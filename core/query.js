// Costruzione delle query comuni a tutte le pagine.

/**
 * Query string e filtri (include/esclude) di una pagina.
 * st = { query?: string, filters?: [{field, value, neg?, phrase?} | {field, values: [...], neg?}] }
 * `values` = «è uno di» (terms, valori in OR), es. dal widget selettore di valori.
 * fields = lista campi dell'indice: i filtri su campi assenti vengono ignorati,
 * così un filtro nato su un indice non azzera i pannelli di un altro.
 * except = campo i cui filtri vanno ignorati (un selettore calcola le sue opzioni senza la propria selezione).
 */
export function filterClauses(st, fields, except) {
  const f = [], n = [];
  if (st?.query?.trim()) f.push({ query_string: { query: st.query, default_operator: 'AND', lenient: true } });
  for (const x of st?.filters || []) {
    if (fields && !fields.some(y => y.name === x.field)) continue;
    if (except && x.field === except) continue;
    (x.neg ? n : f).push(Array.isArray(x.values) ? { terms: { [x.field]: x.values } }
      : x.phrase ? { match_phrase: { [x.field]: x.value } } : { term: { [x.field]: x.value } });
  }
  return { f, n };
}
/** Testo del valore di un filtro (chip, query string): «a, b» per i filtri a più valori. */
export const filterText = x => Array.isArray(x.values) ? x.values.join(', ') : String(x.value);

/** bool completo: range temporale + query/filtri di pagina + query string extra (es. filtro del pannello). */
export function buildQuery({ timefield, tr, state, fields, extra, except }) {
  const { f, n } = filterClauses(state, fields, except);
  if (timefield && tr) f.unshift({ range: { [timefield]: { gte: tr.from, lte: tr.to, format: 'epoch_millis' } } });
  if (extra?.trim()) f.push({ query_string: { query: extra, default_operator: 'AND', lenient: true } });
  const q = { bool: { filter: f } };
  if (n.length) q.bool.must_not = n;
  return q;
}

/** Filtri di pagina → query string, per trasferire una vista Discover in un pannello. */
export function toQueryString(st) {
  const quote = v => '"' + String(v).replace(/(["\\])/g, '\\$1') + '"';
  const parts = [];
  if (st.query?.trim()) parts.push('(' + st.query.trim() + ')');
  for (const f of st.filters || []) parts.push((f.neg ? 'NOT ' : '') + f.field + ':' + (Array.isArray(f.values) ? '(' + f.values.map(quote).join(' OR ') + ')' : quote(f.value)));
  return parts.join(' AND ');
}
