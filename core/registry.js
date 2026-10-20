// Carica i widget dichiarati nei manifest (widgets/dist/index.json, widgets/custom/index.json, …).
// Ogni manifest: { "source": "dist" | "custom", "widgets": [ { "type": "...", "module": "./file.js" } ] }
// I moduli sono importati dinamicamente; un widget che non rispetta il contratto viene escluso
// e segnalato in registry.problems (visibile nella pagina Dev Tools).

import { validateWidget } from './contract.js';
import { compileWidget } from './declarative.js';

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

/**
 * Widget dichiarativi (documenti JSON, es. dall'indice dei widget): compilati e validati come gli altri.
 * Ritorna { widgets: [definizione con source 'index' e origin builtin|user], problems }.
 */
export function compileDocs(docs, where = 'index') {
  const widgets = [], problems = [];
  for (const d of docs || []) {
    try {
      const w = compileWidget(d);
      const errs = validateWidget(w, d.type);
      if (errs.length) { problems.push({ where, type: d.type, msg: errs.join('; ') }); continue; }
      widgets.push({ ...w, source: 'index', origin: d.source || 'user', doc: d });
    } catch (e) { problems.push({ where, type: d?.type, msg: e.message }); }
  }
  return { widgets, problems };
}

export function injectCss(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
}
