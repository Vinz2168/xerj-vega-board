#!/usr/bin/env node
// Validates pages, widgets, example dashboards and translation catalogues without a browser.
//   node tools/validate.mjs                 everything
//   node tools/validate.mjs --widget bullet one widget
//   node tools/validate.mjs --json          JSON output (handy for agents)
// For each widget: contract, then query → demo engine → rows → spec (compiled with vega-lite if installed),
// plus a check that every user-facing label has an English and an Italian text.
// Exit code 1 if there is at least one error; translation gaps are warnings.

import { readFile, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { validateWidget, validatePage, validateDashboard, HEIGHTS } from '../core/contract.js';
import { demoSearch, demoMapping } from '../core/demo/engine.js';
import { flattenMapping } from '../core/backend.js';
import { buildQuery } from '../core/query.js';
import { pickIv, toRange } from '../core/time.js';
import { autofill } from '../core/ui.js';
import { CATALOGS, LANGS, isLocalized } from '../core/i18n.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--widget') ? args[args.indexOf('--widget') + 1] : null;
const asJson = args.includes('--json');
const out = { errors: [], warnings: [], ok: [] };
const err = (where, msg) => out.errors.push({ where, msg });
const warn = (where, msg) => out.warnings.push({ where, msg });

let vl = null;
try { vl = await import('vega-lite'); } catch (e) { warn('vega-lite', 'not installed: specs are not compiled (npm i vega-lite for a full check)'); }

const THEME = { fg: '#1A2028', muted: '#5A6571', line: '#D2D8DF', sunk: '#E2E6EB', surface: '#FFFFFF', other: '#A3ADB8', accent: '#BF5318', danger: '#B42318', ok: '#2F7D4F', warn: '#A86A00',
  c: ['#BF5318', '#2A7895', '#5A852B', '#7853AE', '#B33951', '#A2801A'], font: 'sans-serif', mono: 'monospace' };
const fieldsOf = idx => flattenMapping(Object.values(demoMapping(idx))[0]?.mappings?.properties);
const tr = toRange('7d');

/** Esegue un pannello sul motore demo e ritorna un messaggio d'errore oppure null. */
function runPanel(w, params, h = 'm') {
  const fields = fieldsOf(params.index);
  const c = { tr, fields, height: HEIGHTS[h], panelId: 'validate', theme: THEME, state: {}, rerender() {}, setQuery() {}, addFilter() {},
    iv: pickIv(params.interval, tr, w.target || 40),
    q: buildQuery({ timefield: params.timefield, tr, state: { query: '', filters: [] }, fields, extra: params.filter }) };
  let body;
  try { body = w.query(params, c); JSON.stringify(body); } catch (e) { return 'query(): ' + e.message; }
  const res = demoSearch(params.index, body);
  if (res.error) return 'the demo engine rejects the query: ' + res.error.reason;
  c.response = res;
  let rows;
  try { rows = w.rows(res, params, c); } catch (e) { return 'rows(): ' + e.message; }
  if (!Array.isArray(rows)) return 'rows() must return an array';
  if (w.spec) {
    let spec;
    try { spec = w.spec(params, rows, c); JSON.stringify(spec); } catch (e) { return 'spec(): ' + e.message; }
    if (!spec?.data?.values) return 'spec() must include data.values with the rows';
    if (vl) { try { vl.compile(spec); } catch (e) { return 'Vega-Lite cannot compile the spec: ' + e.message; } }
  }
  return null;
}

/* ---- translations ---- */
const langs = Object.keys(LANGS);
/** Labels of a widget that lack a language: plain strings for name/desc, objects without some language. */
function i18nGaps(w) {
  const gaps = [];
  const check = (x, what, plainOk) => {
    if (x == null) return;
    if (typeof x === 'string') { if (!plainOk) gaps.push(`${what} is a plain string: write { ${langs.join(', ')} }`); return; }
    if (isLocalized(x)) { const miss = langs.filter(l => typeof x[l] !== 'string'); if (miss.length) gaps.push(`${what} lacks ${miss.join(', ')}`); }
  };
  check(w.name, 'name', false); check(w.desc, 'desc', false);
  for (const p of w.params || []) {
    check(p.label, `param ${p.key}.label`, true); check(p.help, `param ${p.key}.help`, true); check(p.placeholder, `param ${p.key}.placeholder`, true);
    for (const [v, lab] of p.options || []) check(lab, `param ${p.key} option ${v}`, true);
  }
  return gaps;
}
if (!only) {
  const en = CATALOGS.en;
  for (const l of langs.filter(l => l !== 'en')) {
    const miss = Object.keys(en).filter(k => !(k in CATALOGS[l])), extra = Object.keys(CATALOGS[l]).filter(k => !(k in en));
    if (miss.length) warn('core/i18n/' + l + '.js', 'missing keys (English is shown instead): ' + miss.join(', '));
    if (extra.length) warn('core/i18n/' + l + '.js', 'keys not in en.js: ' + extra.join(', '));
    if (!miss.length && !extra.length) out.ok.push('catalogue ' + l + ' (' + Object.keys(en).length + ' keys)');
  }
}

