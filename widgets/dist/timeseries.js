import * as kit from '../../core/kit.js';

export default {
  type: 'timeseries',
  name: { en: 'Time series', it: 'Serie temporale' },
  desc: { en: 'Trend over time', it: 'Andamento nel tempo' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 24h22"/><path d="M5 20l5-6 4 3 5-8 6 5"/></svg>',
  defaults: { w: 8, h: 'm' },
  init: { fn: 'count', style: 'area', interval: 'auto' },
  params: [kit.P.index, kit.P.time,
    { key: 'fn', label: { en: 'Calculation', it: 'Calcolo' }, type: 'select', options: [...kit.FN, ['p95', kit.FN_LABEL.p95]] },
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'number', show: p => p.fn !== 'count' },
    { key: 'style', label: { en: 'Style', it: 'Stile' }, type: 'select', options: [['area', { en: 'Area', it: 'Area' }], ['line', { en: 'Line', it: 'Linea' }], ['bar', { en: 'Bars', it: 'Barre' }]] },
    kit.P.interval, kit.P.filter],
  target: 60,

  query(p, c) {
    const h = kit.dateHisto(p.timefield, c);
    const a = kit.metricAgg(p.fn, p.field); if (a) h.aggs = a;
    return { size: 0, query: c.q, aggs: { t: h } };
  },
  rows(r, p, c) {
    return (r.aggregations?.t?.buckets || []).map(b => ({ t: b.key, t2: b.key + c.iv[1] * 0.86, v: p.fn === 'sum' ? (kit.metricValue(b, p.fn) ?? 0) : kit.metricValue(b, p.fn) }));
  },
  spec(p, rows, c) {
    const t = c.theme;
    const enc = { x: kit.timeX, y: { field: 'v', type: 'quantitative', title: null, axis: { tickCount: 4 } } };
    const tip = [kit.tipTime, { field: 'v', type: 'quantitative', title: kit.fnLabel(p.fn), format: ',.2~f' }];
    if (p.style === 'bar') return { ...kit.baseSpec(c.height), data: { values: rows }, params: [kit.brushParam(t)], mark: { type: 'bar', color: t.c[0], cornerRadiusEnd: 1 }, encoding: { ...enc, x2: { field: 't2' }, y2: { datum: 0 }, tooltip: tip } };
    // con x e x2 Vega-Lite tratterebbe y come banda: y2 esplicito fa partire la barra da zero
    const layer = [
      { params: [kit.brushParam(t)], mark: { type: 'line', color: t.c[0], strokeWidth: 2, interpolate: 'monotone' } },
      { mark: { type: 'point', filled: true, size: 70, opacity: 0.001 }, encoding: { tooltip: tip } }];
    if (p.style === 'area') layer.unshift({ mark: { type: 'area', color: t.c[0], opacity: 0.16, interpolate: 'monotone' } });
    return { ...kit.baseSpec(c.height), data: { values: rows }, encoding: enc, layer };
  }
};
