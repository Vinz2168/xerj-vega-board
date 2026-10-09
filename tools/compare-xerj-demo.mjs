// Confronto XERJ ↔ motore demo (core/demo/engine.js) sulle stesse query e sugli stessi documenti.
//
// Uso: node tools/compare-xerj-demo.mjs [--es http://localhost:9200] [--out NOME]
//   --out NOME  legge test-out/NOME/msearch.jsonl e scrive in test-out/NOME/compare (es. opensearch)
// Richiede test-out/seed-now.txt (scritto da tools/seed-xerj.mjs): il generatore demo viene eseguito con lo stesso
// "adesso" del seed, così i due motori vedono documenti identici.
// Output: test-out/compare/checks.json (funzioni di query), test-out/compare/panels.json (query dei pannelli
// intercettate in test-out/msearch.jsonl), più un file per check con le due risposte complete.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg0 = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const SUB = arg0('--out') || '';
const OUT = path.join(ROOT, 'test-out', SUB, 'compare');
mkdirSync(OUT, { recursive: true });
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ES = (arg('--es') || 'http://localhost:9200').replace(/\/$/, '');

const NOW = +readFileSync(path.join(ROOT, 'test-out/seed-now.txt'), 'utf8').trim();
const realNow = Date.now; Date.now = () => NOW;
const { demoData } = await import('../core/demo/data.js');
const { demoRoute } = await import('../core/demo/engine.js');
demoData();
Date.now = realNow;

