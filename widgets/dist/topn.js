import * as kit from '../../core/kit.js';

export default {
  type: 'topn',
  name: { en: 'Top values', it: 'Classifica' },
  desc: { en: 'The most frequent values', it: 'I valori più frequenti' },
  icon: '<svg viewBox="0 0 30 30" fill="currentColor"><rect x="4" y="5" width="22" height="4" rx="1"/><rect x="4" y="11" width="16" height="4" rx="1" opacity=".75"/><rect x="4" y="17" width="11" height="4" rx="1" opacity=".55"/><rect x="4" y="23" width="6" height="3" rx="1" opacity=".4"/></svg>',
  defaults: { w: 6, h: 'm' },
  init: { size: 8, fn: 'count' },
  params: [kit.P.index, kit.P.time,
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'keyword' },
    kit.P.size(undefined, 3, 25),
    { key: 'fn', label: { en: 'Rank by', it: 'Ordina per' }, type: 'select', options: kit.FN.filter(([k]) => k !== 'min') },
    { key: 'mfield', label: { en: 'Numeric field', it: 'Campo numerico' }, type: 'field', ftype: 'number', show: p => p.fn !== 'count' },
    kit.P.filter],
  click: p => p.field,

  query(p, c) {
    const terms = { field: p.field, size: p.size, order: p.fn === 'count' ? { _count: 'desc' } : { m: 'desc' } };
    const b = { size: 0, query: c.q, aggs: { k: { terms } } };
    const a = kit.metricAgg(p.fn, p.mfield); if (a) b.aggs.k.aggs = a;
    return b;
  },
  rows: (r, p) => (r.aggregations?.k?.buckets || []).map(b => ({ k: b.key, v: kit.metricValue(b, p.fn) ?? 0 })),
  spec: (p, rows, c) => ({ ...kit.baseSpec(c.height), data: { values: rows },
    mark: { type: 'bar', color: c.theme.c[0], cornerRadiusEnd: 2, cursor: 'pointer' },
    encoding: {
      y: { field: 'k', type: 'nominal', sort: '-x', title: null, axis: { labelLimit: 170, ticks: false, domain: false, labelFont: c.theme.mono, labelFontSize: 11 } },
      x: { field: 'v', type: 'quantitative', title: null, axis: { tickCount: 4 } },
      tooltip: [{ field: 'k', type: 'nominal', title: p.field }, { field: 'v', type: 'quantitative', title: kit.fnLabel(p.fn), format: ',.2~f' }] } })
};
