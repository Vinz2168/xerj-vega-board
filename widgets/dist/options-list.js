import * as kit from '../../core/kit.js';

// Elenco opzioni (come l'"Options list" di Kibana): una tendina con i valori di un campo, aggregati con `terms`
// (ogni valore con il suo conteggio), da cui scegliere uno o più valori. La scelta diventa un filtro della dashboard:
// un valore → term, più valori → terms («è uno di»), in modalità Includi o Escludi.
// Le opzioni si calcolano senza la selezione del widget stesso (ctx.queryWithout), così scegliere IT non nasconde DE.
// La ricerca filtra le opzioni già caricate (fino a "Opzioni"), senza nuove query.

const T = {
  any: { en: 'Any', it: 'Qualsiasi' },
  search: { en: 'Search…', it: 'Cerca…' },
  include: { en: 'Include', it: 'Includi' },
  exclude: { en: 'Exclude', it: 'Escludi' },
  clear: { en: 'Clear selection', it: 'Cancella selezione' },
  none: { en: 'No values', it: 'Nessun valore' },
  noMatch: { en: 'No value matches', it: 'Nessun valore corrisponde' },
  shown: { en: '{n} values', it: '{n} valori' },
  selected: { en: '{n} selected', it: '{n} selezionati' }
};
const tx = (k, n) => kit.L(T[k]).replace('{n}', kit.fmtNum(n));

// chiusura al click fuori / Esc: un solo listener per pagina, ogni widget aperto registra la sua funzione _close
if (typeof document !== 'undefined' && !globalThis.__xvbOptionsList) {
  globalThis.__xvbOptionsList = true;
  document.addEventListener('mousedown', e => {
    for (const r of document.querySelectorAll('.w-options-list.open')) if (!r.contains(e.target)) r._close?.();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const r of document.querySelectorAll('.w-options-list.open')) { r._close?.(); r.querySelector('.ol-btn')?.focus(); }
  }, true);
}

