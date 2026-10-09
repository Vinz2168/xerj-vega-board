// Shell: legge config.json, carica i widget, monta le pagine e gestisce lo stato globale
// (connessione, tempo, tema). Le pagine ricevono l'oggetto `app` descritto in AGENTS.md.

import { $, esc, store } from './util.js';
import { toRange, isAbs } from './time.js';
import { createBackend } from './backend.js';
import { loadWidgets } from './registry.js';
import { validatePage } from './contract.js';
import { setLocale, setBrushHandler } from './vega.js';
import { toast, modal } from './ui.js';
import { shortDT } from './util.js';
import { t, L, LANGS, getLang, setLang, isForced } from './i18n.js';

const listeners = {};
const pages = new Map();          // id → { def, section, bar, filters, mounted, stale, entry }
let active = null;

async function boot() {
  setLocale();
  const config = await (await fetch(new URL('../config.json', import.meta.url))).json();
  const base = new URL('../', import.meta.url).href;
  const backend = createBackend({ dashboardIndex: config.dashboardIndex, defaultConnection: config.connection });
  const { widgets, problems } = await loadWidgets(config.widgets || [], base);

  const saved = store.get('xvb.time', { value: '7d', refresh: 0 });
  let timeValue = saved.value, refresh = saved.refresh, hist = [], rfTimer = null;

  const app = {
    config, backend, widgets, problems, base,
    on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => listeners[evt].delete(fn); },
    emit(evt, data) { for (const fn of listeners[evt] || []) { try { fn(data); } catch (e) { console.error(e); } } },
    toast, modal,
    time: {
      get value() { return timeValue; },
      get refresh() { return refresh; },
      get canBack() { return hist.length > 0; },
      range: () => toRange(timeValue),
      set(v, { remember = true, silent = false } = {}) {
        if (JSON.stringify(v) === JSON.stringify(timeValue)) return;
        if (remember) { hist.push(timeValue); if (hist.length > 20) hist.shift(); }
        timeValue = v; persistTime(); armRefresh();
        app.emit('time', v);
        if (!silent) refreshActive();
      },
      back() { if (hist.length) app.time.set(hist.pop(), { remember: false }); },
      setRefresh(sec) { refresh = sec; persistTime(); armRefresh(); app.emit('time', timeValue); },
      clearHistory() { hist = []; }
    },
    /** Cambia pagina; `intent` arriva a page.onIntent(intent) (es. "aggiungi questo pannello"). */
    navigate(id, intent) { location.hash = '#/' + id; show(id, intent); },
    get activePage() { return active; },
    setTitle(text, { editable = false, onInput } = {}) {
      const t = $('#pageTitle'); t.value = text || ''; t.readOnly = !editable; t.classList.toggle('editable', editable);
      t.oninput = editable && onInput ? () => onInput(t.value) : null;
    },
    refreshActive: () => refreshActive()
  };
  const persistTime = () => store.set('xvb.time', { value: timeValue, refresh });
  function armRefresh() {
    clearInterval(rfTimer);
    const sec = isAbs(timeValue) ? 0 : refresh;
    if (sec) rfTimer = setInterval(() => { if (!document.hidden && !modal.isOpen) refreshActive(); }, sec * 1000);
  }
  armRefresh();
  setBrushHandler((a, b) => {
    app.time.set({ from: a, to: b });
    toast(t('time.narrowed', { from: shortDT(a), to: shortDT(b) }), t('time.back'), () => app.time.back());
  });

  /* ---- navigazione ---- */
  const nav = $('#nav'), main = $('#pages'), bars = $('#pagebars');
  for (const p of config.pages) {
    const section = document.createElement('section'); section.className = 'page'; section.dataset.page = p.id; section.hidden = true;
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', 'tab-' + p.id);
    const bar = document.createElement('div'); bar.className = 'pagebar'; bar.hidden = true;
    const filters = document.createElement('div'); filters.className = 'filters';
    bar.appendChild(document.createElement('div')).className = 'barrow';
    bar.appendChild(filters);
    main.appendChild(section); bars.appendChild(bar);
    pages.set(p.id, { entry: p, section, bar, filters, def: null, mounted: false, stale: false });
    nav.insertAdjacentHTML('beforeend', `<button type="button" role="tab" id="tab-${esc(p.id)}" data-page="${esc(p.id)}" aria-selected="false" aria-controls="">${esc(L(p.title))}</button>`);
  }
  nav.addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) app.navigate(b.dataset.page); });
  window.addEventListener('hashchange', () => { const id = location.hash.replace(/^#\/?/, ''); if (pages.has(id) && id !== active) show(id); });

  async function show(id, intent) {
    const p = pages.get(id) || pages.get(config.pages[0].id);
    if (!p.def) {
      try {
        if (p.entry.css) await loadCss(p.entry.css);
        const mod = await import(new URL(p.entry.module, base).href);
        const errs = validatePage(mod.default, p.entry.id);
        if (errs.length) throw new Error(errs.join('; '));
        p.def = mod.default;
      } catch (e) {
        p.section.innerHTML = `<div class="msg err" style="padding:48px"><b>${esc(t('app.pageFailed', { page: L(p.entry.title) }))}</b><code>${esc(e.message)}</code></div>`;
      }
    }
    if (active && active !== p.entry.id) { const prev = pages.get(active); prev.section.hidden = true; prev.bar.hidden = true; prev.def?.hide?.(); }
    active = p.entry.id;
    document.body.dataset.page = active;
    nav.querySelectorAll('[data-page]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.page === active)));
    p.section.hidden = false; p.bar.hidden = false;
    app.setTitle(L(p.entry.title));
    if (!p.def) return;
    if (!p.mounted) { p.mounted = true; p.stale = false; await p.def.mount({ main: p.section, bar: p.bar.firstChild, filters: p.filters }, app); }
    else { await p.def.show?.(); if (p.stale) { p.stale = false; await p.def.refresh?.(); } }
    if (intent) await p.def.onIntent?.(intent);
  }
  function refreshActive() {
    for (const [id, p] of pages) if (p.mounted) { if (id === active) p.def.refresh?.(); else p.stale = true; }
  }
  const loadCss = href => new Promise(res => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(href, base).href;
    l.onload = l.onerror = () => res(); document.head.appendChild(l);
  });

  /* ---- connessione ---- */
  const connBtn = $('#btnConn');
  const paintConn = () => {
    const c = backend.conn;
    $('#connLbl').textContent = c.mode === 'demo' ? t('conn.demo') : c.url.replace(/^https?:\/\//, '');
    $('#connDot').classList.toggle('demo', c.mode === 'demo');
  };
  paintConn();
  connBtn.addEventListener('click', () => {
    const c = backend.conn;
    const box = modal.open(`<h2>${t('conn.title')}</h2>
      <div class="seg" role="radiogroup" aria-label="${t('conn.source')}">
        <label><input type="radio" name="cm" value="demo"${c.mode === 'demo' ? ' checked' : ''}>${t('conn.demo')}</label>
        <label><input type="radio" name="cm" value="xerj"${c.mode === 'xerj' ? ' checked' : ''}>XERJ</label>
      </div>
      <p>${t('conn.demoHelp')}</p>
      <div class="f"><label for="cUrl">${t('conn.url')}</label><input type="url" id="cUrl" value="${esc(c.url)}" placeholder="http://localhost:9200"></div>
      <div class="f"><label for="cKey">${t('conn.key')}</label><input type="password" id="cKey" value="${esc(c.key || '')}" autocomplete="off"><p class="help">${t('conn.keyHelp')}</p></div>
      <div class="note">${t('conn.note', { index: '<code>' + esc(backend.dashboardIndex) + '</code>' })}</div>
      <div class="result" id="cRes"></div>
      <div class="mrow"><button type="button" class="btn ghost" id="cTest">${t('conn.test')}</button><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button type="button" class="btn primary" id="cSave">${t('conn.use')}</button></div>`);
    const read = () => ({ mode: box.querySelector('input[name=cm]:checked').value, url: $('#cUrl').value.trim() || 'http://localhost:9200', key: $('#cKey').value.trim() });
    $('#cTest').onclick = async () => {
      const res = $('#cRes'), prev = backend.conn; backend.setConnection(read());
      res.className = 'result'; res.textContent = t('conn.testing');
      try { const r = await backend.ping(); res.className = 'result ok'; res.textContent = t('conn.ok', { name: r.name || r.cluster_name || 'node', version: r.version?.number || '?' }); }
      catch (e) { res.className = 'result bad'; res.textContent = t('conn.fail', { msg: e.message }); }
      backend.setConnection(prev);
    };
    $('#cSave').onclick = () => { backend.setConnection(read()); paintConn(); modal.close(); app.emit('connection', backend.conn); refreshActive(); };
  });

  /* ---- problemi del registry ---- */
  if (problems.length) {
    const b = $('#btnProblems'); b.hidden = false; b.querySelector('span').textContent = problems.length;
    b.addEventListener('click', () => modal.open(`<h2>${t('problems.title')}</h2><p>${t('problems.help')}</p>
      <ul class="plist">${problems.map(p => `<li><code>${esc(p.where)}</code>${p.type ? ` · <b>${esc(p.type)}</b>` : ''}<br><span>${esc(p.msg)}</span></li>`).join('')}</ul>
      <div class="mrow"><button type="button" class="btn" data-close>${t('common.close')}</button></div>`));
  }

  /* ---- lingua: segue il browser, si può forzare; il cambio ricarica la pagina ---- */
  const langSel = $('#langSel');
  langSel.setAttribute('aria-label', t('lang.label'));
  langSel.innerHTML = `<option value="">${t('lang.auto', { lang: LANGS[getLang()] })}</option>` +
    Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  langSel.value = isForced() ? getLang() : '';
  langSel.addEventListener('change', () => { setLang(langSel.value || null); location.reload(); });
  $('#btnProblems').title = t('problems.title');

  /* ---- modale e tema ---- */
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) modal.close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.isOpen) modal.close(); });
  const onTheme = () => { app.emit('theme'); refreshActive(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // altezza dell'header in --hdr: serve agli elementi sticky delle pagine
  const hdr = document.querySelector('.top');
  new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', hdr.offsetHeight + 'px')).observe(hdr);

  window.xvb = app; // comodo da console e per gli agent che ispezionano la pagina
  const first = location.hash.replace(/^#\/?/, '');
  await show(pages.has(first) ? first : config.pages[0].id);
}

boot().catch(e => {
  document.getElementById('pages').innerHTML = `<div class="msg err" style="padding:48px"><b>${t('app.bootFailed')}</b><code>${String(e.message).replace(/</g, '&lt;')}</code><span>${t('app.bootHelp')}</span></div>`;
  console.error(e);
});
