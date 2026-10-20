// Pagina Corpus: il Corpus Hub di XERJ (pack firmati e pre-indicizzati) visto dal nodo connesso.
// Legge solo gli endpoint read-only /_hub/v1 (catalogue, search, code, def) e _cat/indices per sapere quali pack
// sono caricati: un pack ripristinato da `xerj hub pull` diventa indici xc-<slug>-b<build>-*. Nessun download parte
// da qui: per caricare un corpus la pagina mostra il comando da eseguire. Solo con XERJ (config.json → pages[].engines).

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t } from '../../core/i18n.js';

const PACK_INDEX = /^xc-(.+)-b(\d+)-/;
let app, catalogue = null, loaded = new Map(), hubError = null, found = null;
const view = Object.assign({ q: '', domain: '', onlyLoaded: false, sel: '', mode: 'code', ask: '' }, store.get('xvb.corpus', {}));
const save = () => store.set('xvb.corpus', view);
const bytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return fmtNum(Math.round(n * 10) / 10) + ' ' + u[i]; };
const errOf = r => r.body?.error?.reason || r.body?.error?.type || ('HTTP ' + r.status);
const days = d => Math.max(0, Math.round((Date.now() - Date.parse(d)) / 864e5));

const page = {
  id: 'corpus',
  async mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <form class="qwrap cpsq" id="cpForm" role="search">
        <label class="vh" for="cpText">${t('corp.search')}</label>
        <input type="search" id="cpText" placeholder="${esc(t('corp.placeholder'))}" value="${esc(view.q)}" autocomplete="off" spellcheck="false">
        <button type="submit" class="btn primary">${t('corp.searchLoaded')}</button>
      </form>
      <label class="vh" for="cpDomain">${t('corp.domain')}</label><select id="cpDomain"></select>
      <label class="ixsys"><input type="checkbox" id="cpLoaded"${view.onlyLoaded ? ' checked' : ''}> ${t('corp.onlyLoaded')}</label>`;
    slots.main.innerHTML = `<div class="cp"><section class="ixcard cplist" id="cpList"></section><section class="ixcard cpdet" id="cpDet"></section></div>`;
    $('#cpText').addEventListener('input', e => { view.q = e.target.value; found = null; save(); paintList(); });
    $('#cpForm').addEventListener('submit', e => { e.preventDefault(); searchAll(); });
    $('#cpDomain').addEventListener('change', e => { view.domain = e.target.value; save(); paintList(); });
    $('#cpLoaded').addEventListener('change', e => { view.onlyLoaded = e.target.checked; save(); paintList(); });
    $('#cpList').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) { view.sel = b.dataset.sel; save(); paintList(); paintDetail(); } });
    $('#cpDet').addEventListener('click', e => {
      const c = e.target.closest('[data-copy]'); if (c) copy(c.dataset.copy);
      const m = e.target.closest('[data-mode]'); if (m) { view.mode = m.dataset.mode; save(); paintDetail(); }
    });
    await page.refresh();
  },
  async refresh() {
    const list = $('#cpList'); list.classList.add('loading');
    hubError = null;
    try {
      if (!catalogue) {
        const r = await app.backend.request('GET', '_hub/v1/catalogue');
        if (!r.ok) throw Object.assign(new Error(errOf(r)), { status: r.status });
        catalogue = (r.body.corpora || []).slice().sort((a, b) => a.slug.localeCompare(b.slug));
      }
      const ix = await app.backend.request('GET', '_cat/indices/xc-*?format=json&bytes=b&h=index,docs.count,store.size');
      loaded = new Map();
      for (const r of ix.ok && Array.isArray(ix.body) ? ix.body : []) {
        const m = r.index.match(PACK_INDEX); if (!m) continue;
        const e = loaded.get(m[1]) || { build: m[2], indices: [], docs: 0, size: 0 };
        e.indices.push(r.index); e.docs += +r['docs.count'] || 0; e.size += +r['store.size'] || 0;
        loaded.set(m[1], e);
      }
    } catch (e) { hubError = e; catalogue = null; }
    list.classList.remove('loading');
    const doms = [...new Set((catalogue || []).map(c => c.domain).filter(Boolean))].sort();
    $('#cpDomain').innerHTML = `<option value="">${t('corp.allDomains')}</option>` + doms.map(d => `<option${d === view.domain ? ' selected' : ''}>${esc(d)}</option>`).join('');
    paintList(); paintDetail();
  }
};
export default page;

function visible() {
  const q = view.q.trim().toLowerCase();
  return (catalogue || []).filter(c => (!view.domain || c.domain === view.domain) && (!view.onlyLoaded || loaded.has(c.slug))
    && (!q || found || c.slug.includes(q) || (c.ask_for || '').toLowerCase().includes(q)));
}

function paintList() {
  const el = $('#cpList');
  if (hubError) {
    el.innerHTML = `<div class="msg cpoff"><b>${t('corp.noHub')}</b><span>${hubError.status === 404 ? t('corp.noHubHelp') : esc(hubError.message)}</span>
      <code>xerj hub sync</code><span>${t('corp.noHubConf')}</span><code>[hub]<br>catalogue_path = "~/.xerj/hub/catalogue.json"</code></div>`;
    return;
  }
  let cs = visible();
  if (found) { const order = new Map(found.map((f, i) => [f.slug, i])); cs = cs.filter(c => order.has(c.slug)).sort((a, b) => order.get(a.slug) - order.get(b.slug)); }
  if (!cs.some(c => c.slug === view.sel)) view.sel = (cs.find(c => loaded.has(c.slug)) || cs[0])?.slug || '';
  el.innerHTML = `<div class="ixhead cphead"><b>${found ? t('corp.found', { n: fmtNum(cs.length), q: esc(view.q) }) : t('corp.count', { n: fmtNum(cs.length), l: fmtNum(loaded.size) })}</b>
      ${found ? `<button type="button" class="linkbtn" id="cpReset">${t('corp.showAll')}</button>` : ''}</div>
    <ul class="cprows">${cs.map(c => { const f = found?.find(x => x.slug === c.slug); return `<li><button type="button" data-sel="${esc(c.slug)}" aria-pressed="${c.slug === view.sel}">
      <span class="cpdot${loaded.has(c.slug) ? ' on' : ''}" title="${esc(loaded.has(c.slug) ? t('corp.loaded') : t('corp.notLoaded'))}"></span>
      <span class="cpnm"><b>${esc(c.slug)}</b><span>${esc(f ? f.best_hit?.file || '' : c.ask_for || '')}</span></span>
      <span class="cpdom">${esc(c.domain || '')}</span></button></li>`; }).join('') || `<li class="msg">${t('corp.none')}</li>`}</ul>`;
  $('#cpReset')?.addEventListener('click', () => { found = null; paintList(); paintDetail(); });
}

/** Ricerca su tutti i pack caricati (GET /_hub/v1/search): i corpus che rispondono, il migliore prima. */
async function searchAll() {
  const q = $('#cpText').value.trim(); view.q = q; save();
  if (!q) { found = null; paintList(); return; }
  const r = await app.backend.request('GET', '_hub/v1/search?q=' + encodeURIComponent(q));
  if (!r.ok) { app.toast(errOf(r)); return; }
  found = r.body.corpora || [];
  view.ask = q; view.sel = found[0]?.slug || view.sel; save();
  paintList(); paintDetail();
}

async function paintDetail() {
  const el = $('#cpDet'), c = (catalogue || []).find(x => x.slug === view.sel);
  if (!c) { el.innerHTML = ''; return; }
  const L = loaded.get(c.slug), approach = c.licence_class === 'approach-only';
  el.innerHTML = `<div class="ixdh">
      <div><span class="eyebrow">${esc(c.domain || t('corp.corpus'))}</span><h2>${esc(c.slug)}</h2>
        <p class="ixmeta">${esc(c.licence_spdx || '?')} · ${esc(c.licence_class)} · ${t('corp.pin', { sha: esc((c.pin_sha || '').slice(0, 8)), d: days(c.pin_date) })} · ${bytes(c.pack_bytes)}</p></div>
      <span class="pill ${L ? 'ok' : 'off'}">${L ? t('corp.loaded') : t('corp.notLoaded')}</span></div>
    <div class="ixbody">
      <p class="cpask">${esc(c.ask_for || '')}</p>
      ${approach ? `<p class="note cpwarn">${t('corp.approach')}</p>` : ''}
      ${L ? `<p class="help">${t('corp.indices', { n: L.indices.length, docs: fmtNum(L.docs), size: bytes(L.size) })} ${L.indices.map(i => `<code>${esc(i)}</code>`).join(' ')}</p>
        <form class="cpq" id="cpAskForm">
          <div class="seg">${['code', 'def'].map(m => `<label><input type="radio" name="cpMode" data-mode="${m}"${view.mode === m ? ' checked' : ''}>${t('corp.mode.' + m)}</label>`).join('')}</div>
          <label class="vh" for="cpAsk">${t('corp.ask')}</label>
          <input type="search" id="cpAsk" value="${esc(view.ask)}" placeholder="${esc(t(view.mode === 'def' ? 'corp.defPh' : 'corp.codePh'))}" spellcheck="false">
          <button type="submit" class="btn primary">${t('corp.go')}</button>
          <button type="button" class="btn ghost" id="cpOpen">${t('corp.openSearch')}</button>
        </form>
        <div id="cpHits"></div>`
      : `<p>${t('corp.pullHelp')}</p><div class="cpcmd"><code>xerj hub pull ${esc(c.slug)}</code><button type="button" class="btn ghost" data-copy="xerj hub pull ${esc(c.slug)}">${t('common.copy')}</button></div>
        <p class="help">${t('corp.pullNote')}</p>`}
    </div>`;
  if (!L) return;
  $('#cpAskForm').addEventListener('submit', e => { e.preventDefault(); ask(c); });
  $('#cpOpen').onclick = () => app.navigate('search', { index: L.indices.join(','), q: $('#cpAsk').value.trim() });
  if (view.ask) ask(c);
}

/** Domanda a un corpus caricato: passaggi (/_hub/v1/code) o definizione di un simbolo (/_hub/v1/def). */
async function ask(c) {
  const q = $('#cpAsk').value.trim(), box = $('#cpHits'); view.ask = q; save();
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = ''; box.classList.add('loading');
  const path = view.mode === 'def' ? `_hub/v1/def/${encodeURIComponent(c.slug)}/${encodeURIComponent(q)}?k=5` : `_hub/v1/code/${encodeURIComponent(c.slug)}?q=${encodeURIComponent(q)}&k=5`;
  const r = await app.backend.request('GET', path);
  if (view.sel !== c.slug || !box.isConnected) return;
  box.classList.remove('loading');
  if (!r.ok) { box.innerHTML = `<div class="msg err"><code>${esc(errOf(r))}</code></div>`; return; }
  const a = r.body, hits = a.hits || [];
  box.innerHTML = `<p class="help">${t('corp.answer', { n: hits.length, from: esc(a.answered_from || ''), age: a.age_days ?? '?' })}${a.truncated ? ' · ' + t('corp.truncated') : ''}</p>
    ${(a.warnings || []).map(w => `<p class="note cpwarn">${esc(w)}</p>`).join('')}
    ${hits.map(h => `<div class="cphit"><div class="cphh"><code>${esc(h.file || '')}${h.line ? ':' + h.line : ''}</code><span class="svfmt">${esc(h.kind || '')}</span><span class="spacer"></span><span class="svfmt">${fmtNum(Math.round((h.score || 0) * 100) / 100)}</span></div>
      ${h.licence_warning ? `<p class="note cpwarn">${esc(h.licence_warning)}</p>` : ''}
      <pre>${esc(h.value ?? h.text ?? '')}</pre></div>`).join('') || `<div class="msg">${t('corp.noHits')}</div>`}`;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); app.toast(t('common.copied')); } catch (e) { app.toast(t('common.selectedCopy')); }
}