async function xerj(method, p, body) {
  const nd = /(^|\/)_(msearch|bulk)(\?|$)/.test(p);
  const r = await fetch(ES + '/' + p.replace(/^\//, ''), { method, headers: body != null ? { 'content-type': nd ? 'application/x-ndjson' : 'application/json' } : {},
    body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const txt = await r.text(); let b; try { b = JSON.parse(txt); } catch { b = txt; }
  return { status: r.status, body: b };
}
function demo(method, p, body) {
  try { return demoRoute(method, p, body); } catch (e) { return { status: 'throw', body: String(e.message) }; }
}

/* ---------- riassunto di una risposta di ricerca, per confronti stabili ---------- */
const round = v => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
function aggSummary(a) {
  if (!a || typeof a !== 'object') return a;
  if (Array.isArray(a.buckets)) {
    return { buckets: a.buckets.length, docs: a.buckets.reduce((s, b) => s + b.doc_count, 0), sum_other: a.sum_other_doc_count,
      first: a.buckets.slice(0, 4).map(b => ({ key: b.key, n: b.doc_count, ...subSummary(b) })), lastKey: a.buckets.at(-1)?.key };
  }
  if ('values' in a) return { values: Object.fromEntries(Object.entries(a.values || {}).map(([k, v]) => [k, round(v)])) };
  if ('value' in a) return { value: round(a.value) };
  return a;
}
function subSummary(b) { const o = {}; for (const [k, v] of Object.entries(b)) if (v && typeof v === 'object' && !Array.isArray(v)) o[k] = aggSummary(v); return o; }
function searchSummary(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.error) return { error: r.error.type + ': ' + (r.error.reason || '').slice(0, 200) };
  const t = r.hits?.total;
  return { total: typeof t === 'number' ? t : t && { value: t.value, relation: t.relation }, hits: r.hits?.hits?.length,
    ids: r.hits?.hits?.slice(0, 5).map(h => h._id), highlight: r.hits?.hits?.filter(h => h.highlight).length,
    aggs: r.aggregations && Object.fromEntries(Object.entries(r.aggregations).map(([k, v]) => [k, aggSummary(v)])) };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- 1. funzioni di query richieste dal test ---------- */
const D = 864e5, from7 = NOW - 7 * D;
const range7 = { range: { '@timestamp': { gte: from7, lte: NOW, format: 'epoch_millis' } } };
const S = (index, body) => ({ method: 'POST', path: index + '/_search', body });
const CHECKS = [
  { name: 'date_histogram min_doc_count 0 + extended_bounds', note: 'bucket vuoti inclusi e limiti estesi oltre i dati',
    req: S('ax-weblogs', { size: 0, query: { bool: { filter: [range7] } }, aggs: { t: { date_histogram: { field: '@timestamp', fixed_interval: '6h', min_doc_count: 0, extended_bounds: { min: from7, max: NOW + 2 * D } } } } }),
    pick: r => { const b = r.aggregations?.t?.buckets || []; return { buckets: b.length, docs: b.reduce((s, x) => s + x.doc_count, 0), empty: b.filter(x => !x.doc_count).length, firstKey: b[0]?.key, lastKey: b.at(-1)?.key }; } },
  { name: 'date_histogram senza extended_bounds', note: 'come lo snippet di Dev Tools',
    req: S('ax-weblogs', { size: 0, aggs: { t: { date_histogram: { field: '@timestamp', fixed_interval: '1h', min_doc_count: 0 } } } }),
    pick: r => { const b = r.aggregations?.t?.buckets || []; return { buckets: b.length, docs: b.reduce((s, x) => s + x.doc_count, 0), empty: b.filter(x => !x.doc_count).length }; } },
  { name: 'percentiles', note: 'p95 di response_ms (ES/XERJ: TDigest approssimato; demo: esatto con interpolazione)',
    req: S('ax-weblogs', { size: 0, query: { bool: { filter: [range7] } }, aggs: { m: { percentiles: { field: 'response_ms', percents: [50, 95, 99] } } } }),
    pick: r => ({ keys: Object.keys(r.aggregations?.m?.values || {}), values: Object.values(r.aggregations?.m?.values || {}).map(v => Math.round(v * 10) / 10) }), approx: 0.03 },
  { name: 'percentiles in un bucket terms', note: 'come lo snippet di default di Dev Tools',
    req: S('ax-weblogs', { size: 0, aggs: { h: { terms: { field: 'host' }, aggs: { p95: { percentiles: { field: 'response_ms', percents: [95] } } } } } }),
    pick: r => (r.aggregations?.h?.buckets || []).map(b => [b.key, b.doc_count, Math.round(Object.values(b.p95.values)[0])]), approx: 0.05 },
  { name: 'value_count', req: S('ax-weblogs', { size: 0, aggs: { c: { value_count: { field: 'host' } }, cr: { value_count: { field: 'response_ms' } } } }),
    pick: r => ({ host: r.aggregations?.c?.value, response_ms: r.aggregations?.cr?.value }) },
  { name: 'cardinality', req: S('ax-weblogs', { size: 0, aggs: { p: { cardinality: { field: 'path' } }, s: { cardinality: { field: 'status' } }, b: { cardinality: { field: 'bytes' } } } }),
    pick: r => ({ path: r.aggregations?.p?.value, status: r.aggregations?.s?.value, bytes: r.aggregations?.b?.value }), approx: 0.01 },
  { name: 'terms ordinato per sotto-aggregazione', note: 'order {m: desc} con sum, come il widget topn',
    req: S('ax-orders', { size: 0, aggs: { k: { terms: { field: 'category', size: 4, order: { m: 'desc' } }, aggs: { m: { sum: { field: 'total' } } } } } }),
    pick: r => ({ order: (r.aggregations?.k?.buckets || []).map(b => b.key), sums: (r.aggregations?.k?.buckets || []).map(b => Math.round(b.m.value)), other: r.aggregations?.k?.sum_other_doc_count }) },
  { name: 'terms ordinato per percentile', note: 'order su percentiles: in ES serve "m.95"',
    req: S('ax-weblogs', { size: 0, aggs: { k: { terms: { field: 'host', size: 3, order: { 'm.95': 'desc' } }, aggs: { m: { percentiles: { field: 'response_ms', percents: [95] } } } } } }),
    pick: r => ({ order: (r.aggregations?.k?.buckets || []).map(b => b.key) }) },
  { name: 'highlight fields "*" + require_field_match false', note: 'come i widget search e Discover',
    req: S('ax-weblogs', { size: 5, query: { bool: { must: [{ query_string: { query: 'timeout', default_operator: 'AND', lenient: true } }] } }, highlight: { pre_tags: ['\u0002'], post_tags: ['\u0003'], require_field_match: false, fields: { '*': {} } } }),
    pick: r => ({ hits: r.hits?.hits?.length, withHighlight: r.hits?.hits?.filter(h => h.highlight).length, fields: [...new Set((r.hits?.hits || []).flatMap(h => Object.keys(h.highlight || {})))] }) },
  { name: 'highlight fields "message" (nome esplicito)', note: 'stessa query, campo esplicito',
    req: S('ax-weblogs', { size: 5, query: { bool: { must: [{ query_string: { query: 'timeout', default_operator: 'AND', lenient: true } }] } }, highlight: { pre_tags: ['\u0002'], post_tags: ['\u0003'], require_field_match: false, fields: { message: {} } } }),
    pick: r => ({ hits: r.hits?.hits?.length, withHighlight: r.hits?.hits?.filter(h => h.highlight).length, fields: [...new Set((r.hits?.hits || []).flatMap(h => Object.keys(h.highlight || {})))] }) },
  { name: 'highlight con query in bool.filter (Discover)', note: 'Discover mette la query string nel filter',
    req: S('ax-weblogs', { size: 5, query: { bool: { filter: [{ query_string: { query: 'timeout', default_operator: 'AND', lenient: true } }] } }, highlight: { require_field_match: false, fields: { message: {} } } }),
    pick: r => ({ hits: r.hits?.hits?.length, withHighlight: r.hits?.hits?.filter(h => h.highlight).length }) },
  { name: 'query_string lenient true (tipo sbagliato)', note: 'bytes:abc su campo long: con lenient non deve dare errore',
    req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { query_string: { query: 'bytes:abc OR timeout', lenient: true } } }),
    pick: r => ({ error: r.error?.type || null, total: r.hits?.total?.value }) },
  { name: 'query_string lenient false (tipo sbagliato)', note: 'in Elasticsearch è un errore 400 (number_format / query_shard_exception)',
    req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { query_string: { query: 'bytes:abc OR timeout', lenient: false } } }),
    pick: r => ({ error: r.error ? (r.error.type || 'error') : null, total: r.hits?.total?.value }) },
  { name: 'query_string wildcard su keyword', note: 'status:5* come il filtro del pannello «Errori 5xx»',
    req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { query_string: { query: 'status:5*', default_operator: 'AND', lenient: true } } }),
    pick: r => ({ total: r.hits?.total?.value }) },
  { name: 'query_string range su numero', req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { query_string: { query: 'response_ms:>600 AND host:api-2', default_operator: 'AND', lenient: true } } }),
    pick: r => ({ total: r.hits?.total?.value }) },
  { name: 'match_phrase', note: 'match_phrase su text (filtri phrase di Discover)',
    req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { bool: { filter: [{ match_phrase: { message: 'upstream timeout' } }] } } }),
    pick: r => ({ error: r.error?.type || null, total: r.hits?.total?.value }) },
  { name: 'match_phrase in must_not', note: 'filtro di esclusione phrase',
    req: S('ax-weblogs', { size: 0, track_total_hits: true, query: { bool: { must_not: [{ match_phrase: { message: 'upstream timeout' } }] } } }),
    pick: r => ({ error: r.error?.type || null, total: r.hits?.total?.value }) },
  { name: 'from/size oltre 50', note: 'pagina 2 di Discover (from 50, size 50) ordinata per @timestamp',
    req: S('ax-weblogs', { from: 50, size: 50, track_total_hits: true, query: { bool: { filter: [range7] } }, sort: [{ '@timestamp': { order: 'desc' } }] }),
    pick: r => ({ hits: r.hits?.hits?.length, first: r.hits?.hits?.[0]?._id, last: r.hits?.hits?.at(-1)?._id }) },
  { name: 'from/size profondo (from 9950)', req: S('ax-weblogs', { from: 9950, size: 50, sort: [{ '@timestamp': { order: 'desc' } }] }),
    pick: r => ({ error: r.error?.type || null, hits: r.hits?.hits?.length, first: r.hits?.hits?.[0]?._id }) },
  { name: 'track_total_hits true', req: S('ax-weblogs', { size: 0, track_total_hits: true }), pick: r => r.hits?.total },
  { name: 'track_total_hits default', note: 'ES: limite 10.000 con relation gte', req: S('ax-weblogs', { size: 0 }), pick: r => r.hits?.total },
  { name: 'track_total_hits false', req: S('ax-weblogs', { size: 0, track_total_hits: false }), pick: r => r.hits?.total ?? '(assente)' },
  { name: '_cat/indices?format=json&h=index', req: { method: 'GET', path: '_cat/indices?format=json&h=index' },
    pick: r => Array.isArray(r) ? { n: r.length, keys: [...new Set(r.flatMap(Object.keys))], userIndices: r.map(x => x.index).filter(i => !i.startsWith('.')).sort() } : r },
  { name: 'GET vega-dashboards/_search su indice inesistente', note: 'listDash() si aspetta 404',
    req: S('xvb-missing-index', { size: 1 }), pick: (r, st) => ({ status: st, type: r.error?.type }) },
  { name: '_msearch con un indice inesistente', note: 'un elemento in errore non deve far fallire gli altri',
    req: { method: 'POST', path: '_msearch', body: '{"index":"ax-orders"}\n{"size":0}\n{"index":"xvb-missing-index"}\n{"size":0}\n' },
    pick: r => (r.responses || []).map(x => x.error ? 'error:' + x.error.type + ' status ' + x.status : 'ok ' + x.status) },
  { name: '_source come array + sort _score', req: S('ax-weblogs', { size: 2, _source: ['host', 'path'], query: { bool: { must: [{ query_string: { query: 'timeout' } }] } }, sort: ['_score', { '@timestamp': { order: 'desc' } }] }),
    pick: r => ({ keys: [...new Set((r.hits?.hits || []).flatMap(h => Object.keys(h._source || {})))], hits: r.hits?.hits?.length }) },
  { name: 'sum_other_doc_count di terms', req: S('ax-weblogs', { size: 0, aggs: { k: { terms: { field: 'country', size: 3 } } } }),
    pick: r => ({ keys: (r.aggregations?.k?.buckets || []).map(b => b.key), other: r.aggregations?.k?.sum_other_doc_count }) }
];

