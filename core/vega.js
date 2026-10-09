// Integrazione con Vega/Vega-Lite (caricati come globali da CDN in index.html).

import { getLang } from './i18n.js';

let pendingBrush = null, brushedAt = 0, onBrush = null;

/** Formati numerici e nomi di mesi/giorni di Vega nella lingua attiva (l'inglese è il default di Vega). */
export function setLocale() {
  const vega = globalThis.vega; if (!vega || getLang() !== 'it') return;
  try {
    vega.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['', ' €'] });
    vega.timeFormatLocale({ dateTime: '%A %e %B %Y, %X', date: '%d/%m/%Y', time: '%H:%M:%S', periods: ['AM', 'PM'],
      days: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'], shortDays: ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'],
      months: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
      shortMonths: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'] });
  } catch (e) { /* versioni senza locale API */ }
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Colori correnti letti dai token CSS: i widget li ricevono in ctx.theme. */
export function theme() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  return { fg: g('--fg'), muted: g('--muted'), line: g('--line'), sunk: g('--sunk'), surface: g('--surface'), other: g('--c-other'),
    accent: g('--accent'), danger: g('--danger'), ok: g('--ok'), warn: g('--warn'),
    c: [1, 2, 3, 4, 5, 6].map(i => g('--c' + i)), font: 'IBM Plex Sans, system-ui, sans-serif', mono: 'IBM Plex Mono, ui-monospace, monospace' };
}
export function vegaConfig(t) {
  return { background: null, font: t.font, view: { stroke: null },
    axis: { labelColor: t.muted, titleColor: t.muted, gridColor: t.line, gridDash: [2, 3], domainColor: t.line, tickColor: t.line, labelFont: t.mono, labelFontSize: 10.5, titleFont: t.font, titleFontWeight: 500 },
    legend: { labelColor: t.fg, titleColor: t.muted, labelFont: t.font, labelFontSize: 11, symbolType: 'circle', symbolSize: 64 },
    range: { category: t.c }, text: { color: t.fg }, mark: { color: t.c[0] } };
}

/** Registra chi riceve gli intervalli selezionati col brush (la shell → filtro temporale). */
export function setBrushHandler(fn) { onBrush = fn; }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', () => {
    if (!pendingBrush) return;
    const [a, b] = pendingBrush; pendingBrush = null;
    if (b - a < 6e4 || !onBrush) return;
    brushedAt = Date.now();
    setTimeout(() => onBrush(Math.round(a), Math.round(b)), 0);
  }, true);
}

/**
 * Disegna una spec Vega-Lite in `el`. Opzioni: onClick(datum) per i filtri incrociati.
 * Il segnale "brush" (kit.brushParam) è collegato automaticamente al filtro temporale.
 * Ritorna la view (da finalizzare con view.finalize() quando il pannello sparisce).
 */
export async function embed(el, spec, { onClick } = {}) {
  const t = theme();
  const host = document.createElement('div'); host.style.width = '100%';
  // nel documento prima del disegno: con width "container" Vega-Lite misura il contenitore all'avvio
  // (in un nodo staccato varrebbe 0 e il grafico resterebbe invisibile fino a un resize della finestra)
  el.innerHTML = ''; el.appendChild(host);
  const res = await globalThis.vegaEmbed(host, spec, { actions: false, renderer: 'svg', config: vegaConfig(t), tooltip: { theme: isDark() ? 'dark' : 'light' } });
  const view = res.view;
  if (onClick) view.addEventListener('click', (ev, item) => {
    if (Date.now() - brushedAt < 500) return;
    const d = item && item.datum; if (d) onClick(d);
  });
  try {
    view.addSignalListener('brush', (n, v) => {
      const r = v && (v.t || Object.values(v)[0]);
      pendingBrush = Array.isArray(r) && r.length === 2 ? [+r[0], +r[1]] : null;
    });
  } catch (e) { /* spec senza brush */ }
  return view;
}
