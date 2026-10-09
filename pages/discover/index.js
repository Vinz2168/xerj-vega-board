// Pagina Discover: istogramma, lista campi con valori più frequenti, documenti espandibili, filtri include/esclude.

import { $, esc, store, fmtNum, fmtDate, totalHits, getPath, hlHtml, opts, debounce, vAttr, vRead, HL_PRE, HL_POST } from '../../core/util.js';
import { autoIv } from '../../core/time.js';
import { buildQuery, toQueryString } from '../../core/query.js';
import { embed, theme } from '../../core/vega.js';
import { brushParam, baseSpec, tipTime } from '../../core/kit.js';
import { timePicker, queryBar, filterChips, pickField, typeLabel } from '../../core/ui.js';
import { t } from '../../core/i18n.js';

const PAGE = 50, FROM_CAP = 10000;
const GLYPH = { date: 'D', keyword: 'K', number: '#', text: 'T' };
let app, el = {}, qbar, chips;
const disc = Object.assign({ index: '', timefield: '', query: '', filters: [], columns: [], sortAsc: false }, store.get('xvb.disc', {}));
const open = new Map();
let idxList = [], hits = [], total = 0, seqN = 0, view = null, fieldOpen = null, fieldFind = '', lastErr = '';

const save = () => store.set('xvb.disc', { index: disc.index, timefield: disc.timefield, query: disc.query, filters: disc.filters, columns: disc.columns, sortAsc: disc.sortAsc });
const fields = () => app.backend.cachedFields(disc.index);
const typeOf = n => (fields().find(f => f.name === n) || {}).type;
const key = h => h._index + '/' + h._id;

export default {
  id: 'discover',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `<div id="disc-tp"></div><form id="disc-q"></form>`;
    timePicker($('#disc-tp'), app, 'disc');
    qbar = queryBar($('#disc-q'), { placeholder: t('disc.queryPlaceholder'), value: disc.query, onSubmit: v => { disc.query = v; save(); render(); } });
    chips = filterChips(slots.filters, () => disc.filters, i => { disc.filters.splice(i, 1); save(); chips.render(); render(); });
    slots.main.innerHTML = `<div class="dview">
      <aside class="dside" id="dside" aria-label="${t('disc.sideLabel')}"></aside>
      <div class="dmain"><div class="dtop" id="dtop"></div><div class="dhist" id="dhist"></div><div class="dtw" id="dtw"></div><div class="dfoot" id="dfoot"></div></div></div>`;
    el.main = slots.main;
    wire();
    app.on('connection', () => { fieldOpen = null; open.clear(); });
    await render();
  },
  refresh: () => render(),
  /** Intent: { index?, query?, filters? } per aprire Discover già filtrato (es. da un pannello). */
  async onIntent(i) {
    if (i.index) { disc.index = i.index; disc.columns = []; }
    if (i.query != null) { disc.query = i.query; qbar.set(i.query); }
    if (i.filters) disc.filters = i.filters;
    save(); chips.render(); await render();
  }
};

function query(tr) { return buildQuery({ timefield: disc.timefield, tr, state: disc, fields: fields() }); }
function body(tr, from) {
  const b = { size: PAGE, from, track_total_hits: true, query: query(tr) };
  if (disc.timefield) b.sort = [{ [disc.timefield]: { order: disc.sortAsc ? 'asc' : 'desc' } }];
  if (disc.query?.trim()) b.highlight = { pre_tags: [HL_PRE], post_tags: [HL_POST], require_field_match: false, fragment_size: 300, number_of_fragments: 1, fields: { '*': {} } };
  return b;
}

