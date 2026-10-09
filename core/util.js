// Utilità pure, senza dipendenze dal DOM al momento dell'import (usabili anche da Node).
// Numeri e date seguono la lingua attiva (core/i18n.js).

import { locale, t } from './i18n.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Math.random().toString(36).slice(2, 9);
export const slug = s => (s || 'dashboard').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard';
export const clone = o => JSON.parse(JSON.stringify(o));

/** localStorage tollerante: in finestre private o anteprime può mancare o lanciare. */
export const store = {
  get(k, d) { try { const v = globalThis.localStorage?.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, JSON.stringify(v)); } catch (e) { /* ignorato */ } }
};

/** Legge "a.b.c" da un oggetto; prova prima la chiave letterale (campi con il punto nel nome). */
export const getPath = (o, p) => { if (!p) return o; if (o && p in o) return o[p]; return p.split('.').reduce((a, k) => a == null ? a : a[k], o); };

/** Confronto con wildcard `*`, case-insensitive. */
export const wild = (s, p) => {
  if (!String(p).includes('*')) return String(s).toLowerCase() === String(p).toLowerCase();
  const re = new RegExp('^' + String(p).split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(String(s));
};

export function fmtNum(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: a < 10 ? 2 : a < 1000 ? 1 : 0 }).format(v);
}
export function fmtDate(v) {
  const d = new Date(typeof v === 'number' ? v : Date.parse(v));
  if (isNaN(d)) return String(v);
  return d.toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export const shortDT = ms => new Date(ms).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const toLocalInput = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
export const totalHits = r => { const t = r?.hits?.total; return typeof t === 'number' ? t : (t?.value ?? 0); };

/** Evidenziazione: i motori restituiscono i frammenti con i tag sentinella \u0002 … \u0003. */
export const HL_PRE = '\u0002', HL_POST = '\u0003';
export const hlHtml = s => esc(s).replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>');

const timers = {};
export const debounce = (k, fn, ms) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };
export const cancelDebounce = k => clearTimeout(timers[k]);

export const vAttr = v => encodeURIComponent(JSON.stringify(v));
export const vRead = s => JSON.parse(decodeURIComponent(s));

/** <option> con il valore corrente selezionato; se il valore non è in lista lo mostra come "(non trovato)". */
export const opts = (list, v) => {
  const has = list.some(([k]) => String(k) === String(v));
  const l = has || v == null || v === '' ? list : [[v, t('common.notFound', { v })], ...list];
  return l.map(([k, lab]) => `<option value="${esc(k)}"${String(k) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('');
};
