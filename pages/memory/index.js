// Pagina Agent Memory: la memoria semantica degli agenti di XERJ (/_memory/{namespace}), come nella sidebar del
// concept XERJ Companion di @pilahito (xerj-org/xerj#1755). Elenco paginato, richiamo (testo, semantico, ibrido)
// ed eliminazione di una voce con conferma e «Annulla» (la voce si riscrive con lo stesso id).
// XERJ non ha un endpoint che elenchi i namespace (gli indici .xerj-memory-* sono riservati): la pagina ricorda
// nel browser quelli aperti. Solo con XERJ e in demo (config.json → pages[].engines).

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t } from '../../core/i18n.js';
import { confirm } from '../../core/ui.js';
import { demoNamespaces } from '../../core/demo/memory.js';

const PAGE = 50, MODES = ['text', 'semantic', 'hybrid'];
let app, data = null, recall = null, busy = 0;
const view = Object.assign({ recent: [], sel: '', q: '', mode: 'text', k: 10 }, store.get('xvb.memory', {}));
const save = () => store.set('xvb.memory', view);
const errOf = r => r.body?.error?.reason || r.body?.error?.type || (typeof r.body === 'string' && r.body.trim()) || ('HTTP ' + r.status);
const path = (ns, rest = '') => '_memory/' + encodeURIComponent(ns) + rest;
const NS_OK = /^[a-z0-9][a-z0-9_.-]{0,199}$/;
const TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

