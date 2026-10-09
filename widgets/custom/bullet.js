import * as kit from '../../core/kit.js';

// Esempio di widget custom: una metrica confrontata con un obiettivo (bullet chart).
// Mostra come usare i colori semantici del tema (ok / danger) e un parametro numerico libero.
export default {
  type: 'bullet',
  name: { en: 'Target', it: 'Obiettivo' },
  desc: { en: 'Metric against a threshold', it: 'Metrica contro una soglia' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="11" width="24" height="8" rx="1.5" opacity=".35"/><rect x="3" y="13" width="15" height="4" rx="1" fill="currentColor"/><path d="M21 8v14" stroke-width="2"/></svg>',
  defaults: { w: 4, h: 's' },
  init: { fn: 'p95', target: 500, better: 'lower', unit: 'ms' },
  params: [kit.P.index, kit.P.time,
    { key: 'fn', label: { en: 'Calculation', it: 'Calcolo' }, type: 'select', options: ['avg', 'p95', 'p99', 'max', 'sum', 'count'].map(k => [k, kit.FN_LABEL[k]]) },
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'number', show: p => p.fn !== 'count' },
    { key: 'target', label: { en: 'Target', it: 'Obiettivo' }, type: 'number', min: 0, max: 1e12 },
    { key: 'better', label: { en: 'Good when the value is', it: 'Va bene quando il valore è' }, type: 'select',
      options: [['lower', { en: 'Below the target', it: 'Sotto l\'obiettivo' }], ['higher', { en: 'Above the target', it: 'Sopra l\'obiettivo' }]] },
    { key: 'unit', label: { en: 'Unit', it: 'Unità' }, type: 'text', placeholder: 'ms, €, …' },
    kit.P.filter],

  query(p, c) {
    const b = { size: 0, track_total_hits: true, query: c.q };
    const a = kit.metricAgg(p.fn, p.field); if (a) b.aggs = a;
    return b;
  },
  rows(r, p) {
    const v = p.fn === 'count' ? kit.totalHits(r) : kit.metricValue(r.aggregations, p.fn);
    const ok = v == null ? null : p.better === 'higher' ? v >= p.target : v <= p.target;
    return [{ v: v ?? 0, target: +p.target, max: Math.max(+p.target * 1.4, (v ?? 0) * 1.08, 1), ok,
      label: kit.fmtNum(v) + (p.unit ? ' ' + p.unit : ''),
      verdict: ok == null ? kit.L({ en: 'no data', it: 'nessun dato' }) : kit.L(ok ? { en: 'within target', it: 'entro l\'obiettivo' } : { en: 'off target', it: 'fuori obiettivo' }) + ' (' + kit.fmtNum(+p.target) + (p.unit ? ' ' + p.unit : '') + ')' }];
  },
  spec(p, rows, c) {
    const t = c.theme, h = c.height, col = rows[0].ok === false ? t.danger : t.ok;
    const x = { type: 'quantitative', scale: { domain: [0, rows[0].max], nice: false }, axis: null };
    return { ...kit.baseSpec(h), data: { values: rows }, layer: [
      { mark: { type: 'text', align: 'left', baseline: 'top', x: 0, y: 4, fontSize: Math.round(Math.min(h * 0.26, 30)), fontWeight: 600, font: t.font, color: t.fg }, encoding: { text: { field: 'label' } } },
      { mark: { type: 'text', align: 'left', baseline: 'top', x: 0, y: Math.round(Math.min(h * 0.26, 30)) + 10, fontSize: 11, font: t.mono, color: col }, encoding: { text: { field: 'verdict' } } },
      { mark: { type: 'bar', color: t.sunk, height: 16, cornerRadius: 3, y: { expr: 'height - 14' } }, encoding: { x: { field: 'max', ...x } } },
      { mark: { type: 'bar', color: col, height: 8, cornerRadius: 2, y: { expr: 'height - 14' } }, encoding: { x: { field: 'v', ...x }, tooltip: [{ field: 'label', title: kit.fnLabel(p.fn) }, { field: 'target', title: kit.L({ en: 'Target', it: 'Obiettivo' }), format: ',.2~f' }] } },
      { mark: { type: 'tick', color: t.fg, thickness: 2, size: 22, y: { expr: 'height - 14' } }, encoding: { x: { field: 'target', ...x } } }] };
  }
};