const checks = [];
for (const c of CHECKS) {
  const x = await xerj(c.req.method, c.req.path, c.req.body);
  const d = demo(c.req.method, c.req.path, c.req.body);
  const px = (() => { try { return c.pick(x.body, x.status); } catch (e) { return 'pick error: ' + e.message; } })();
  const pd = (() => { try { return c.pick(d.body, d.status); } catch (e) { return 'pick error: ' + e.message; } })();
  let verdict = same(px, pd) ? 'uguale' : 'diverso';
  if (verdict === 'diverso' && c.approx) {
    const nx = JSON.stringify(px).match(/-?\d+(\.\d+)?/g)?.map(Number) || [], nd = JSON.stringify(pd).match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
    if (nx.length === nd.length && nx.every((v, i) => Math.abs(v - nd[i]) <= Math.max(1, Math.abs(nd[i]) * c.approx))) verdict = `uguale entro ${c.approx * 100}%`;
  }
  const file = path.posix.join('test-out', SUB, 'compare', 'check-') + c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') + '.json';
  writeFileSync(path.join(ROOT, file), JSON.stringify({ name: c.name, note: c.note, request: c.req, xerj: x, demo: d }, null, 2));
  checks.push({ name: c.name, note: c.note || '', xerjStatus: x.status, demoStatus: d.status, xerj: px, demo: pd, verdict, file });
  console.log(`${verdict.padEnd(16)} ${c.name}\n   xerj ${x.status} ${JSON.stringify(px).slice(0, 220)}\n   demo ${d.status} ${JSON.stringify(pd).slice(0, 220)}`);
}
writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));

