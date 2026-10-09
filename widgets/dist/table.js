import * as kit from '../../core/kit.js';

// Widget HTML (render invece di spec): una tabella in Vega sarebbe più scomoda da leggere.
export default {
  type: 'table',
  name: { en: 'Documents', it: 'Documenti' },
  desc: { en: 'The latest records', it: 'Gli ultimi record' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="22" height="20" rx="2"/><path d="M4 11h22M4 17h22M12 11v14"/></svg>',
  defaults: { w: 12, h: 'm' },
  init: { size: 10, columns: [] },
  params: [kit.P.index, kit.P.time, { key: 'columns', label: { en: 'Columns', it: 'Colonne' }, type: 'fields' }, kit.P.size(undefined, 1, 100), kit.P.filter],
  css: `.w-table{height:100%;overflow:auto}
.w-table table{border-collapse:collapse;width:100%;font-size:12.5px}
.w-table th{position:sticky;top:0;background:var(--surface);text-align:left;font:500 11px var(--mono);color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.w-table td{padding:5px 10px;border-bottom:1px solid var(--line);white-space:nowrap;font-family:var(--mono);font-variant-numeric:tabular-nums}
.w-table tr:hover td{background:var(--bg)}`,

  query(p, c) {
    const b = { size: p.size, query: c.q, sort: [{ [p.timefield]: { order: 'desc' } }] };
    if (p.columns?.length) b._source = p.columns;
    return b;
  },
  rows: r => (r.hits?.hits || []).map(h => h._source || {}),
  render(el, p, rows, c) {
    const cols = p.columns?.length ? p.columns : Object.keys(rows[0] || {});
    const dates = new Set(c.fields.filter(f => f.type === 'date').map(f => f.name));
    const cell = (r, col) => { let v = kit.getPath(r, col); if (v != null && dates.has(col)) v = kit.fmtDate(v); else if (typeof v === 'number') v = kit.fmtNum(v); return `<td>${kit.esc(v ?? '')}</td>`; };
    el.innerHTML = '<div class="w-table"><table><thead><tr>' + cols.map(x => `<th>${kit.esc(x)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + cols.map(x => cell(r, x)).join('') + '</tr>').join('') + '</tbody></table></div>';
  }
};
