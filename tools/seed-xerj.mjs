// Carica i dati sintetici della modalità demo (core/demo/data.js) su un nodo XERJ/ES.
// Uso: node tools/seed-xerj.mjs [url]   (default http://localhost:9200)
// Per ogni indice: DELETE (se esiste) → PUT con il mapping di DEMO_MAP → _bulk a blocchi di 2000 → _refresh → _count.
// I campi date passano da epoch ms a ISO 8601; doc._id (non enumerabile) diventa l'_id.
// I timestamp sono relativi a "adesso": se il test si rilancia un altro giorno, rilanciare questo script.
// SEED_NOW=<epoch ms> fissa l'istante "adesso" del generatore (stessi documenti in seed e confronti col motore demo);
// quello usato viene scritto in test-out/seed-now.txt.
import { writeFileSync, mkdirSync } from 'node:fs';
import { demoData, DEMO_MAP } from '../core/demo/data.js';

const URL_ = (process.argv[2] || 'http://localhost:9200').replace(/\/$/, '');
const CHUNK = 2000;

async function req(method, path, body, ctype = 'application/json') {
  const r = await fetch(URL_ + path, { method, headers: body ? { 'content-type': ctype } : {}, body });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

const NOW = process.env.SEED_NOW ? +process.env.SEED_NOW : Date.now();
const realNow = Date.now; Date.now = () => NOW;
const data = demoData();
Date.now = realNow;
mkdirSync(new URL('../test-out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../test-out/seed-now.txt', import.meta.url), String(NOW) + '\n');
console.log('seed now =', NOW, new Date(NOW).toISOString());
const summary = [];
let failed = false;

for (const [index, props] of Object.entries(DEMO_MAP)) {
  const docs = data[index];
  const dateFields = Object.keys(props).filter(k => props[k].type === 'date');

  const del = await req('DELETE', '/' + index);
  console.log(`DELETE /${index} → ${del.status}`);
  const put = await req('PUT', '/' + index, JSON.stringify({ mappings: { properties: props } }));
  console.log(`PUT /${index} → ${put.status} ${JSON.stringify(put.json)}`);
  if (put.status >= 300) { failed = true; continue; }

  let errors = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const lines = [];
    for (const d of docs.slice(i, i + CHUNK)) {
      const src = { ...d };
      for (const f of dateFields) if (typeof src[f] === 'number') src[f] = new Date(src[f]).toISOString();
      lines.push(JSON.stringify({ index: { _index: index, _id: d._id } }), JSON.stringify(src));
    }
    const b = await req('POST', '/_bulk', lines.join('\n') + '\n', 'application/x-ndjson');
    const errs = b.json?.items?.filter(it => (it.index || it.create)?.error) || [];
    errors += errs.length;
    console.log(`_bulk ${index} [${i}..${i + lines.length / 2}) → ${b.status} errors=${b.json?.errors} (${errs.length})`
      + (errs.length ? ' first: ' + JSON.stringify(errs[0]) : ''));
    if (b.status >= 300) { failed = true; console.log(JSON.stringify(b.json).slice(0, 500)); }
  }

  await req('POST', `/${index}/_refresh`);
  const c = await req('GET', `/${index}/_count`);
  const ok = c.json?.count === docs.length;
  if (!ok) failed = true;
  summary.push({ index, expected: docs.length, count: c.json?.count, bulkErrors: errors, ok });
}

const cat = await req('GET', '/_cat/indices?v');
console.log('\n' + (typeof cat.json === 'string' ? cat.json : JSON.stringify(cat.json, null, 1)));
console.table(summary);
process.exit(failed ? 1 : 0);
