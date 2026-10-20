// Pagina Ricerca: codice e documenti indicizzati da `xerj autoindex` (indici ax-*), senza modelli («zero-token»).
// Query «defs-first» come `xerj search`: multi_match + match_phrase sulle definizioni + term sul nome del simbolo.
// Il risultato scelto mostra il blocco che lo contiene (`fields: ["_passage"]` di XERJ) o, per un simbolo,
// le righe line..end_line prese dal documento del file. Cronologia delle ricerche nel browser.
// Solo con XERJ e in demo (config.json → pages[].engines).

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t, locale } from '../../core/i18n.js';

// schede: gruppi di ax_format (i formati non elencati hanno una scheda col proprio nome)
const GROUPS = [
  ['code', ['code', 'js', 'ts', 'jsx', 'tsx', 'rs', 'py', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'rb', 'php', 'swift', 'sh']],   // autoindex scrive «code», i pack del Corpus Hub l'estensione
  ['docs', ['txt-prose', 'txt-lines', 'markdown', 'html', 'pdf', 'docx', 'eml', 'mbox']],
  ['data', ['json', 'ndjson', 'csv', 'tsv', 'yaml', 'toml', 'xml', 'log']]
];
const SOURCE = ['ax_path', 'ax_file', 'ax_locator', 'line', 'start_line', 'end_line', 'language', 'kind', 'name', 'code', 'title', 'ax_format'];
const SIZE = 12, MAX_LINES = 80, RECENT = 15;
const ICON = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  clock: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
};

let app, hits = [], aggs = null, total = 0, took = 0, sel = 0, seq = 0;
const st = Object.assign({ q: '', index: '', tab: 'all' }, store.get('xvb.search', {}));
let recent = store.get('xvb.search.recent', []);
const save = () => store.set('xvb.search', st);
const defaultIndex = () => app.backend.isDemo() ? 'ax-orbit' : 'ax-*';

