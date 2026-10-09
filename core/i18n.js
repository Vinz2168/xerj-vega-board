// Internazionalizzazione / internationalization.
//
// Lingua: come Kibana segue il browser. Con file statici non c'è un server che legga
// l'header Accept-Language, quindi si usa navigator.languages, che contiene la stessa lista.
// Regola: la prima lingua supportata nell'elenco del browser; se nessuna, inglese.
// Si può forzare con setLang() (persistito nel browser).
//
// Due strumenti:
//   t('chiave', { var })   stringhe del core, dai cataloghi in core/i18n/<lang>.js
//   L(x)                   etichette dei widget: x è una stringa (uguale in ogni lingua)
//                          oppure { en: '…', it: '…' }; se manca la lingua corrente usa en.
// Importabile anche da Node (validate.mjs): senza navigator la lingua è en.

import en from './i18n/en.js';
import it from './i18n/it.js';

export const CATALOGS = { en, it };
export const LANGS = { en: 'English', it: 'Italiano' };
export const DEFAULT_LANG = 'en';
const LOCALES = { en: 'en-GB', it: 'it-IT' };
const KEY = 'xvb.lang';

function stored() { try { return globalThis.localStorage?.getItem(KEY) || null; } catch (e) { return null; } }

/** Prima lingua supportata tra quelle preferite dal browser (o forzate). */
export function detectLang(prefs = globalThis.navigator?.languages || [globalThis.navigator?.language].filter(Boolean)) {
  const forced = stored();
  if (forced && CATALOGS[forced]) return forced;
  for (const p of prefs || []) { const base = String(p).toLowerCase().split('-')[0]; if (CATALOGS[base]) return base; }
  return DEFAULT_LANG;
}

let lang = detectLang();
export const getLang = () => lang;
/** Locale BCP 47 per Intl (numeri, date). */
export const locale = () => LOCALES[lang] || 'en-GB';
/** Forza una lingua (null = torna al browser). La shell ricarica la pagina dopo il cambio. */
export function setLang(l) {
  try { if (l) globalThis.localStorage?.setItem(KEY, l); else globalThis.localStorage?.removeItem(KEY); } catch (e) { /* ignorato */ }
  lang = detectLang();
  if (globalThis.document) globalThis.document.documentElement.lang = lang;
}
export const isForced = () => !!stored();

/** Stringa del catalogo, con {variabili}. Chiave mancante → inglese → chiave stessa (visibile, così si nota). */
export function t(key, vars) {
  const s = CATALOGS[lang]?.[key] ?? CATALOGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
}
/** Etichetta localizzata: stringa o { en, it, … }. */
export function L(x) {
  if (x == null || typeof x !== 'object' || Array.isArray(x)) return x;
  return x[lang] ?? x.en ?? Object.values(x)[0];
}
/** true se il valore è un oggetto di traduzioni. */
export const isLocalized = x => !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.en === 'string';

if (globalThis.document) globalThis.document.documentElement.lang = lang;
