// Pagina Dev Tools: console REST in stile Kibana (richiesta sotto il cursore, Ctrl+Invio),
// cronologia, copia come curl e l'elenco dei widget registrati con i relativi problemi.

import { $, esc, store, fmtNum } from '../../core/util.js';
import { t, L, locale } from '../../core/i18n.js';

// La lingua resta fissa per tutta la vita della pagina (il cambio ricarica), quindi t() a livello di modulo va bene.
const DEFAULT_TEXT = `# ${t('dev.hint1')}
# ${t('dev.hint2')}

GET _cat/indices?v

GET ax-weblogs/_mapping

POST ax-weblogs/_search
{
  "size": 3,
  "query": { "query_string": { "query": "timeout AND host:api-2" } },
  "sort": [{ "@timestamp": "desc" }]
}

POST ax-weblogs/_search
{
  "size": 0,
  "aggs": {
    "per_host": {
      "terms": { "field": "host" },
      "aggs": { "p95": { "percentiles": { "field": "response_ms", "percents": [95] } } }
    }
  }
}
`;
const SNIPPETS = [
  [t('dev.snip.indices'), 'GET _cat/indices?v'],
  [t('dev.snip.health'), 'GET _cluster/health'],
  [t('dev.snip.mapping'), 'GET ax-weblogs/_mapping'],
  [t('dev.snip.count'), 'POST ax-weblogs/_count\n{\n  "query": { "query_string": { "query": "status:5*" } }\n}'],
  [t('dev.snip.highlight'), 'POST ax-weblogs/_search\n{\n  "size": 5,\n  "query": { "bool": { "must": [{ "query_string": { "query": "pool" } }] } },\n  "highlight": { "fields": { "*": {} } }\n}'],
  [t('dev.snip.histogram'), 'POST ax-weblogs/_search\n{\n  "size": 0,\n  "aggs": { "t": { "date_histogram": { "field": "@timestamp", "fixed_interval": "1h", "min_doc_count": 0 } } }\n}'],
  [t('dev.snip.dashboards'), 'POST vega-dashboards/_search\n{\n  "size": 20,\n  "_source": ["title", "updated_at"]\n}']
];
const REQ = /^\s*(GET|POST|PUT|DELETE|HEAD|PATCH)\s+(\S+)\s*$/i;
let app, ta, hist = store.get('xvb.devtools.hist', []);

export default {
  id: 'devtools',
  mount(slots, a) {
    app = a;
    slots.bar.innerHTML = `
      <label class="vh" for="dvSnip">${t('dev.insert')}</label>
      <select id="dvSnip"><option value="">${t('dev.insert')}…</option>${SNIPPETS.map((s, i) => `<option value="${i}">${esc(s[0])}</option>`).join('')}</select>
      <button type="button" class="btn primary" id="dvRun" title="${t('dev.runKey')}">${t('dev.run')}</button>
      <button type="button" class="btn ghost" id="dvIndent">${t('dev.indent')}</button>
      <button type="button" class="btn ghost" id="dvCurl">${t('dev.curl')}</button>
      <span class="dvwhere" id="dvWhere" aria-live="polite"></span>`;
    slots.main.innerHTML = `<div class="dv">
      <section class="dvcard" aria-label="${t('dev.requests')}">
        <div class="dvhead"><span class="eyebrow">${t('dev.console')}</span></div>
        <label class="vh" for="dvText">${t('dev.requests')}</label>
        <textarea id="dvText" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        <details class="dvmore" id="dvHist"><summary>${t('dev.history')}</summary><div id="dvHistList"></div></details>
        <details class="dvmore"><summary>${t('dev.widgets')} · ${app.widgets.size}${app.problems.length ? ' · <b class="warnt">' + esc(t('dev.withProblems', { n: app.problems.length })) + '</b>' : ''}</summary><div id="dvWidgets"></div></details>
      </section>
      <section class="dvcard" aria-label="${t('dev.response')}">
        <div class="dvhead"><span class="eyebrow">${t('dev.response')}</span><span id="dvStatus"></span></div>
        <pre class="dvout" id="dvOut"><span class="dvhint">${t('dev.empty')}</span></pre>
      </section></div>`;
    ta = $('#dvText');
    ta.value = store.get('xvb.devtools.text', DEFAULT_TEXT);
    renderHistory(); renderWidgets();
    ta.addEventListener('input', () => { store.set('xvb.devtools.text', ta.value); where(); });
    ['keyup', 'click', 'focus'].forEach(ev => ta.addEventListener(ev, where));
    ta.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); }
    });
    $('#dvRun').addEventListener('click', run);
    $('#dvIndent').addEventListener('click', indent);
    $('#dvCurl').addEventListener('click', curl);
    $('#dvSnip').addEventListener('change', e => { const s = SNIPPETS[+e.target.value]; if (s) insert(s[1]); e.target.value = ''; });
    where();
  },
  show() { app.setTitle(L(app.config.pages.find(p => p.id === 'devtools')?.title) || 'Dev Tools'); }
};

