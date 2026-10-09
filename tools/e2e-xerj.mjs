// Test end-to-end della board contro XERJ (via tools/proxy.py) con Playwright + Chromium headless.
//
// Prerequisiti: XERJ su :9200 con i dati di tools/seed-xerj.mjs, proxy su :8080, config.json in modalità xerj.
// Uso:  PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node tools/e2e-xerj.mjs [--base http://localhost:8080] [--local-vega]
//   --local-vega  intercetta cdn.jsdelivr.net e serve vega/vega-lite/vega-embed da node_modules
//   --only dashboard|discover|devtools   esegue solo quella sezione
//   --conn-url U  connessione "xerj" verso l'URL U, impostata nel localStorage del contesto pulito (config.json resta com'è)
//   --out NOME    cartella di output test-out/NOME (es. opensearch)
//   --demo        stesso flusso sul motore demo del browser (localStorage xvb.conn = demo), output in test-out/demo/
// Output in test-out/ (o test-out/demo/): e2e-results.json, msearch.jsonl (ogni _msearch con body e risposta),
// devtools/*.json, screenshots/*.png
//
// Ogni stato della dashboard si registra due volte: "asRendered" (come la board lo lascia) e "afterResize"
// (dopo un evento resize della finestra, come farebbe l'utente ridimensionandola): i grafici Vega con
// width "container" disegnati in un nodo staccato dal DOM restano larghi 0 finché non arriva un resize.
//
// Ogni pagina gira in un contesto pulito (localStorage vuoto); le interazioni sulla dashboard usano lo stesso contesto
// per verificare che dopo il ricaricamento la dashboard salvata torni.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const DEMO = process.argv.includes('--demo');
const CONN_URL = arg('--conn-url');
const OUT = path.join(ROOT, 'test-out', arg('--out') || (DEMO ? 'demo' : '')), SHOTS = path.join(OUT, 'screenshots'), DEV = path.join(OUT, 'devtools');
for (const d of [OUT, SHOTS, DEV]) mkdirSync(d, { recursive: true });
const BASE = arg('--base') || 'http://localhost:8080';
const ES_DIRECT = arg('--es') || 'http://localhost:9200';
const LOCAL_VEGA = process.argv.includes('--local-vega');
const ONLY = arg('--only'), run = s => !ONLY || ONLY === s;
const EXAMPLES = JSON.parse(readFileSync(path.join(ROOT, 'pages/dashboard/examples.json'), 'utf8'));
const MSEARCH_LOG = path.join(OUT, 'msearch.jsonl');
writeFileSync(MSEARCH_LOG, '');

const results = { mode: DEMO ? 'demo' : 'xerj', connUrl: CONN_URL, base: BASE, startedAt: new Date().toISOString(), cdn: LOCAL_VEGA ? 'local node_modules' : 'cdn.jsdelivr.net', pages: {}, dashboards: [], interactions: {}, discover: {}, devtools: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- browser e raccolta degli errori ---------- */
const browser = await chromium.launch();
async function newContext() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'it-IT' });
  if (CONN_URL) await ctx.addInitScript(u => { if (!localStorage.getItem('xvb.conn')) localStorage.setItem('xvb.conn', JSON.stringify({ mode: 'xerj', url: u, key: '' })); }, CONN_URL);
  if (DEMO) await ctx.addInitScript(() => { if (!localStorage.getItem('xvb.conn')) localStorage.setItem('xvb.conn', JSON.stringify({ mode: 'demo', url: 'http://localhost:9200', key: '' })); });
  if (LOCAL_VEGA) {
    const map = { 'vega@5.30.0': 'vega', 'vega-lite@5.21.0': 'vega-lite', 'vega-embed@6.26.0': 'vega-embed' };
    await ctx.route('https://cdn.jsdelivr.net/npm/**', async route => {
      const m = route.request().url().match(/npm\/([^/]+)\/(.+)$/);
      if (!m || !map[m[1]]) return route.continue();
      route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(path.join(ROOT, 'node_modules', map[m[1]], m[2])) });
    });
  }
  return ctx;
}
function watch(page, bucket) {
  const log = results.pages[bucket] ||= { console: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push({ type: m.type(), text: m.text().slice(0, 1500) }); });
  page.on('pageerror', e => log.pageErrors.push(String(e.stack || e).slice(0, 1500)));
  page.on('requestfailed', r => log.failedRequests.push({ url: r.url(), method: r.method(), error: r.failure()?.errorText }));
  page.on('response', async r => {
    const req = r.request(), url = r.url();
    if (url.includes('/_msearch')) {
      let body = null; try { body = await r.json(); } catch (e) { body = await r.text().catch(() => null); }
      appendFileSync(MSEARCH_LOG, JSON.stringify({ bucket, t: Date.now(), status: r.status(), request: req.postData(), response: body }) + '\n');
    }
    if (r.status() >= 400) log.httpErrors.push({ url, method: req.method(), status: r.status(), requestBody: req.postData()?.slice(0, 3000) ?? null, responseBody: (await r.text().catch(() => '')).slice(0, 3000) });
  });
  return log;
}

