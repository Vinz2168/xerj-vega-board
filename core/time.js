// Intervalli di tempo relativi/assoluti e scelta dell'intervallo degli istogrammi.

export const RANGES = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };
// Etichette in core/i18n: time.last.<chiave> (es. time.last.7d) e time.short.<chiave> per i pulsanti.

/** Intervalli ammessi per date_histogram.fixed_interval, dal più fine al più largo. */
export const IV = [['1m', 6e4], ['5m', 3e5], ['15m', 9e5], ['30m', 18e5], ['1h', 36e5], ['3h', 108e5], ['6h', 216e5], ['12h', 432e5], ['1d', 864e5], ['7d', 6048e5]];
export const ivMs = l => (IV.find(x => x[0] === l) || [])[1];

/** Il più piccolo intervallo che produce al massimo `target` bucket. Ritorna [etichetta, ms]. */
export const autoIv = (span, target) => IV.find(([, ms]) => ms >= span / target) || IV[IV.length - 1];

/** Intervallo scelto dall'utente se sensato, altrimenti automatico. */
export function pickIv(interval, tr, target = 40) {
  const span = tr.to - tr.from;
  if (interval && interval !== 'auto' && ivMs(interval) && span / ivMs(interval) <= 1500) return [interval, ivMs(interval)];
  return autoIv(span, target);
}

export const isAbs = t => !!t && typeof t === 'object';

/** Valore di tempo ('7d' oppure {from,to}) → {from,to} in epoch ms. */
export function toRange(t, now = Date.now()) {
  if (isAbs(t)) return { from: t.from, to: t.to };
  return { from: now - (RANGES[t] || RANGES['7d']), to: now };
}