/* ---------- 2. query dei pannelli intercettate dal test Playwright ---------- */
const LOG = path.join(ROOT, 'test-out', SUB, 'msearch.jsonl');
const panels = [];
if (existsSync(LOG)) {
  const seen = new Set();
  for (const line of readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line); if (!e.request) continue;
    const lines = e.request.split('\n').filter(Boolean);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const h = JSON.parse(lines[i]), body = JSON.parse(lines[i + 1]);
      // la stessa query con un "adesso" diverso conta una volta: chiave senza i numeri del range
      const k = h.index + JSON.stringify(body).replace(/\d{13}/g, 'T');
      if (seen.has(k)) continue; seen.add(k);
      const xr = e.response?.responses?.[i / 2];
      const dr = demo('POST', h.index + '/_search', body);
      const sx = searchSummary(xr), sd = searchSummary(dr.status === 200 ? dr.body : dr.body);
      panels.push({ bucket: e.bucket, index: h.index, body, xerj: sx, demo: sd, same: same(sx, sd) });
    }
  }
  writeFileSync(path.join(OUT, 'panels.json'), JSON.stringify(panels, null, 2));
  console.log(`\npannelli: ${panels.length} query distinte, uguali ${panels.filter(p => p.same).length}, diverse ${panels.filter(p => !p.same).length}`);
}
