// Pagina Metriche: lo stato del nodo XERJ dalle metriche Prometheus (GET /v1/metrics, servito anche sulla porta ES),
// come «Analytics» nella sidebar del concept XERJ Companion di @pilahito (xerj-org/xerj#1755).
// Prometheus dà contatori cumulativi, non serie storiche: la pagina campiona a intervalli finché è aperta e ricava
// tassi (query/s, documenti/s) e quantili di latenza dalla differenza tra due letture, come histogram_quantile.
// Lo storico vive solo in memoria (ultimi MAX campioni). Solo con XERJ e in demo (config.json → pages[].engines).

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t } from '../../core/i18n.js';
import { embed, theme } from '../../core/vega.js';
import { baseSpec } from '../../core/kit.js';

const MAX = 180, EVERY = [0, 2, 5, 10, 30];
let app, samples = [], last = null, timer = null, err = null, connKey = '';
const views = {};
const view = Object.assign({ every: 5 }, store.get('xvb.metrics', {}));
const save = () => store.set('xvb.metrics', view);

const CHARTS = [
  { id: 'qps', title: 'met.c.qps', unit: 'rate', series: [['qps', 'met.s.queries']] },
  { id: 'lat', title: 'met.c.latency', unit: 'ms', series: [['p50', 'p50'], ['p95', 'p95'], ['p99', 'p99']] },
  { id: 'ing', title: 'met.c.ingest', unit: 'rate', series: [['dps', 'met.s.docs']] },
  { id: 'mem', title: 'met.c.memory', unit: 'bytes', series: [['mem', 'met.s.memory'], ['wal', 'met.s.wal']] }
];

