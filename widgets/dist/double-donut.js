import * as kit from '../../core/kit.js';

// Doppio donut: anello interno = categorie di `field`, anello esterno = ripartizione di ognuna per `field2`.
// Gli angoli sono calcolati in rows (theta/theta2 in radianti, scale null), così ogni fetta esterna sta
// esattamente sopra la sua categoria. Fette separate da 2px color superficie. Due modi di colorare (`color`):
//   parent  interno nei colori categoriali in ordine fisso, esterno nella tinta della madre a opacità decrescenti
//           → «com'è fatta ogni categoria»;
//   outer   interno neutro con etichette, esterno colorato per valore (stesso valore = stesso colore ovunque,
//           i 6 valori più grandi in ordine fisso, il resto in "Altro") → «come si distribuisce un valore».
// Query: terms → terms (+ sum facoltativa), tutto nel sottoinsieme compatibile XERJ.

const TAU = Math.PI * 2;
const OPACITY = [0.72, 0.56, 0.44, 0.35, 0.28, 0.22];   // fette esterne di una stessa categoria, dalla più grande
const OTHER = { en: 'Other', it: 'Altro' };

/** Campo dell'anello esterno: se coincide con quello interno (o manca) usa il primo altro keyword dell'indice. */
function outerField(p, c) {
  if (p.field2 && p.field2 !== p.field) return p.field2;
  const ks = (c.fields || []).filter(f => f.type === 'keyword' && f.name !== p.field);
  return (ks.find(f => !/(^|_)id$/i.test(f.name) && !f.name.endsWith('.keyword')) || ks[0])?.name || '';
}
const sumAgg = p => p.fn === 'sum' && p.metric ? { m: { sum: { field: p.metric } } } : null;
const val = (b, p) => Math.max(0, p.fn === 'sum' && p.metric ? (b?.m?.value ?? 0) : (b?.doc_count ?? 0));