export default {
  type: 'options-list',
  name: { en: 'Options list', it: 'Elenco opzioni' },
  desc: { en: 'Filter the dashboard by one or more values', it: 'Filtra la dashboard per uno o più valori' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="6" width="22" height="7" rx="2"/><path d="M20 9l1.5 1.5L23 9"/><path d="M6 18h3M6 23h3M12 18h12M12 23h9" stroke-linecap="round"/></svg>',
  defaults: { w: 3, h: 's' },   // w = larghezza nella barra dei controlli; h non si usa
  init: { multi: 'multi', sort: 'count', size: 50 },
  keepEmpty: true,
  control: true,   // nella barra dei controlli sopra la griglia, non come pannello
  params: [
    kit.P.index, kit.P.time,
    { key: 'field', label: { en: 'Field', it: 'Campo' }, type: 'field', ftype: 'keyword' },
    { key: 'multi', label: { en: 'Selection', it: 'Selezione' }, type: 'select',
      options: [['multi', { en: 'Multiple values', it: 'Più valori' }], ['single', { en: 'One value', it: 'Un solo valore' }]] },
    { key: 'sort', label: { en: 'Order', it: 'Ordine' }, type: 'select',
      options: [['count', { en: 'By document count', it: 'Per numero di documenti' }], ['key', { en: 'Alphabetical', it: 'Alfabetico' }]] },
    { ...kit.P.size({ en: 'Options', it: 'Opzioni' }, 5, 200),
      help: { en: 'How many values to load. Search works on these.', it: 'Quanti valori caricare. La ricerca lavora su questi.' } },
    kit.P.filter
  ],

  query(p, c) {
    return { size: 0, query: c.queryWithout ? c.queryWithout(p.field) : c.q,
      aggs: { k: { terms: { field: p.field, size: p.size, order: p.sort === 'key' ? { _key: 'asc' } : { _count: 'desc' } } } } };
  },
  rows: r => (r.aggregations?.k?.buckets || []).map(b => ({ k: b.key, v: b.doc_count })),

  render(el, p, rows, c) {
    const st = c.state, multi = p.multi !== 'single';
    const inc = c.filterValues?.(p.field, false) || [], exc = c.filterValues?.(p.field, true) || [];
    if (st.neg == null || inc.length || exc.length) st.neg = !inc.length && exc.length > 0;
    const cur = (st.neg ? exc : inc).map(String), sel = new Set(cur);
    // valori scelti che non sono più tra le opzioni (altro intervallo, altri filtri): restano visibili, con conteggio 0
    const opts = [...rows.map(r => ({ k: r.k, v: r.v })), ...cur.filter(k => !rows.some(r => String(r.k) === k)).map(k => ({ k, v: 0 }))];
    const q = (st.search || '').trim().toLowerCase();
    const shown = q ? opts.filter(o => String(o.k).toLowerCase().includes(q)) : opts;
    const id = 'ol-' + c.panelId, name = id + '-opt';
    const valTxt = cur.length ? cur.join(', ') : kit.L(T.any);

    el.innerHTML = `<div class="w-options-list${st.open ? ' open' : ''}">
      <div class="ol-ctl">
        <button type="button" class="ol-btn${cur.length ? ' on' : ''}${st.neg && cur.length ? ' neg' : ''}" aria-haspopup="listbox" aria-expanded="${!!st.open}" aria-controls="${id}">
          <span class="ol-lab">${kit.esc(c.title || p.field)}</span>
          <span class="ol-val" title="${kit.esc(valTxt)}">${st.neg && cur.length ? '<b>NOT</b> ' : ''}${kit.esc(valTxt)}</span>
          ${cur.length > 1 ? `<span class="ol-n">${cur.length}</span>` : ''}
          <svg class="ol-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
        </button>
        ${cur.length ? `<button type="button" class="ol-x" data-ol="clear" aria-label="${kit.esc(kit.L(T.clear))}" title="${kit.esc(kit.L(T.clear))}">×</button>` : ''}
      </div>
      <div class="ol-pop" id="${id}"${st.open ? '' : ' hidden'}>
        <div class="ol-top">
          <input type="search" class="ol-q" value="${kit.esc(st.search || '')}" placeholder="${kit.esc(kit.L(T.search))}" aria-label="${kit.esc(kit.L(T.search))}" autocomplete="off">
          <div class="ol-mode" role="radiogroup">
            <button type="button" data-ol="inc" aria-pressed="${!st.neg}">${kit.esc(kit.L(T.include))}</button><button type="button" data-ol="exc" aria-pressed="${!!st.neg}">${kit.esc(kit.L(T.exclude))}</button>
          </div>
        </div>
        <div class="ol-list" role="listbox" aria-multiselectable="${multi}">
          ${shown.length ? shown.map((o, i) => `<label class="ol-opt${o.v ? '' : ' zero'}"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" data-i="${i}"${sel.has(String(o.k)) ? ' checked' : ''}><span class="k">${kit.esc(o.k)}</span><span class="v">${o.v ? kit.fmtNum(o.v) : '–'}</span></label>`).join('')
            : `<p class="ol-empty">${kit.esc(kit.L(opts.length ? T.noMatch : T.none))}</p>`}
        </div>
        <div class="ol-foot"><span>${tx('shown', shown.length)}${cur.length ? ' · ' + tx('selected', cur.length) : ''}</span>
          ${cur.length ? `<button type="button" data-ol="clear">${kit.esc(kit.L(T.clear))}</button>` : ''}</div>
      </div>
    </div>`;

    const root = el.firstElementChild, pop = root.querySelector('.ol-pop'), btn = root.querySelector('.ol-btn');
    const setOpen = on => { st.open = on; root.classList.toggle('open', on); pop.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) root.querySelector('.ol-q').focus(); };
    root._close = () => setOpen(false);
    const apply = (values, neg = st.neg) => c.setFilter?.(p.field, values, neg);

    btn.addEventListener('click', () => setOpen(!st.open));
    root.querySelector('.ol-q').addEventListener('input', e => {
      st.search = e.target.value; const pos = e.target.selectionStart;
      this.render(el, p, rows, c);   // ridisegna solo l'HTML: le opzioni sono già caricate
      const qi = el.querySelector('.ol-q'); qi.focus(); qi.setSelectionRange(pos, pos);
    });
    root.querySelector('.ol-list').addEventListener('change', e => {
      const o = shown[+e.target.dataset.i]; if (!o) return;
      st.focus = String(o.k);
      if (!multi) { st.open = false; apply([o.k]); return; }
      const next = e.target.checked ? [...cur, String(o.k)] : cur.filter(k => k !== String(o.k));
      // i valori del filtro tengono il tipo originale dell'opzione (numeri restano numeri)
      apply(next.map(k => opts.find(x => String(x.k) === k)?.k ?? k));
    });
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-ol]')?.dataset.ol; if (!a) return;
      if (a === 'clear') { apply([]); return; }
      const neg = a === 'exc'; if (neg === !!st.neg) return;
      // cambio modalità: la selezione passa da includi a escludi (o viceversa)
      const vals = cur.map(k => opts.find(x => String(x.k) === k)?.k ?? k);
      if (vals.length) { c.setFilter?.(p.field, [], st.neg); st.neg = neg; apply(vals, neg); }
      else { st.neg = neg; this.render(el, p, rows, c); }
    });
    if (st.open && st.focus != null) {
      const i = shown.findIndex(o => String(o.k) === st.focus);
      root.querySelectorAll('.ol-opt input')[i]?.focus(); st.focus = null;
    }
  },

  css: `.w-options-list{position:relative;height:100%;display:flex;flex-direction:column;justify-content:center}
.w-options-list .ol-ctl{display:flex;align-items:stretch;min-width:0;border:1px solid var(--line);border-radius:7px;background:var(--surface)}
.w-options-list .ol-ctl:focus-within,.w-options-list.open .ol-ctl{border-color:var(--accent)}
.w-options-list .ol-btn{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;border:0;background:transparent;cursor:pointer;text-align:left;color:var(--fg);border-radius:7px}
.w-options-list .ol-lab{font:500 11.5px var(--mono);color:var(--muted);white-space:nowrap;padding-right:8px;border-right:1px solid var(--line)}
.w-options-list .ol-val{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.w-options-list .ol-btn.on .ol-val{color:var(--fg);font-weight:500}
.w-options-list .ol-btn.neg .ol-val b{color:var(--danger);font:600 11px var(--mono)}
.w-options-list .ol-n{font:500 10.5px var(--mono);background:var(--accent-soft);border-radius:99px;padding:1px 7px}
.w-options-list .ol-caret{width:12px;height:12px;flex:none;color:var(--muted)}
.w-options-list .ol-x{border:0;border-left:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer;width:32px;font-size:16px;border-radius:0 7px 7px 0}
.w-options-list .ol-x:hover{color:var(--fg);background:var(--sunk)}
.w-options-list .ol-pop{position:absolute;z-index:40;top:calc(50% + 24px);left:0;width:max(100%, 290px);max-width:calc(100vw - 32px);background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);display:grid;grid-template-columns:minmax(0,1fr)}
.w-options-list .ol-top{display:flex;flex-wrap:wrap;gap:6px;padding:8px;border-bottom:1px solid var(--line);min-width:0}
.w-options-list .ol-q{flex:1 1 120px;min-width:0;min-height:32px;padding:5px 9px}
.w-options-list .ol-mode{display:inline-flex;border:1px solid var(--line);border-radius:7px;padding:2px;gap:2px;background:var(--bg)}
.w-options-list .ol-mode button{border:0;background:transparent;border-radius:5px;padding:0 8px;font-size:12px;cursor:pointer;color:var(--muted)}
.w-options-list .ol-mode button[aria-pressed="true"]{background:var(--surface);color:var(--fg);box-shadow:var(--shadow)}
.w-options-list .ol-mode button[data-ol="exc"][aria-pressed="true"]{color:var(--danger)}
.w-options-list .ol-list{max-height:260px;overflow:auto;padding:4px;min-width:0}
.w-options-list .ol-opt{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px}
.w-options-list .ol-opt:hover{background:var(--bg)}
.w-options-list .ol-opt input{margin:0;accent-color:var(--accent)}
.w-options-list .ol-opt .k{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.w-options-list .ol-opt .v{font:11.5px var(--mono);color:var(--muted);font-variant-numeric:tabular-nums}
.w-options-list .ol-opt.zero .k{color:var(--muted)}
.w-options-list .ol-empty{margin:0;padding:14px 8px;text-align:center;color:var(--muted);font-size:12.5px}
.w-options-list .ol-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--line);font:11px var(--mono);color:var(--muted)}
.w-options-list .ol-foot button{border:0;background:transparent;color:var(--accent);cursor:pointer;font:500 12px var(--sans);padding:2px 0}`
};