const page = {
  id: 'metrics',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <label class="mtlab" for="mtEvery">${t('met.every')}</label>
      <select id="mtEvery">${EVERY.map(s => `<option value="${s}"${s === view.every ? ' selected' : ''}>${s ? t('met.sec', { n: s }) : t('met.paused')}</option>`).join('')}</select>
      <button type="button" class="btn ghost" id="mtNow">${t('met.now')}</button>
      <button type="button" class="btn ghost" id="mtClear">${t('met.clear')}</button>
      <span class="spacer"></span>
      <span class="mtlive" id="mtLive"></span>`;
    slots.main.innerHTML = `<div class="mt">
      <div class="mttiles" id="mtTiles"></div>
      <div class="mtgrid">${CHARTS.map(c => `<section class="ixcard mtcard"><h3>${t(c.title)}</h3><div class="mtchart" id="mtc-${c.id}"></div></section>`).join('')}</div>
      <section class="ixcard mtcard"><h3>${t('met.byIndex')}</h3><div id="mtIdx"></div></section>
      <details class="ixcard mtraw"><summary>${t('met.raw')}</summary><pre id="mtRaw"></pre></details>
    </div>`;
    $('#mtEvery').onchange = e => { view.every = +e.target.value; save(); arm(); paintLive(); };
    $('#mtNow').onclick = () => scrape();
    $('#mtClear').onclick = () => { samples = samples.slice(-1); paint(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) scrape(); });
    await scrape(); arm();
  },
  show() { arm(); scrape(); },
  hide() { clearInterval(timer); timer = null; paintLive(); },
  async refresh() {
    // cambio di connessione: lo storico di un altro nodo non ha senso; tema: i grafici si ridisegnano con i nuovi colori
    for (const k in views) { try { views[k].finalize(); } catch (e) { /* */ } delete views[k]; }
    await scrape();
  }
};
export default page;

function arm() {
  clearInterval(timer); timer = null;
  if (view.every && app.activePage === 'metrics') timer = setInterval(() => { if (!document.hidden) scrape(); }, view.every * 1000);
  paintLive();
}
function paintLive() {
  const el = $('#mtLive'); if (!el) return;
  const on = !!timer && !err;
  el.className = 'mtlive' + (on ? ' on' : err ? ' err' : '');
  el.textContent = err ? t('met.error') : on ? t('met.live', { n: samples.length }) : t('met.stopped', { n: samples.length });
}

/* ---- lettura e calcolo ---- */
async function scrape() {
  const key = app.backend.conn.mode + ' ' + app.backend.conn.url;
  if (key !== connKey) { connKey = key; samples = []; }
  const r = await app.backend.request('GET', 'v1/metrics');
  if (!r.ok || typeof r.body !== 'string') {
    err = { status: r.status, msg: r.body?.error?.reason || r.body?.error?.type || (typeof r.body === 'string' ? r.body.slice(0, 200) : '') || ('HTTP ' + r.status) };
    paintError(); paintLive(); return;
  }
  err = null; last = r.body;
  samples.push({ t: Date.now(), m: parseProm(r.body) });
  if (samples.length > MAX) samples.shift();
  paint();
}

/** Testo Prometheus → Map(«nome{etichette}» → valore). Le etichette restano nella chiave così come sono scritte. */
function parseProm(text) {
  const m = new Map();
  for (const line of String(text).split('\n')) {
    if (!line || line[0] === '#') continue;
    const x = /^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(\S+)/.exec(line); if (!x) continue;
    const v = x[3] === '+Inf' ? Infinity : x[3] === '-Inf' ? -Infinity : +x[3];
    if (!Number.isNaN(v)) m.set(x[1] + (x[2] || ''), v);
  }
  return m;
}
const get = (m, k) => m?.get(k) ?? null;
const sum = (m, prefix) => { let s = null; for (const [k, v] of m) if (k === prefix || k.startsWith(prefix + '{')) s = (s || 0) + v; return s; };
/** Valori per etichetta: «nome{index="x"}» → { x: v }. */
const byLabel = (m, name, label) => {
  const out = {}, re = new RegExp('^' + name + '\\{.*?' + label + '="([^"]*)"');
  for (const [k, v] of m) { const x = re.exec(k); if (x) out[x[1]] = (out[x[1]] || 0) + v; }
  return out;
};
/** Bucket di un istogramma: [[le, conteggio cumulativo]] ordinati. */
const buckets = (m, name) => {
  const out = []; const re = new RegExp('^' + name + '_bucket\\{(?:.*,)?le="([^"]+)"');
  for (const [k, v] of m) { const x = re.exec(k); if (x) out.push([x[1] === '+Inf' ? Infinity : +x[1], v]); }
  return out.sort((a, b) => a[0] - b[0]);
};
/** Quantile da bucket cumulativi (interpolazione lineare nel bucket, come histogram_quantile di Prometheus). */
function quantile(q, bs) {
  const total = bs.length ? bs[bs.length - 1][1] : 0; if (!total) return null;
  const rank = q * total;
  for (let i = 0; i < bs.length; i++) {
    if (bs[i][1] >= rank) {
      const [hi, cHi] = bs[i], [lo, cLo] = i ? bs[i - 1] : [0, 0];
      if (hi === Infinity) return lo;
      return cHi === cLo ? hi : lo + (hi - lo) * (rank - cLo) / (cHi - cLo);
    }
  }
  return null;
}
const diffBuckets = (a, b) => b.map(([le, c], i) => [le, c - (a[i]?.[0] === le ? a[i][1] : 0)]);
const rate = (a, b, k) => { const x = k(a.m), y = k(b.m), dt = (b.t - a.t) / 1000; return x == null || y == null || dt <= 0 || y < x ? null : (y - x) / dt; };

/** Un punto per ogni coppia di campioni consecutivi; i gauge vengono dal campione più recente. */
function points() {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const lat = diffBuckets(buckets(a.m, 'xerj_query_latency_seconds'), buckets(b.m, 'xerj_query_latency_seconds'));
    const ms = q => { const v = quantile(q, lat); return v == null ? null : v * 1000; };
    out.push({ t: b.t, qps: rate(a, b, m => get(m, 'xerj_queries_executed_total')), dps: rate(a, b, m => get(m, 'xerj_docs_indexed_total')),
      p50: ms(0.5), p95: ms(0.95), p99: ms(0.99), mem: get(b.m, 'xerj_memory_usage_bytes'), wal: get(b.m, 'xerj_wal_size_bytes') });
  }
  return out;
}

/* ---- disegno ---- */
const bytes = n => { if (n == null) return '—'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return fmtNum(Math.round(n * 10) / 10) + ' ' + u[i]; };
const ms = s => s == null ? null : s * 1000;
const num = (v, d = 1) => v == null || !isFinite(v) ? '—' : fmtNum(Math.round(v * 10 ** d) / 10 ** d);

function paint() {
  const pts = points(), p = pts[pts.length - 1] || {}, m = samples[samples.length - 1]?.m || new Map();
  const total = buckets(m, 'xerj_query_latency_seconds'), hits = get(m, 'xerj_query_cache_hits'), miss = get(m, 'xerj_query_cache_misses');
  const tiles = [
    ['met.t.qps', num(p.qps), t('met.u.perSec')],
    ['met.t.p50', num(p.p50), 'ms'],
    ['met.t.p95', num(p.p95), 'ms', t('met.t.allTime', { v: num(ms(quantile(0.95, total))) })],
    ['met.t.dps', num(p.dps), t('met.u.perSec')],
    ['met.t.docs', num(get(m, 'xerj_doc_count'), 0)],
    ['met.t.cache', hits == null || !(hits + miss) ? '—' : num(100 * hits / (hits + miss)), '%'],
    ['met.t.active', num(get(m, 'xerj_active_searches'), 0)],
    ['met.t.segments', num(get(m, 'xerj_segment_count'), 0)],
    ['met.t.memory', bytes(get(m, 'xerj_memory_usage_bytes'))],
    ['met.t.wal', bytes(get(m, 'xerj_wal_size_bytes'))]
  ];
  $('#mtTiles').innerHTML = tiles.map(([k, v, u, sub]) => `<div class="mttile"><span>${t(k)}</span><b>${v}${u && v !== '—' ? `<small>${esc(u)}</small>` : ''}</b>${sub ? `<em>${sub}</em>` : ''}</div>`).join('');
  for (const c of CHARTS) chart(c, pts);
  paintIndices();
  $('#mtRaw').textContent = last || '';
  paintLive();
}

async function chart(c, pts) {
  const el = $('#mtc-' + c.id);
  const rows = pts.flatMap(p => c.series.map(([k, lab]) => ({ t: p.t, s: lab.startsWith('met.') ? t(lab) : lab, v: p[k] }))).filter(r => r.v != null);
  if (pts.length < 1) { finalize(c.id); el.innerHTML = `<div class="msg">${t('met.waiting')}</div>`; return; }
  // con pochi punti la linea quasi non si vede: finché sono meno di 3 la spec ha anche i punti (poi si ridisegna senza)
  const dots = pts.length < 3;
  if (views[c.id] && views[c.id].dots !== dots) finalize(c.id);
  if (views[c.id]) { try { await views[c.id].data('rows', rows).runAsync(); return; } catch (e) { finalize(c.id); } }
  const th = theme(), names = c.series.map(([, lab]) => lab.startsWith('met.') ? t(lab) : lab);
  const fmt = c.unit === 'bytes' ? '.3~s' : ',.1f';
  const spec = { ...baseSpec(150), datasets: { rows }, data: { name: 'rows' },
    mark: { type: 'line', interpolate: 'monotone', strokeWidth: 1.8, point: dots ? { size: 36, filled: true } : false },
    encoding: {
      x: { field: 't', type: 'temporal', title: null, axis: { tickCount: 5, labelOverlap: true, format: '%H:%M:%S' } },
      y: { field: 'v', type: 'quantitative', title: c.unit === 'ms' ? 'ms' : c.unit === 'rate' ? t('met.u.perSec') : null, axis: { tickCount: 4, format: c.unit === 'bytes' ? '.2~s' : '~s' }, scale: { zero: true } },
      color: { field: 's', type: 'nominal', title: null, scale: { domain: names, range: th.c.slice(0, names.length) }, legend: names.length > 1 ? { orient: 'top', direction: 'horizontal' } : null },
      tooltip: [{ field: 't', type: 'temporal', title: t('met.time'), format: '%H:%M:%S' }, { field: 's', title: t('met.series') }, { field: 'v', type: 'quantitative', title: t('met.value'), format: fmt }]
    } };
  try { views[c.id] = await embed(el, spec); views[c.id].dots = dots; } catch (e) { el.innerHTML = `<div class="msg err"><code>${esc(e.message)}</code></div>`; }
}
function finalize(id) { try { views[id]?.finalize(); } catch (e) { /* */ } delete views[id]; }

function paintIndices() {
  const b = samples[samples.length - 1], a = samples[samples.length - 2];
  const qb = byLabel(b.m, 'xerj_queries_by_index_total', 'index'), db = byLabel(b.m, 'xerj_docs_indexed_by_index_total', 'index');
  const qa = a ? byLabel(a.m, 'xerj_queries_by_index_total', 'index') : {}, da = a ? byLabel(a.m, 'xerj_docs_indexed_by_index_total', 'index') : {};
  const dt = a ? (b.t - a.t) / 1000 : 0, r = (x, y) => a && x != null && y != null && y >= x ? (y - x) / dt : null;
  const names = [...new Set([...Object.keys(qb), ...Object.keys(db)])].sort((x, y) => (qb[y] || 0) - (qb[x] || 0));
  $('#mtIdx').innerHTML = names.length ? `<table class="dvw mttable"><thead><tr><th>${t('met.i.index')}</th><th>${t('met.i.qps')}</th><th>${t('met.i.queries')}</th><th>${t('met.i.dps')}</th><th>${t('met.i.docs')}</th></tr></thead><tbody>
    ${names.map(n => `<tr><td><code>${esc(n)}</code></td><td>${num(r(qa[n], qb[n]))}</td><td>${num(qb[n], 0)}</td><td>${num(r(da[n], db[n]))}</td><td>${num(db[n], 0)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="help">${t('met.noIndex')}</p>`;
}

function paintError() {
  const missing = err.status === 404, auth = err.status === 401 || err.status === 403;
  $('#mtTiles').innerHTML = `<div class="msg err cpoff mterr"><b>${missing ? t('met.noApi') : auth ? t('met.noAuth') : t('met.failed')}</b>
    <span>${missing ? t('met.noApiHelp') : auth ? t('met.noAuthHelp') : ''}</span><code>${esc(err.msg)}</code></div>`;
}