async function render() {
  const idx = idxList = await app.backend.indices().catch(() => []);
  if (!idx.includes(disc.index)) disc.index = idx[0] || '';
  const fl = await app.backend.fields(disc.index);
  if (!fl.some(f => f.name === disc.timefield && f.type === 'date')) disc.timefield = pickField(fl, 'date');
  disc.columns = disc.columns.filter(c => fl.some(f => f.name === c));
  save(); renderSide(idx);
  if (!disc.index) { $('#dtop').innerHTML = ''; $('#dhist').innerHTML = ''; $('#dtw').innerHTML = `<div class="msg" style="padding:40px">${t('disc.noIndex')}</div>`; $('#dfoot').innerHTML = ''; return; }
  const my = ++seqN, tr = app.time.range(), iv = autoIv(tr.to - tr.from, 60);
  const b = body(tr, 0);
  if (disc.timefield) b.aggs = { t: { date_histogram: { field: disc.timefield, fixed_interval: iv[0], min_doc_count: 0, extended_bounds: { min: tr.from, max: tr.to } } } };
  $('#dhist').classList.add('loading'); $('#dtw').classList.add('loading');
  let r;
  try { r = await app.backend.search(disc.index, b); } catch (e) { r = { error: { reason: t('disc.connFailed', { msg: e.message }) } }; }
  if (my !== seqN) return;
  $('#dhist').classList.remove('loading'); $('#dtw').classList.remove('loading');
  if (r.error) { lastErr = r.error.reason || r.error.type || 'errore'; hits = []; total = 0; }
  else { lastErr = ''; hits = r.hits.hits; total = totalHits(r); }
  $('#dtop').innerHTML = `<span class="count">${fmtNum(total)}</span><span class="sub">${esc(t(total === 1 ? 'disc.docIn' : 'disc.docsIn', { index: disc.index }))} · ${r.took ?? '–'} ms</span>
    <button type="button" class="btn" data-act="todash" title="${t('disc.toDashTitle')}">${t('disc.toDash')}</button>`;
  renderHist(r.error ? [] : (r.aggregations?.t?.buckets || []), iv);
  renderTable();
}
async function loadMore() {
  const my = seqN, btn = $('#dMore'); if (btn) { btn.disabled = true; btn.textContent = t('common.loading'); }
  let r; try { r = await app.backend.search(disc.index, body(app.time.range(), hits.length)); } catch (e) { r = { error: { reason: e.message } }; }
  if (my !== seqN) return;
  if (r.error) { app.toast(t('disc.loadFailed', { msg: r.error.reason || '' })); renderTable(); return; }
  hits = hits.concat(r.hits.hits); renderTable();
}
async function renderHist(buckets, iv) {
  const h = $('#dhist');
  try { view?.finalize(); } catch (e) { /* */ } view = null;
  if (!disc.timefield) { h.innerHTML = `<div class="msg">${t('disc.noDate')}</div>`; return; }
  const th = theme(), rows = buckets.map(b => ({ t: b.key, t2: b.key + iv[1] * 0.86, v: b.doc_count }));
  const spec = { ...baseSpec(96), data: { values: rows }, params: [brushParam(th)], mark: { type: 'bar', color: th.c[0], cornerRadiusEnd: 1 },
    encoding: { x: { field: 't', type: 'temporal', title: null, axis: { tickCount: 8, labelOverlap: true, grid: false } }, x2: { field: 't2' },
      y: { field: 'v', type: 'quantitative', title: null, axis: { tickCount: 3 } }, y2: { datum: 0 },
      tooltip: [{ ...tipTime, title: t('chart.from') }, { field: 'v', type: 'quantitative', title: t('chart.docs'), format: ',d' }] } };
  try { view = await embed(h, spec); } catch (e) { h.innerHTML = `<div class="msg err"><code>${esc(e.message)}</code></div>`; }
}