/** Attende che i pannelli abbiano finito: niente .pb.loading e rete ferma. */
async function settle(page, ms = 600) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#grid .pb.loading, #dhist.loading, #dtw.loading, #dvOut.loading'), null, { timeout: 30000 }).catch(() => {});
  await sleep(ms);
}
async function setTime(page, suffix, range) {
  await page.click(`#tbtn-${suffix}`);
  await page.click(`#tpop-${suffix} [data-r="${range}"]`);
  await settle(page);
}
/** Stato di ogni pannello della griglia. */
const panelStates = page => page.evaluate(() => [...document.querySelectorAll('#grid .panel')].map(a => {
  const pb = a.querySelector('.pb'), err = pb.querySelector('.msg.err'), msg = pb.querySelector('.msg');
  const svg = pb.querySelector('svg.marks, .vega-embed svg, svg');
  const out = { id: a.dataset.id, title: a.querySelector('h3')?.textContent, meta: a.querySelector('.meta')?.textContent || '' };
  if (err) return { ...out, status: 'error', error: err.innerText.trim() };
  if (pb.querySelector('.w-table')) return { ...out, status: 'drawn', render: 'table', rows: pb.querySelectorAll('tbody tr').length, firstRow: pb.querySelector('tbody tr')?.innerText.replace(/\s+/g, ' ').trim() };
  if (pb.querySelector('.w-search')) return { ...out, status: 'drawn', render: 'search', info: pb.querySelector('.sinfo')?.textContent, hits: pb.querySelectorAll('.hit').length, marks: pb.querySelectorAll('mark').length, emptyMsg: pb.querySelector('.sres .msg')?.textContent || null };
  if (msg) return { ...out, status: 'message', message: msg.innerText.trim() };
  if (svg) {
    const marks = svg.querySelectorAll('path, rect, circle').length;
    const texts = [...svg.querySelectorAll('text')].map(t => t.textContent).filter(Boolean);
    const svgW = Math.round(svg.getBoundingClientRect().width), pbW = Math.round(pb.getBoundingClientRect().width);
    // larga 0 (o quasi) = il grafico non si vede anche se la spec è stata compilata
    return { ...out, status: svgW < 40 ? 'blank' : 'drawn', render: 'vega', svgW, pbW, marks, text: texts.slice(0, 12).join(' | ').slice(0, 300) };
  }
  return { ...out, status: 'empty', html: pb.innerHTML.slice(0, 200) };
}));

/** Applica una dashboard dal pulsante JSON (su XERJ gli esempi non vengono caricati automaticamente). */
async function applyJson(page, def) {
  await page.click('#btnJson');
  await page.fill('#jTxt', JSON.stringify(def, null, 2));
  await page.click('#jApply');
  const err = await page.locator('#jErr').isVisible().catch(() => false);
  if (err) throw new Error('JSON non applicabile: ' + await page.locator('#jErr').textContent());
  await settle(page);
}
const resize = async page => { await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await sleep(700); };
const shot = async (page, name, full = false) => { const f = path.join(SHOTS, name + '.png'); await page.screenshot({ path: f, fullPage: full }); return 'test-out/screenshots/' + name + '.png'; };
const step = async (name, fn) => { try { return await fn(); } catch (e) { console.error(`[${name}]`, e.message); return { error: String(e.message).slice(0, 800) }; } };

