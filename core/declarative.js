// Widget dichiarativi: un documento JSON (salvabile in un indice) → un widget che rispetta il contratto di core/contract.js.
// Niente codice nel documento: la query è un template, le righe un percorso, la spec Vega-Lite un dato.
// Così un widget si aggiunge con un PUT, senza build, e si può caricare anche dove la CSP vieta eval (la console di XERJ).
//
// Forma del documento (vedi AGENTS.md → «Widget dichiarativi»):
//   { type, name, desc?, defaults?, init?, params: [...], target?,
//     query: { … "{{param}}" … "{{ctx.q}}" … },            template: un valore "{{x}}" intero mantiene il tipo
//     rows: { path: ["aggregations.k.buckets", …], map: { k: "key", v: "doc_count", t: "^.key" } }   oppure { value: "aggregations.m.value" }
//     spec: { mark, encoding, … },                          Vega-Lite senza data: le righe arrivano come data.values
//     color?: { param: "split", row: "k" },                 colori stabili della dashboard per il campo del parametro
//     brush?: true, click?: "<param>" }
// Variabili del contesto nei template: ctx.q, ctx.interval, ctx.from, ctx.to, ctx.height.

import * as kit from './kit.js';
import { isLocalized } from './i18n.js';

// chiavi vietate ovunque nel documento: dati esterni, link, riferimenti
const FORBIDDEN = new Set(['url', 'href', '$ref', 'loader', 'usermeta']);
const ICON = '<svg viewBox="0 0 30 30" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 6c-3 0-3 2-3 4v2c0 1.5-1 3-3 3 2 0 3 1.5 3 3v2c0 2 0 4 3 4M19 6c3 0 3 2 3 4v2c0 1.5 1 3 3 3-2 0-3 1.5-3 3v2c0 2 0 4-3 4"/></svg>';

/** Problemi del documento (stringhe); vuoto = compilabile. */
export function checkDeclarative(d) {
  const errs = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['the widget document must be an object'];
  if (typeof d.query !== 'object' || !d.query) errs.push('"query" must be an object (a _search body template)');
  if (!d.rows || !(Array.isArray(d.rows.path) || typeof d.rows.value === 'string')) errs.push('"rows" needs "path" (array) and "map", or "value" (a path)');
  if (d.rows?.path && (typeof d.rows.map !== 'object' || !d.rows.map)) errs.push('"rows.map" must map row fields to response paths');
  if (typeof d.spec !== 'object' || !d.spec) errs.push('"spec" must be a Vega-Lite object (without data)');
  if (d.color && (typeof d.color.param !== 'string' || typeof d.color.row !== 'string')) errs.push('"color" must be { param, row }');
  if (d.click != null && typeof d.click !== 'string') errs.push('"click" must be the key of the parameter to filter on');
  const walk = (x, at) => {
    if (Array.isArray(x)) return x.forEach((v, i) => walk(v, at + '[' + i + ']'));
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (FORBIDDEN.has(k)) errs.push(`"${at}.${k}" is not allowed in a declarative widget (no external data, links or references)`); walk(v, at + '.' + k); }
    else if (typeof x === 'function') errs.push(`"${at}" is code: a declarative widget holds data only`);
  };
  walk(d, 'widget');
  for (const p of d.params || []) if (p && p.show != null && !(typeof p.show === 'object' && typeof p.show.key === 'string')) errs.push(`parameter "${p.key}": "show" must be { key, eq } or { key, ne }`);
  return errs;
}

/** Sostituisce i "{{…}}": un valore che è solo "{{x}}" diventa il valore (oggetto, numero…), altrimenti interpolazione testuale. */
function fill(x, vars) {
  if (typeof x === 'string') {
    const whole = x.match(/^\{\{\s*([\w.@-]+)\s*\}\}$/);
    if (whole) return vars(whole[1]);
    return x.replace(/\{\{\s*([\w.@-]+)\s*\}\}/g, (m, k) => { const v = vars(k); return v == null ? '' : String(v); });
  }
  if (Array.isArray(x)) return x.map(v => fill(v, vars));
  if (x && typeof x === 'object') {
    if (isLocalized(x)) return kit.L(x);   // testi { en, it } dentro la spec (titoli, tooltip)
    const o = {};
    for (const [k, v] of Object.entries(x)) o[fill(k, vars)] = fill(v, vars);
    return o;
  }
  return x;
}
const varsOf = (p, c) => k => {
  if (k.startsWith('ctx.')) {
    const n = k.slice(4);
    return n === 'interval' ? c.iv?.[0] : n === 'from' ? c.tr?.from : n === 'to' ? c.tr?.to : c[n];
  }
  return p[k];
};
const get = (o, path) => path === '' ? o : kit.getPath(o, path);

/** Righe piatte dal percorso: ogni livello di path è un array; "^." nella mappa risale di un livello. */
function rowsOf(resp, r) {
  if (r.value) return [{ v: get(resp, r.value) ?? null }];
  const out = [];
  const step = (node, level, stack) => {
    const arr = get(node, r.path[level]);
    for (const item of Array.isArray(arr) ? arr : []) {
      const st = [...stack, item];
      if (level < r.path.length - 1) { step(item, level + 1, st); continue; }
      const row = {};
      for (const [k, src] of Object.entries(r.map)) {
        const up = (String(src).match(/^(\^\.)+/)?.[0].length || 0) / 2;
        row[k] = get(st[st.length - 1 - up], String(src).slice(up * 2)) ?? null;
      }
      out.push(row);
    }
  };
  step(resp, 0, []);
  return out;
}

/** Documento → widget. Lancia se il documento non è valido. */
export function compileWidget(d) {
  const errs = checkDeclarative(d);
  if (errs.length) throw new Error(errs.join('; '));
  const params = (d.params || []).map(p => {
    const { show, ...rest } = p;
    if (!show) return rest;
    return { ...rest, show: v => ('eq' in show ? v[show.key] === show.eq : v[show.key] !== show.ne) };
  });
  return {
    type: d.type, name: d.name, desc: d.desc, icon: ICON, declarative: true,
    defaults: d.defaults, init: d.init, params, target: d.target,
    ...(d.click ? { click: p => p[d.click] } : {}),
    query: (p, c) => fill(d.query, varsOf(p, c)),
    rows: resp => rowsOf(resp, d.rows),
    spec(p, rows, c) {
      const s = fill(d.spec, varsOf(p, c));
      const spec = { ...kit.baseSpec(c.height), ...s, data: { values: rows } };
      if (d.color) {
        const vals = [...new Set(rows.map(r => r[d.color.row]))];
        spec.encoding = { ...spec.encoding, color: { field: d.color.row, type: 'nominal', title: null, ...(spec.encoding?.color || {}),
          scale: { domain: vals, range: vals.map((v, i) => kit.colorOf(c, p[d.color.param], v, i)) } } };
      }
      if (d.brush) spec.params = [...(spec.params || []), kit.brushParam(c.theme)];
      return spec;
    }
  };
}
