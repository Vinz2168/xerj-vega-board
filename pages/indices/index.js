// Pagina Indici: elenco degli indici con mapping e impostazioni, e gestione degli index pattern
// (come i data view di Kibana: un nome con wildcard e il campo tempo da proporre in Discover e nelle dashboard).
// Solo con XERJ e in demo (config.json → pages[].engines): con Elasticsearch/OpenSearch la board resta quella classica.

import { $, esc, store, fmtNum, wild } from '../../core/util.js';
import { t } from '../../core/i18n.js';
import { confirm } from '../../core/ui.js';
import { kindOf } from '../../core/backend.js';

let app, view = Object.assign({ tab: 'indices', filter: '', system: false, sel: '', detail: 'mapping' }, store.get('xvb.indices', {}));
let rows = [], patterns = [];
const save = () => store.set('xvb.indices', view);
const bytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return fmtNum(Math.round(n * 10) / 10) + ' ' + u[i]; };
const errMsg = r => r.body?.error?.reason || r.body?.error?.type || ('HTTP ' + r.status);

const page = {
  id: 'indices',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <div class="seg" role="tablist" id="ixTabs">
        <label><input type="radio" name="ixTab" value="indices">${t('idx.tabIndices')}</label>
        <label><input type="radio" name="ixTab" value="patterns">${t('idx.tabPatterns')}</label>
      </div>
      <label class="vh" for="ixFilter">${t('idx.filter')}</label>
      <input type="search" id="ixFilter" class="ixfilter" placeholder="${t('idx.filter')}" value="${esc(view.filter)}">
      <label class="ixsys"><input type="checkbox" id="ixSys"${view.system ? ' checked' : ''}> ${t('idx.system')}</label>
      <span class="spacer"></span>
      <button type="button" class="btn primary" id="ixNew">${t('idx.newPattern')}</button>
      <button type="button" class="btn ghost" id="ixReload">${t('idx.reload')}</button>`;
    slots.main.innerHTML = `<div class="ix"><section class="ixcard ixlist" id="ixList"></section><section class="ixcard ixdet" id="ixDet"></section></div>`;
    slots.bar.querySelector(`input[value="${view.tab}"]`).checked = true;
    $('#ixTabs').addEventListener('change', e => { view.tab = e.target.value; view.sel = ''; save(); paint(); });
    $('#ixFilter').addEventListener('input', e => { view.filter = e.target.value; save(); paintList(); });
    $('#ixSys').addEventListener('change', e => { view.system = e.target.checked; save(); paintList(); });
    $('#ixReload').addEventListener('click', () => page.refresh());
    $('#ixNew').addEventListener('click', () => editPattern({ title: view.tab === 'indices' && view.sel ? view.sel.replace(/[-_.]?[^-_.]*$/, '') + '*' : '', timefield: '' }));
    $('#ixList').addEventListener('click', e => {
      const b = e.target.closest('[data-sel]'); if (!b) return;
      view.sel = b.dataset.sel; save(); paintList(); paintDetail();
    });
    await page.refresh();
  },
  async refresh() {
    const list = $('#ixList'); list.classList.add('loading');
    try {
      const r = await app.backend.request('GET', '_cat/indices?format=json&bytes=b&h=health,status,index,docs.count,store.size');
      if (!r.ok) throw new Error(errMsg(r));
      rows = (Array.isArray(r.body) ? r.body : []).sort((a, b) => a.index.localeCompare(b.index));
      patterns = await app.backend.listPatterns();
    } catch (e) {
      rows = []; list.innerHTML = `<div class="msg err"><b>${t('idx.failed')}</b><code>${esc(e.message)}</code></div>`;
    }
    list.classList.remove('loading');
    paint();
  }
};
export default page;

function paint() {
  $('#ixSys').closest('label').hidden = view.tab !== 'indices';
  paintList(); paintDetail();
}

const visible = () => rows.filter(r => (view.system || !r.index.startsWith('.')) && (!view.filter || r.index.toLowerCase().includes(view.filter.toLowerCase())));
const matching = title => rows.filter(r => title.split(',').some(p => wild(r.index, p.trim())));

function paintList() {
  const el = $('#ixList');
  if (view.tab === 'indices') {
    const vs = visible();
    if (!vs.some(r => r.index === view.sel)) view.sel = vs[0]?.index || '';
    el.innerHTML = `<div class="ixhead"><b>${t('idx.count', { n: fmtNum(vs.length) })}</b><span>${t('idx.docs')}</span><span>${t('idx.size')}</span></div>
      <ul class="ixrows">${vs.map(r => `<li><button type="button" data-sel="${esc(r.index)}" aria-pressed="${r.index === view.sel}">
        <span class="hl ${esc(r.health)}" title="${esc(r.health)}"></span><span class="nm">${esc(r.index)}</span>
        <span class="num">${fmtNum(+r['docs.count'] || 0)}</span><span class="num">${bytes(r['store.size'])}</span></button></li>`).join('')
        || `<li class="msg">${t('idx.none')}</li>`}</ul>`;
  } else {
    const ps = patterns.filter(p => !view.filter || p.title.toLowerCase().includes(view.filter.toLowerCase()));
    if (!ps.some(p => p.id === view.sel)) view.sel = ps[0]?.id || '';
    el.innerHTML = `<div class="ixhead"><b>${t('idx.patternCount', { n: fmtNum(ps.length) })}</b><span>${t('idx.matches')}</span><span>${t('idx.timefield')}</span></div>
      <ul class="ixrows">${ps.map(p => `<li><button type="button" data-sel="${esc(p.id)}" aria-pressed="${p.id === view.sel}">
        <span class="hl pat"></span><span class="nm">${esc(p.title)}</span>
        <span class="num">${fmtNum(matching(p.title).length)}</span><span class="num tf">${esc(p.timefield || '—')}</span></button></li>`).join('')
        || `<li class="msg"><b>${t('idx.noPatterns')}</b><span>${t('idx.noPatternsHelp')}</span></li>`}</ul>`;
  }
}

async function paintDetail() {
  const el = $('#ixDet');
  if (!view.sel) { el.innerHTML = ''; return; }
  if (view.tab === 'patterns') return paintPattern(el, patterns.find(p => p.id === view.sel));
  const name = view.sel, row = rows.find(r => r.index === name);
  el.innerHTML = `<div class="ixdh">
      <div><span class="eyebrow">${t('idx.index')}</span><h2>${esc(name)}</h2>
        <p class="ixmeta">${row ? `${esc(row.health)} · ${esc(row.status)} · ${t('idx.nDocs', { n: fmtNum(+row['docs.count'] || 0) })} · ${bytes(row['store.size'])}` : ''}</p></div>
      <div class="mrow"><button type="button" class="btn ghost" id="ixDisc">${t('idx.openDiscover')}</button></div></div>
    <div class="dtabs" role="tablist">${['mapping', 'json', 'settings'].map(k => `<button type="button" role="tab" data-d="${k}" aria-selected="${view.detail === k}">${t('idx.d.' + k)}</button>`).join('')}</div>
    <div class="ixbody loading" id="ixBody"></div>`;
  $('#ixDisc').onclick = () => app.navigate('discover', { index: name });
  el.querySelector('.dtabs').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { view.detail = b.dataset.d; save(); paintDetail(); } };
  const body = $('#ixBody');
  const r = await app.backend.request('GET', encodeURIComponent(name) + (view.detail === 'settings' ? '/_settings' : '/_mapping'));
  if (view.sel !== name || !body.isConnected) return;
  body.classList.remove('loading');
  if (!r.ok) { body.innerHTML = `<div class="msg err"><code>${esc(errMsg(r))}</code></div>`; return; }
  if (view.detail === 'mapping') {
    const props = Object.values(r.body || {})[0]?.mappings?.properties || {};
    const flat = flatten(props);
    body.innerHTML = flat.length ? `<table class="dvw ixmap"><thead><tr><th>${t('idx.field')}</th><th>${t('idx.type')}</th><th>${t('idx.kind')}</th></tr></thead><tbody>
      ${flat.map(f => `<tr><td style="padding-left:${6 + f.depth * 16}px"><code>${esc(f.name)}</code></td><td><span class="ft ${esc(kindOf(f.type) || '')}">${esc((kindOf(f.type) || f.type || '?')[0].toUpperCase())}</span> ${esc(f.type || 'object')}</td><td>${esc(f.extra)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="msg">${t('idx.noFields')}</div>`;
  } else body.innerHTML = `<pre class="djson">${esc(JSON.stringify(r.body, null, 2))}</pre>`;
}

/** properties → righe {name, type, depth, extra}: oggetti annidati indentati, sottocampi (fields) come righe figlie. */
function flatten(props, depth = 0, out = []) {
  for (const [k, v] of Object.entries(props)) {
    const extra = [v.format && 'format: ' + v.format, v.index === false && 'index: false', v.dims && 'dims: ' + v.dims, v.analyzer && 'analyzer: ' + v.analyzer].filter(Boolean).join(' · ');
    out.push({ name: k, type: v.type || (v.properties ? 'object' : ''), depth, extra });
    if (v.properties) flatten(v.properties, depth + 1, out);
    for (const [sk, sv] of Object.entries(v.fields || {})) out.push({ name: k + '.' + sk, type: sv.type, depth: depth + 1, extra: t('idx.subfield') });
  }
  return out;
}

async function paintPattern(el, p) {
  if (!p) { el.innerHTML = ''; return; }
  const m = matching(p.title), fields = await app.backend.fields(p.title);
  el.innerHTML = `<div class="ixdh">
      <div><span class="eyebrow">${t('idx.pattern')}</span><h2>${esc(p.title)}</h2>
        <p class="ixmeta">${t('idx.patternMeta', { n: fmtNum(m.length), f: fmtNum(fields.length) })} · ${p.timefield ? t('idx.timeIs', { f: '<code>' + esc(p.timefield) + '</code>' }) : t('idx.noTime')}</p></div>
      <div class="mrow">
        <button type="button" class="btn ghost" id="ixPDisc">${t('idx.openDiscover')}</button>
        <button type="button" class="btn" id="ixPEdit">${t('idx.edit')}</button>
        <button type="button" class="btn danger-ghost" id="ixPDel">${t('idx.delete')}</button></div></div>
    <div class="ixbody">
      <h3 class="ixh3">${t('idx.matchingIndices')}</h3>
      <div class="ixchips">${m.map(r => `<span class="chip"><b>${esc(r.index)}</b><span>${fmtNum(+r['docs.count'] || 0)}</span></span>`).join('') || `<span class="none">${t('idx.noMatch')}</span>`}</div>
      <h3 class="ixh3">${t('idx.fields')}</h3>
      <table class="dvw"><thead><tr><th>${t('idx.field')}</th><th>${t('idx.kind')}</th></tr></thead><tbody>
        ${fields.map(f => `<tr><td><code>${esc(f.name)}</code>${f.primary ? ` <span class="badge">${t('idx.timefield')}</span>` : ''}</td><td><span class="ft ${esc(f.type)}">${esc(f.type[0].toUpperCase())}</span> ${esc(t('type.' + f.type))}</td></tr>`).join('')}</tbody></table>
    </div>`;
  $('#ixPDisc').onclick = () => app.navigate('discover', { index: p.title });
  $('#ixPEdit').onclick = () => editPattern(p);
  $('#ixPDel').onclick = () => removePattern(p);
}

/** Modale di creazione/modifica: il campo tempo si sceglie tra i campi data degli indici che il pattern copre. */
function editPattern(p) {
  const box = app.modal.open(`<h2>${p.id ? t('idx.editPattern') : t('idx.newPattern')}</h2>
    <p>${t('idx.patternHelp')}</p>
    <div class="f"><label for="ipTitle">${t('idx.pattern')}</label><input type="text" id="ipTitle" value="${esc(p.title)}" placeholder="ax-*" spellcheck="false" autocomplete="off"${p.id ? ' readonly' : ''}></div>
    <p class="help" id="ipMatch"></p>
    <div class="f"><label for="ipTime">${t('idx.timefield')}</label><select id="ipTime"></select></div>
    <div class="result" id="ipRes" role="status"></div>
    <div class="mrow"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button type="button" class="btn primary" id="ipSave">${t('common.save')}</button></div>`);
  const ti = $('#ipTitle', box), tm = $('#ipTime', box), res = $('#ipRes', box);
  let seq = 0;
  const sync = async () => {
    const title = ti.value.trim(), my = ++seq, m = title ? matching(title) : [];
    $('#ipMatch', box).innerHTML = title ? (m.length ? t('idx.willMatch', { n: m.length, list: m.slice(0, 6).map(r => '<code>' + esc(r.index) + '</code>').join(', ') + (m.length > 6 ? '…' : '') }) : t('idx.noMatch')) : '';
    const dates = title ? (await app.backend.fields(title)).filter(f => f.type === 'date') : [];
    if (my !== seq) return;
    const cur = tm.value || p.timefield;
    tm.innerHTML = `<option value="">${t('idx.noTimeOpt')}</option>` + dates.map(f => `<option value="${esc(f.name)}"${f.name === cur ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
  };
  ti.addEventListener('input', () => { tm.value = ''; sync(); });
  sync(); if (!p.id) ti.focus();
  $('#ipSave', box).onclick = async () => {
    const title = ti.value.trim();
    if (!title) { res.className = 'result bad'; res.textContent = t('idx.titleRequired'); return; }
    if (!p.id && patterns.some(x => x.title === title)) { res.className = 'result bad'; res.textContent = t('idx.exists'); return; }
    try {
      const d = await app.backend.savePattern({ id: p.id, title, timefield: tm.value });
      app.modal.close(); view.tab = 'patterns'; view.sel = d.id; save();
      $('#ixTabs').querySelector('input[value="patterns"]').checked = true;
      app.toast(t('idx.saved', { p: title }));
      patternsChanged();
    } catch (e) { res.className = 'result bad'; res.textContent = e.message; }
  };
}

// i pattern compaiono nei selettori di indice delle altre pagine: le segna da aggiornare (lo fanno alla prossima visita)
// e ridisegna questa, come la shell fa per tempo e connessione
const patternsChanged = () => app.refreshActive();

async function removePattern(p) {
  if (!await confirm({ title: t('idx.deleteTitle', { p: p.title }), html: t('idx.deleteHelp'), ok: t('idx.delete'), danger: true })) return;
  try {
    await app.backend.deletePattern(p.id);
    patternsChanged();
    app.toast(t('idx.deleted', { p: p.title }), t('common.undo'), async () => { await app.backend.savePattern(p); view.sel = p.id; save(); patternsChanged(); });
  } catch (e) { app.toast(e.message); }
}
