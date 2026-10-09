import * as kit from '../../core/kit.js';

// Widget HTML interattivo: usa ctx.state (stato transitorio del pannello) e ctx.rerender().
export default {
  type: 'search',
  name: { en: 'Search', it: 'Ricerca' },
  desc: { en: 'Full-text with highlighting', it: 'Full-text con evidenziazione' },
  icon: '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="13" cy="13" r="7"/><path d="M18.2 18.2L25 25"/><path d="M10 13h6" opacity=".6"/></svg>',
  defaults: { w: 12, h: 'l' },
  init: { size: 25, q: '', fields: [], tags: [] },
  keepEmpty: true,               // disegna anche con zero risultati (la casella di ricerca deve restare)
  params: [kit.P.index, kit.P.time,
    { key: 'titleField', label: { en: 'Title field', it: 'Campo titolo' }, type: 'field', ftype: 'keyword', help: { en: 'Shown in bold for each result.', it: 'Mostrato in grassetto per ogni risultato.' } },
    { key: 'fields', label: { en: 'Search in fields', it: 'Cerca nei campi' }, type: 'fields', kinds: ['text', 'keyword'], optional: true, help: { en: 'None selected means all fields.', it: 'Nessuno selezionato vuol dire tutti i campi.' } },
    { key: 'tags', label: { en: 'Tags under each result', it: 'Etichette sotto il risultato' }, type: 'fields', kinds: ['keyword', 'number'], optional: true },
    { key: 'q', label: { en: 'Initial search', it: 'Ricerca iniziale' }, type: 'text', placeholder: { en: 'e.g. timeout', it: 'es. timeout' },
      help: { en: 'Query string syntax: <code>AND</code>, <code>NOT</code>, <code>field:value</code>, <code>*</code>.', it: 'Sintassi query string: <code>AND</code>, <code>NOT</code>, <code>campo:valore</code>, <code>*</code>.' } },
    kit.P.size({ en: 'Results', it: 'Risultati' }, 5, 100), kit.P.filter],
  css: `.w-search{height:100%;display:flex;flex-direction:column;gap:8px;min-height:0}
.w-search .sbar{display:flex;gap:6px;margin:0}
.w-search .sbar input{flex:1;min-width:0;font-family:var(--mono);font-size:13px}
.w-search .sbar .btn{min-height:34px;padding:0 10px;font-size:12.5px}
.w-search .sinfo{font:11.5px var(--mono);color:var(--muted)}
.w-search .sres{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--line)}
.w-search .hit{padding:8px 2px;border-bottom:1px solid var(--line);display:grid;gap:3px;min-width:0}
.w-search .hh{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;min-width:0}
.w-search time{font:11.5px var(--mono);color:var(--muted);white-space:nowrap}
.w-search .ht{font-weight:500;font-size:13px;min-width:0;overflow-wrap:anywhere}
.w-search .tags{display:flex;gap:4px;flex-wrap:wrap}
.w-search .tag{font:11px var(--mono);background:var(--sunk);border-radius:4px;padding:0 5px;color:var(--muted)}
.w-search .frag{font:12.5px/1.5 var(--mono);overflow-wrap:anywhere}
.w-search .frag b{font-weight:500;color:var(--muted)}`,

  query(p, c) {
    const s = (c.state.q ?? p.q ?? '').trim();
    const b = { size: p.size, track_total_hits: true, query: { bool: { ...c.q.bool } },
      sort: s ? ['_score', { [p.timefield]: { order: 'desc' } }] : [{ [p.timefield]: { order: 'desc' } }] };
    if (s) {
      b.query.bool.must = [{ query_string: { query: s, default_operator: 'AND', lenient: true, ...(p.fields?.length ? { fields: p.fields } : {}) } }];
      b.highlight = { pre_tags: [kit.HL_PRE], post_tags: [kit.HL_POST], require_field_match: false, fragment_size: 160, number_of_fragments: 2,
        fields: p.fields?.length ? Object.fromEntries(p.fields.map(f => [f, {}])) : { '*': {} } };
    }
    return b;
  },
  rows: r => r.hits?.hits || [],
  render(el, p, hits, c) {
    let box = el.querySelector('.w-search');
    if (!box) {
      el.innerHTML = `<div class="w-search"><form class="sbar" onsubmit="return false"><label class="vh" for="s-${c.panelId}">${kit.L({ en: 'Search documents', it: 'Cerca nei documenti' })}</label>
        <input id="s-${c.panelId}" type="search" placeholder="${kit.L({ en: 'e.g. timeout AND host:api-2', it: 'es. timeout AND host:api-2' })}" autocomplete="off">
        <button class="btn" type="button" data-sapply title="${kit.L({ en: 'Use this search as the query of the whole page', it: 'Usa questa ricerca come query di tutta la pagina' })}">${kit.L({ en: 'Apply to the whole dashboard', it: 'Applica a tutta la dashboard' })}</button></form>
        <div class="sinfo" aria-live="polite"></div><div class="sres"></div></div>`;
      box = el.querySelector('.w-search');
      const inp = box.querySelector('input');
      inp.value = c.state.q ?? p.q ?? '';
      let t; inp.addEventListener('input', () => { c.state.q = inp.value; clearTimeout(t); t = setTimeout(c.rerender, 300); });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); c.rerender(); } });
      box.querySelector('[data-sapply]').addEventListener('click', () => { if (inp.value.trim()) c.setQuery(inp.value.trim()); });
    }
    const s = (c.state.q ?? p.q ?? '').trim(), tot = kit.totalHits(c.response);
    const what = kit.L(tot === 1 ? { en: 'result', it: 'risultato' } : { en: 'results', it: 'risultati' });
    const scope = s ? kit.L({ en: ' for “', it: ' per «' }) + s + kit.L({ en: '”', it: '»' }) : kit.L({ en: ', most recent first', it: ', i più recenti' });
    box.querySelector('.sinfo').textContent = kit.fmtNum(tot) + ' ' + what + scope + ' · ' + (c.response.took ?? '–') + ' ms';
    const textF = c.fields.filter(f => f.type === 'text').map(f => f.name);
    box.querySelector('.sres').innerHTML = hits.length ? hits.map(h => {
      const src = h._source || {}, hl = h.highlight || {};
      const title = hl[p.titleField] ? kit.hlHtml(hl[p.titleField][0]) : kit.esc(kit.getPath(src, p.titleField) ?? h._id);
      let frags = Object.entries(hl).filter(([k]) => k !== p.titleField && !k.endsWith('.keyword')).slice(0, 3)
        .map(([k, v]) => `<div class="frag"><b>${kit.esc(k)}</b> ${v.map(kit.hlHtml).join(' … ')}</div>`).join('');
      if (!frags) { const k = textF.find(f => kit.getPath(src, f) != null); if (k) frags = `<div class="frag">${kit.esc(kit.getPath(src, k))}</div>`; }
      const tags = (p.tags || []).map(f => kit.getPath(src, f)).filter(v => v != null).map(v => `<span class="tag">${kit.esc(typeof v === 'number' ? kit.fmtNum(v) : v)}</span>`).join('');
      const tv = kit.getPath(src, p.timefield);
      return `<article class="hit"><div class="hh">${tv != null ? `<time>${kit.esc(kit.fmtDate(tv))}</time>` : ''}<span class="ht">${title}</span></div>${frags}${tags ? `<div class="tags">${tags}</div>` : ''}</article>`;
    }).join('') : `<div class="msg">${kit.L({ en: 'No documents found. Try fewer terms or a wider time range.', it: 'Nessun documento trovato. Prova con meno termini o un intervallo più ampio.' })}</div>`;
  }
};
