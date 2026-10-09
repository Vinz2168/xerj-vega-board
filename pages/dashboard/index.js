// Pagina Dashboard: griglia di pannelli, catalogo dei widget registrati, editor laterale, salvataggio.

import { $, esc, uid, slug, clone, opts, fmtNum, totalHits, debounce, vAttr, vRead } from '../../core/util.js';
import { pickIv } from '../../core/time.js';
import { buildQuery } from '../../core/query.js';
import { HEIGHTS, validateDashboard } from '../../core/contract.js';
import { embed, theme } from '../../core/vega.js';
import { ICON, timePicker, queryBar, filterChips, paramControl, autofill, confirm } from '../../core/ui.js';
import { t, L } from '../../core/i18n.js';

let app, el = {}, dash = null, list = [], dirty = false, editing = false, activeId = null;
let views = {}, seq = {}, pstate = {}, syncingTime = false, qbar, chips;
const seen = {};   // pannello → { campo, valori } disegnati con ctx.color: alimenta la sezione Colori dell'editor
const W = () => app.widgets;
const getP = id => dash.panels.find(p => p.id === id);
const H = p => HEIGHTS[p.h] || HEIGHTS.m;
// widget con `control: true` (es. elenco opzioni): vanno nella barra dei controlli sopra la griglia, come in Kibana
const isCtl = p => !!W().get(p.type)?.control;
const hostOf = p => isCtl(p) ? el.ctl : el.grid;
const panelClass = p => (isCtl(p) ? 'panel ctl' : 'panel') + ' w' + p.w;
const syncCtlBar = () => { el.ctl.hidden = !el.ctl.children.length; };

