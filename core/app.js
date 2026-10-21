// Shell: legge config.json, carica i widget, monta le pagine e gestisce lo stato globale
// (connessione, tempo, tema). Le pagine ricevono l'oggetto `app` descritto in AGENTS.md.

import { $, esc, store } from './util.js';
import { toRange, isAbs } from './time.js';
import { createBackend } from './backend.js';
import { loadWidgets, compileDocs } from './registry.js';
import { validatePage } from './contract.js';
import { setLocale, setBrushHandler } from './vega.js';
import { toast, modal } from './ui.js';
import { shortDT } from './util.js';
import { t, L, LANGS, getLang, setLang, isForced } from './i18n.js';

const listeners = {};
const svg = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PAGE_ICONS = {
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  discover: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  corpus: svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  indices: svg('<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"/><path d="M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"/>'),
  memory: svg('<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 18 17a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3"/>'),
  metrics: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  devtools: svg('<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13.5 5l-3 14"/>'),
  page: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>')
};
const THEME_ICONS = {
  auto: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>'),
  dark: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')
};
const pages = new Map();          // id → { def, section, bar, filters, mounted, stale, entry }
let active = null;

async function boot() {
  setLocale();
  const config = await (await fetch(new URL('../config.json', import.meta.url))).json();
  const base = new URL('../', import.meta.url).href;
  const backend = createBackend({ dashboardIndex: config.dashboardIndex, patternIndex: config.patternIndex, widgetIndex: config.widgetIndex, defaultConnection: config.connection });
  const { widgets, problems } = await loadWidgets((config.widgets || []).filter(m => typeof m === 'string'), base);
  const fileWidgets = new Map(widgets), fileProblems = [...problems];

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
    refreshActive: () => refreshActive(),
    /** Ricarica i widget dell'indice (dichiarativi) sopra quelli in file; in demo, al primo uso, copia gli esempi. */
    async reloadWidgets() {
      let docs = [];
      try {
        docs = await backend.listWidgetDocs();
        if (docs == null) {   // demo mai usata
          docs = (await (await fetch(new URL('widgets/declarative/seed.json', base))).json()).widgets.map(d => ({ ...d, source: 'builtin' }));
          for (const d of docs) await backend.saveWidgetDoc(d);
        }
      } catch (e) { console.warn('widget index not readable:', e.message); docs = []; }
      const res = compileDocs(docs, backend.widgetIndex);
      widgets.clear(); for (const [k, v] of fileWidgets) widgets.set(k, v);
      for (const w of res.widgets) widgets.set(w.type, { ...w, overrides: fileWidgets.has(w.type) });
      problems.length = 0; problems.push(...fileProblems, ...res.problems);
      paintProblems();
      app.emit('widgets');
    }
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

  /* ---- navigazione: sidebar con icona e titolo; l'icona viene da config.json (pages[].icon, SVG inline) o da PAGE_ICONS ---- */
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
    nav.insertAdjacentHTML('beforeend', `<button type="button" role="tab" id="tab-${esc(p.id)}" data-page="${esc(p.id)}" aria-selected="false" aria-controls="">${p.icon || PAGE_ICONS[p.id] || PAGE_ICONS.page}<span>${esc(L(p.title))}</span></button>`);
  }
  nav.addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) app.navigate(b.dataset.page); });
  window.addEventListener('hashchange', () => { const id = location.hash.replace(/^#\/?/, ''); if (pages.has(id) && id !== active) show(id); });

  // pages[].engines (facoltativo): con quali connessioni la pagina c'è — xerj, demo, es (Elasticsearch/OpenSearch).
  // In più l'utente può nascondere pagine da Impostazioni (xvb.pages.hidden, nel browser). Impostazioni non si nasconde,
  // e dove Impostazioni non c'è (es. con Elasticsearch) la scelta non vale: una pagina si nasconde solo dove si può anche rimostrare.
  const PINNED = 'settings';
  let hidden = new Set([].concat(store.get('xvb.pages.hidden', [])));
  const forEngine = p => !p.entry.engines || p.entry.engines.includes(backend.conn.mode);
  const hidesApply = () => pages.has(PINNED) && forEngine(pages.get(PINNED));
  const allowed = p => forEngine(p) && !(hidesApply() && p.entry.id !== PINNED && hidden.has(p.entry.id));
  const firstAllowed = () => [...pages.values()].find(allowed) || pages.get(config.pages[0].id);
  const paintNav = () => { for (const p of pages.values()) nav.querySelector(`[data-page="${CSS.escape(p.entry.id)}"]`).hidden = !allowed(p); };
  const leaveIfGone = () => { const p = pages.get(active); if (p && !allowed(p)) app.navigate(firstAllowed().entry.id); };
  app.on('connection', () => { paintNav(); leaveIfGone(); });
  paintNav();
  Object.assign(app, {
    /** Pagine di config.json per Impostazioni: { id, title, available (motore attuale), hidden, pinned }. */
    pageList: () => config.pages.map(e => ({ id: e.id, title: L(e.title), available: forEngine(pages.get(e.id)), hidden: e.id !== PINNED && hidden.has(e.id), pinned: e.id === PINNED })),
    /** Nasconde dalla navigazione le pagine indicate (le altre tornano visibili); salvato nel browser. */
    setHiddenPages(ids) {
      hidden = new Set((ids || []).filter(id => id !== PINNED && pages.has(id)));
      store.set('xvb.pages.hidden', [...hidden]);
      paintNav(); leaveIfGone(); app.emit('pages');
    }
  });

  async function show(id, intent) {
    let p = pages.get(id) || pages.get(config.pages[0].id);
    if (!allowed(p)) { p = firstAllowed(); if (location.hash !== '#/' + p.entry.id) history.replaceState(null, '', '#/' + p.entry.id); }
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

  /* ---- connessione e login ----
     Come Kibana: schermata di accesso a tutta pagina. Il motore lo decide config.json (connection.engine):
     XERJ → token API, altrimenti utente e password. Con connection.engineSelectable compare il flag XERJ per sceglierlo. Le credenziali vivono in sessionStorage (backend.js). */
  const paintConn = () => {
    const c = backend.conn;
    $('#connLbl').textContent = c.mode === 'demo' ? t('conn.demo') : c.url.replace(/^https?:\/\//, '');
    $('#connDot').classList.toggle('demo', c.mode === 'demo');
    $('#btnConn').title = t('conn.change');
    const lo = $('#btnLogout'); lo.hidden = !backend.loggedIn; lo.title = lo.querySelector('span').textContent = t('login.logout');
  };
  const EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>';
  let loginOpen = null;   // Promise della schermata aperta (una sola alla volta)
  /** Mostra la schermata di accesso; si risolve quando c'è una connessione valida. `cancel` = si può tornare indietro. */
  function login({ msg = '', info = false, cancel = false } = {}) {
    if (loginOpen) return loginOpen;
    modal.isOpen && modal.close();
    const el = $('#login'), c = backend.conn;
    const x = backend.engine === 'xerj', sel = backend.engineSelectable;
    const url = c.url || 'http://localhost:9200', locked = backend.urlLocked;
    // campo segreto con l'occhio per vederlo provvisoriamente (si richiude all'invio)
    const secret = (id, attrs) => !backend.revealAllowed ? `<input type="password" id="${id}" ${attrs}>` : `<div class="pw"><input type="password" id="${id}" ${attrs}><button type="button" class="pwtog" data-pw="${id}" aria-pressed="false" aria-label="${esc(t('login.show'))}" title="${esc(t('login.show'))}">${EYE}</button></div>`;
    el.innerHTML = `<form class="lbox" novalidate autocomplete="on">
      <div class="lhead"><div class="glyph" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div><span class="eyebrow">XERJ · Vega Board</span><h1>${t('login.title')}</h1></div></div>
      ${sel ? `<label class="switch"><input type="checkbox" role="switch" id="lXerj"${x ? ' checked' : ''}><span class="track" aria-hidden="true"></span><b>${t('login.xerj')}</b></label>` : ''}
      <p class="help" id="lEngine">${t(x ? 'login.engineXerj' : 'login.engineEs')}</p>
      <div class="f"${backend.urlShown ? '' : ' hidden'}><label for="lUrl">${t('login.url')}</label><input type="url" id="lUrl" name="url" value="${esc(url)}" placeholder="http://localhost:9200" autocomplete="url" required${locked ? ' readonly' : ''}>${locked ? `<p class="help">${t('login.urlLocked')}</p>` : ''}</div>
      <div class="f" data-x="1"><label for="lToken">${t('login.token')}</label>${secret('lToken', 'autocomplete="off" spellcheck="false"')}<p class="help">${t('login.tokenHelp')}</p></div>
      <div class="f" data-x="0"><label for="lUser">${t('login.user')}</label><input type="text" id="lUser" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(backend.auth?.user || '')}"></div>
      <div class="f" data-x="0"><label for="lPass">${t('login.pass')}</label>${secret('lPass', 'name="password" autocomplete="current-password"')}</div>
      <div class="result${msg && !info ? ' bad' : ''}" id="lRes" role="status">${esc(msg)}</div>
      <button type="submit" class="btn primary lsubmit" id="lGo">${t('login.submit')}</button>
      ${cancel || backend.demoAllowed ? `<div class="lfoot">${cancel ? `<button type="button" class="btn ghost" id="lCancel">${t('common.cancel')}</button>` : ''}
        ${backend.demoAllowed ? `<button type="button" class="btn ghost" id="lDemo" title="${esc(t('login.demoHelp'))}">${t('login.demo')}</button>` : ''}</div>` : ''}
      <p class="help">${t('login.note', { index: '<code>' + esc(backend.dashboardIndex) + '</code>' })}</p>
    </form>`;
    const form = el.querySelector('form'), res = $('#lRes');
    const reveal = (b, on) => {
      const i = $('#' + b.dataset.pw); i.type = on ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(on)); b.title = t(on ? 'login.hide' : 'login.show'); b.setAttribute('aria-label', b.title);
      b.innerHTML = on ? EYE_OFF : EYE;
    };
    const hideAll = () => form.querySelectorAll('[data-pw]').forEach(b => reveal(b, false));
    form.querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', () => { reveal(b, b.getAttribute('aria-pressed') !== 'true'); $('#' + b.dataset.pw).focus(); }));
    const isX = () => sel ? $('#lXerj').checked : x;
    const focusFirst = () => [...form.querySelectorAll('.f:not([hidden]) input:not([readonly])')].find(i => !i.value)?.focus();
    const sync = () => {
      form.querySelectorAll('[data-x]').forEach(f => { f.hidden = f.dataset.x !== (isX() ? '1' : '0'); });
      $('#lEngine').innerHTML = t(isX() ? 'login.engineXerj' : 'login.engineEs');
    };
    if (sel) $('#lXerj').addEventListener('change', () => {
      hideAll(); backend.chooseEngine(isX() ? 'xerj' : 'es');
      res.className = 'result'; res.textContent = ''; sync(); focusFirst();
    });
    sync(); el.hidden = false; document.body.classList.add('login-open');
    focusFirst();
    loginOpen = new Promise(resolve => {
      const done = changed => {
        el.hidden = true; el.innerHTML = ''; document.body.classList.remove('login-open'); loginOpen = null;
        if (changed) { paintConn(); app.emit('connection', backend.conn); }
        resolve(changed);
      };
      form.addEventListener('submit', async e => {
        e.preventDefault(); hideAll();
        const x = isX(), c = { mode: x ? 'xerj' : 'es', url: $('#lUrl').value.trim().replace(/\/+$/, '') };
        const a = x ? { key: $('#lToken').value.trim() } : { user: $('#lUser').value.trim(), pass: $('#lPass').value };
        if (!c.url || (x ? !a.key : !a.user || !a.pass)) { res.className = 'result bad'; res.textContent = t('login.required'); return; }
        const go = $('#lGo'); go.disabled = true; res.className = 'result'; res.textContent = t('login.checking');
        try {
          await backend.probe(c, a);
          backend.setConnection(c, a); done(true);
        } catch (err) {
          res.className = 'result bad';
          res.textContent = err.status === 401 ? t(x ? 'login.badXerj' : 'login.bad') : err.status === 403 ? t('login.denied') : t('login.unreachable', { msg: err.message });
          go.disabled = false;
          (x ? $('#lToken') : $('#lPass')).select();
        }
      });
      if (backend.demoAllowed) $('#lDemo').onclick = () => { backend.setConnection({ mode: 'demo', url: $('#lUrl').value.trim() || url }, null); done(true); };
      if (cancel) $('#lCancel').onclick = () => done(false);
    });
    return loginOpen;
  }
  /** All'avvio: in demo, con una sessione valida o su un server senza autenticazione si entra direttamente. */
  async function ensureLogin() {
    if (backend.isDemo()) return;
    try { await backend.ping(); }
    catch (e) { await login({ msg: e.status === 401 || backend.loggedIn ? '' : t('login.unreachable', { msg: e.message }) }); }
  }
  backend.onUnauthorized = () => {
    if (loginOpen) return;
    backend.logout(); paintConn();
    login({ msg: t('login.expired') }).then(() => refreshActive());
  };
  paintConn();
  $('#btnConn').addEventListener('click', async () => { if (await login({ cancel: true })) refreshActive(); });
  $('#btnLogout').addEventListener('click', async () => {
    backend.logout(); paintConn();
    await login({ msg: t('login.loggedOut'), info: true });
    refreshActive();
  });

  /* ---- problemi del registry (anche dei widget dell'indice: si ridipinge a ogni reloadWidgets) ---- */
  function paintProblems() {
    const b = $('#btnProblems'); b.hidden = !problems.length; b.querySelector('span').textContent = problems.length;
  }
  paintProblems();
  {
    const b = $('#btnProblems');
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

  /* ---- tema: segue il sistema, si può forzare scuro o chiaro (salvato nel browser, applicato da index.html all'avvio) ---- */
  const btnTheme = $('#btnTheme'), THEMES = ['auto', 'dark', 'light'];
  const paintTheme = () => {
    const cur = document.documentElement.dataset.theme || 'auto';
    btnTheme.innerHTML = THEME_ICONS[cur] + `<span>${t('theme.' + cur)}</span>`;
    btnTheme.title = t('theme.label');
  };
  btnTheme.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(document.documentElement.dataset.theme || 'auto') + 1) % THEMES.length];
    try { if (next === 'auto') localStorage.removeItem('xvb.theme'); else localStorage.setItem('xvb.theme', next); } catch (e) { /* ignorato */ }
    if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    paintTheme();
  });
  paintTheme();

  /* ---- stile dell'interfaccia: «classic» (barra in alto) o «nova» (sidebar a sinistra, core/skins/nova.css).
     Con XERJ e in demo: default da config.json → skin, la scelta dal selettore resta nel browser.
     Con Elasticsearch/OpenSearch resta sempre la board classica (niente selettore).
     Lo stile cambia solo CSS e posizione di navigazione e selettori: pagine e widget non se ne accorgono
     (ricevono i nuovi colori con l'evento theme). ---- */
  const SKINS = ['classic', 'nova'], skinSel = $('#skinSel'), root = document.documentElement;
  const side = document.createElement('aside'); side.className = 'side';
  side.innerHTML = `<div class="sbrand"><div class="glyph" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div><b>XERJ</b><span>Vega Board</span></div></div><div class="snav"></div><div class="sfoot"></div>`;
  document.body.prepend(side);
  // nella barra classica ogni elemento torna al suo posto: un segnaposto ricorda dov'era
  const movable = [[nav, '.snav'], [skinSel, '.sfoot'], [btnTheme, '.sfoot'], [langSel, '.sfoot']]
    .map(([el, to]) => { const mark = document.createComment(el.id); el.before(mark); return { el, to, mark }; });
  const applySkin = k => {
    k = SKINS.includes(k) ? k : 'classic';
    root.dataset.skin = k; skinSel.value = k; side.hidden = k !== 'nova';
    nav.setAttribute('aria-orientation', k === 'nova' ? 'vertical' : 'horizontal');
    for (const m of movable) (k === 'nova' ? side.querySelector(m.to).appendChild(m.el) : m.mark.after(m.el));
  };
  skinSel.setAttribute('aria-label', t('skin.label')); skinSel.title = t('skin.label');
  skinSel.innerHTML = SKINS.map(k => `<option value="${k}">${t('skin.' + k)}</option>`).join('');
  const skinFor = () => {
    if (backend.conn.mode === 'es') return 'classic';
    try { return localStorage.getItem('xvb.skin') || config.skin || 'nova'; } catch (e) { return config.skin || 'nova'; }
  };
  const paintSkin = () => { applySkin(skinFor()); skinSel.hidden = backend.conn.mode === 'es'; };
  skinSel.addEventListener('change', () => {
    try { localStorage.setItem('xvb.skin', skinSel.value); } catch (e) { /* ignorato */ }
    applySkin(skinSel.value);
  });
  app.on('connection', paintSkin);
  paintSkin();

  /* ---- modale ---- */
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) modal.close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.isOpen) modal.close(); });
  const onTheme = () => { paintTheme(); app.emit('theme'); refreshActive(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-skin'] });

  // altezza dell'header in --hdr: serve agli elementi sticky delle pagine
  const hdr = document.querySelector('.top');
  new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', hdr.offsetHeight + 'px')).observe(hdr);

  window.xvb = app; // comodo da console e per gli agent che ispezionano la pagina
  await ensureLogin();
  await app.reloadWidgets();
  app.on('connection', () => app.reloadWidgets().then(() => refreshActive()));
  const first = location.hash.replace(/^#\/?/, '');
  await show(pages.has(first) ? first : config.pages[0].id);
}

boot().catch(e => {
  document.getElementById('pages').innerHTML = `<div class="msg err" style="padding:48px"><b>${t('app.bootFailed')}</b><code>${String(e.message).replace(/</g, '&lt;')}</code><span>${t('app.bootHelp')}</span></div>`;
  console.error(e);
});