/* ---------- 1. Dashboard ---------- */
if (run('dashboard')) {
  const ctx = await newContext(), page = await ctx.newPage(); watch(page, 'dashboard');
  await page.goto(BASE + '/#/dashboard'); await settle(page, 1200);
  results.interactions.initialList = await page.evaluate(() => ({ title: document.querySelector('#pageTitle').value, options: [...document.querySelectorAll('#dashSel option')].map(o => o.value + '=' + o.textContent), conn: document.querySelector('#connLbl').textContent }));
  await shot(page, '00-dashboard-initial-xerj');

  for (const ex of EXAMPLES) {
    await step('apply ' + ex.id, () => applyJson(page, ex));
    for (const range of ['7d', '30d']) {
      await step(`time ${ex.id} ${range}`, () => setTime(page, 'dash', range));
      const typed = ps => { for (const p of ps) p.type = ex.panels.find(x => x.id === p.id)?.type; return ps; };
      const asRendered = typed(await panelStates(page));
      const s0 = await shot(page, `dash-${ex.id}-${range}-as-rendered`);
      await resize(page);
      const panels = typed(await panelStates(page));
      const s1 = await shot(page, `dash-${ex.id}-${range}`), s2 = await shot(page, `dash-${ex.id}-${range}-full`, true);
      results.dashboards.push({ dashboard: ex.id, range, timeLabel: await page.locator('#tbtn-dash .tl').textContent(), asRendered, panels, screenshots: [s0, s1, s2] });
      console.log(`${ex.id} ${range}: as rendered ` + asRendered.map(p => `${p.id}:${p.status}`).join(' '));
      console.log(`${ex.id} ${range}: after resize ` + panels.map(p => `${p.id}:${p.status}`).join(' '));
    }
  }

  /* ---------- 2. Interazioni (web-traffic, 7 giorni) ---------- */
  const I = results.interactions;
  await step('apply web-traffic again', () => applyJson(page, EXAMPLES[0]));
  await step('time 7d', () => setTime(page, 'dash', '7d'));
  I.topnBeforeResize = await page.evaluate(() => { const ps = [...document.querySelectorAll('[data-id="p08"] .pb svg .mark-rect path')]; return { bars: ps.length, zeroWidth: ps.filter(p => p.getBoundingClientRect().width < 1).length }; });
  await resize(page);

  I.topnClick = await step('topn click', async () => {
    const before = await page.locator('.pagebar:not([hidden]) .chip').count();
    const bar = page.locator('[data-id="p08"] .pb svg .mark-rect path').first();
    await bar.waitFor({ timeout: 10000 });
    await bar.click({ force: true });
    await settle(page);
    const chips = await page.locator('.pagebar:not([hidden]) .chip').allInnerTexts();
    const shotF = await shot(page, 'int-topn-click-chip');
    const panels = await panelStates(page);
    // rimuove il filtro per le prove successive
    if (chips.length > before) { await page.locator('.pagebar:not([hidden]) .chip button').first().click(); await settle(page); await resize(page); }
    return { chipsBefore: before, chipsAfter: chips, ok: chips.length > before, panelsWithFilter: panels.map(p => ({ id: p.id, status: p.status, meta: p.meta, error: p.error })), screenshot: shotF };
  });

  I.searchPanel = await step('search panel', async () => {
    const inp = page.locator('#s-p10');
    await inp.fill('');
    await inp.press('Enter'); await settle(page);
    const emptyState = await panelStates(page).then(ps => ps.find(p => p.id === 'p10'));
    await inp.fill('timeout'); await inp.press('Enter'); await settle(page);
    const st = await panelStates(page).then(ps => ps.find(p => p.id === 'p10'));
    const sample = await page.locator('[data-id="p10"] .hit').first().innerHTML().catch(() => null);
    await page.locator('[data-id="p10"]').scrollIntoViewIfNeeded();
    const s = await shot(page, 'int-search-timeout');
    return { withoutQuery: emptyState, withTimeout: st, ok: (st?.marks || 0) > 0, firstHitHtml: sample?.slice(0, 1200), screenshot: s };
  });

  I.save = await step('save', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const enabled = await page.locator('#btnSave').isEnabled();
    await page.click('#btnSave');
    await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 }).catch(() => {});
    const toast = await page.locator('#toast').innerText().catch(() => '');
    await settle(page);
    const id = await page.evaluate(() => document.querySelector('#dashSel').value);
    const direct = DEMO ? { status: 'n/a (demo: localStorage)', body: { found: await page.evaluate(k => !!JSON.parse(localStorage.getItem('xvb.dash.demo.v4') || '[]').find(d => d.id === k), id) } }
      : await fetch(`${ES_DIRECT}/vega-dashboards/_doc/${encodeURIComponent(id)}`).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
    let def = null; try { def = JSON.parse(direct.body?._source?.definition); } catch (e) { /* */ }
    const s = await shot(page, 'int-save');
    return { saveEnabled: enabled, toast, savedId: id, get: { status: direct.status, found: direct.body?.found, title: direct.body?._source?.title, updated_at: direct.body?._source?.updated_at, panels: def?.panels?.length, defTime: def?.time }, ok: (DEMO || direct.status === 200) && direct.body?.found === true, screenshot: s };
  });

  I.reload = await step('reload', async () => {
    await page.reload(); await settle(page, 1500);
    const asRendered = (await panelStates(page)).map(p => p.status);
    await resize(page);
    const info = await page.evaluate(() => ({ title: document.querySelector('#pageTitle').value, selected: document.querySelector('#dashSel').value, options: [...document.querySelectorAll('#dashSel option')].map(o => o.value) }));
    const panels = await panelStates(page);
    const s = await shot(page, 'int-reload');
    return { ...info, asRendered, panels: panels.map(p => ({ id: p.id, status: p.status, error: p.error })), ok: info.selected === I.save?.savedId && panels.length === EXAMPLES[0].panels.length, screenshot: s };
  });
  await ctx.close();
}