export default {
  id: 'dashboard',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <div class="tp-host" id="dash-tp"></div>
      <form id="dash-q"></form>
      <div class="actions">
        <label class="vh" for="dashSel">${t('dash.saved')}</label><select id="dashSel"></select>
        <button id="btnEdit" class="btn" type="button">${t('dash.edit')}</button>
        <button id="btnSave" class="btn primary" type="button" disabled>${t('common.save')}</button>
        <button id="btnJson" class="btn ghost" type="button">JSON</button>
        <button id="btnDelDash" class="btn danger-ghost edit-only" type="button">${t('dash.delete')}</button>
      </div>`;
    timePicker($('#dash-tp'), app, 'dash');
    qbar = queryBar($('#dash-q'), { placeholder: t('dash.queryPlaceholder'), onSubmit: v => { dash.query = v; markDirty(); renderPanels(); } });
    chips = filterChips(slots.filters, () => dash?.filters, i => { dash.filters.splice(i, 1); markDirty(); chips.render(); renderPanels(); });

    slots.main.innerHTML = `<div class="dash-body"><aside class="palette" id="palette" aria-label="${t('dash.catalog')}"></aside><div class="board" id="board"><div class="ctlbar" id="ctlbar" hidden aria-label="${t('dash.controls')}"></div><div class="grid" id="grid"></div></div></div>`;
    el.board = $('#board'); el.ctl = $('#ctlbar'); el.grid = $('#grid'); el.palette = $('#palette');
    el.drawer = document.createElement('aside'); el.drawer.className = 'drawer'; el.drawer.setAttribute('aria-label', t('dash.configure')); el.drawer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el.drawer);

    renderPalette(); wireGrid(); wireDrawer(); wireHeader();
    app.on('time', v => { if (syncingTime || !dash || app.activePage !== 'dashboard') return; dash.time = v; dash.refresh = app.time.refresh; markDirty(); });
    app.on('connection', () => loadList());
    let rsT; new ResizeObserver(() => { clearTimeout(rsT); rsT = setTimeout(() => window.dispatchEvent(new Event('resize')), 120); }).observe(el.grid);
    await loadList();
  },
  show() { if (dash) app.setTitle(dash.title, { editable: editing, onInput: onTitle }); },
  hide() { closeDrawer(); },
  refresh: () => renderPanels(),
  /** Intent da altre pagine: { addPanel: {type, title, w, h, params} } */
  async onIntent(intent) {
    if (intent?.addPanel) {
      const p = { id: uid(), w: 12, h: 'm', ...clone(intent.addPanel) };
      const w = W().get(p.type); if (w) autofill(w, p.params, await app.backend.fields(p.params.index));
      if (!dash.panels.length) el.grid.innerHTML = '';
      dash.panels.push(p); hostOf(p).appendChild(panelEl(p)); syncCtlBar(); markDirty(); setEditing(true); renderPanels([p.id]);
      el.board.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ block: 'nearest' });
      app.toast(t('dash.panelAdded', { title: dash.title }));
    }
  }
};

/* ---------- caricamento e salvataggio ---------- */
async function loadList(selectId) {
  try {
    let l = await app.backend.listDash();
    if (l == null) { // demo mai usata: carica gli esempi
      l = await (await fetch(new URL('pages/dashboard/examples.json', app.base))).json();
      l.forEach(localize);   // titoli degli esempi in { en, it }: si fissano nella lingua corrente al primo caricamento
      app.backend.seedDemo(l);
    }
    list = l.map(localize);
  } catch (e) { list = []; app.toast(t('dash.listFailed', { msg: e.message })); }
  list.sort((a, b) => a.title.localeCompare(b.title, 'it'));
  const want = selectId || dash?.id || app.backend.isDemo() && 'web-traffic';
  const d = list.find(x => x.id === want) || list[0];
  if (d) loadDash(d); else newDash();
}
/** Titoli scritti come { en, it } (esempi, dashboard create da un agent) → stringa nella lingua attiva. */
function localize(d) {
  if (d && typeof d === 'object') { d.title = L(d.title); for (const p of d.panels || []) p.title = L(p.title); }
  return d;
}
function loadDash(d) {
  dash = localize(clone(d)); dash.filters ||= []; dash.panels ||= [];
  activeId = null; closeDrawer(); pstate = {};
  syncingTime = true;
  app.time.set(dash.time || '7d', { remember: false, silent: true });
  if (dash.refresh != null && dash.refresh !== app.time.refresh) app.time.setRefresh(dash.refresh);
  app.time.clearHistory();
  syncingTime = false;
  renderHeader(); clearDirty(); chips.render(); renderGrid(); renderPanels();
}
function newDash() {
  loadDash({ id: 'dashboard-' + uid(), title: t('dash.new'), time: app.time.value, query: '', filters: [], panels: [] });
  setEditing(true); markDirty();
}
function renderHeader() {
  if (app.activePage === 'dashboard') app.setTitle(dash.title, { editable: editing, onInput: onTitle });
  qbar.set(dash.query);
  const items = [...list]; if (!items.some(d => d.id === dash.id)) items.push(dash);
  $('#dashSel').innerHTML = items.map(d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('') + '<option value="__new">＋ ' + esc(t('dash.new')) + '</option>';
  $('#dashSel').value = dash.id;
}
const onTitle = v => { dash.title = v; markDirty(); };
function markDirty() { dirty = true; const s = $('#btnSave'); s.disabled = false; s.classList.add('dirty'); paintEditBtn(); }
function clearDirty() { dirty = false; const s = $('#btnSave'); s.disabled = true; s.classList.remove('dirty'); paintEditBtn(); }
/** Come in Kibana: in modifica, con cambiamenti non salvati, il pulsante dice che uscire vuol dire salvare. */
function paintEditBtn() {
  const b = $('#btnEdit'); if (!b) return;
  b.textContent = !editing ? t('dash.edit') : dirty ? t('dash.saveAndClose') : t('dash.done');
  b.classList.toggle('on', editing);
}
/** Salva la dashboard corrente. Ritorna true se il salvataggio è riuscito. */
async function save() {
  const oldId = dash.id;
  dash.title = (dash.title || '').trim() || t('dash.untitled');
  // l'id resta quello della dashboard (rinominare cambia solo il titolo, niente duplicati);
  // solo una dashboard nuova, con id provvisorio, prende l'id dallo slug del titolo
  if (oldId.startsWith('dashboard-')) dash.id = slug(dash.title);
  dash.time = app.time.value; dash.refresh = app.time.refresh;
  try {
    await app.backend.saveDash(dash, oldId.startsWith('dashboard-') ? oldId : null);
    list = list.filter(d => d.id !== dash.id && d.id !== oldId); list.push(clone(dash)); list.sort((a, b) => a.title.localeCompare(b.title, 'it'));
    clearDirty(); renderHeader();
    app.toast(app.backend.isDemo() ? t('dash.savedLocal') : t('dash.savedRemote', { index: app.backend.dashboardIndex, id: dash.id }));
    return true;
  } catch (e) { dash.id = oldId; app.toast(t('dash.saveFailed', { msg: e.message })); return false; }
}

function wireHeader() {
  $('#dashSel').addEventListener('change', e => {
    const v = e.target.value;
    const go = () => { if (v === '__new') newDash(); else loadDash(list.find(d => d.id === v)); };
    if (dirty) { e.target.value = dash.id; app.toast(t('dash.unsaved'), t('dash.discard'), go); } else go();
  });
  // «Modifica» entra in modifica; in uscita, se ci sono cambiamenti, «Salva e chiudi» salva prima (se fallisce si resta in modifica)
  $('#btnEdit').addEventListener('click', async () => {
    if (!editing) { setEditing(true); return; }
    const b = $('#btnEdit'); b.disabled = true;
    try { if (!dirty || await save()) setEditing(false); } finally { b.disabled = false; }
  });
  $('#btnSave').addEventListener('click', () => save());
  // ricaricare o chiudere la pagina in modifica con cambiamenti non salvati: il browser chiede conferma
  // (fuori da «Modifica» cambiano solo tempo, query e filtri: come in Kibana non si avvisa)
  window.addEventListener('beforeunload', e => { if (dirty && editing) { e.preventDefault(); e.returnValue = ''; } });
  $('#btnDelDash').addEventListener('click', async () => {
    const d = clone(dash), saved = list.some(x => x.id === d.id);
    const where = app.backend.isDemo() ? t('dash.whereLocal') : '<code>' + esc(app.backend.dashboardIndex) + '</code>';
    const ok = await confirm({ title: t('dash.confirmDelete'), danger: true, ok: t('dash.delete'),
      html: saved ? t('dash.confirmDeleteText', { title: '<b>' + esc(d.title) + '</b>', where }) : t('dash.confirmDiscardText', { title: '<b>' + esc(d.title) + '</b>' }) });
    if (!ok) return;
    if (saved) {
      try { await app.backend.deleteDash(d.id); } catch (e) { app.toast(t('dash.deleteFailed', { msg: e.message })); return; }
    }
    list = list.filter(x => x.id !== d.id);
    if (list.length) loadDash(list[0]); else newDash();
    if (!saved) return;
    app.toast(t('dash.deleted', { title: d.title }), t('common.undo'), async () => {
      try {
        await app.backend.saveDash(d);
        list = list.filter(x => x.id !== d.id); list.push(clone(d)); list.sort((a, b) => a.title.localeCompare(b.title, 'it'));
        loadDash(d);
      } catch (e) { app.toast(t('dash.saveFailed', { msg: e.message })); }
    });
  });
  $('#btnJson').addEventListener('click', () => {
    const box = app.modal.open(`<h2>${t('dash.jsonTitle')}</h2>
      <p>${t('dash.jsonHelp', { index: '<code>' + esc(app.backend.dashboardIndex) + '</code>', schema: '<code>schemas/dashboard.schema.json</code>' })}</p>
      <label class="vh" for="jTxt">${t('dash.jsonTitle')}</label><textarea id="jTxt" spellcheck="false">${esc(JSON.stringify(dash, null, 2))}</textarea>
      <p class="jerr" id="jErr" hidden></p>
      <div class="mrow"><button type="button" class="btn ghost" id="jCopy">${t('common.copy')}</button><button type="button" class="btn ghost" data-close>${t('common.close')}</button><button type="button" class="btn primary" id="jApply">${t('common.apply')}</button></div>`);
    $('#jCopy', box).onclick = async () => { const ta = $('#jTxt'); try { await navigator.clipboard.writeText(ta.value); app.toast(t('common.copied')); } catch (e) { ta.select(); app.toast(t('common.selectedCopy')); } };
    $('#jApply', box).onclick = () => {
      const err = $('#jErr');
      try {
        const d = JSON.parse($('#jTxt').value);
        const errs = validateDashboard(d, W()); if (errs.length) throw new Error(errs.join('; '));
        for (const p of d.panels) { const w = W().get(p.type); p.id ||= uid(); p.params = { ...w.init, ...(p.params || {}) }; p.w ||= w.defaults?.w || 6; p.h ||= w.defaults?.h || 'm'; }
        d.id ||= slug(d.title);
        app.modal.close(); loadDash(d); markDirty();
      } catch (e) { err.hidden = false; err.textContent = t('dash.notApplicable', { msg: e.message }); }
    };
  });
}
function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  paintEditBtn();
  if (app.activePage === 'dashboard') app.setTitle(dash.title, { editable: on, onInput: onTitle });
  el.board.querySelectorAll('.panel').forEach(a => { a.draggable = on; });
  if (!on) closeDrawer();
  if (!dash.panels.length) renderGrid();
}

/* ---------- catalogo ---------- */
function renderPalette() {
  const all = [...W().values()];
  const group = (src, title) => {
    const ws = all.filter(w => w.source === src); if (!ws.length) return '';
    return `<h3>${title}</h3><div class="wlist">${ws.map(w => `<button type="button" class="witem" data-add="${esc(w.type)}">${w.icon || ICON.widget}<div><b>${esc(L(w.name))}${w.overrides ? ` <i class="badge">${t('dash.overrides')}</i>` : ''}</b><span>${esc(L(w.desc) || '')}</span></div></button>`).join('')}</div>`;
  };
  el.palette.innerHTML = `<h2>${t('dash.catalog')}</h2><p class="lead">${t('dash.catalogLead')}</p>` + group('dist', t('dash.standard')) + group('custom', t('dash.custom'));
  el.palette.addEventListener('click', e => { const b = e.target.closest('[data-add]'); if (b) addPanel(b.dataset.add); });
}
async function addPanel(type) {
  const w = W().get(type), idx = await app.backend.indices().catch(() => []);
  const last = dash.panels[dash.panels.length - 1];
  // un controllo senza titolo mostra il nome del campo come etichetta
  const p = { id: uid(), type, title: w.control ? '' : L(w.name), w: w.defaults?.w || 6, h: w.defaults?.h || 'm', params: clone(w.init || {}) };
  p.params.index = last?.params.index || idx[0] || '';
  autofill(w, p.params, await app.backend.fields(p.params.index));
  if (!dash.panels.length) el.grid.innerHTML = '';
  dash.panels.push(p); hostOf(p).appendChild(panelEl(p)); syncCtlBar(); markDirty();
  renderPanels([p.id]); openDrawer(p.id);
  el.board.querySelector(`[data-id="${p.id}"]`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
}

/* ---------- griglia ---------- */
function panelEl(p) {
  const a = document.createElement('article');
  a.className = panelClass(p); a.dataset.id = p.id; a.style.setProperty('--w', p.w); a.draggable = editing;
  const tools = `<div class="tools"><button type="button" data-act="cfg" aria-label="${t('panel.configure')}" title="${t('panel.configure')}">${ICON.cfg}</button><button type="button" data-act="dup" aria-label="${t('panel.duplicate')}" title="${t('panel.duplicate')}">${ICON.dup}</button><button type="button" data-act="del" aria-label="${t('panel.remove')}" title="${t('panel.remove')}">${ICON.del}</button></div>`;
  // controllo: niente intestazione né altezza fissa, solo maniglia e strumenti (in modifica) ai lati
  if (isCtl(p)) { a.innerHTML = `<span class="grip" aria-hidden="true">⋮⋮</span><div class="pb"></div>${tools}`; return a; }
  a.innerHTML = `<header class="ph"><span class="grip" aria-hidden="true">⋮⋮</span><h3>${esc(p.title)}</h3><span class="meta"></span>
    <div class="tools"><button type="button" data-act="cfg" aria-label="${t('panel.configure')}" title="${t('panel.configure')}">${ICON.cfg}</button><button type="button" data-act="dup" aria-label="${t('panel.duplicate')}" title="${t('panel.duplicate')}">${ICON.dup}</button><button type="button" data-act="del" aria-label="${t('panel.remove')}" title="${t('panel.remove')}">${ICON.del}</button></div></header>
    <div class="pb" style="height:${H(p) + 20}px"></div>`;
  return a;
}
function renderGrid() {
  Object.values(views).forEach(v => { try { v.finalize(); } catch (e) { /* già chiusa */ } }); views = {};
  el.grid.innerHTML = ''; el.ctl.innerHTML = '';
  if (!dash.panels.length) {
    el.grid.innerHTML = `<div class="empty"><b>${t('dash.empty')}</b>${editing ? t('dash.emptyEditing') : t('dash.emptyView')}</div>`;
    syncCtlBar(); return;
  }
  for (const p of dash.panels) hostOf(p).appendChild(panelEl(p));
  syncCtlBar();
  if (activeId) el.board.querySelector(`[data-id="${activeId}"]`)?.classList.add('active');
}
const pbOf = id => el.board.querySelector(`[data-id="${id}"] .pb`);
const setMeta = (id, t) => { const m = el.board.querySelector(`[data-id="${id}"] .meta`); if (m) m.textContent = t || ''; };
function showMsg(id, html, err) {
  const b = pbOf(id); if (!b) return;
  b.classList.remove('loading'); try { views[id]?.finalize(); } catch (e) { /* */ } delete views[id];
  b.innerHTML = `<div class="msg${err ? ' err' : ''}">${html}</div>`;
}

async function renderPanels(ids) {
  if (!dash) return;
  const ps = ids ? dash.panels.filter(p => ids.includes(p.id)) : dash.panels;
  const fieldsBy = {};
  await Promise.all([...new Set(ps.map(p => p.params.index).filter(Boolean))].map(async i => { fieldsBy[i] = await app.backend.fields(i); }));
  const tr = app.time.range(), jobs = [];
  for (const p of ps) {
    const b = pbOf(p.id); if (!b) continue;
    const w = W().get(p.type), my = seq[p.id] = (seq[p.id] || 0) + 1;
    if (!w) { showMsg(p.id, `<b>${esc(t('panel.unregistered', { type: p.type }))}</b><span>${t('panel.unregisteredHelp')}</span>`, true); continue; }
    try {
      if (!p.params.index) throw new Error(t('panel.chooseIndex'));
      const fields = fieldsBy[p.params.index] || [];
      const c = makeCtx(p, w, tr, fields);
      b.classList.add('loading');
      jobs.push({ p, w, c, my, req: { index: p.params.index, body: w.query(p.params, c) } });
    } catch (e) { showMsg(p.id, `<b>${t('panel.incomplete')}</b><span>${esc(e.message)}</span>`, true); setMeta(p.id, ''); }
  }
  if (!jobs.length) return;
  let res;
  try { res = await app.backend.msearch(jobs.map(j => j.req)); }
  catch (e) {
    jobs.forEach(j => { if (seq[j.p.id] === j.my) { showMsg(j.p.id, `<b>${t('panel.connFailed')}</b><code>${esc(e.message)}</code>`, true); setMeta(j.p.id, ''); } });
    return;
  }
  const th = theme();
  await Promise.all(jobs.map((j, i) => { if (seq[j.p.id] === j.my) { j.c.theme = th; return draw(j, res[i]); } }));
  if (activeId && jobs.some(j => j.p.id === activeId)) paintColors();
}
/** Contesto passato ai widget: vedi AGENTS.md → "ctx". */
function makeCtx(p, w, tr, fields) {
  const c = {
    tr, fields, height: H(p), panelId: p.id, title: p.title,
    iv: pickIv(p.params.interval, tr, w.target || 40),
    q: buildQuery({ timefield: p.params.timefield, tr, state: dash, fields, extra: p.params.filter }),
    state: (pstate[p.id] ||= {}),
    rerender: () => renderPanels([p.id]),
    setQuery: v => { dash.query = v; qbar.set(v); markDirty(); renderPanels(); app.toast(t('dash.queryApplied')); },
    addFilter: (field, value, neg) => addFilter(field, value, neg),
    // selettore di valori: query senza i filtri di pagina su quel campo, valori attuali, sostituzione della selezione
    queryWithout: field => buildQuery({ timefield: p.params.timefield, tr, state: dash, fields, extra: p.params.filter, except: field }),
    filterValues: (field, neg = false) => dash.filters.filter(f => f.field === field && !!f.neg === neg).flatMap(f => Array.isArray(f.values) ? f.values : [f.value]),
    setFilter: (field, values, neg) => setFilter(field, values, neg)
  };
  seen[p.id] = null;
  c.color = (field, value) => {
    const s = (seen[p.id] ||= { field, values: [] }); if (s.field === field && !s.values.includes(String(value))) s.values.push(String(value));
    const i = colorSlot(field, value, c.theme.c.length); return i < 0 ? c.theme.other : c.theme.c[i];
  };
  return c;
}
async function draw(j, r) {
  const { p, w, c } = j, b = pbOf(p.id); if (!b) return;
  if (!r || r.error) { showMsg(p.id, `<b>${t('panel.engineError')}</b><code>${esc(r?.error?.reason || r?.error?.type || t('panel.emptyResponse'))}</code>`, true); setMeta(p.id, ''); return; }
  c.response = r;
  let rows;
  try { rows = w.rows(r, p.params, c); } catch (e) { showMsg(p.id, `<b>${t('panel.badResponse')}</b><code>${esc(e.message)}</code>`, true); return; }
  const total = totalHits(r);
  setMeta(p.id, fmtNum(total) + ' doc · ' + (r.took ?? '–') + ' ms' + (w.target ? ' · ' + c.iv[0] : ''));
  if (!w.keepEmpty && (!rows.length || (total === 0 && p.type !== 'vegalite'))) { showMsg(p.id, esc(t('panel.noData'))); return; }
  b.classList.remove('loading');
  if (w.render) {
    try { views[p.id]?.finalize(); } catch (e) { /* */ } delete views[p.id];
    if (!w.keepEmpty) b.innerHTML = '';
    try { w.render(b, p.params, rows, c); } catch (e) { showMsg(p.id, `<b>${t('panel.widgetError')}</b><code>${esc(e.message)}</code>`, true); }
    return;
  }
  let spec;
  try { spec = w.spec(p.params, rows, c); } catch (e) { showMsg(p.id, `<b>${t('panel.badSpec')}</b><code>${esc(e.message)}</code>`, true); return; }
  try {
    const old = views[p.id];
    views[p.id] = await embed(b, spec, { onClick: w.click ? d => { if (!d.other && d.k != null) addFilter(w.click(p.params), d.k); } : null });
    try { old?.finalize(); } catch (e) { /* */ }
  } catch (e) { showMsg(p.id, `<b>${t('panel.vegaFailed')}</b><code>${esc(e.message)}</code>`, true); }
}
function addFilter(field, value, neg = false) {
  if (!field) return;
  const ex = dash.filters.find(f => f.field === field && !f.values && String(f.value) === String(value));
  if (ex) { if (!!ex.neg === neg) return; ex.neg = neg; } else dash.filters.push(neg ? { field, value, neg } : { field, value });
  markDirty(); chips.render(); renderPanels();
}

/** Sostituisce i filtri (include o esclude) su un campo: 0 valori = nessun filtro, 1 = term, più = terms («è uno di»). */
function setFilter(field, values, neg = false) {
  if (!field) return;
  const vs = [...new Set((values || []).map(v => v))];
  dash.filters = dash.filters.filter(f => !(f.field === field && !!f.neg === neg));
  if (vs.length) dash.filters.push({ field, ...(vs.length === 1 ? { value: vs[0] } : { values: vs }), ...(neg ? { neg: true } : {}) });
  markDirty(); chips.render(); renderPanels();
}

/* ---------- colori ----------
   dash.colors = { campo: { valore: posizione nella palette (0…5) } }. Un valore nuovo prende la prima posizione libera
   di quel campo e la tiene (anche con altri filtri, in altri pannelli, dopo il salvataggio); a palette esaurita è grigio.
   Si salva la posizione, non il colore, così vale in tema chiaro e scuro. */
function colorSlot(field, value, n) {
  const m = ((dash.colors ||= {})[field] ||= {}), k = String(value);
  if (k in m) return m[k];
  const used = new Set(Object.values(m));
  for (let i = 0; i < n; i++) if (!used.has(i)) { m[k] = i; return i; }
  return -1;
}
/** Assegna a un valore una posizione (o -1 = grigio); chi l'aveva prende la vecchia posizione del valore (scambio). */
function setColorSlot(field, value, slot) {
  const m = ((dash.colors ||= {})[field] ||= {}), k = String(value), old = k in m ? m[k] : -1;
  const holder = Object.keys(m).find(x => x !== k && m[x] === slot);
  if (holder != null) { if (old >= 0) m[holder] = old; else delete m[holder]; }
  if (slot >= 0) m[k] = slot; else delete m[k];
  markDirty(); renderPanels();
}
/** Sezione Colori dell'editor: i valori che il pannello attivo colora, con la loro posizione nella palette. */
function paintColors() {
  const box = $('#dColors', el.drawer), p = activeId && getP(activeId); if (!box || !p) return;
  const s = seen[p.id];
  if (!s?.values.length) { box.innerHTML = ''; return; }
  const m = dash.colors?.[s.field] || {};
  const vals = [...s.values].sort((a, b) => ((m[a] ?? 99) - (m[b] ?? 99))).slice(0, 40);
  const sw = (v, i) => `<button type="button" class="sw${(m[v] ?? -1) === i ? ' on' : ''}" data-cslot="${i}" data-cv="${esc(vAttr(v))}" style="--sw:${i < 0 ? 'var(--c-other)' : `var(--c${i + 1})`}" aria-pressed="${(m[v] ?? -1) === i}" aria-label="${esc(i < 0 ? t('colors.grey') : t('colors.slot', { n: i + 1 }))}" title="${esc(i < 0 ? t('colors.grey') : t('colors.slot', { n: i + 1 }))}"></button>`;
  box.innerHTML = `<div class="sect">${t('colors.title')} · <code>${esc(s.field)}</code></div>
    <p class="help">${t('colors.help')}</p>
    <div class="clist">${vals.map(v => `<div class="crow"><span class="ck" title="${esc(v)}">${esc(v)}</span><div class="cs" role="group" aria-label="${esc(v)}">${[0, 1, 2, 3, 4, 5, -1].map(i => sw(v, i)).join('')}</div></div>`).join('')}</div>
    <button type="button" class="btn ghost" data-creset="${esc(s.field)}">${t('colors.reset')}</button>`;
}

function wireGrid() {
  el.board.addEventListener('click', e => {
    const art = e.target.closest('.panel'); if (!art) return;
    const id = art.dataset.id, b = e.target.closest('[data-act]');
    if (b) {
      if (b.dataset.act === 'cfg') openDrawer(id);
      if (b.dataset.act === 'dup') {
        const src = getP(id), i = dash.panels.indexOf(src);
        const p = clone(src); p.id = uid(); p.title = t('panel.copyOf', { title: src.title });
        dash.panels.splice(i + 1, 0, p); art.after(panelEl(p)); markDirty(); renderPanels([p.id]);
      }
      if (b.dataset.act === 'del') {
        const p = getP(id);
        confirm({ title: t('panel.confirmRemove'), html: t('panel.confirmRemoveText', { title: '<b>' + esc(p.title) + '</b>' }), ok: t('panel.remove'), danger: true }).then(ok => {
          if (!ok || !getP(id)) return;
          const i = dash.panels.indexOf(p), a = el.board.querySelector(`[data-id="${id}"]`);
          dash.panels.splice(i, 1); try { views[id]?.finalize(); } catch (x) { /* */ } delete views[id]; a?.remove(); syncCtlBar();
          if (activeId === id) closeDrawer();
          if (!dash.panels.length) renderGrid();
          markDirty();
          app.toast(t('panel.removed', { title: p.title }), t('common.undo'), () => { dash.panels.splice(i, 0, p); renderGrid(); renderPanels(); });
        });
      }
      return;
    }
    if (editing && e.target.closest('.ph h3')) openDrawer(id);
  });
  let dragId = null;
  // si riordina solo dentro lo stesso contenitore (barra dei controlli o griglia)
  const sameHost = a => a.parentElement === el.board.querySelector(`[data-id="${dragId}"]`)?.parentElement;
  el.board.addEventListener('dragstart', e => { const a = e.target.closest('.panel'); if (!a || !editing) return; dragId = a.dataset.id; a.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* */ } });
  el.board.addEventListener('dragend', () => { el.board.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); dragId = null; });
  el.board.addEventListener('dragover', e => {
    const a = e.target.closest('.panel'); if (!dragId || !a || a.dataset.id === dragId || !sameHost(a)) return;
    e.preventDefault();
    const r = a.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2;
    el.board.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    a.classList.add(before ? 'drop-before' : 'drop-after');
  });
  el.board.addEventListener('drop', e => {
    const a = e.target.closest('.panel'); if (!dragId || !a || a.dataset.id === dragId || !sameHost(a)) return;
    e.preventDefault();
    const before = a.classList.contains('drop-before'), src = el.board.querySelector(`[data-id="${dragId}"]`);
    const p = getP(dragId); dash.panels.splice(dash.panels.indexOf(p), 1);
    const ti = dash.panels.indexOf(getP(a.dataset.id));
    dash.panels.splice(before ? ti : ti + 1, 0, p);
    if (before) a.before(src); else a.after(src);
    markDirty();
  });
}

/* ---------- editor laterale ---------- */
function openDrawer(id) {
  if (!editing) setEditing(true);
  activeId = id;
  el.board.querySelectorAll('.panel.active').forEach(x => x.classList.remove('active'));
  el.board.querySelector(`[data-id="${id}"]`)?.classList.add('active');
  document.body.classList.add('drawer-open'); el.drawer.setAttribute('aria-hidden', 'false');
  renderDrawer().then(() => $('#f-__title', el.drawer)?.focus({ preventScroll: true }));
}
function closeDrawer() {
  activeId = null; document.body.classList.remove('drawer-open'); el.drawer?.setAttribute('aria-hidden', 'true');
  el.board?.querySelectorAll('.panel.active').forEach(x => x.classList.remove('active'));
}
async function renderDrawer() {
  const p = activeId && getP(activeId); if (!p) { closeDrawer(); return; }
  const w = W().get(p.type);
  const indices = await app.backend.indices().catch(() => []), fields = await app.backend.fields(p.params.index);
  const scroll = $('.dform', el.drawer)?.scrollTop || 0;
  const params = (w?.params || []).filter(prm => !prm.show || prm.show(p.params));
  el.drawer.innerHTML = `<div class="dh"><div><span class="eyebrow">${esc(L(w?.name) || p.type)}${w?.source === 'custom' ? ' · ' + t('dash.customOne') : ''}</span><h2>${t('dash.configure')}</h2></div><button type="button" class="btn ghost x" id="dClose" aria-label="${t('common.close')}">${ICON.x}</button></div>
  <form class="dform" onsubmit="return false">
    <div class="f"><label for="f-__title">${t(isCtl(p) ? 'panel.label' : 'panel.title')}</label><input type="text" id="f-__title" data-key="__title" data-live value="${esc(p.title)}"${isCtl(p) ? ` placeholder="${esc(t('panel.labelPlaceholder'))}"` : ''}></div>
    ${isCtl(p) ? `<p class="help">${t('panel.controlHelp')}</p>` : ''}
    <div class="two">
      <div class="f"><label for="f-__w">${t('panel.width')}</label><select id="f-__w" data-key="__w">${opts([[3, '1/4'], [4, '1/3'], [6, '1/2'], [8, '2/3'], [12, t('panel.full')]], p.w)}</select></div>
      ${isCtl(p) ? '' : `<div class="f"><label for="f-__h">${t('panel.height')}</label><select id="f-__h" data-key="__h">${opts([['s', t('panel.h.s')], ['m', t('panel.h.m')], ['l', t('panel.h.l')]], p.h)}</select></div>`}
    </div>
    <div class="sect">${t('panel.data')}</div>
    ${params.map(prm => paramControl(p.params, prm, { indices, fields })).join('')}
    <div id="dColors" class="dcolors"></div>
  </form>`;
  paintColors();
  $('#dClose', el.drawer).onclick = closeDrawer;
  $('.dform', el.drawer).scrollTop = scroll;
}
function wireDrawer() {
  el.drawer.addEventListener('change', async e => {
    const tg = e.target, key = tg.dataset.key; if (!key || tg.dataset.live !== undefined) return;
    const p = getP(activeId); if (!p) return;
    const w = W().get(p.type), art = el.board.querySelector(`[data-id="${p.id}"]`);
    if (key === '__w') { p.w = +tg.value; art.className = panelClass(p) + ' active'; art.style.setProperty('--w', p.w); markDirty(); renderPanels([p.id]); return; }
    if (key === '__h') { p.h = tg.value; art.querySelector('.pb').style.height = (H(p) + 20) + 'px'; markDirty(); renderPanels([p.id]); return; }
    if (tg.dataset.multi !== undefined) p.params[key] = [...el.drawer.querySelectorAll(`input[data-key="${key}"]:checked`)].map(x => x.value);
    else if (tg.type === 'number') { const prm = w.params.find(x => x.key === key); p.params[key] = Math.max(prm.min, Math.min(prm.max, +tg.value || prm.min)); }
    else p.params[key] = tg.value;
    autofill(w, p.params, await app.backend.fields(p.params.index));
    markDirty();
    if (tg.dataset.multi === undefined) await renderDrawer();
    renderPanels([p.id]);
  });
  el.drawer.addEventListener('input', e => {
    const tg = e.target, key = tg.dataset.key; if (!key || tg.dataset.live === undefined) return;
    const p = getP(activeId); if (!p) return;
    if (key === '__title') {
      p.title = tg.value; const h = el.board.querySelector(`[data-id="${p.id}"] h3`); if (h) h.textContent = tg.value; markDirty();
      if (isCtl(p)) debounce('p' + p.id, () => renderPanels([p.id]), 300);   // l'etichetta del controllo la disegna il widget
      return;
    }
    p.params[key] = tg.value; markDirty();
    if (tg.dataset.json !== undefined) {
      const err = document.getElementById(tg.id + '-err');
      try { JSON.parse(tg.value); err.hidden = true; } catch (x) { err.hidden = false; err.textContent = t('common.badJson', { msg: x.message }); return; }
    }
    debounce('p' + p.id, () => renderPanels([p.id]), 450);
  });
  el.drawer.addEventListener('click', e => {
    const b = e.target.closest('[data-cslot],[data-creset]'), p = activeId && getP(activeId); if (!b || !p) return;
    if (b.dataset.creset != null) { delete dash.colors?.[b.dataset.creset]; markDirty(); renderPanels(); return; }
    setColorSlot(seen[p.id].field, vRead(b.dataset.cv), +b.dataset.cslot);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && activeId && !app.modal.isOpen) closeDrawer(); });
}
