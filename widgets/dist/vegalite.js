import * as kit from '../../core/kit.js';

// Via di fuga: query ES e spec Vega-Lite scritte a mano, salvate dentro il pannello.
const subst = (v, c, p) => {
  if (typeof v === 'string') {
    if (v === '%context%') return c.q;
    if (v === '%from%') return c.tr.from;
    if (v === '%to%') return c.tr.to;
    return v.replace(/%interval%/g, c.iv[0]).replace(/%timefield%/g, p.timefield || '');
  }
  if (Array.isArray(v)) return v.map(x => subst(x, c, p));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = subst(v[k], c, p); return o; }
  return v;
};

export default {
  type: 'vegalite',
  name: { en: 'Free Vega-Lite', it: 'Vega-Lite libero' },
  desc: { en: 'Hand-written query and spec', it: 'Query e spec scritte a mano' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 8l-6 7 6 7M19 8l6 7-6 7M16.5 6l-3 18"/></svg>',
  defaults: { w: 6, h: 'm' },
  init: {
    body: JSON.stringify({ size: 0, query: '%context%', aggs: { t: { date_histogram: { field: '%timefield%', fixed_interval: '%interval%', min_doc_count: 0 } } } }, null, 2),
    path: 'aggregations.t.buckets',
    spec: JSON.stringify({ mark: { type: 'line', point: true }, encoding: { x: { field: 'key', type: 'temporal', title: null }, y: { field: 'doc_count', type: 'quantitative', title: null } } }, null, 2)
  },
  params: [kit.P.index, kit.P.time,
    { key: 'body', label: 'Query (JSON)', type: 'json', help: {
      en: '<code>"%context%"</code> becomes the page time range, query and filters. Also available: <code>%timefield%</code>, <code>%interval%</code>, <code>%from%</code>, <code>%to%</code>.',
      it: '<code>"%context%"</code> diventa tempo, query e filtri della pagina. Disponibili anche <code>%timefield%</code>, <code>%interval%</code>, <code>%from%</code>, <code>%to%</code>.' } },
    { key: 'path', label: { en: 'Rows path', it: 'Percorso delle righe' }, type: 'text', placeholder: 'aggregations.t.buckets',
      help: { en: 'Where the array to hand to Vega sits in the response.', it: 'Dove si trova l\'array da passare a Vega nella risposta.' } },
    { key: 'spec', label: { en: 'Vega-Lite spec (JSON)', it: 'Spec Vega-Lite (JSON)' }, type: 'json',
      help: { en: 'Without <code>data</code>: rows are injected. The panel sets width and height.', it: 'Senza <code>data</code>: le righe vengono iniettate. Larghezza e altezza le decide il pannello.' } }],
  target: 40,

  query: (p, c) => subst(JSON.parse(p.body), c, p),
  rows(r, p) {
    const v = kit.getPath(r, p.path);
    if (!Array.isArray(v)) throw new Error(kit.L({ en: `The path “${p.path}” does not lead to an array`, it: `Il percorso «${p.path}» non porta a un array` }));
    return v;
  },
  spec: (p, rows, c) => ({ ...kit.baseSpec(c.height), ...JSON.parse(p.spec), data: { values: rows } })
};
