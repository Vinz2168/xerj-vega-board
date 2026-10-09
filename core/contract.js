// Contratti di widget e pagine. Usato dal registry nel browser e da tools/validate.mjs in Node.
// Messaggi in inglese: sono diagnostica per sviluppatori e agent, non interfaccia.

import { isLocalized } from './i18n.js';

/** Etichetta valida: stringa non vuota oppure { en: '…', it: '…', … } con almeno en. */
export const isLabel = x => (typeof x === 'string' && x.length > 0) || isLocalized(x);

export const PARAM_TYPES = ['index', 'field', 'fields', 'select', 'number', 'text', 'json'];
export const FIELD_KINDS = ['date', 'keyword', 'number', 'text'];
export const HEIGHTS = { s: 116, m: 236, l: 360 };
export const WIDTHS = [3, 4, 6, 8, 12];

/** Ritorna l'elenco dei problemi (stringhe). Vuoto = widget valido. */
export function validateWidget(w, expectedType) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  need(w && typeof w === 'object', 'the module must have an object as default export');
  if (!w || typeof w !== 'object') return errs;
  need(typeof w.type === 'string' && /^[a-z][a-z0-9-]*$/.test(w.type), '"type" is required, lowercase kebab-case');
  if (expectedType) need(w.type === expectedType, `"type" (${w.type}) differs from the manifest entry (${expectedType})`);
  need(isLabel(w.name), '"name" is required: a string or { en, it }');
  if (w.desc != null) need(isLabel(w.desc), '"desc" must be a string or { en, it }');
  need(typeof w.query === 'function', '"query(params, ctx)" is required');
  need(typeof w.rows === 'function', '"rows(response, params, ctx)" is required');
  need(typeof w.spec === 'function' || typeof w.render === 'function', 'needs "spec(params, rows, ctx)" (Vega-Lite) or "render(el, params, rows, ctx)" (HTML)');
  need(Array.isArray(w.params), '"params" must be an array');
  for (const p of w.params || []) {
    need(p && typeof p.key === 'string', 'every parameter needs a "key"');
    if (p?.label != null) need(isLabel(p.label), `parameter "${p.key}": label must be a string or { en, it }`);
    need(PARAM_TYPES.includes(p?.type), `parameter "${p?.key}": invalid type "${p?.type}" (allowed: ${PARAM_TYPES.join(', ')})`);
    if (p?.type === 'field') need(typeof p.ftype === 'function' || FIELD_KINDS.includes(p.ftype), `parameter "${p.key}": missing or invalid ftype`);
    if (p?.type === 'select') need(Array.isArray(p.options) && p.options.every(o => Array.isArray(o) && o.length === 2 && isLabel(o[1])), `parameter "${p.key}": options must be [[value, label], …] with label a string or { en, it }`);
    if (p?.type === 'number') need(Number.isFinite(p.min) && Number.isFinite(p.max), `parameter "${p.key}": min and max are required`);
  }
  if (w.defaults) {
    need(!w.defaults.w || WIDTHS.includes(w.defaults.w), `defaults.w must be one of ${WIDTHS.join(', ')}`);
    need(!w.defaults.h || w.defaults.h in HEIGHTS, 'defaults.h must be s, m or l');
  }
  if (w.click) need(typeof w.click === 'function', '"click(params)" must be a function returning the field to filter on');
  if (w.css) need(typeof w.css === 'string', '"css" must be a string');
  if (w.control != null) need(typeof w.control === 'boolean' && (!w.control || typeof w.render === 'function'), '"control" must be a boolean; a control needs "render" (HTML)');
  return errs;
}

/** Contratto delle pagine montate dalla shell. */
export function validatePage(p, expectedId) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['the module must have an object as default export'];
  if (expectedId && p.id !== expectedId) errs.push(`"id" (${p.id}) differs from config.json (${expectedId})`);
  if (typeof p.mount !== 'function') errs.push('"mount(slots, app)" is required');
  return errs;
}

/** Controllo leggero di una definizione di dashboard rispetto ai tipi registrati. */
export function validateDashboard(d, types) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['the dashboard must be an object'];
  if (!isLabel(d.title)) errs.push('"title" is required');
  if (!Array.isArray(d.panels)) return [...errs, '"panels" must be an array'];
  d.panels.forEach((p, i) => {
    if (!types.has(p.type)) errs.push(`panel ${i + 1}: type "${p.type}" is not registered`);
    if (p.w && !WIDTHS.includes(p.w)) errs.push(`panel ${i + 1}: invalid w`);
    if (p.h && !(p.h in HEIGHTS)) errs.push(`panel ${i + 1}: invalid h`);
  });
  return errs;
}