const page = {
  id: 'search',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <form class="qwrap sq" id="sqForm" role="search">
        <span class="sqi">${ICON.search}</span>
        <label class="vh" for="sqText">${t('srch.label')}</label>
        <input type="search" id="sqText" placeholder="${esc(t('srch.placeholder'))}" value="${esc(st.q)}" autocomplete="off" spellcheck="false">
        <button type="submit" class="btn primary">${t('srch.go')}</button>
      </form>
      <label class="vh" for="sqIndex">${t('srch.index')}</label>
      <select id="sqIndex" title="${esc(t('srch.index'))}"></select>`;
    slots.main.innerHTML = `<div class="sv">
      <div class="svmain">
        <div class="svtabs" id="sqTabs" role="tablist"></div>
        <div id="sqBody"></div>
      </div>
      <aside class="svside">
        <section class="svcard"><div class="svch">${ICON.clock}<h3>${t('srch.recent')}</h3><button type="button" class="linkbtn" id="sqClear">${t('srch.clear')}</button></div><ul class="svrecent" id="sqRecent"></ul></section>
        <section class="svcard"><div class="svch"><h3>${t('srch.corpus')}</h3></div><div id="sqCorpus"></div></section>
      </aside></div>`;
    $('#sqForm').addEventListener('submit', e => { e.preventDefault(); st.q = $('#sqText').value.trim(); st.tab = 'all'; save(); run(true); });
    $('#sqIndex').addEventListener('change', e => { st.index = e.target.value; save(); run(); corpus(); });
    $('#sqTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { st.tab = b.dataset.tab; save(); run(); } });
    $('#sqRecent').addEventListener('click', e => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      st.q = b.dataset.q; if (b.dataset.i) st.index = b.dataset.i; st.tab = 'all'; save();
      $('#sqText').value = st.q; $('#sqIndex').value = st.index; run(true);
    });
    $('#sqClear').addEventListener('click', () => { recent = []; store.set('xvb.search.recent', recent); paintRecent(); });
    $('#sqBody').addEventListener('click', e => {
      const r = e.target.closest('[data-hit]'); if (r) { sel = +r.dataset.hit; paintResults(); $('#sqBody').scrollIntoView({ block: 'nearest' }); return; }
      const ex = e.target.closest('[data-ex]'); if (ex) { st.q = ex.dataset.ex; $('#sqText').value = st.q; save(); run(true); return; }
      if (e.target.closest('#sqCopy')) copy();
    });
    await page.refresh();
  },
  async refresh() {
    const list = [...new Set([defaultIndex(), ...(st.index ? [st.index] : []), ...(await app.backend.indices().catch(() => []))])];
    if (!st.index) st.index = defaultIndex();
    $('#sqIndex').innerHTML = list.map(i => `<option value="${esc(i)}"${i === st.index ? ' selected' : ''}>${esc(i)}</option>`).join('');
    paintRecent(); corpus();
    await run();
  },
  show() { $('#sqText')?.focus(); },
  /** Da altre pagine (es. Corpus): { index, q } apre la ricerca su quegli indici. */
  async onIntent(i) {
    if (i.index) { st.index = i.index; st.tab = 'all'; }
    if (i.q != null) { st.q = i.q; $('#sqText').value = i.q; }
    save(); await page.refresh(); if (st.q) await run(true);
  }
};
export default page;

/* ---- ricerca ---- */
function queryOf(q) {
  return { bool: {
    should: [
      { multi_match: { query: q, fields: ['name^4', 'defs^3', 'code^2', 'body', 'title', 'text'], type: 'most_fields' } },
      { match_phrase: { defs: { query: q, boost: 8 } } },
      { term: { name: { value: q, boost: 10 } } }
    ],
    minimum_should_match: 1,
    filter: [{ exists: { field: 'ax_path' } }]   // solo documenti scritti da autoindex
  } };
}
const groupOf = fmt => (GROUPS.find(([, fs]) => fs.includes(fmt)) || [fmt])[0];
const formatsOf = tab => (GROUPS.find(([g]) => g === tab) || [tab, [tab]])[1];

async function run(remember = false) {
  const body = $('#sqBody'), my = ++seq;
  paintTabs();
  if (!st.q) { hits = []; aggs = null; body.innerHTML = intro(); return; }
  body.classList.add('loading');
  const q = queryOf(st.q);
  // due ricerche in un _msearch: i risultati (filtrati per scheda) e i conteggi di tutte le schede.
  // Non post_filter: XERJ rc.74 lo ignora.
  const hitsQ = st.tab === 'all' ? q : { bool: { ...q.bool, filter: [...q.bool.filter, { terms: { ax_format: formatsOf(st.tab) } }] } };
  let res;
  try {
    res = await app.backend.msearch([
      { index: st.index, body: { size: SIZE, query: hitsQ, _source: SOURCE, fields: ['_passage'], highlight: { fields: { body: {}, code: {}, text: {} }, fragment_size: 160, number_of_fragments: 1 } } },
      { index: st.index, body: { size: 0, query: q, aggs: { f: { terms: { field: 'ax_format', size: 30 } }, l: { terms: { field: 'language', size: 8 } } } } }
    ]);
  } catch (e) { res = [{ error: { reason: e.message } }]; }
  if (my !== seq) return;
  body.classList.remove('loading');
  const [h, c] = res;
  if (h.error) { body.innerHTML = `<div class="svcard msg err"><b>${t('srch.failed')}</b><code>${esc(h.error.reason || h.error.type || JSON.stringify(h.error))}</code></div>`; aggs = null; paintTabs(); return; }
  hits = h.hits.hits; total = h.hits.total?.value ?? h.hits.total ?? 0; took = h.took || 0; sel = 0;
  aggs = c && !c.error ? c.aggregations : null;
  paintTabs(); paintResults();
  if (remember) {
    recent = [{ q: st.q, i: st.index, at: Date.now(), n: total }, ...recent.filter(r => r.q !== st.q || r.i !== st.index)].slice(0, RECENT);
    store.set('xvb.search.recent', recent); paintRecent();
  }
}

function paintTabs() {
  const el = $('#sqTabs'); if (!el) return;
  const counts = new Map();
  for (const b of aggs?.f?.buckets || []) { const g = groupOf(b.key); counts.set(g, (counts.get(g) || 0) + b.doc_count); }
  const all = [...counts.values()].reduce((a, b) => a + b, 0);
  const tabs = [['all', all], ...GROUPS.map(([g]) => [g, counts.get(g) || 0]).filter(([g, n]) => n || g === st.tab), ...[...counts].filter(([g]) => !GROUPS.some(([x]) => x === g))];
  el.innerHTML = tabs.map(([g, n]) => `<button type="button" role="tab" data-tab="${esc(g)}" aria-selected="${g === st.tab}">${esc(t('srch.tab.' + g) === 'srch.tab.' + g ? g : t('srch.tab.' + g))}${aggs ? `<span>${fmtNum(n)}</span>` : ''}</button>`).join('');
}

function intro() {
  const ex = app.backend.isDemo() ? ['resume checkpoint', 'fingerprint', 'merge segments', 'QueryHistory'] : ['function', 'README', 'config'];
  return `<div class="svcard svintro"><div class="svhero">${ICON.search}</div><h2>${t('srch.introTitle')}</h2><p>${t('srch.introText')}</p>
    <div class="svex">${ex.map(x => `<button type="button" class="chipbtn" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div></div>`;
}

/* ---- risultati ---- */
const srcOf = h => h._source || {};
const lineOf = h => srcOf(h).line ?? srcOf(h).start_line;
const label = h => { const s = srcOf(h); return s.kind ? `${s.kind} ${s.name || s.title || ''}` : (s.title || s.ax_path || h._id); };

function paintResults() {
  const el = $('#sqBody');
  if (!hits.length) { el.innerHTML = `<div class="svcard msg"><b>${t('srch.noHits', { q: esc(st.q) })}</b><span>${t('srch.noHitsHelp', { cmd: '<code>xerj autoindex &lt;folder&gt;</code>' })}</span></div>`; return; }
  const h = hits[sel], s = srcOf(h);
  el.innerHTML = `<section class="svcard svbest">
      <div class="svbh"><span class="svspark">✦</span><h2>${sel === 0 ? t('srch.best') : t('srch.selected')}</h2>
        <span class="pill ok">${esc(t('srch.local'))}</span><span class="spacer"></span>
        <span class="svmeta">${t('srch.stats', { n: fmtNum(total), ms: fmtNum(took) })}</span></div>
      <p class="svsum">${summary(h)}</p>
      <div class="svcode"><div class="svfile"><span class="svlang">${esc((s.language || s.ax_format || '?').slice(0, 2).toUpperCase())}</span><b>${esc((s.ax_path || '').split('/').pop())}</b><span class="svpath">— ${esc(s.ax_path || '')}</span><span class="spacer"></span>
        <button type="button" class="btn ghost" id="sqCopy">${ICON.copy}<span>${t('common.copy')}</span></button></div>
        <div class="svpre loading" id="sqCode"></div></div>
    </section>
    <h3 class="svh3">${t('srch.refs')}</h3>
    <div class="svrefs">${hits.map((x, i) => ref(x, i)).join('')}</div>`;
  loadCode(h);
}

function summary(h) {
  const s = srcOf(h), where = `<code>${esc(s.ax_path || '')}${lineOf(h) ? ':' + lineOf(h) : ''}</code>`;
  if (s.kind) return t('srch.sumSymbol', { kind: esc(s.kind), name: `<code>${esc(s.name || s.title)}</code>`, where });
  return t('srch.sumText', { where, fmt: esc(s.ax_format || '') });
}

function ref(h, i) {
  const s = srcOf(h), hl = Object.values(h.highlight || {})[0]?.[0];
  const snip = hl ? esc(hl).replace(/&lt;em&gt;/g, '<mark>').replace(/&lt;\/em&gt;/g, '</mark>') : esc(s.code || passageOf(h)?.text?.slice(0, 160) || '');
  const ln = lineOf(h);
  return `<button type="button" class="svref" data-hit="${i}" aria-pressed="${i === sel}">
    <span class="svri">${ICON.file}</span>
    <span class="svrt"><b>${esc(label(h))}</b><span class="svpath">${esc(s.ax_path || '')}</span></span>
    <span class="svrs">${snip}</span>
    <span class="svrf">${i === 0 ? `<span class="pill ok">${t('srch.bestBadge')}</span>` : `<span class="svfmt">${esc(s.ax_format || '')}</span>`}<span class="spacer"></span>${ln ? `<span class="svln">L${ln}${s.end_line ? '–L' + s.end_line : ''}</span>` : ''}</span>
  </button>`;
}
const passageOf = h => { const p = h.fields?._passage?.[0]; return typeof p === 'string' ? { text: p } : p; };

/** Testo da mostrare e prima riga: simbolo → righe line..end_line dal documento del file; altrimenti il passage. */
async function loadCode(h) {
  const box = $('#sqCode'), my = seq, s = srcOf(h);
  let text = null, first = 1, focus = null;
  try {
    if (s.kind && s.ax_file) {
      const r = await app.backend.search(h._index, { size: 1, query: { bool: { filter: [{ term: { ax_file: s.ax_file } }, { term: { ax_locator: 'code' } }] } }, _source: ['body', 'symbols'] });
      const f = r.hits?.hits?.[0]?._source;
      if (f?.body) {
        const sym = (f.symbols || []).find(x => x.line === s.line && (!s.name || x.name === s.name));
        const lines = f.body.split('\n'), a = s.line || 1, b = sym?.end_line || Math.min(lines.length, a + 30);
        text = lines.slice(a - 1, b).join('\n'); first = a; focus = a;
      }
    }
    if (text == null) {
      const p = passageOf(h);
      if (p?.text) {
        text = p.text;
        if (p.field === 'body' && p.start_offset > 0) {
          const d = await app.backend.request('GET', encodeURIComponent(h._index) + '/_doc/' + encodeURIComponent(h._id));
          const b = d.body?._source?.body;
          if (typeof b === 'string') first = b.slice(0, p.start_offset).split('\n').length + (srcOf(h).start_line ? srcOf(h).start_line - 1 : 0);
        } else if (s.start_line) first = s.start_line;
      } else text = s.code || s.title || '';
    }
  } catch (e) { text = s.code || s.title || ''; }
  if (my !== seq || !box.isConnected) return;
  const lines = text.replace(/\s+$/, '').split('\n'), cut = lines.length > MAX_LINES;
  box.dataset.text = text;
  box.classList.remove('loading');
  const lang = s.ax_format === 'code' ? s.language : null;
  box.innerHTML = `<table><tbody>${lines.slice(0, MAX_LINES).map((l, i) => `<tr${first + i === focus ? ' class="on"' : ''}><td class="ln">${first + i}</td><td class="lc">${lang ? hlCode(l, lang) : hlText(l)}</td></tr>`).join('')}</tbody></table>
    ${cut ? `<p class="svcut">${t('srch.more', { n: lines.length - MAX_LINES })}</p>` : ''}`;
}

async function copy() {
  const text = $('#sqCode')?.dataset.text; if (!text) return;
  try { await navigator.clipboard.writeText(text); app.toast(t('common.copied')); } catch (e) { app.toast(t('common.selectedCopy')); }
}

/* ---- evidenziazione: sintassi leggera per il codice, termini della query per il testo ---- */
const KW = new Set(('as async await break case catch class const continue crate def default del do elif else enum except export extends false fn for from function '
  + 'if impl import in interface let loop match mod move mut new None not null or pass pub raise return self Self static struct super switch this throw trait true '
  + 'True False try type typeof use var void where while with yield').split(' '));
const TOKEN = /(\/\/.*$|#(?![\[!]).*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_]\w*)(?=\s*\()|([A-Za-z_]\w*)/g;
function hlCode(line, lang) {
  const hash = ['python', 'bash', 'shell', 'ruby', 'toml', 'yaml'].includes(lang);
  let out = '', last = 0;
  for (const m of line.matchAll(TOKEN)) {
    let cls = m[1] ? 'cm' : m[2] ? 'st' : m[3] ? 'nu' : m[4] ? (KW.has(m[4]) ? 'kw' : 'fn') : KW.has(m[5]) ? 'kw' : /^[A-Z]/.test(m[5]) ? 'ty' : '';
    if (m[1] && m[1].startsWith('#') && !hash) cls = lang === 'rust' && m[1].startsWith('#[') ? 'kw' : '';
    if (m[1] && !cls) { out += esc(line.slice(last, m.index + 1)); last = m.index + 1; continue; }   // '#' fuori dai linguaggi con commenti #: carattere normale
    out += esc(line.slice(last, m.index)) + (cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]));
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last)) || ' ';
}
function hlText(line) {
  const ws = st.q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(w => w.length > 2);
  if (!ws.length) return esc(line) || ' ';
  const re = new RegExp('(' + ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return line.split(re).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join('') || ' ';
}

/* ---- colonna destra ---- */
function ago(ms) {
  const s = (ms - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto', style: 'short' });
  for (const [u, n] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return rtf.format(0, 'minute');
}
function paintRecent() {
  const el = $('#sqRecent'); if (!el) return;
  el.innerHTML = recent.map(r => `<li><button type="button" data-q="${esc(r.q)}" data-i="${esc(r.i || '')}" title="${esc(r.i || '')}">${ICON.clock}<span>${esc(r.q)}</span><time>${esc(ago(r.at))}</time></button></li>`).join('')
    || `<li class="none">${t('srch.noRecent')}</li>`;
}
async function corpus() {
  const el = $('#sqCorpus'); if (!el) return;
  const r = await app.backend.request('GET', '_cat/indices/' + encodeURIComponent(st.index) + '?format=json&bytes=b&h=index,docs.count,store.size').catch(e => ({ ok: false, body: { error: { reason: e.message } } }));
  if (!r.ok || !Array.isArray(r.body)) { el.innerHTML = `<p class="none">${t('srch.noCorpus', { cmd: '<code>xerj autoindex &lt;folder&gt;</code>' })}</p>`; return; }
  const docs = r.body.reduce((a, x) => a + (+x['docs.count'] || 0), 0);
  const langs = aggs?.l?.buckets || [];
  el.innerHTML = `<div class="svstat"><div><span>${t('srch.indices')}</span><b>${fmtNum(r.body.length)}</b></div><div><span>${t('srch.documents')}</span><b>${fmtNum(docs)}</b></div></div>
    <ul class="svidx">${r.body.sort((a, b) => b['docs.count'] - a['docs.count']).slice(0, 8).map(x => `<li><code>${esc(x.index)}</code><span>${fmtNum(+x['docs.count'] || 0)}</span></li>`).join('')}</ul>
    ${langs.length ? `<p class="help">${t('srch.languages')}: ${langs.map(b => esc(b.key) + ' ' + fmtNum(b.doc_count)).join(' · ')}</p>` : ''}`;
}
