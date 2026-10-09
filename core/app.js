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
  await ensureLogin();
  const first = location.hash.replace(/^#\/?/, '');
  await show(pages.has(first) ? first : config.pages[0].id);
}

boot().catch(e => {
  document.getElementById('pages').innerHTML = `<div class="msg err" style="padding:48px"><b>${t('app.bootFailed')}</b><code>${String(e.message).replace(/</g, '&lt;')}</code><span>${t('app.bootHelp')}</span></div>`;
  console.error(e);
});
