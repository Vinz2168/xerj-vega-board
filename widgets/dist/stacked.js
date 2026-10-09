import * as kit from '../../core/kit.js';

export default {
  type: 'stacked',
  name: { en: 'Series by category', it: 'Serie per categoria' },
  desc: { en: 'Time split by a field', it: 'Tempo diviso per un campo' },
  icon: '<svg viewBox="0 0 30 30" fill="currentColor"><rect x="5" y="15" width="4" height="9" rx="1"/><rect x="5" y="10" width="4" height="4" rx="1" opacity=".45"/><rect x="11" y="11" width="4" height="13" rx="1"/><rect x="11" y="6" width="4" height="4" rx="1" opacity=".45"/><rect x="17" y="17" width="4" height="7" rx="1"/><rect x="17" y="12" width="4" height="4" rx="1" opacity=".45"/><rect x="23" y="13" width="4" height="11" rx="1"/><rect x="23" y="9" width="4" height="3" rx="1" opacity=".45"/></svg>',
  defaults: { w: 8, h: 'm' },
  init: { size: 5, style: 'bar', interval: 'auto' },
  params: [kit.P.index, kit.P.time,
    { key: 'split', label: { en: 'Split by', it: 'Suddividi per' }, type: 'field', ftype: 'keyword' },
    kit.P.size({ en: 'Categories', it: 'Categorie' }, 2, 12),
    { key: 'style', label: { en: 'Style', it: 'Stile' }, type: 'select', options: [['bar', { en: 'Stacked bars', it: 'Barre impilate' }], ['area', { en: 'Stacked areas', it: 'Aree impilate' }]] },
    kit.P.interval, kit.P.filter],
  target: 40,
  click: p => p.split,

  // terms all'esterno: le stesse N categorie in tutti gli intervalli
  query: (p, c) => ({ size: 0, query: c.q, aggs: { s: { terms: { field: p.split, size: p.size }, aggs: { t: kit.dateHisto(p.timefield, c) } } } }),
  // impilamento calcolato qui (y0/y1): con barre a intervallo (x + x2) lo stack di Vega-Lite non si applica
  rows(r, p, c) {
    const base = new Map();
    return (r.aggregations?.s?.buckets || []).flatMap(s => (s.t?.buckets || []).map(b => {
      const y0 = base.get(b.key) || 0, y1 = y0 + b.doc_count; base.set(b.key, y1);
      return { t: b.key, t2: b.key + c.iv[1] * 0.86, k: s.key, v: b.doc_count, y0, y1 };
    }));
  },
  spec(p, rows, c) {
    const t = c.theme, keys = [...new Map(rows.map(r => [String(r.k), r.k])).values()];   // ordine dei bucket = per conteggio
    const enc = { x: kit.timeX, y: { field: 'y1', type: 'quantitative', title: null, axis: { tickCount: 4 } }, y2: { field: 'y0' },
      color: { field: 'k', type: 'nominal', title: null, sort: keys.map(String), scale: { domain: keys, range: keys.map((k, i) => kit.colorOf(c, p.split, k, i)) }, legend: { orient: 'bottom', direction: 'horizontal', columns: 6, labelLimit: 120 } },
      tooltip: [kit.tipTime, { field: 'k', type: 'nominal', title: p.split }, { field: 'v', type: 'quantitative', title: kit.L(kit.LABELS.docs), format: ',d' }] };
    const base = { ...kit.baseSpec(c.height), data: { values: rows }, params: [kit.brushParam(t)] };
    if (p.style === 'area') return { ...base, mark: { type: 'area', interpolate: 'monotone', cursor: 'pointer', opacity: 0.85 }, encoding: enc };
    return { ...base, mark: { type: 'bar', cursor: 'pointer' }, encoding: { ...enc, x2: { field: 't2' } } };
  }
};
