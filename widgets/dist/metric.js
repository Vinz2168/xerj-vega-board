import * as kit from '../../core/kit.js';

export default {
  type: 'metric',
  name: { en: 'Metric', it: 'Metrica' },
  desc: { en: 'One key number', it: 'Un numero chiave' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="24" height="18" rx="3"/><path d="M9 19v-8l-2 2M14 11h4l-4 8h4M21 19l2-8"/></svg>',
  defaults: { w: 3, h: 's' },
  init: { fn: 'count', unit: '' },
  params: [kit.P.index, kit.P.time,
    { key: 'fn', label: { en: 'Calculation', it: 'Calcolo' }, type: 'select', options: [...kit.FN, ['cardinality', kit.FN_LABEL.cardinality], ['p95', kit.FN_LABEL.p95]] },
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: p => p.fn === 'cardinality' ? 'keyword' : 'number', show: p => p.fn !== 'count' },
    { key: 'unit', label: { en: 'Unit', it: 'Unità' }, type: 'text', placeholder: 'ms, €, B…' },
    kit.P.filter],

  query(p, c) {
    const b = { size: 0, track_total_hits: true, query: c.q };
    const a = kit.metricAgg(p.fn, p.field); if (a) b.aggs = a;
    return b;
  },
  rows(r, p) {
    const v = p.fn === 'count' ? kit.totalHits(r) : kit.metricValue(r.aggregations, p.fn);
    return [{ txt: kit.fmtNum(v) + (p.unit ? ' ' + p.unit : ''), sub: kit.fnLabel(p.fn) + (p.fn !== 'count' && p.field ? ' · ' + p.field : '') }];
  },
  spec(p, rows, c) {
    const h = c.height, t = c.theme, fs = Math.round(Math.min(h * 0.4, 54));
    return { ...kit.baseSpec(h), data: { values: rows }, layer: [
      { mark: { type: 'text', align: 'left', baseline: 'middle', x: 2, y: { expr: 'height*0.42' }, fontSize: fs, fontWeight: 600, font: t.font, color: t.fg }, encoding: { text: { field: 'txt' } } },
      { mark: { type: 'text', align: 'left', baseline: 'top', x: 2, y: { expr: 'height*0.42 + ' + Math.round(fs * 0.62) }, fontSize: 11, font: t.mono, color: t.muted }, encoding: { text: { field: 'sub' } } }] };
  }
};