function cell(h, name) {
  const hl = h.highlight?.[name]; if (hl) return hlHtml(hl[0]);
  const v = getPath(h._source || {}, name);
  if (v == null) return '<span class="none">—</span>';
  if (typeOf(name) === 'date') return esc(fmtDate(v));
  return esc(typeof v === 'object' ? JSON.stringify(v) : v);
}
function flat(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, pre + k + '.', out); else out[pre + k] = v; }
  return out;
}
function renderTable() {
  const tw = $('#dtw'), foot = $('#dfoot');
  if (lastErr) { tw.innerHTML = `<div class="msg err" style="padding:32px"><b>${t('panel.engineError')}</b><code>${esc(lastErr)}</code></div>`; foot.innerHTML = ''; return; }
  if (!hits.length) { tw.innerHTML = `<div class="msg" style="padding:40px">${t('disc.noDocs')}</div>`; foot.innerHTML = ''; return; }
  const cols = disc.columns, span = 2 + Math.max(cols.length, 1), fl = fields();
  const head = `<tr><th></th><th>${disc.timefield ? `<button type="button" data-act="sort" title="${t('disc.sort')}">${esc(disc.timefield)} ${disc.sortAsc ? '↑' : '↓'}</button>` : '_id'}</th>` +
    (cols.length ? cols.map(c => `<th>${esc(c)}<button type="button" class="rm" data-act="col" data-f="${esc(c)}" aria-label="${esc(t('disc.colRemove', { field: c }))}">×</button></th>`).join('') : `<th>${t('disc.document')}</th>`) + '</tr>';
  const rowsHtml = hits.map((h, i) => {
    const k = key(h), mode = open.get(k), src = h._source || {};
    const tcell = disc.timefield ? esc(fmtDate(getPath(src, disc.timefield))) : esc(h._id);
    let cells;
    if (cols.length) cells = cols.map(c => `<td class="c">${cell(h, c)}</td>`).join('');
    else {
      const f = flat(src); delete f[disc.timefield];
      const hk = Object.keys(h.highlight || {}).filter(x => x in f);
      cells = `<td class="c"><div class="summary">${[...hk, ...Object.keys(f).filter(x => !hk.includes(x))].map(x => `<span class="kv"><b>${esc(x)}</b>${cell(h, x)}</span>`).join('')}</div></td>`;
    }
    let out = `<tr class="${mode ? 'open' : ''}"><td><button type="button" class="exp" data-act="exp" data-i="${i}" aria-expanded="${!!mode}" aria-label="${t('disc.details')}">▸</button></td><td class="t">${tcell}</td>${cells}</tr>`;
    if (mode) {
      const det = mode === 'json' ? `<pre class="djson">${esc(JSON.stringify(src, null, 2))}</pre>` :
        `<table class="dkv"><tbody>${Object.entries(flat(src)).map(([f, v]) => {
          const hasKw = fl.some(x => x.name === f + '.keyword'), ty = typeOf(f) || (hasKw ? 'text' : '');
          const ff = ty === 'text' && hasKw ? f + '.keyword' : f, phrase = ty === 'text' && !hasKw;
          const can = v != null && typeof v !== 'object' && ty && ty !== 'date', on = cols.includes(f);
          const fb = neg => `<button type="button" data-act="filt"${neg ? ' data-neg' : ''} data-f="${esc(ff)}" data-v="${vAttr(v)}"${phrase ? ' data-phrase' : ''} title="${t(neg ? 'disc.excludeValue' : 'disc.filterValue')}" aria-label="${t(neg ? 'disc.excludeValue' : 'disc.filterValue')}">${neg ? '−' : '+'}</button>`;
          return `<tr><td>${esc(f)}</td><td class="v">${cell(h, f)}</td><td><span class="ib">${can ? fb(false) + fb(true) : ''}<button type="button" data-act="col" data-f="${esc(f)}" title="${t(on ? 'disc.colOff' : 'disc.colOn')}" aria-label="${t(on ? 'disc.colOff' : 'disc.colOn')}">${on ? '◧' : '▤'}</button></span></td></tr>`;
        }).join('')}</tbody></table>`;
      out += `<tr class="ddet"><td colspan="${span}"><div class="dtabs" role="tablist"><button type="button" role="tab" data-act="dtab" data-i="${i}" data-t="tab" aria-selected="${mode !== 'json'}">${t('disc.table')}</button><button type="button" role="tab" data-act="dtab" data-i="${i}" data-t="json" aria-selected="${mode === 'json'}">JSON</button><span class="docid">${esc(h._index)} / ${esc(h._id)}</span></div>${det}</td></tr>`;
    }
    return out;
  }).join('');
  tw.innerHTML = `<table class="dtbl"><thead>${head}</thead><tbody>${rowsHtml}</tbody></table>`;
  const more = hits.length < total && hits.length < FROM_CAP;
  foot.innerHTML = `<span>${esc(t('disc.shown', { n: fmtNum(hits.length), total: fmtNum(total) }))}</span>` +
    (more ? `<button type="button" class="btn" id="dMore" data-act="more">${t('disc.more', { n: PAGE })}</button>` : (hits.length >= FROM_CAP ? `<span>${t('disc.cap')}</span>` : ''));
}
function renderSide(idx = idxList) {
  const fl = fields(), dates = fl.filter(f => f.type === 'date'), find = fieldFind.toLowerCase();
  const row = f => {
    const on = disc.columns.includes(f.name);
    return `<div class="frow"><button type="button" class="fname" data-act="fname" data-f="${esc(f.name)}" aria-expanded="${fieldOpen === f.name}"><i class="ft ${f.type}" title="${typeLabel(f.type)}">${GLYPH[f.type]}</i><span>${esc(f.name)}</span></button><button type="button" class="fadd${on ? ' on' : ''}" data-act="col" data-f="${esc(f.name)}" aria-label="${esc(t(on ? 'disc.colOffNamed' : 'disc.colOnNamed', { field: f.name }))}" title="${t(on ? 'disc.colOff' : 'disc.colOn')}">${on ? '−' : '+'}</button></div>`
      + (fieldOpen === f.name ? `<div class="fdet" id="fdet">${t('disc.computing')}</div>` : '');
  };
  const sel = disc.columns.map(c => fl.find(f => f.name === c)).filter(Boolean);
  const avail = fl.filter(f => !disc.columns.includes(f.name) && (!find || f.name.toLowerCase().includes(find)));
  $('#dside').innerHTML = `<div class="f"><label for="dIndex">${t('param.index')}</label><select id="dIndex">${opts((idx || []).map(i => [i, i]), disc.index)}</select></div>
    ${dates.length > 1 ? `<div class="f"><label for="dTime">${t('param.timefield')}</label><select id="dTime">${opts(dates.map(f => [f.name, f.name]), disc.timefield)}</select></div>` : ''}
    <div class="f"><label for="dFind">${t('disc.findField')}</label><input type="search" id="dFind" value="${esc(fieldFind)}" placeholder="${t('disc.findPlaceholder')}" autocomplete="off"></div>
    ${sel.length ? `<h4>${t('disc.columns')}</h4><div class="flist">${sel.map(row).join('')}</div>` : ''}
    <h4>${t('disc.fields')} · ${avail.length}</h4><div class="flist">${avail.map(row).join('') || `<p class="help">${t('disc.noFieldMatch')}</p>`}</div>`;
  if (fieldOpen) fieldDetails(fieldOpen);
}
async function fieldDetails(name) {
  const f = fields().find(x => x.name === name), box = () => $('#fdet');
  if (!f || !box()) return;
  if (f.type === 'text') { box().innerHTML = '<span class="muted">' + t('disc.textField') + (fields().some(x => x.name === name + '.keyword') ? ' ' + t('disc.useKeyword', { field: '<code>' + esc(name) + '.keyword</code>' }) : '') + '</span>'; return; }
  const aggs = { c: { value_count: { field: name } } };
  if (f.type === 'keyword') aggs.v = { terms: { field: name, size: 5 } };
  else { aggs.mn = { min: { field: name } }; aggs.mx = { max: { field: name } }; if (f.type === 'number') aggs.av = { avg: { field: name } }; }
  let r; try { r = await app.backend.search(disc.index, { size: 0, track_total_hits: true, query: query(app.time.range()), aggs }); } catch (e) { r = { error: { reason: e.message } }; }
  const b = box(); if (!b || fieldOpen !== name) return;
  if (r.error) { b.innerHTML = `<span class="muted">${esc(r.error.reason || 'Errore')}</span>`; return; }
  const tot = totalHits(r), cnt = r.aggregations?.c?.value ?? 0;
  const pres = `<span class="muted">${esc(t('disc.presence', { pct: tot ? fmtNum(Math.min(100, cnt / tot * 100)) : 0, total: fmtNum(tot) }))}</span>`;
  if (f.type === 'keyword') {
    const bs = r.aggregations?.v?.buckets || [];
    b.innerHTML = (bs.length ? `<div class="tv">${bs.map(x => { const pct = tot ? x.doc_count / tot * 100 : 0; return `<span class="lab" title="${esc(x.key)}">${esc(x.key)}</span><span class="pct">${fmtNum(pct)}%</span><span class="ib"><button type="button" data-act="filt" data-f="${esc(name)}" data-v="${vAttr(x.key)}" aria-label="${esc(t('disc.filterFor', { v: x.key }))}" title="${t('disc.filter')}">+</button><button type="button" data-act="filt" data-neg data-f="${esc(name)}" data-v="${vAttr(x.key)}" aria-label="${esc(t('disc.excludeFor', { v: x.key }))}" title="${t('disc.exclude')}">−</button></span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>`; }).join('')}</div>` : `<span class="muted">${t('disc.noValues')}</span>`) + pres;
  } else {
    const fm = v => v == null ? '—' : f.type === 'date' ? fmtDate(v) : fmtNum(v);
    b.innerHTML = `<div class="stats"><div><span>${t('stat.min')}</span><b>${esc(fm(r.aggregations.mn?.value))}</b></div>${f.type === 'number' ? `<div><span>${t('stat.avg')}</span><b>${esc(fm(r.aggregations.av?.value))}</b></div>` : ''}<div><span>${t('stat.max')}</span><b>${esc(fm(r.aggregations.mx?.value))}</b></div></div>${pres}`;
  }
}
function addFilter(field, value, neg, phrase) {
  const ex = disc.filters.find(f => f.field === field && String(f.value) === String(value));
  if (ex) { if (!!ex.neg === neg) return; ex.neg = neg; } else disc.filters.push({ field, value, ...(neg ? { neg: true } : {}), ...(phrase ? { phrase: true } : {}) });
  save(); chips.render(); render();
}
function toggleCol(name) {
  const i = disc.columns.indexOf(name);
  if (i >= 0) disc.columns.splice(i, 1); else disc.columns.push(name);
  save(); renderSide(); renderTable();
}
function wire() {
  el.main.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'exp') { const k = key(hits[+b.dataset.i]); if (open.has(k)) open.delete(k); else open.set(k, 'tab'); renderTable(); }
    else if (a === 'dtab') { open.set(key(hits[+b.dataset.i]), b.dataset.t); renderTable(); }
    else if (a === 'col') toggleCol(b.dataset.f);
    else if (a === 'fname') { fieldOpen = fieldOpen === b.dataset.f ? null : b.dataset.f; renderSide(); }
    else if (a === 'filt') addFilter(b.dataset.f, vRead(b.dataset.v), b.dataset.neg !== undefined, b.dataset.phrase !== undefined);
    else if (a === 'sort') { disc.sortAsc = !disc.sortAsc; save(); render(); }
    else if (a === 'more') loadMore();
    else if (a === 'todash') app.navigate('dashboard', { addPanel: { type: 'table', title: 'Discover · ' + disc.index, w: 12, h: 'm',
      params: { index: disc.index, timefield: disc.timefield, columns: [...disc.columns], size: 20, filter: toQueryString(disc) } } });
  });
  el.main.addEventListener('change', async e => {
    if (e.target.id === 'dIndex') { disc.index = e.target.value; disc.columns = []; disc.filters = []; fieldOpen = null; open.clear(); chips.render(); await render(); }
    if (e.target.id === 'dTime') { disc.timefield = e.target.value; render(); }
  });
  el.main.addEventListener('input', e => {
    if (e.target.id !== 'dFind') return;
    fieldFind = e.target.value;
    debounce('dfind', () => { renderSide(); const i = $('#dFind'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 150);
  });
}