/* ---------- 3. Discover ---------- */
if (run('discover')) {
  const ctx = await newContext(), page = await ctx.newPage(); watch(page, 'discover');
  const D = results.discover;
  await page.goto(BASE + '/#/discover'); await settle(page, 1200);
  D.initial = await page.evaluate(() => ({ index: document.querySelector('#dIndex')?.value, indices: [...document.querySelectorAll('#dIndex option')].map(o => o.value) }));
  await step('select index', async () => { await page.selectOption('#dIndex', 'ax-weblogs'); await settle(page); });
  await step('time 7d', () => setTime(page, 'disc', '7d'));
  const state = () => page.evaluate(() => ({
    count: document.querySelector('#dtop .count')?.textContent, sub: document.querySelector('#dtop .sub')?.textContent,
    histBars: document.querySelectorAll('#dhist svg .mark-rect path').length, histW: Math.round(document.querySelector('#dhist svg')?.getBoundingClientRect().width || 0), histErr: document.querySelector('#dhist .msg')?.innerText || null,
    rows: document.querySelectorAll('#dtw .dtbl > tbody > tr:not(.ddet)').length, tableErr: document.querySelector('#dtw .msg')?.innerText || null,
    foot: document.querySelector('#dfoot')?.innerText, chips: [...document.querySelectorAll('.pagebar:not([hidden]) .chip')].map(c => c.innerText), marks: document.querySelectorAll('#dtw mark').length }));
  D.base = await state(); D.base.screenshot = await shot(page, 'disc-weblogs-7d-as-rendered');
  await resize(page);
  D.baseAfterResize = await state(); D.baseAfterResize.screenshot = await shot(page, 'disc-weblogs-7d');

  D.openDoc = await step('open doc', async () => {
    await page.click('#dtw [data-act="exp"][data-i="0"]'); await sleep(300);
    const det = await page.locator('#dtw .ddet').first().innerText();
    await page.click('#dtw [data-act="dtab"][data-t="json"]'); await sleep(200);
    const json = await page.locator('#dtw .djson').first().innerText().catch(() => null);
    const s = await shot(page, 'disc-open-doc');
    return { ok: !!det, detail: det.slice(0, 600), json: json?.slice(0, 600), screenshot: s };
  });

  D.fieldDetail = await step('field detail', async () => {
    await page.click('#dside [data-act="fname"][data-f="host"]');
    await page.waitForFunction(() => { const b = document.querySelector('#fdet'); return b && !/Calcolo|Computing/i.test(b.textContent); }, null, { timeout: 15000 }).catch(() => {});
    const txt = await page.locator('#fdet').innerText();
    const vals = await page.locator('#fdet .tv .lab').allInnerTexts();
    const s = await shot(page, 'disc-field-host');
    return { ok: vals.length > 0, values: vals, text: txt, screenshot: s };
  });

  D.exclude = await step('exclude filter', async () => {
    const before = await state();
    await page.click('#fdet [data-act="filt"][data-neg]'); await settle(page);
    const after = await state();
    const s = await shot(page, 'disc-exclude');
    return { before: before.count, after: after.count, chips: after.chips, ok: after.chips.length > 0 && after.count !== before.count, screenshot: s };
  });

  D.loadMore = await step('load more', async () => {
    const before = await state();
    await page.click('#dMore'); await settle(page);
    const after = await state();
    await page.locator('#dfoot').scrollIntoViewIfNeeded();
    const s = await shot(page, 'disc-load-more');
    return { rowsBefore: before.rows, rowsAfter: after.rows, foot: after.foot, ok: after.rows > before.rows, screenshot: s };
  });

  D.queryHighlight = await step('query highlight', async () => {
    await page.fill('#disc-q-in', 'timeout'); await page.press('#disc-q-in', 'Enter'); await settle(page);
    const st = await state();
    const s = await shot(page, 'disc-query-timeout');
    return { ...st, ok: st.marks > 0, screenshot: s };
  });
  await ctx.close();
}