export default {
  type: 'double-donut',
  name: { en: 'Double donut', it: 'Doppio donut' },
  desc: { en: 'Shares of a field, split by a second one', it: 'Quote di un campo, suddivise per un secondo' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor"><circle cx="15" cy="15" r="6" stroke-width="3.2" opacity=".35"/><path d="M15 9a6 6 0 0 1 5.7 7.9" stroke-width="3.2"/><circle cx="15" cy="15" r="11" stroke-width="2.6" opacity=".25"/><path d="M15 4a11 11 0 0 1 10.5 14.3" stroke-width="2.6"/></svg>',
  defaults: { w: 4, h: 'l' },
  init: { size: 5, size2: 4, fn: 'count', color: 'parent' },
  params: [
    kit.P.index, kit.P.time,
    { key: 'field', label: { en: 'Inner ring', it: 'Anello interno' }, type: 'field', ftype: 'keyword' },
    { key: 'field2', label: { en: 'Outer ring', it: 'Anello esterno' }, type: 'field', ftype: 'keyword',
      help: { en: 'Splits each inner slice. If it equals the inner field, the next keyword field is used.', it: 'Suddivide ogni fetta interna. Se è uguale al campo interno si usa il keyword successivo.' } },
    kit.P.size({ en: 'Inner slices', it: 'Fette interne' }, 2, 6),
    { ...kit.P.size({ en: 'Outer slices per inner one', it: 'Fette esterne per ognuna' }, 2, 6), key: 'size2' },
    { key: 'fn', label: { en: 'Size of the slices', it: 'Ampiezza delle fette' }, type: 'select',
      options: [['count', kit.FN_LABEL.count], ['sum', kit.FN_LABEL.sum]] },
    { key: 'metric', label: { en: 'Field to sum', it: 'Campo da sommare' }, type: 'field', ftype: 'number', show: p => p.fn === 'sum' },
    { key: 'color', label: { en: 'Outer ring colour', it: 'Colore anello esterno' }, type: 'select',
      options: [['parent', { en: 'Inner category', it: 'Categoria interna' }], ['outer', { en: 'Outer value', it: 'Valore esterno' }]],
      help: { en: '<b>Inner category</b>: how each category is made up. <b>Outer value</b>: the same value has the same colour in every category; the inner ring turns neutral.',
        it: '<b>Categoria interna</b>: com\'è fatta ogni categoria. <b>Valore esterno</b>: lo stesso valore ha lo stesso colore in ogni categoria; l\'anello interno diventa neutro.' } },
    kit.P.filter
  ],
  click: p => p.field,   // solo l'anello interno è cliccabile (le fette esterne non hanno `k`)

  query(p, c) {
    const m = sumAgg(p);
    return { size: 0, query: c.q, aggs: {
      k: { terms: { field: p.field, size: p.size }, aggs: { s: { terms: { field: outerField(p, c), size: p.size2 }, ...(m ? { aggs: m } : {}) }, ...(m || {}) } },
      ...(m ? { tot: m.m } : {})
    } };
  },

  rows(r, p, c) {
    const a = r.aggregations?.k, f2 = outerField(p, c);
    if (!f2) throw new Error(kit.L({ en: 'The index has no second keyword field for the outer ring.', it: 'L\'indice non ha un secondo campo keyword per l\'anello esterno.' }));
    const groups = (a?.buckets || []).map((b, i) => {
      const v = val(b, p), kids = (b.s?.buckets || []).map(s => ({ k2: s.key, v: val(s, p) }));
      const rest = p.fn === 'sum' && p.metric ? v - kids.reduce((n, x) => n + x.v, 0) : (b.s?.sum_other_doc_count || 0);
      if (rest > 0) kids.push({ k2: kit.L(OTHER), v: rest, other: true });
      return { k: b.key, v, i, kids };
    });
    const known = groups.reduce((n, g) => n + g.v, 0);
    const restTop = p.fn === 'sum' && p.metric ? (r.aggregations?.tot?.value ?? known) - known : (a?.sum_other_doc_count || 0);
    if (restTop > 0) groups.push({ k: kit.L(OTHER), v: restTop, other: true, kids: [] });
    const total = groups.reduce((n, g) => n + g.v, 0);
    if (!total) return [];

    const t = c.theme, rows = [], byOuter = p.color === 'outer';
    // colori dalla mappa della dashboard (kit.colorOf): un valore ha lo stesso colore con qualsiasi filtro.
    // Modo "outer": i valori esterni si registrano per totale decrescente, così i più grandi prendono i primi colori liberi.
    const col2 = new Map();
    if (byOuter) {
      const tot2 = new Map();
      for (const g of groups) for (const x of g.kids) if (!x.other) tot2.set(x.k2, (tot2.get(x.k2) || 0) + x.v);
      [...tot2].sort((x, y) => y[1] - x[1]).forEach(([k], i) => { const col = kit.colorOf(c, f2, k, i); if (col !== t.other) col2.set(k, col); });
    }
    let a0 = 0;
    for (const g of groups) {
      const span = g.v / total * TAU, col = g.other ? t.other : byOuter ? t.line : kit.colorOf(c, p.field, g.k, g.i);
      rows.push({ ring: 'in', k: g.k, v: g.v, a0, a1: a0 + span, am: a0 + span / 2, span, col, pt: g.v / total, ...(g.other ? { other: true } : {}) });
      // l'"Altro" di primo livello non si suddivide: una sola fetta esterna neutra, così gli anelli restano allineati
      const kids = g.kids.length ? g.kids : [{ k2: kit.L(OTHER), v: g.v, other: true }];
      const sub = kids.reduce((n, x) => n + x.v, 0) || 1;
      let b0 = a0;
      kids.forEach((x, j) => {
        const s = x.v / sub * span;
        rows.push({ ring: 'out', parent: g.k, k2: x.k2, v: x.v, a0: b0, a1: b0 + s, am: b0 + s / 2, span: s,
          col: x.other || g.other ? t.other : byOuter ? (col2.get(x.k2) || t.other) : col,
          op: byOuter ? 1 : x.other || g.other ? 0.3 : OPACITY[Math.min(j, OPACITY.length - 1)],
          lk: !x.other && !g.other && col2.has(x.k2) ? String(x.k2) : kit.L(OTHER),   // voce di legenda nel modo "outer"
          pp: x.v / (g.v || 1), pt: x.v / total, rest: !!(x.other || g.other), other: true });   // other: true = non cliccabile (filtrerebbe il campo sbagliato)
        b0 += s;
      });
      a0 += span;
    }
    return rows;
  },

  spec(p, rows, c) {
    const t = c.theme;
    // raggi sull'area del grafico (legenda esclusa): il donut resta un cerchio intero anche in un pannello stretto
    const R = 'max(24, min(width, height) / 2 - 2)', r = k => ({ expr: `${R} * ${k}` });
    const docs = p.fn === 'sum' && p.metric ? `${kit.fnLabel('sum')} ${p.metric}` : kit.L(kit.LABELS.docs);
    const fmtV = p.fn === 'sum' ? ',.2~f' : ',d';
    const inner = rows.filter(x => x.ring === 'in'), byOuter = p.color === 'outer';
    const legend = { orient: 'bottom', direction: 'horizontal', columns: 3, labelLimit: 90, symbolType: 'circle' };
    // voci di legenda dell'anello esterno: valori colorati in ordine, poi "Altro" se c'è
    const outerKeys = []; const seen = new Set();
    for (const x of rows) if (x.ring === 'out' && x.col !== t.other && !seen.has(x.lk)) { seen.add(x.lk); outerKeys.push([x.lk, x.col]); }
    outerKeys.sort((x, y) => t.c.indexOf(x[1]) - t.c.indexOf(y[1]));
    if (rows.some(x => x.ring === 'out' && x.col === t.other)) outerKeys.push([kit.L(OTHER), t.other]);
    const theta = { theta: { field: 'a0', type: 'quantitative', scale: null }, theta2: { field: 'a1' } };
    const arc = { type: 'arc', stroke: t.surface, strokeWidth: 2, cornerRadius: 2 };
    const share = { field: 'pt', type: 'quantitative', title: kit.L({ en: 'Share of total', it: 'Quota sul totale' }), format: '.1%' };
    return { ...kit.baseSpec(c.height), data: { values: rows },
      layer: [
        { transform: [{ filter: "datum.ring === 'in'" }],
          mark: { ...arc, innerRadius: r(0.34), outerRadius: r(0.64), cursor: 'pointer', ...(byOuter ? { fill: t.line } : {}) },
          encoding: { ...theta,
            ...(byOuter ? {} : { color: { field: 'k', type: 'nominal', title: null, sort: inner.map(x => String(x.k)),
              scale: { domain: inner.map(x => x.k), range: inner.map(x => x.col) }, legend } }),
            tooltip: [{ field: 'k', type: 'nominal', title: p.field }, { field: 'v', type: 'quantitative', title: docs, format: fmtV }, share] } },
        { transform: [{ filter: "datum.ring === 'out'" }],
          mark: { ...arc, innerRadius: { expr: `${R} * 0.64 + 2` }, outerRadius: r(1) },
          encoding: { ...theta,
            ...(byOuter
              ? { color: { field: 'lk', type: 'nominal', title: null, sort: outerKeys.map(x => x[0]),
                  scale: { domain: outerKeys.map(x => x[0]), range: outerKeys.map(x => x[1]) }, legend } }
              : { fill: { field: 'col', type: 'nominal', scale: null, legend: null },
                  fillOpacity: { field: 'op', type: 'quantitative', scale: null, legend: null } }),
            tooltip: [{ field: 'parent', type: 'nominal', title: p.field }, { field: 'k2', type: 'nominal', title: outerField(p, c) },
              { field: 'v', type: 'quantitative', title: docs, format: fmtV },
              { field: 'pp', type: 'quantitative', title: kit.L({ en: 'Share of the inner slice', it: 'Quota sulla fetta interna' }), format: '.1%' }, share] } },
        // etichette dirette solo sulle fette abbastanza larghe dell'anello senza legenda; mai su "Altro"
        byOuter
          ? { transform: [{ filter: `datum.ring === 'in' && !datum.other && datum.span * ${R} * 0.49 > 40` }],
              mark: { type: 'text', radius: r(0.49), font: t.font, fontSize: 10.5, fontWeight: 500, color: t.fg, limit: { expr: `${R} * 0.28` } },
              encoding: { theta: { field: 'am', type: 'quantitative', scale: null }, text: { field: 'k' } } }
          : { transform: [{ filter: `datum.ring === 'out' && !datum.rest && datum.span * ${R} * 0.83 > 40` }],
              mark: { type: 'text', radius: r(0.83), font: t.font, fontSize: 10.5, color: t.fg, limit: { expr: `${R} * 0.32` } },
              encoding: { theta: { field: 'am', type: 'quantitative', scale: null }, text: { field: 'k2' } } }
      ] };
  }
};
