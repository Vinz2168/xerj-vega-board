import * as kit from '../../core/kit.js';

// TEMPLATE — copy this file to widgets/custom/<type>.js, change `type`, then add
// { "type": "<type>", "module": "./<type>.js" } to widgets/custom/index.json and run `node tools/validate.mjs`.
// Files starting with "_" are not registered: this one is only a starting point.
//
// Every user-facing text is { en, it } (English is required, Italian recommended):
// the shell resolves labels in the form; inside rows/spec/render use kit.L({ en, it }).

export default {
  type: 'my-widget',                 // unique, kebab-case; same type as a dist widget = replaces it
  name: { en: 'My widget', it: 'Il mio widget' },
  desc: { en: 'What it shows, in a few words', it: 'Cosa mostra, in poche parole' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="22" height="20" rx="3"/></svg>',
  defaults: { w: 6, h: 'm' },        // w: 3|4|6|8|12 columns, h: s|m|l
  init: { size: 10 },                // initial values of parameters other than index/field
  params: [                          // generate the configuration form (see AGENTS.md → Parameters)
    kit.P.index,
    kit.P.time,
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'keyword' },
    kit.P.size({ en: 'Values', it: 'Valori' }, 3, 20),
    kit.P.filter
  ],
  target: 40,                        // optional: wanted number of time buckets (drives ctx.iv)
  click: p => p.field,               // optional: click on an element with datum.k → filter p.field = k

  /** _search body. ctx.q already holds time range, page query and filters, and the panel filter. */
  query(p, ctx) {
    return { size: 0, query: ctx.q, aggs: { k: { terms: { field: p.field, size: p.size } } } };
  },
  /** _search response → flat rows for Vega. Throwing an Error shows its message in the panel. */
  rows(r, p, ctx) {
    return (r.aggregations?.k?.buckets || []).map(b => ({ k: b.key, v: b.doc_count }));
  },
  /** Vega-Lite spec. Use ctx.height and ctx.theme colours; do not set width (the panel decides it). */
  spec(p, rows, ctx) {
    return {
      ...kit.baseSpec(ctx.height),
      data: { values: rows },
      mark: { type: 'bar', color: ctx.theme.c[0], cursor: 'pointer' },
      encoding: {
        x: { field: 'k', type: 'nominal', title: null, sort: '-y' },
        y: { field: 'v', type: 'quantitative', title: null },
        tooltip: [{ field: 'k', title: p.field }, { field: 'v', title: kit.L(kit.LABELS.docs), format: ',d' }]
      }
    };
  }
  // Instead of spec: render(el, p, rows, ctx) for an HTML widget (see widgets/dist/table.js).
};
