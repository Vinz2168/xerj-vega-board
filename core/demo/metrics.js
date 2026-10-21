// Metriche in demo: GET /v1/metrics in formato testo Prometheus con gli stessi nomi di XERJ (xerj-common/src/metrics.rs).
// I contatori crescono a ogni lettura in base al tempo trascorso, con un ritmo che oscilla: la pagina Metriche
// vede tassi, latenze e gauge che si muovono come su un nodo vero.

import { DEMO_MAP, demoData } from './data.js';

const LAT_BUCKETS = Array.from({ length: 15 }, (_, i) => 0.0005 * 2 ** i);   // exponential_buckets(0.0005, 2, 15)
let st = null;

function advance() {
  const t = Date.now();
  if (!st) {
    const idx = Object.keys(DEMO_MAP);
    st = { t: t - 1000, queries: 182340, docs: 0, bw: 7.2e8, br: 2.1e8, hits: 50210, misses: 9120, lat: LAT_BUCKETS.map(() => 0), latSum: 0, latCount: 0,
      byIndexQ: Object.fromEntries(idx.map((n, i) => [n, 60000 / (i + 1)])), byIndexD: Object.fromEntries(idx.map(n => [n, demoData()[n].length])) };
    st.docs = Object.values(st.byIndexD).reduce((a, b) => a + b, 0);
  }
  const dt = Math.max(0, (t - st.t) / 1000); st.t = t;
  const wave = 1 + 0.45 * Math.sin(t / 47000) + 0.2 * Math.sin(t / 9000);
  const q = Math.round(dt * 38 * wave * (0.85 + Math.random() * 0.3)), d = Math.round(dt * 120 * (1.2 - wave / 2) * Math.random());
  st.queries += q; st.docs += d; st.bw += d * 900; st.br += q * 40;
  const hit = Math.round(q * (0.8 + Math.random() * 0.1)); st.hits += hit; st.misses += q - hit;
  const names = Object.keys(st.byIndexQ);
  for (let i = 0; i < q; i++) {
    // latenza log-normale attorno a ~6 ms, più lenta quando il carico sale
    const s = Math.exp(Math.log(0.006 * wave) + 0.8 * gauss());
    st.latSum += s; st.latCount++;
    LAT_BUCKETS.forEach((b, j) => { if (s <= b) st.lat[j]++; });
    st.byIndexQ[names[Math.floor(Math.random() ** 2 * names.length)]]++;   // i primi indici più interrogati
  }
  for (let i = 0; i < d; i++) st.byIndexD[names[Math.floor(Math.random() * names.length)]]++;
  return wave;
}
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

/** Testo Prometheus (version=0.0.4) con le metriche principali di XERJ. */
export function demoMetrics() {
  const wave = advance(), out = [];
  const m = (name, type, help, rows) => { out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); for (const [lab, v] of rows) out.push(name + lab + ' ' + v); };
  m('xerj_docs_indexed_total', 'counter', 'Total number of documents successfully indexed', [['', st.docs]]);
  m('xerj_queries_executed_total', 'counter', 'Total number of search queries executed', [['', st.queries]]);
  m('xerj_bytes_written_total', 'counter', 'Total on-disk bytes written to segment (.seg) files by flush and merge', [['', Math.round(st.bw)]]);
  m('xerj_bytes_read_total', 'counter', 'Total on-disk bytes read from segment (.seg) files', [['', Math.round(st.br)]]);
  m('xerj_docs_indexed_by_index_total', 'counter', 'Documents indexed, labelled by index name', Object.entries(st.byIndexD).map(([n, v]) => [`{index="${n}"}`, v]));
  m('xerj_queries_by_index_total', 'counter', 'Queries executed, labelled by index name', Object.entries(st.byIndexQ).map(([n, v]) => [`{index="${n}"}`, Math.round(v)]));
  m('xerj_query_latency_seconds', 'histogram', 'End-to-end query latency', [
    ...LAT_BUCKETS.map((b, j) => [`{le="${b}"}`, st.lat[j]]), ['{le="+Inf"}', st.latCount]
  ].concat([['_sum', st.latSum.toFixed(6)], ['_count', st.latCount]]).map(([l, v]) => [l.startsWith('_') ? l : '_bucket' + l, v]));
  m('xerj_segment_count', 'gauge', 'Number of segments', [['', 14 + Math.round(4 * wave)]]);
  m('xerj_doc_count', 'gauge', 'Number of documents', [['', st.docs]]);
  m('xerj_memory_usage_bytes', 'gauge', 'Memory usage in bytes', [['', Math.round(3.1e8 + 4e7 * wave)]]);
  m('xerj_active_searches', 'gauge', 'Searches in flight', [['', Math.round(2 * wave * Math.random())]]);
  m('xerj_wal_size_bytes', 'gauge', 'WAL size in bytes', [['', Math.round(1.6e7 + 6e6 * Math.sin(Date.now() / 30000))]]);
  m('xerj_query_cache_hits', 'gauge', 'Query cache hits', [['', st.hits]]);
  m('xerj_query_cache_misses', 'gauge', 'Query cache misses', [['', st.misses]]);
  return out.join('\n') + '\n';
}
