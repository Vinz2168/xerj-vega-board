import * as kit from '../../core/kit.js';

export default {
  type: 'heatmap',
  name: { en: 'Heatmap', it: 'Mappa di calore' },
  desc: { en: 'Time × category', it: 'Tempo × categoria' },
  icon: '<svg viewBox="0 0 30 30" fill="currentColor"><rect x="4" y="5" width="6" height="6" rx="1" opacity=".3"/><rect x="12" y="5" width="6" height="6" rx="1" opacity=".8"/><rect x="20" y="5" width="6" height="6" rx="1" opacity=".5"/><rect x="4" y="13" width="6" height="6" rx="1" opacity=".9"/><rect x="12" y="13" width="6" height="6" rx="1" opacity=".2"/><rect x="20" y="13" width="6" height="6" rx="1" opacity=".6"/><rect x="4" y="21" width="6" height="5" rx="1" opacity=".5"/><rect x="12" y="21" width="6" height="5" rx="1" opacity=".4"/><rect x="20" y="21" width="6" height="5" rx="1"/></svg>',
  defaults: { w: 6, h: 'm' },
  init: { size: 6, interval: 'auto' },
  params: [kit.P.index, kit.P.time, { key: 'field', label: { en: 'Rows', it: 'Righe' }, type: 'field', ftype: 'keyword' }, kit.P.size({ en: 'Number of rows', it: 'Numero di righe' }, 2, 20), kit.P.interval, kit.P.filter],
  target: 36,
  click: p => p.field,

  query: (p, c) => ({ size: 0, query: c.q, aggs: { k: { terms: { field: p.field, size: p.size }, aggs: { t: kit.dateHisto(p.timefield, c) } } } }),
  rows: (r, p, c) => (r.aggregations?.k?.buckets || []).flatMap(s => (s.t?.buckets || []).map(b => ({ t: b.key, t2: b.key + c.iv[1], k: s.key, v: b.doc_count }))),
  spec: (p, rows, c) => ({ ...kit.baseSpec(c.height), data: { values: rows },
    mark: { type: 'rect', cursor: 'pointer', cornerRadius: 1.5, stroke: c.theme.surface, strokeWidth: 1 },
    encoding: {
      x: { ...kit.timeX, axis: { ...kit.timeX.axis, grid: false } }, x2: { field: 't2' },
      y: { field: 'k', type: 'nominal', title: null, sort: [...new Set(rows.map(r => r.k))], axis: { ticks: false, domain: false, labelFont: c.theme.mono, labelFontSize: 11, labelLimit: 120 } },
      color: { field: 'v', type: 'quantitative', title: null, scale: { range: [c.theme.sunk, c.theme.c[0]] }, legend: null },
      tooltip: [kit.tipTime, { field: 'k', type: 'nominal', title: p.field }, { field: 'v', type: 'quantitative', title: kit.L(kit.LABELS.docs), format: ',d' }] } })
};
