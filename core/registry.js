// Carica i widget dichiarati nei manifest (widgets/dist/index.json, widgets/custom/index.json, …).
// Ogni manifest: { "source": "dist" | "custom", "widgets": [ { "type": "...", "module": "./file.js" } ] }
// I moduli sono importati dinamicamente; un widget che non rispetta il contratto viene escluso
// e segnalato in registry.problems (visibile nella pagina Dev Tools).

import { validateWidget } from './contract.js';

export async function loadWidgets(manifestUrls, base = location.href) {
  const widgets = new Map(), problems = [];
  for (const rel of manifestUrls) {
    const url = new URL(rel, base);
    let man;
    try { man = await (await fetch(url)).json(); }
    catch (e) { problems.push({ where: rel, msg: 'manifest not readable: ' + e.message }); continue; }
    const source = man.source || (rel.includes('custom') ? 'custom' : 'dist');
    for (const entry of man.widgets || []) {
      if (entry.enabled === false) continue;
      const modUrl = new URL(entry.module, url).href;
      try {
        const mod = await import(modUrl);
        const w = mod.default;
        const errs = validateWidget(w, entry.type);
        if (errs.length) { problems.push({ where: entry.module, type: entry.type, msg: errs.join('; ') }); continue; }
        if (widgets.has(w.type) && source !== 'custom') { problems.push({ where: entry.module, type: w.type, msg: 'type already registered, ignored' }); continue; }
        // Un widget custom con lo stesso type sostituisce quello standard: è il modo previsto per personalizzarlo.
        widgets.set(w.type, { ...w, source, module: modUrl, overrides: widgets.has(w.type) });
        if (w.css) injectCss('w-' + w.type, w.css);
      } catch (e) {
        problems.push({ where: entry.module, type: entry.type, msg: 'import failed: ' + e.message });
      }
    }
  }
  return { widgets, problems };
}

export function injectCss(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
}
