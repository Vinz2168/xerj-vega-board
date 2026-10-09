import * as kit from '../../core/kit.js';

export default {
  type: 'donut',
  name: { en: 'Distribution', it: 'Distribuzione' },
  desc: { en: 'Shares of a field', it: 'Quote di un campo' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="5"><circle cx="15" cy="15" r="9" opacity=".35"/><path d="M15 6a9 9 0 0 1 8.6 11.7"/></svg>',
  defaults: { w: 4, h: 'm' },
  init: { size: 6 },
  params: [kit.P.index, kit.P.time, { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'keyword' }, kit.P.size({ en: 'Slices', it: 'Fette' }, 2, 10), kit.P.filter],
  click: p => p.field,

  query: (p, c) => ({ size: 0, query: c.q, aggs: { k: { terms: { field: p.field, size: p.size } } } }),
  rows(r) {
    const a = r.aggregations?.k;
    const rows = (a?.buckets || []).map(b => ({ k: b.key, v: b.doc_count }));
    if (a?.sum_other_doc_count) rows.push({ k: kit.L({ en: 'Other', it: 'Altro' }), v: a.sum_other_doc_count, other: true });   // `other` non è cliccabile
    return rows;
  },
  spec(p, rows, c) {
    const t = c.theme, h = c.height;
    return { ...kit.baseSpec(h), data: { values: rows },
      mark: { type: 'arc', innerRadius: Math.round(h * 0.24), padAngle: 0.012, cornerRadius: 2, cursor: 'pointer', stroke: t.surface, strokeWidth: 1 },
      encoding: { theta: { field: 'v', type: 'quantitative', stack: true },
        color: { field: 'k', type: 'nominal', title: null, sort: rows.map(r => String(r.k)), scale: { domain: rows.map(r => r.k), range: rows.map((r, i) => r.other ? t.other : t.c[i % t.c.length]) }, legend: { orient: 'right', labelLimit: 110 } },
        order: { field: 'v', sort: 'descending' },
        tooltip: [{ field: 'k', type: 'nominal', title: p.field }, { field: 'v', type: 'quantitative', title: kit.L(kit.LABELS.docs), format: ',d' }] } };
  }
};