/* ---- config e pagine ---- */
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
if (!only) {
  for (const p of config.pages || []) {
    const file = path.join(root, p.module);
    try { await access(file); } catch (e) { err('page ' + p.id, 'missing file: ' + p.module); continue; }
    if (p.css) { try { await access(path.join(root, p.css)); } catch (e) { warn('page ' + p.id, 'missing css: ' + p.css); } }
    try {
      const mod = await import(pathToFileURL(file).href);
      const e = validatePage(mod.default, p.id);
      if (e.length) err('page ' + p.id, e.join('; ')); else out.ok.push('page ' + p.id);
    } catch (e) { err('page ' + p.id, 'import failed: ' + e.message); }
  }
}

/* ---- widget ---- */
const types = new Map();
for (const man of config.widgets || []) {
  const manPath = path.join(root, man);
  let m; try { m = JSON.parse(await readFile(manPath, 'utf8')); } catch (e) { err(man, 'manifest not readable: ' + e.message); continue; }
  for (const entry of m.widgets || []) {
    if (entry.enabled === false) continue;
    const file = path.join(path.dirname(manPath), entry.module), where = 'widget ' + entry.type + ' (' + path.relative(root, file) + ')';
    let w;
    try { w = (await import(pathToFileURL(file).href)).default; } catch (e) { err(where, 'import failed: ' + e.message); continue; }
    const ce = validateWidget(w, entry.type);
    if (ce.length) { err(where, ce.join('; ')); continue; }
    types.set(w.type, w);
    i18nGaps(w).forEach(g => warn(where, g));
    if (only && w.type !== only) continue;
    // prova su entrambi gli indici demo: basta che uno vada (alcuni widget servono solo a un tipo di dato)
    const tries = [];
    for (const index of ['ax-weblogs', 'ax-orders']) {
      const params = autofill(w, { ...(w.init || {}), index, timefield: '' }, fieldsOf(index));
      if (w.params.some(p => p.type === 'field' && !params[p.key] && (!p.show || p.show(params)))) { tries.push(index + ': no field of the required type'); continue; }
      const e = runPanel(w, params, w.defaults?.h);
      if (!e) { tries.length = 0; break; }
      tries.push(index + ': ' + e);
    }
    if (tries.length) err(where, tries.join(' | ')); else out.ok.push(where);
  }
}

/* ---- dashboard di esempio ---- */
if (!only) {
  try {
    const ex = JSON.parse(await readFile(path.join(root, 'pages/dashboard/examples.json'), 'utf8'));
    for (const d of ex) {
      const de = validateDashboard(d, types);
      if (de.length) { err('dashboard ' + d.id, de.join('; ')); continue; }
      let bad = 0;
      for (const p of d.panels) { const e = runPanel(types.get(p.type), p.params, p.h); if (e) { bad++; err('dashboard ' + d.id + ' › ' + (p.title?.en ?? p.title), e); } }
      if (!bad) out.ok.push('dashboard ' + d.id + ' (' + d.panels.length + ' panels)');
    }
  } catch (e) { warn('examples.json', e.message); }
}

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  for (const o of out.ok) console.log('  ok   ' + o);
  for (const w of out.warnings) console.log('  warn ' + w.where + ': ' + w.msg);
  for (const e of out.errors) console.log('  ERR  ' + e.where + ': ' + e.msg);
  console.log(`\n${out.ok.length} ok, ${out.warnings.length} warnings, ${out.errors.length} errors`);
}
process.exit(out.errors.length ? 1 : 0);