const page = {
  id: 'memory',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <form class="qwrap mmopen" id="mmOpen">
        <label class="vh" for="mmNs">${t('mem.namespace')}</label>
        <input type="text" id="mmNs" list="mmNsList" placeholder="${esc(t('mem.nsPlaceholder'))}" autocomplete="off" spellcheck="false">
        <datalist id="mmNsList"></datalist>
        <button type="submit" class="btn primary">${t('mem.open')}</button>
      </form>
      <span class="spacer"></span>
      <button type="button" class="btn ghost" id="mmReload">${t('mem.reload')}</button>`;
    slots.main.innerHTML = `<div class="cp mm"><section class="ixcard cplist" id="mmList"></section><section class="ixcard cpdet" id="mmDet"></section></div>`;
    $('#mmOpen').addEventListener('submit', e => { e.preventDefault(); open($('#mmNs').value.trim()); });
    $('#mmReload').addEventListener('click', () => page.refresh());
    $('#mmList').addEventListener('click', e => {
      const f = e.target.closest('[data-forget]'); if (f) { forgetRecent(f.dataset.forget); return; }
      const b = e.target.closest('[data-sel]'); if (b) open(b.dataset.sel);
    });
    $('#mmDet').addEventListener('click', e => {
      const d = e.target.closest('[data-del]'); if (d) del(d.dataset.del);
      if (e.target.closest('#mmMore')) load(true);
      if (e.target.closest('#mmClear')) { view.q = ''; recall = null; save(); paintDetail(); }
    });
    $('#mmDet').addEventListener('submit', e => { e.preventDefault(); ask(); });
    $('#mmDet').addEventListener('change', e => {
      if (e.target.name === 'mmMode') { view.mode = e.target.value; save(); }
      if (e.target.id === 'mmK') { view.k = +e.target.value; save(); }
    });
    await page.refresh();
  },
  async refresh() {
    // in demo i namespace di esempio; su XERJ solo quelli aperti da questo browser
    if (app.backend.isDemo()) for (const ns of demoNamespaces()) if (!view.recent.includes(ns)) view.recent.push(ns);
    if (!view.sel && view.recent.length) view.sel = view.recent[0];
    save(); paintList();
    await load();
    if (view.q) await ask();
  }
};
export default page;

async function open(ns) {
  if (!ns) return;
  if (!NS_OK.test(ns)) { app.toast(t('mem.badNs')); return; }
  view.sel = ns; view.recent = [ns, ...view.recent.filter(x => x !== ns)].slice(0, 30);
  view.q = ''; recall = null; save();
  $('#mmNs').value = '';
  paintList(); await load();
}
function forgetRecent(ns) {
  view.recent = view.recent.filter(x => x !== ns);
  if (view.sel === ns) { view.sel = view.recent[0] || ''; recall = null; view.q = ''; }
  save(); paintList(); load();
}

function paintList() {
  $('#mmNsList').innerHTML = view.recent.map(n => `<option value="${esc(n)}">`).join('');
  $('#mmList').innerHTML = `<div class="ixhead cphead"><b>${t('mem.namespaces')}</b></div>
    <ul class="cprows mmrows">${view.recent.map(n => `<li><button type="button" data-sel="${esc(n)}" aria-pressed="${n === view.sel}">
      <span class="cpdot${n === view.sel ? ' on' : ''}"></span><span class="cpnm"><b>${esc(n)}</b>${n === view.sel && data?.namespace === n && !data.error ? `<span>${t('mem.count', { n: fmtNum(data.count) })}</span>` : ''}</span></button>
      <button type="button" class="mmx" data-forget="${esc(n)}" title="${esc(t('mem.forgetRecent'))}" aria-label="${esc(t('mem.forgetRecent'))}: ${esc(n)}">×</button></li>`).join('')
      || `<li class="msg">${t('mem.noRecent')}</li>`}</ul>
    <p class="help mmnote">${app.backend.isDemo() ? t('mem.noteDemo') : t('mem.noteList')}</p>`;
}

/** Prima pagina (o la successiva con more = true) di GET /_memory/{ns}. */
async function load(more = false) {
  const ns = view.sel, det = $('#mmDet');
  if (!ns) { data = null; paintDetail(); return; }
  const from = more && data?.next ? data.next.from : 0, my = ++busy;
  det.classList.add('loading');
  const r = await app.backend.request('GET', path(ns, `?from=${from}&size=${PAGE}`));
  if (my !== busy) return;
  det.classList.remove('loading');
  if (!r.ok) { data = { namespace: ns, error: r }; paintDetail(); return; }
  const b = r.body || {};
  data = { namespace: ns, exists: b.exists !== false, count: b.count ?? 0, next: b.next || null, entries: more ? [...data.entries, ...(b.entries || [])] : (b.entries || []) };
  paintDetail(); paintList();
}

/** POST /_memory/{ns}/_recall: le voci più vicine alla domanda, nel modo scelto. */
async function ask() {
  const q = $('#mmQ')?.value.trim() ?? view.q; view.q = q; save();
  if (!q) { recall = null; paintDetail(); return; }
  const body = { query: q, k: view.k, ...(view.mode === 'semantic' ? { semantic: true } : view.mode === 'hybrid' ? { hybrid: true } : {}) };
  const ns = view.sel, my = ++busy, det = $('#mmDet');
  det.classList.add('loading');
  const r = await app.backend.request('POST', path(ns, '/_recall'), body);
  if (my !== busy) return;
  det.classList.remove('loading');
  recall = r.ok ? { q, mode: view.mode, hits: r.body?.hits || [] } : { q, mode: view.mode, error: errOf(r) };
  paintDetail();
}

function paintDetail() {
  const el = $('#mmDet');
  if (!view.sel) { el.innerHTML = `<div class="svintro"><h2>${t('mem.introTitle')}</h2><p>${t('mem.intro')}</p></div>`; return; }
  if (data?.error) {
    const r = data.error, missing = r.status === 404 && !r.body?.namespace;
    el.innerHTML = `<div class="msg err cpoff"><b>${missing ? t('mem.noApi') : t('mem.failed')}</b>${missing ? `<span>${t('mem.noApiHelp')}</span>` : ''}<code>${esc(errOf(r))}</code></div>`;
    return;
  }
  const d = data || { entries: [], count: 0 }, list = recall?.hits || d.entries;
  el.innerHTML = `<div class="ixdh">
      <div><span class="eyebrow">${t('mem.namespace')}</span><h2>${esc(view.sel)}</h2>
        <p class="ixmeta">${d.exists === false ? t('mem.empty') : t('mem.count', { n: fmtNum(d.count) })} · <code>.xerj-memory-${esc(view.sel)}</code></p></div></div>
    <div class="ixbody">
      <form class="cpq mmq">
        <div class="seg">${MODES.map(m => `<label title="${esc(t('mem.modeHelp.' + m))}"><input type="radio" name="mmMode" value="${m}"${view.mode === m ? ' checked' : ''}>${t('mem.mode.' + m)}</label>`).join('')}</div>
        <label class="vh" for="mmQ">${t('mem.recall')}</label>
        <input type="search" id="mmQ" value="${esc(view.q)}" placeholder="${esc(t('mem.recallPh'))}" spellcheck="false">
        <label class="vh" for="mmK">k</label>
        <select id="mmK" title="${esc(t('mem.k'))}">${[5, 10, 20, 50].map(k => `<option value="${k}"${k === view.k ? ' selected' : ''}>k = ${k}</option>`).join('')}</select>
        <button type="submit" class="btn primary">${t('mem.recall')}</button>
      </form>
      ${recall ? `<p class="help mmrh">${recall.error ? `<b class="warnt">${esc(recall.error)}</b>` : t('mem.recalled', { n: fmtNum(recall.hits.length), q: esc(recall.q), mode: t('mem.mode.' + recall.mode) })}
        <button type="button" class="linkbtn" id="mmClear">${t('mem.showAll')}</button></p>` : ''}
      <ul class="mmlist">${list.map(e => item(e, !!recall)).join('')
        || `<li class="msg">${recall ? t('mem.noHits') : d.exists === false ? t('mem.emptyHelp') : t('mem.none')}</li>`}</ul>
      ${!recall && d.next ? `<div class="mrow"><button type="button" class="btn ghost" id="mmMore">${t('mem.more', { n: fmtNum(d.count - d.entries.length) })}</button></div>` : ''}
    </div>`;
}

function item(e, scored) {
  const md = e.metadata && typeof e.metadata === 'object' ? Object.entries(e.metadata) : [];
  return `<li class="mmitem">
    <p class="mmtext">${esc(e.text ?? '')}</p>
    <div class="mmmeta">
      ${md.map(([k, v]) => `<span class="chip"><span>${esc(k)}</span> ${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('')}
      <span class="spacer"></span>
      ${scored && e.score != null ? `<span class="svfmt" title="${esc(t('mem.score'))}">${fmtNum(Math.round(e.score * 1000) / 1000)}</span>` : ''}
      <code class="mmid">${esc(e.id)}</code>
      <button type="button" class="mmdel" data-del="${esc(e.id)}" title="${esc(t('mem.delete'))}" aria-label="${esc(t('mem.delete'))}">${TRASH}</button>
    </div></li>`;
}

/** Elimina una voce dopo conferma; «Annulla» la riscrive con lo stesso id, testo e metadati. */
async function del(id) {
  const ns = view.sel, e = (recall?.hits || []).concat(data?.entries || []).find(x => x.id === id);
  if (!e) return;
  const ok = await confirm({ title: t('mem.delTitle'), html: `<q class="mmquote">${esc(e.text)}</q><br><br>${t('mem.delHelp', { ns: esc(ns) })}`, ok: t('mem.delete'), danger: true });
  if (!ok) return;
  const r = await app.backend.request('DELETE', path(ns, '/' + encodeURIComponent(id)));
  if (!r.ok) { app.toast(t('mem.delFailed', { msg: errOf(r) })); return; }
  if (recall) recall.hits = recall.hits.filter(x => x.id !== id);
  if (data) { data.entries = data.entries.filter(x => x.id !== id); data.count = Math.max(0, data.count - 1); }
  paintDetail(); paintList();
  app.toast(t('mem.deleted'), t('common.undo'), async () => {
    const back = await app.backend.request('POST', path(ns), { id: e.id, text: e.text, ...(e.metadata != null ? { metadata: e.metadata } : {}) });
    if (!back.ok) { app.toast(t('mem.restoreFailed', { msg: errOf(back) })); return; }
    app.toast(t('mem.restored'));
    if (view.sel === ns) { await load(); if (view.q) await ask(); }
  });
}
