// Caso minimo: vegaEmbed con width "container" in un nodo staccato dal DOM (come core/vega.js) → larghezza 0 fino a un resize.
// Uso (proxy su :8080 attivo): PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node test-out/repro/vega-detached.mjs
import { chromium } from '../../node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await p.goto('http://localhost:8080/index.html'); await p.waitForFunction(() => window.vegaEmbed);
const r = await p.evaluate(async () => {
  const spec = { width: 'container', height: 100, autosize: { type: 'fit', contains: 'padding' }, data: { values: [{ k: 'a', v: 3 }, { k: 'b', v: 5 }] }, mark: 'bar', encoding: { y: { field: 'k', type: 'nominal' }, x: { field: 'v', type: 'quantitative' } } };
  const box = () => { const d = document.createElement('div'); d.style.width = '600px'; document.body.prepend(d); return d; };
  const w = el => Math.round(el.querySelector('svg').getBoundingClientRect().width);
  // A: come core/vega.js → embed in un nodo staccato, poi appendChild
  const a = box(); const hostA = document.createElement('div'); hostA.style.width = '100%';
  await vegaEmbed(hostA, spec, { actions: false, renderer: 'svg' }); a.appendChild(hostA);
  await new Promise(r => setTimeout(r, 300)); const A = w(a);
  // B: host attaccato prima dell'embed
  const bb = box(); const hostB = document.createElement('div'); hostB.style.width = '100%'; bb.appendChild(hostB);
  await vegaEmbed(hostB, spec, { actions: false, renderer: 'svg' }); await new Promise(r => setTimeout(r, 300)); const B = w(bb);
  window.dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 300));
  return { detachedThenAppended: A, attachedBefore: B, detachedAfterResize: w(a) };
});
console.log(JSON.stringify(r)); await b.close();