/** Trova la richiesta in cui si trova il cursore. Ritorna {method, path, bodyText, start, end} (righe). */
function current() {
  const lines = ta.value.split('\n');
  const cur = ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
  const starts = lines.map((l, i) => REQ.test(l) ? i : -1).filter(i => i >= 0);
  if (!starts.length) return null;
  const start = [...starts].reverse().find(i => i <= cur) ?? starts[0];
  const next = starts.find(i => i > start) ?? lines.length;
  let end = next - 1; while (end > start && !lines[end].trim()) end--;
  const [, method, path] = lines[start].match(REQ);
  const bodyText = lines.slice(start + 1, end + 1).filter(l => !/^\s*(#|\/\/)/.test(l)).join('\n').trim();
  return { method: method.toUpperCase(), path, bodyText, start, end, lines };
}
function where() {
  const r = current();
  $('#dvWhere').textContent = r ? t('dev.where', { line: r.start + 1, req: r.method + ' ' + r.path }) : t('dev.none');
}
function parseBody(r) {
  if (!r.bodyText) return null;
  if (/(^|\/)_(msearch|bulk)(\?|$)/.test(r.path)) return r.bodyText.split('\n').filter(l => l.trim()).map(l => JSON.stringify(JSON.parse(l))).join('\n') + '\n';
  return JSON.parse(r.bodyText);
}
async function run() {
  const r = current(); if (!r) { app.toast(t('dev.nothing')); return; }
  let body;
  try { body = parseBody(r); } catch (e) { show({ status: 0, ok: false, body: t('dev.badBody', { msg: e.message }), ms: 0, size: 0 }); return; }
  $('#dvOut').classList.add('loading'); $('#dvRun').disabled = true;
  let res;
  try { res = await app.backend.request(r.method, r.path, body); }
  catch (e) { res = { status: 0, ok: false, body: t('dev.connFailed', { msg: e.message }) + (app.backend.isDemo() ? '' : ' ' + t('dev.connHint')), ms: 0, size: 0 }; }
  $('#dvOut').classList.remove('loading'); $('#dvRun').disabled = false;
  show(res);
  hist = [{ method: r.method, path: r.path, body: r.bodyText, status: res.status, ts: Date.now() }, ...hist.filter(h => !(h.method === r.method && h.path === r.path && h.body === r.bodyText))].slice(0, 30);
  store.set('xvb.devtools.hist', hist); renderHistory();
  if (/^(PUT|POST|DELETE)$/.test(r.method) && !/_(search|count|msearch|mapping)/.test(r.path)) app.backend.resetCaches();
}
function show(res) {
  const cls = res.status >= 200 && res.status < 300 ? 'ok' : 'err';
  $('#dvStatus').innerHTML = `<span class="pill ${cls}">${res.status || t('dev.error')}</span><span class="dvmeta">${res.ms} ms · ${esc(t('dev.chars', { n: fmtNum(res.size) }))}</span>`;
  $('#dvOut').innerHTML = typeof res.body === 'string' ? esc(res.body) : colorJson(JSON.stringify(res.body, null, 2));
}
/** Colora un JSON già indentato (chiavi, stringhe, numeri, booleani). */
function colorJson(s) {
  return esc(s).replace(/(&quot;(?:\\.|(?!&quot;).)*&quot;)(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (m, str, colon, lit) => str ? `<span class="${colon ? 'jk' : 'js'}">${str}</span>${colon || ''}` : lit ? `<span class="jl">${m}</span>` : `<span class="jn">${m}</span>`);
}
function indent() {
  const r = current(); if (!r || !r.bodyText) return;
  let out;
  try {
    const b = parseBody(r);
    out = typeof b === 'string' ? b.trim() : JSON.stringify(b, null, 2);
  } catch (e) { app.toast(t('common.badJson', { msg: e.message })); return; }
  const lines = r.lines; lines.splice(r.start + 1, r.end - r.start, ...out.split('\n'));
  ta.value = lines.join('\n'); store.set('xvb.devtools.text', ta.value);
}
async function curl() {
  const r = current(); if (!r) return;
  const url = (app.backend.isDemo() ? 'http://localhost:9200' : app.backend.conn.url.replace(/\/+$/, '')) + '/' + r.path.replace(/^\/+/, '');
  let cmd = `curl -X ${r.method} "${url}"`;
  if (app.backend.loggedIn) cmd += app.backend.conn.mode === 'xerj' ? ` -H "Authorization: ApiKey $XERJ_API_KEY"` : ` -u "$ES_USER:$ES_PASSWORD"`;
  if (r.bodyText) {
    let b; try { b = parseBody(r); } catch (e) { app.toast(t('common.badJson', { msg: e.message })); return; }
    const nd = typeof b === 'string';
    cmd += ` -H 'Content-Type: application/${nd ? 'x-ndjson' : 'json'}' ${nd ? '--data-binary' : '-d'} '${(nd ? b : JSON.stringify(b)).replace(/'/g, "'\\''")}'`;
  }
  try { await navigator.clipboard.writeText(cmd); app.toast(t('dev.curlCopied')); }
  catch (e) { app.modal.open(`<h2>${t('dev.curlTitle')}</h2><label class="vh" for="curlTxt">${t('dev.curlTitle')}</label><textarea id="curlTxt" readonly style="min-height:120px">${esc(cmd)}</textarea><div class="mrow"><button type="button" class="btn" data-close>${t('common.close')}</button></div>`); $('#curlTxt').select(); }
}
function insert(text) {
  const v = ta.value.replace(/\s*$/, '');
  ta.value = v + '\n\n' + text + '\n';
  const pos = ta.value.length - 1;
  ta.focus(); ta.setSelectionRange(pos, pos); ta.scrollTop = ta.scrollHeight;
  store.set('xvb.devtools.text', ta.value); where();
}
function renderHistory() {
  const box = $('#dvHistList'); if (!box) return;
  box.innerHTML = hist.length ? `<ul class="dvh">${hist.map((h, i) => `<li><button type="button" data-h="${i}"><span class="pill ${h.status >= 200 && h.status < 300 ? 'ok' : 'err'}">${h.status || '!'}</span><b>${esc(h.method)}</b> <span>${esc(h.path)}</span><time>${new Date(h.ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</time></button></li>`).join('')}</ul>`
    : `<p class="help">${t('dev.historyEmpty')}</p>`;
  box.onclick = e => { const b = e.target.closest('[data-h]'); if (!b) return; const h = hist[+b.dataset.h]; insert(h.method + ' ' + h.path + (h.body ? '\n' + h.body : '')); };
}
function renderWidgets() {
  const rows = [...app.widgets.values()].map(w => `<tr><td><code>${esc(w.type)}</code></td><td>${esc(L(w.name))}</td><td>${w.source}${w.overrides ? ' (' + t('dash.overrides') + ')' : ''}</td><td>${w.render ? 'HTML' : 'Vega-Lite'}</td></tr>`).join('');
  const probs = app.problems.map(p => `<li><code>${esc(p.where)}</code>: ${esc(p.msg)}</li>`).join('');
  $('#dvWidgets').innerHTML = `<table class="dvw"><thead><tr><th>type</th><th>${t('dev.colName')}</th><th>${t('dev.colSource')}</th><th>${t('dev.colRender')}</th></tr></thead><tbody>${rows}</tbody></table>${probs ? `<ul class="plist">${probs}</ul>` : ''}`;
}
