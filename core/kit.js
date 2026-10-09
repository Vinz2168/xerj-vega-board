// Toolkit per chi scrive widget (umani o agent). Importabile anche da Node: niente DOM a livello di modulo.
// Un widget importa da qui con:  import * as kit from '../../core/kit.js';

export { esc, fmtNum, fmtDate, getPath, hlHtml, totalHits, HL_PRE, HL_POST } from './util.js';
// Testi dei widget: scrivi ogni etichetta come { en: '…', it: '…' } (o una stringa se è uguale in tutte le lingue).
// Nel form le risolve la shell; dentro rows/spec/render usa kit.L(...) per ottenere la stringa nella lingua attiva.
export { L, getLang } from './i18n.js';
import { L } from './i18n.js';

/* ---- parametri riusabili (vedi AGENTS.md → "Parametri") ---- */
export const P = {
  index: { key: 'index', label: { en: 'Index', it: 'Indice' }, type: 'index' },
  time: { key: 'timefield', label: { en: 'Time field', it: 'Campo tempo' }, type: 'field', ftype: 'date' },
  filter: { key: 'filter', label: { en: 'Panel filter', it: 'Filtro del pannello' }, type: 'text',
    placeholder: { en: 'e.g. status:5* AND host:api-*', it: 'es. status:5* AND host:api-*' },
    help: { en: 'Query string applied to this panel only.', it: 'Query string aggiunta solo a questo pannello.' } },
  interval: { key: 'interval', label: { en: 'Interval', it: 'Intervallo' }, type: 'select',
    options: [['auto', { en: 'Automatic', it: 'Automatico' }], ['5m', { en: '5 minutes', it: '5 minuti' }], ['15m', { en: '15 minutes', it: '15 minuti' }], ['1h', { en: '1 hour', it: '1 ora' }], ['1d', { en: '1 day', it: '1 giorno' }]] },
  size: (label = { en: 'Rows', it: 'Righe' }, min = 2, max = 25) => ({ key: 'size', label, type: 'number', min, max })
};

/**
 * Colore categoriale di un valore. In dashboard viene dalla mappa colori salvata con la dashboard (ctx.color):
 * stabile tra pannelli, filtri e ricariche, e modificabile dall'editor. Fuori (validatore, anteprime) per posizione `i`.
 * Ritorna theme.other quando la palette è esaurita: il valore va trattato come "Altro".
 */
export const colorOf = (c, field, value, i = 0) => c.color ? c.color(field, value) : c.theme.c[i % c.theme.c.length];

/** Funzioni di metrica per i select: [valore, etichetta localizzata]. */
export const FN = [['count', { en: 'Document count', it: 'Conteggio documenti' }], ['avg', { en: 'Average', it: 'Media' }], ['sum', { en: 'Sum', it: 'Somma' }], ['max', { en: 'Maximum', it: 'Massimo' }], ['min', { en: 'Minimum', it: 'Minimo' }]];
export const FN_LABEL = Object.fromEntries([...FN, ['cardinality', { en: 'Distinct values', it: 'Valori distinti' }], ['p50', { en: 'Median', it: 'Mediana' }], ['p95', { en: '95th percentile', it: '95° percentile' }], ['p99', { en: '99th percentile', it: '99° percentile' }]]);
/** Nome della funzione nella lingua attiva (per tooltip e sottotitoli). */
export const fnLabel = fn => L(FN_LABEL[fn]) ?? fn;
/** Etichette comuni nei tooltip. */
export const LABELS = { docs: { en: 'Documents', it: 'Documenti' }, from: { en: 'From', it: 'Da' } };

/** Sotto-aggregazione `m` per una funzione: null per il conteggio. Supporta pNN come percentile. */
export function metricAgg(fn, field) {
  if (!fn || fn === 'count') return null;
  const p = /^p(\d{1,2})$/.exec(fn);
  if (p) return { m: { percentiles: { field, percents: [+p[1]] } } };
  return { m: { [fn]: { field } } };
}
/** Valore della metrica da un bucket (o dalle aggregations di primo livello). */
export function metricValue(b, fn, totalForCount) {
  if (!fn || fn === 'count') return totalForCount ?? b?.doc_count ?? 0;
  const m = b?.m; if (!m) return null;
  if (m.values) { const v = Object.values(m.values)[0]; return v ?? null; }
  return m.value ?? null;
}

/** date_histogram con bucket vuoti inclusi, allineato all'intervallo del contesto. */
export const dateHisto = (field, c) => ({ date_histogram: { field, fixed_interval: c.iv[0], min_doc_count: 0, extended_bounds: { min: c.tr.from, max: c.tr.to } } });

/* ---- Vega-Lite ---- */
export const baseSpec = h => ({ $schema: 'https://vega.github.io/schema/vega-lite/v5.json', width: 'container', height: h, autosize: { type: 'fit', contains: 'padding' } });
export const tipTime = { field: 't', type: 'temporal', title: L(LABELS.from), format: '%d %b %H:%M' };
/**
 * Selezione a intervallo sull'asse x chiamata "brush": la shell la ascolta e, al rilascio,
 * restringe il filtro temporale globale. Mettila nei `params` di un grafico con x temporale su campo `t`.
 */
export const brushParam = t => ({ name: 'brush', select: { type: 'interval', encodings: ['x'], mark: { fill: t.c[0], fillOpacity: 0.12, stroke: t.c[0], strokeOpacity: 0.55 } } });
export const timeX = { field: 't', type: 'temporal', title: null, axis: { tickCount: 6, labelOverlap: true } };
