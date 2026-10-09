// Motore di ricerca demo: implementa il sottoinsieme della query DSL usato da pagine e widget.
// Se un widget usa qualcosa che qui manca, la demo risponde con un errore esplicito:
// è il segnale per estendere questo file (o per provare il widget direttamente su XERJ).

import { DEMO_MAP, demoData } from './data.js';
import { wild } from '../util.js';
import { ivMs } from '../time.js';

const dv = (doc, f) => doc[f.endsWith('.keyword') ? f.slice(0, -8) : f];
const strFields = (doc, fields) => fields?.length ? fields.map(f => dv(doc, f)).filter(x => typeof x === 'string') : Object.values(doc).filter(x => typeof x === 'string');
const tokens = s => (s || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];

/** Termini della query string usabili per l'evidenziazione e lo score. */
function qsTerms(s) {
  const out = [];
  for (const tok of tokens(s)) {
    if (['AND', 'OR', 'NOT'].includes(tok) || tok.startsWith('-')) continue;
    const m = tok.match(/^([\w.@]+):(.+)$/);
    const v = (m ? m[2] : tok).replace(/"/g, '').replace(/\*/g, '').replace(/^\(|\)$/g, '');
    if (v && !/^[<>]/.test(v)) out.push({ field: m ? m[1] : null, v: v.toLowerCase() });
  }
  return out;
}

/** query_string semplificata: AND implicito, NOT/-, campo:valore, wildcard, campo:>n, testo libero. */
function qsMatch(doc, s, fields) {
  s = (s || '').trim().replace(/^\((.*)\)$/, '$1'); if (!s || s === '*') return true;
  let neg = false;
  for (const tok of tokens(s)) {
    if (tok === 'AND') continue;
    if (tok === 'NOT') { neg = true; continue; }
    let t = tok.replace(/^\(|\)$/g, ''), n = neg; neg = false;
    if (t.startsWith('-')) { n = true; t = t.slice(1); }
    let ok;
    const m = t.match(/^([\w.@]+):(.+)$/);
    if (m) {
      const v = m[2].replace(/^"|"$/g, '').replace(/\\(["\\])/g, '$1'), x = dv(doc, m[1]);
      const cmp = v.match(/^(>=|<=|>|<)(-?[\d.]+)$/);
      if (x == null) ok = false;
      else if (cmp) { const a = +x, b = +cmp[2]; ok = cmp[1] === '>' ? a > b : cmp[1] === '<' ? a < b : cmp[1] === '>=' ? a >= b : a <= b; }
      else ok = wild(x, v);
    } else {
      const v = t.replace(/["*]/g, '').toLowerCase();
      ok = !v || strFields(doc, fields).some(x => x.toLowerCase().includes(v));
    }
    if (n ? ok : !ok) return false;
  }
  return true;
}

function qMatch(doc, q) {
  if (!q || q.match_all) return true;
  const arr = x => x ? (Array.isArray(x) ? x : [x]) : [];
  if (q.bool) {
    const b = q.bool;
    for (const c of [...arr(b.filter), ...arr(b.must)]) if (!qMatch(doc, c)) return false;
    for (const c of arr(b.must_not)) if (qMatch(doc, c)) return false;
    const sh = arr(b.should); if (sh.length && !sh.some(c => qMatch(doc, c))) return false;
    return true;
  }
  if (q.range) {
    const [f, rg] = Object.entries(q.range)[0]; const v = dv(doc, f); if (v == null) return false;
    const n = +v;
    if (rg.gte != null && !(n >= +rg.gte)) return false; if (rg.gt != null && !(n > +rg.gt)) return false;
    if (rg.lte != null && !(n <= +rg.lte)) return false; if (rg.lt != null && !(n < +rg.lt)) return false;
    return true;
  }
  if (q.term) { const [f, c] = Object.entries(q.term)[0]; const val = c && typeof c === 'object' ? c.value : c; return String(dv(doc, f)) === String(val); }
  if (q.terms) { const [f, vals] = Object.entries(q.terms)[0]; return vals.map(String).includes(String(dv(doc, f))); }
  if (q.query_string) return qsMatch(doc, q.query_string.query, q.query_string.fields);
  if (q.simple_query_string) return qsMatch(doc, q.simple_query_string.query, q.simple_query_string.fields);
  if (q.exists) return dv(doc, q.exists.field) != null;
  if (q.match_phrase) { const [f, c] = Object.entries(q.match_phrase)[0]; const v = dv(doc, f), s = c && typeof c === 'object' ? c.query : c; return v != null && String(v).toLowerCase().includes(String(s).toLowerCase()); }
  if (q.match) { const [f, c] = Object.entries(q.match)[0]; const v = dv(doc, f), s = c && typeof c === 'object' ? c.query : c; return v != null && String(s).toLowerCase().split(/\s+/).some(w => String(v).toLowerCase().includes(w)); }
  throw new Error('query not supported by the demo engine: ' + Object.keys(q)[0]);
}

function runAggs(docs, aggs) { const o = {}; for (const [n, d] of Object.entries(aggs || {})) o[n] = runAgg(docs, d); return o; }
function runAgg(docs, def) {
  const sub = def.aggs || def.aggregations;
  if (def.date_histogram) {
    const d = def.date_histogram, iv = ivMs(d.fixed_interval || d.calendar_interval || d.interval) || 36e5;
    const m = new Map();
    for (const doc of docs) { const v = dv(doc, d.field); if (v == null) continue; const k = Math.floor(v / iv) * iv; (m.get(k) || m.set(k, []).get(k)).push(doc); }
    if (d.min_doc_count === 0 && d.extended_bounds) {
      const lo = Math.floor(+d.extended_bounds.min / iv) * iv, hi = Math.floor(+d.extended_bounds.max / iv) * iv;
      for (let k = lo; k <= hi; k += iv) if (!m.has(k)) m.set(k, []);
    }
    const keys = [...m.keys()].sort((a, b) => a - b);
    return { buckets: keys.map(k => ({ key: k, key_as_string: new Date(k).toISOString(), doc_count: m.get(k).length, ...runAggs(m.get(k), sub) })) };
  }
  if (def.terms) {
    const d = def.terms, size = d.size ?? 10, m = new Map();
    for (const doc of docs) { const v = dv(doc, d.field); if (v == null) continue; const k = String(v); if (!m.has(k)) m.set(k, { raw: v, docs: [] }); m.get(k).docs.push(doc); }
    const b = [...m.values()].map(x => ({ key: x.raw, doc_count: x.docs.length, ...runAggs(x.docs, sub) }));
    const [ok, od] = Object.entries(d.order || { _count: 'desc' })[0], dir = od === 'asc' ? 1 : -1;
    const val = x => ok === '_count' ? x.doc_count : ok === '_key' ? x.key : (x[ok]?.value ?? -Infinity);
    b.sort((x, y) => { const a = val(x), c = val(y); return (a < c ? -1 : a > c ? 1 : 0) * dir || y.doc_count - x.doc_count; });
    return { doc_count_error_upper_bound: 0, sum_other_doc_count: b.slice(size).reduce((s, x) => s + x.doc_count, 0), buckets: b.slice(0, size) };
  }
  const [type, cfg] = Object.entries(def).find(([k]) => k !== 'aggs' && k !== 'aggregations');
  const raw = docs.map(d => dv(d, cfg.field)).filter(v => v != null);
  const nums = raw.map(Number), sum = nums.reduce((a, b) => a + b, 0);
  switch (type) {
    case 'avg': return { value: nums.length ? sum / nums.length : null };
    case 'sum': return { value: sum };
    case 'min': return { value: nums.length ? Math.min(...nums) : null };
    case 'max': return { value: nums.length ? Math.max(...nums) : null };
    case 'value_count': return { value: raw.length };
    case 'cardinality': return { value: new Set(raw.map(String)).size };
    case 'stats': return { count: nums.length, min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null, avg: nums.length ? sum / nums.length : null, sum };
    case 'percentiles': {
      const s = [...nums].sort((a, b) => a - b), values = {};
      for (const p of cfg.percents || [1, 5, 25, 50, 75, 95, 99]) {
        if (!s.length) { values[p.toFixed(1)] = null; continue; }
        const i = (p / 100) * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
        values[p.toFixed(1)] = s[lo] + (s[hi] - s[lo]) * (i - lo);
      }
      return { values };
    }
  }
  throw new Error('aggregation not supported by the demo engine: ' + type);
}

function demoHighlight(doc, s, fields) {
  const terms = qsTerms(s); if (!terms.length) return null;
  const hl = {};
  for (const [k, val] of Object.entries(doc)) {
    if (typeof val !== 'string' || (fields?.length && !fields.includes(k))) continue;
    const ts = terms.filter(t => !t.field || t.field === k).map(t => t.v);
    if (!ts.length) continue;
    const re = new RegExp('(' + ts.map(t => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    if (!re.test(val)) continue;
    hl[k] = [val.replace(re, '\u0002$1\u0003')];
  }
  return Object.keys(hl).length ? hl : null;
}

const indexNames = pattern => {
  const pats = String(pattern || '*').split(',').map(p => p.trim());
  return Object.keys(DEMO_MAP).filter(n => pats.some(p => wild(n, p)));
};

/** Equivalente di POST {index}/_search. Ritorna la risposta o {error, status}. */
export function demoSearch(pattern, body = {}) {
  const data = demoData(), t0 = Date.now();
  const names = indexNames(pattern);
  if (!names.length) return { error: { type: 'index_not_found_exception', reason: 'no such index [' + pattern + ']' }, status: 404 };
  try {
    const docs = [];
    for (const n of names) for (const d of data[n]) if (qMatch(d, body.query)) docs.push(d);
    const res = { took: 0, timed_out: false, hits: { total: { value: docs.length, relation: 'eq' }, max_score: null, hits: [] } };
    if (body.aggs || body.aggregations) res.aggregations = runAggs(docs, body.aggs || body.aggregations);
    const size = body.size ?? 10, from = body.from || 0;
    if (size > 0) {
      const sq = [].concat(body.query?.bool?.must || []).find(x => x.query_string)?.query_string;
      const score = d => sq ? qsTerms(sq.query).filter(t => strFields(d, t.field ? [t.field] : sq.fields).some(x => x.toLowerCase().includes(t.v))).length : 1;
      const sorts = (body.sort || []).map(s => typeof s === 'string' ? [s, 'desc'] : [Object.keys(s)[0], (Object.values(s)[0].order || Object.values(s)[0])]);
      const sc = new Map(); if (sq) for (const d of docs) sc.set(d, score(d));
      const val = (d, f) => f === '_score' ? sc.get(d) : dv(d, f);
      const list = sorts.length ? [...docs].sort((a, b) => { for (const [f, o] of sorts) { const x = val(a, f), y = val(b, f), c = (x > y) - (x < y); if (c) return o === 'asc' ? c : -c; } return 0; }) : docs;
      const dates = new Set(names.flatMap(n => Object.entries(DEMO_MAP[n]).filter(([, v]) => v.type === 'date').map(([k]) => k)));
      res.hits.hits = list.slice(from, from + size).map(d => {
        let src = { ...d }; for (const k of dates) if (src[k] != null) src[k] = new Date(src[k]).toISOString();
        const h = { _index: names.length > 1 ? names.find(n => data[n].includes(d)) : names[0], _id: d._id, _score: sq ? sc.get(d) : 1 };
        if (body.highlight && sq) { const hl = demoHighlight(d, sq.query, sq.fields); if (hl) h.highlight = hl; }
        if (Array.isArray(body._source)) { const o = {}; for (const k of body._source) o[k] = src[k]; src = o; }
        h._source = src; return h;
      });
    }
    res.took = Math.max(1, Date.now() - t0);
    return res;
  } catch (e) {
    return { error: { type: 'demo_unsupported', reason: e.message }, status: 400 };
  }
}

export const demoIndices = () => Object.keys(DEMO_MAP);
export const demoMapping = pattern => Object.fromEntries(indexNames(pattern).map(n => [n, { mappings: { properties: DEMO_MAP[n] } }]));

/**
 * Router REST per la console Dev Tools in modalità demo.
 * Ritorna { status, body } dove body è un oggetto JSON o una stringa (per _cat senza format=json).
 */
export function demoRoute(method, rawPath, body) {
  const [pathPart, qs = ''] = rawPath.replace(/^\/+/, '').split('?');
  const params = new URLSearchParams(qs);
  const seg = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const M = method.toUpperCase();
  const err = (status, type, reason) => ({ status, body: { error: { type, reason }, status } });
  const ro = () => err(405, 'demo_read_only', 'the demo is read-only: ' + M + ' /' + pathPart + ' is not available');
  const data = demoData();

  if (!seg.length) return M === 'GET' || M === 'HEAD' ? { status: 200, body: { name: 'xerj-demo', cluster_name: 'demo', version: { number: 'demo', distribution: 'xerj-demo' }, tagline: 'Synthetic data generated in the browser' } } : ro();
  if (seg[0] === '_cat' && seg[1] === 'indices') {
    const rows = demoIndices().filter(n => !seg[2] || wild(n, seg[2])).map(n => ({ health: 'green', status: 'open', index: n, 'docs.count': String(data[n].length) }));
    if (params.get('format') === 'json') return { status: 200, body: rows };
    const cols = ['health', 'status', 'index', 'docs.count'], w = cols.map(c => Math.max(c.length, ...rows.map(r => r[c].length)));
    const line = r => cols.map((c, i) => String(r[c]).padEnd(w[i])).join(' ');
    return { status: 200, body: (params.has('v') ? line(Object.fromEntries(cols.map(c => [c, c]))) + '\n' : '') + rows.map(line).join('\n') + '\n' };
  }
  if (seg[0] === '_cluster' && seg[1] === 'health') return { status: 200, body: { cluster_name: 'demo', status: 'green', number_of_nodes: 1, active_primary_shards: demoIndices().length, active_shards: demoIndices().length, unassigned_shards: 0 } };
  if (seg[0] === '_msearch' || seg[1] === '_msearch') {
    if (M !== 'POST' && M !== 'GET') return ro();
    const lines = String(body || '').split('\n').filter(l => l.trim());
    const responses = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      let h, b; try { h = JSON.parse(lines[i]); b = JSON.parse(lines[i + 1]); } catch (e) { return err(400, 'parse_exception', 'invalid NDJSON at line ' + (i + 1)); }
      const r = demoSearch(h.index || seg[0], b); responses.push(r.error ? { error: r.error, status: r.status } : { ...r, status: 200 });
    }
    return { status: 200, body: { took: 1, responses } };
  }
  const idx = seg[0];
  if (!indexNames(idx).length) return err(404, 'index_not_found_exception', 'no such index [' + idx + ']');
  if (seg.length === 1) return M === 'GET' ? { status: 200, body: Object.fromEntries(indexNames(idx).map(n => [n, { mappings: { properties: DEMO_MAP[n] }, settings: { index: { number_of_shards: '1', number_of_replicas: '0' } } }])) } : ro();
  if (seg[1] === '_mapping') return M === 'GET' ? { status: 200, body: demoMapping(idx) } : ro();
  if (seg[1] === '_search') {
    if (M !== 'POST' && M !== 'GET') return ro();
    const b = { ...(body || {}) }; if (params.has('size')) b.size = +params.get('size'); if (params.has('q')) b.query = { query_string: { query: params.get('q') } };
    const r = demoSearch(idx, b); return r.error ? { status: r.status || 400, body: { error: r.error, status: r.status || 400 } } : { status: 200, body: r };
  }
  if (seg[1] === '_count') {
    const r = demoSearch(idx, { size: 0, query: body?.query }); return r.error ? { status: 400, body: { error: r.error } } : { status: 200, body: { count: r.hits.total.value } };
  }
  if (seg[1] === '_doc' && seg[2]) {
    if (M !== 'GET') return ro();
    for (const n of indexNames(idx)) {
      const d = data[n].find(x => x._id === seg[2]);
      if (d) { const src = { ...d }; for (const [k, v] of Object.entries(DEMO_MAP[n])) if (v.type === 'date' && src[k] != null) src[k] = new Date(src[k]).toISOString(); return { status: 200, body: { _index: n, _id: d._id, found: true, _source: src } }; }
    }
    return { status: 404, body: { _index: idx, _id: seg[2], found: false } };
  }
  return err(400, 'demo_unsupported', 'endpoint not available in the demo: ' + M + ' /' + pathPart);
}