/* ---------- 4. Dev Tools ---------- */
if (run('devtools')) {
  const ctx = await newContext(), page = await ctx.newPage(); watch(page, 'devtools');
  await page.goto(BASE + '/#/devtools'); await settle(page, 1000);
  const opts = await page.$$eval('#dvSnip option', os => os.filter(o => o.value !== '').map(o => ({ value: o.value, label: o.textContent })));
  for (const o of opts) {
    const r = await step('snippet ' + o.label, async () => {
      await page.fill('#dvText', '');
      await page.selectOption('#dvSnip', o.value);
      const req = (await page.inputValue('#dvText')).trim();
      await page.evaluate(() => { document.querySelector('#dvStatus').innerHTML = ''; });   // niente pill della richiesta precedente
      const t0 = Date.now();
      await page.click('#dvRun');
      console.log('devtools', o.label, 'click', Date.now() - t0);
      await page.waitForFunction(() => document.querySelector('#dvStatus .pill'), null, { timeout: 15000 });
      console.log('devtools', o.label, 'pill', Date.now() - t0);
      await settle(page, 200);
      const status = await page.evaluate(() => [...document.querySelectorAll('#dvStatus > span')].map(x => x.textContent).join(' · '));
      const out = await page.locator('#dvOut').innerText();
      const s = await shot(page, `dev-${o.value}`);
      const file = path.join(DEV, `${o.value}.json`);
      writeFileSync(file, JSON.stringify({ label: o.label, request: req, status, response: out }, null, 2));
      return { label: o.label, request: req, status: status.replace(/\s+/g, ' '), responseHead: out.slice(0, 300), file: 'test-out/devtools/' + o.value + '.json', screenshot: s };
    });
    results.devtools.push(r);
  }
  await ctx.close();
}

await browser.close();
results.finishedAt = new Date().toISOString();
writeFileSync(path.join(OUT, ONLY ? `e2e-results-${ONLY}.json` : 'e2e-results.json'), JSON.stringify(results, null, 2));
console.log('ok → test-out/e2e-results.json');
