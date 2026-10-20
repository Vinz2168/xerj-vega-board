// Pagina Impostazioni: esporta, importa e ripristina la configurazione della board (widget dell'indice, dashboard,
// index pattern, preferenze) come un unico file JSON («bundle»). Le credenziali non entrano mai nel bundle.
// Importare non scrive subito: valida ogni elemento e mostra un'anteprima; ripristinare salva prima un backup
// (scaricato e tenuto nel browser) e offre «Annulla». Solo con XERJ e in demo (config.json → pages[].engines).

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t, setLang, getLang, isForced } from '../../core/i18n.js';
import { confirm } from '../../core/ui.js';
import { compileDocs } from '../../core/registry.js';
import { validateDashboard } from '../../core/contract.js';

const SECTIONS = ['widgets', 'dashboards', 'patterns', 'prefs'];
const FORMAT = 'xvb-bundle', VERSION = 1, BACKUP = 'xvb.backup.last';
let app, counts = {}, pending = null;

const page = {
  id: 'settings',
  async mount(slots, a) {
    app = a;
    slots.main.innerHTML = `<div class="st">
      <section class="ixcard stcard"><h2>${t('set.state')}</h2><p class="help">${t('set.stateHelp')}</p><div class="stcounts" id="stCounts"></div></section>
      <section class="ixcard stcard"><h2>${t('set.export')}</h2><p class="help">${t('set.exportHelp')}</p>
        <div class="stchecks" id="stExp">${checks('exp')}</div>
        <div class="mrow"><button type="button" class="btn primary" id="stExpGo">${t('set.exportGo')}</button></div></section>
      <section class="ixcard stcard"><h2>${t('set.import')}</h2><p class="help">${t('set.importHelp')}</p>
        <div class="mrow"><label class="btn" for="stFile">${t('set.chooseFile')}</label><input type="file" id="stFile" accept="application/json,.json" class="vh">
          <span class="spacer"></span><button type="button" class="btn ghost" id="stBackup" hidden>${t('set.restoreBackup')}</button></div>
        <div id="stPreview"></div></section>
      <section class="ixcard stcard stdanger"><h2>${t('set.reset')}</h2><p class="help">${t('set.resetHelp')}</p>
        <div class="stchecks" id="stRes">${checks('res')}</div>
        <div class="mrow"><button type="button" class="btn danger" id="stResGo">${t('set.resetGo')}</button></div></section>
    </div>`;
    $('#stExpGo').onclick = () => exportNow();
    $('#stFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); };
    $('#stBackup').onclick = () => { const b = store.get(BACKUP, null); if (b) preview(b, t('set.backupName', { when: new Date(b.exported_at).toLocaleString() })); };
    $('#stResGo').onclick = () => resetNow();
    await page.refresh();
  },
  async refresh() {
    const b = await collect(SECTIONS);
    counts = { widgets: b.widgets.length, dashboards: b.dashboards.length, patterns: b.patterns.length, prefs: Object.keys(b.prefs).length };
    const user = b.widgets.filter(w => w.source !== 'builtin').length;
    $('#stCounts').innerHTML = SECTIONS.map(s => `<div><span>${t('set.s.' + s)}</span><b>${fmtNum(counts[s])}</b>${s === 'widgets' ? `<em>${t('set.userWidgets', { n: user })}</em>` : ''}</div>`).join('')
      + `<p class="help stwhere">${app.backend.isDemo() ? t('set.whereDemo') : t('set.where', { mode: esc(app.backend.conn.url), w: code(app.backend.widgetIndex), d: code(app.backend.dashboardIndex), p: code(app.backend.patternIndex) })}</p>`;
    $('#stBackup').hidden = !store.get(BACKUP, null);
  }
};
export default page;

const code = s => '<code>' + esc(s) + '</code>';
const checks = id => SECTIONS.map(s => `<label class="chk"><input type="checkbox" data-s="${s}" checked> <span>${t('set.s.' + s)}</span></label>`).join('');
const chosen = id => [...$('#' + id).querySelectorAll('input:checked')].map(i => i.dataset.s);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');

/* ---- bundle ---- */
async function collect(sections) {
  const be = app.backend, b = { format: FORMAT, version: VERSION, exported_at: new Date().toISOString(), engine: be.conn.mode };
  if (sections.includes('widgets')) b.widgets = (await be.listWidgetDocs().catch(() => [])) || [];
  if (sections.includes('dashboards')) b.dashboards = (await be.listDash().catch(() => [])) || [];
  if (sections.includes('patterns')) b.patterns = (await be.listPatterns().catch(() => [])).map(({ id, title, timefield }) => ({ id, title, timefield }));
  if (sections.includes('prefs')) {
    b.prefs = {};
    for (const [k, key, json] of [['skin', 'xvb.skin'], ['theme', 'xvb.theme'], ['lang', 'xvb.lang'], ['time', 'xvb.time', true]]) {
      try { const v = localStorage.getItem(key); if (v != null) b.prefs[k] = json ? JSON.parse(v) : v; } catch (e) { /* ignorato */ }
    }
  }
  return b;
}
function download(bundle, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportNow() {
  const s = chosen('stExp'); if (!s.length) return app.toast(t('set.pickOne'));
  download(await collect(s), `vega-board-config-${stamp()}.json`);
  app.toast(t('set.exported'));
}

/* ---- importazione: lettura, anteprima, applicazione ---- */
function readFile(f) {
  const r = new FileReader();
  r.onload = () => {
    let b; try { b = JSON.parse(r.result); } catch (e) { return showError(t('set.badJson', { msg: e.message })); }
    if (b?.format !== FORMAT) return showError(t('set.badFormat'));
    if (b.version > VERSION) return showError(t('set.newerVersion', { v: b.version }));
    preview(b, f.name);
  };
  r.readAsText(f);
}
const showError = msg => { $('#stPreview').innerHTML = `<p class="result bad">${esc(msg)}</p>`; };

/** Per ogni sezione: elementi nuovi, che sovrascrivono, non validi (col motivo). Niente viene scritto qui. */
async function analyze(b) {
  const cur = await collect(SECTIONS), out = {};
  if (b.widgets) {
    const { widgets, problems } = compileDocs(b.widgets, 'bundle'), have = new Set(cur.widgets.map(w => w.type));
    out.widgets = { ok: b.widgets.filter(d => widgets.some(w => w.type === d.type)), bad: problems.map(p => [p.type || '?', p.msg]), over: widgets.filter(w => have.has(w.type)).length };
  }
  if (b.dashboards) {
    const types = new Map(app.widgets); for (const d of out.widgets?.ok || []) types.set(d.type, d);
    const have = new Set(cur.dashboards.map(d => d.id)), ok = [], bad = [];
    for (const d of b.dashboards) { const e = typeof d?.id === 'string' ? validateDashboard(d, types) : ['"id" is required']; (e.length ? bad.push([d?.id || '?', e.join('; ')]) : ok.push(d)); }
    out.dashboards = { ok, bad, over: ok.filter(d => have.has(d.id)).length };
  }
  if (b.patterns) {
    const have = new Set(cur.patterns.map(p => p.title)), ok = b.patterns.filter(p => typeof p?.title === 'string' && p.title.trim());
    out.patterns = { ok, bad: b.patterns.filter(p => !ok.includes(p)).map(p => [JSON.stringify(p).slice(0, 40), 'missing "title"']), over: ok.filter(p => have.has(p.title)).length };
  }
  if (b.prefs) {
    const ok = Object.entries(b.prefs).filter(([k]) => ['skin', 'theme', 'lang', 'time'].includes(k));
    out.prefs = { ok, bad: Object.keys(b.prefs).filter(k => !ok.some(([x]) => x === k)).map(k => [k, 'unknown preference']), over: ok.length };
  }
  return out;
}
async function preview(b, name) {
  const box = $('#stPreview'); box.innerHTML = ''; box.classList.add('loading');
  const an = await analyze(b); box.classList.remove('loading');
  pending = { b, an };
  const secs = SECTIONS.filter(s => an[s]);
  box.innerHTML = `<p class="help">${t('set.fileInfo', { name: esc(name), when: esc(new Date(b.exported_at).toLocaleString()), engine: esc(b.engine || '?') })}</p>
    <table class="dvw sttable"><thead><tr><th>${t('set.section')}</th><th>${t('set.valid')}</th><th>${t('set.overwrites')}</th><th>${t('set.invalid')}</th><th>${t('set.mode')}</th></tr></thead><tbody>
    ${secs.map(s => `<tr><td><label class="chk"><input type="checkbox" data-s="${s}" checked> <span>${t('set.s.' + s)}</span></label></td>
      <td>${fmtNum(an[s].ok.length)}</td><td>${fmtNum(an[s].over)}</td><td>${an[s].bad.length ? `<b class="warnt">${fmtNum(an[s].bad.length)}</b>` : '0'}</td>
      <td>${s === 'prefs' ? '—' : `<select data-mode="${s}"><option value="merge">${t('set.merge')}</option><option value="replace">${t('set.replace')}</option></select>`}</td></tr>`).join('')}</tbody></table>
    ${secs.flatMap(s => an[s].bad.map(([k, m]) => `<p class="help warn">${t('set.s.' + s)} · <code>${esc(k)}</code>: ${esc(m)}</p>`)).join('')}
    <p class="help">${t('set.replaceHelp')}</p>
    <div class="mrow"><button type="button" class="btn ghost" id="stCancel">${t('common.cancel')}</button><button type="button" class="btn primary" id="stApply">${t('set.apply')}</button></div>`;
  $('#stCancel').onclick = () => { pending = null; box.innerHTML = ''; };
  $('#stApply').onclick = async () => {
    const sel = [...box.querySelectorAll('input[data-s]:checked')].map(i => i.dataset.s);
    const modes = Object.fromEntries([...box.querySelectorAll('select[data-mode]')].map(x => [x.dataset.mode, x.value]));
    if (!sel.length) return app.toast(t('set.pickOne'));
    if (sel.some(s => modes[s] === 'replace') && !await confirm({ title: t('set.replaceTitle'), html: t('set.replaceConfirm', { list: sel.filter(s => modes[s] === 'replace').map(s => t('set.s.' + s)).join(', ') }), ok: t('set.apply'), danger: true })) return;
    const backup = await collect(SECTIONS); store.set(BACKUP, backup);
    try {
      await apply(pending.an, sel, modes);
      box.innerHTML = ''; pending = null;
      app.toast(t('set.imported'), t('common.undo'), () => undo(backup));
    } catch (e) { showError(e.message); }
    await afterChange();
  };
}

/** Scrive le sezioni scelte. replace = toglie prima quello che il bundle non contiene. */
async function apply(an, sel, modes) {
  const be = app.backend, cur = await collect(SECTIONS);
  if (sel.includes('widgets') && an.widgets) {
    if (modes.widgets === 'replace') for (const w of cur.widgets) if (!an.widgets.ok.some(d => d.type === w.type)) await be.deleteWidgetDoc(w.type);
    for (const d of an.widgets.ok) await be.saveWidgetDoc(d);
  }
  if (sel.includes('dashboards') && an.dashboards) {
    if (modes.dashboards === 'replace') for (const d of cur.dashboards) if (!an.dashboards.ok.some(x => x.id === d.id)) await be.deleteDash(d.id);
    for (const d of an.dashboards.ok) await be.saveDash(d);
  }
  if (sel.includes('patterns') && an.patterns) {
    if (modes.patterns === 'replace') for (const p of cur.patterns) if (!an.patterns.ok.some(x => x.title === p.title)) await be.deletePattern(p.id);
    for (const p of an.patterns.ok) { const same = (await be.listPatterns()).find(x => x.title === p.title); await be.savePattern({ ...p, id: same?.id }); }
  }
  if (sel.includes('prefs') && an.prefs) applyPrefs(Object.fromEntries(an.prefs.ok));
}
function applyPrefs(p) {
  const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { /* ignorato */ } };
  set('xvb.time', p.time);
  set('xvb.theme', p.theme === 'dark' || p.theme === 'light' ? p.theme : null);
  if (p.theme === 'dark' || p.theme === 'light') document.documentElement.dataset.theme = p.theme; else delete document.documentElement.dataset.theme;
  const sk = $('#skinSel'); set('xvb.skin', p.skin || null);
  if (sk && !sk.hidden) { sk.value = p.skin || app.config.skin || 'nova'; sk.dispatchEvent(new Event('change')); }
  const lang = p.lang || null;
  if ((lang || null) !== (isForced() ? getLang() : null)) { setLang(lang); setTimeout(() => location.reload(), 1200); }
}
async function undo(backup) {
  const an = await analyze(backup);
  await apply(an, SECTIONS, Object.fromEntries(SECTIONS.map(s => [s, 'replace'])));
  app.toast(t('set.undone'));
  await afterChange();
}
async function afterChange() {
  app.backend.resetCaches();
  await app.reloadWidgets();
  app.emit('config');
  app.refreshActive();
}

/* ---- ripristino ---- */
async function resetNow() {
  const s = chosen('stRes'); if (!s.length) return app.toast(t('set.pickOne'));
  const list = s.map(x => `${t('set.s.' + x)}${x === 'prefs' ? '' : ' (' + fmtNum(counts[x] || 0) + ')'}`).join(', ');
  if (!await confirm({ title: t('set.resetTitle'), html: t('set.resetConfirm', { list: esc(list) }) + (app.backend.isDemo() ? '' : '<br><br>' + t('set.resetServer', { url: esc(app.backend.conn.url) })), ok: t('set.resetGo'), danger: true })) return;
  const backup = await collect(SECTIONS);
  store.set(BACKUP, backup);
  download(backup, `vega-board-backup-${stamp()}.json`);
  const be = app.backend, demo = be.isDemo();
  try {
    if (s.includes('widgets')) {
      for (const w of backup.widgets) await be.deleteWidgetDoc(w.type);
      if (demo) be.forgetDemo('widgets');
      else for (const d of (await (await fetch(new URL('widgets/declarative/seed.json', app.base))).json()).widgets) await be.saveWidgetDoc({ ...d, source: 'builtin' });
    }
    if (s.includes('dashboards')) { for (const d of backup.dashboards) await be.deleteDash(d.id); if (demo) be.forgetDemo('dashboards'); }
    if (s.includes('patterns')) { for (const p of backup.patterns) await be.deletePattern(p.id); if (demo) be.forgetDemo('patterns'); }
    if (s.includes('prefs')) applyPrefs({});
    app.toast(t('set.resetDone'), t('common.undo'), () => undo(backup));
  } catch (e) { app.toast(e.message); }
  await afterChange();
}
