// Dati sintetici per la modalità demo: generati nel browser (o in Node) con un seed fisso.

export const DEMO_MAP = {
  'ax-weblogs': {
    '@timestamp': { type: 'date' }, host: { type: 'keyword' }, method: { type: 'keyword' }, path: { type: 'keyword' },
    status: { type: 'keyword' }, country: { type: 'keyword' }, bytes: { type: 'long' }, response_ms: { type: 'float' }, message: { type: 'text' }
  },
  'ax-orders': {
    order_date: { type: 'date' }, order_id: { type: 'keyword' }, status: { type: 'keyword' }, category: { type: 'keyword' },
    country: { type: 'keyword' }, items: { type: 'integer' }, total: { type: 'double' }
  }
};

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

let DATA = null;

/** { indice: [documenti] }. I documenti hanno un `_id` non enumerabile. Timestamp in epoch ms. */
export function demoData() {
  if (DATA) return DATA;
  const r = rng(20261008), now = Date.now(), D = 864e5, span = 30 * D;
  const pick = arr => { let tot = 0; for (const [, w] of arr) tot += w; let x = r() * tot; for (const [v, w] of arr) { if ((x -= w) <= 0) return v; } return arr[arr.length - 1][0]; };
  const hosts = [['web-1', 30], ['web-2', 30], ['api-1', 18], ['api-2', 14], ['cdn-edge', 8]];
  const paths = [['/', 22], ['/prodotti', 16], ['/carrello', 9], ['/checkout', 6], ['/login', 7], ['/static/app.js', 10], ['/static/style.css', 6], ['/favicon.ico', 2]];
  const apiPaths = [['/api/v1/search', 50], ['/api/v1/orders', 25], ['/api/v1/cart', 15], ['/api/v1/auth', 10]];
  const countries = [['IT', 44], ['DE', 14], ['FR', 11], ['ES', 8], ['US', 10], ['NL', 6], ['GB', 7]];
  const methods = [['GET', 74], ['POST', 18], ['PUT', 5], ['DELETE', 3]];
  const stN = [['200', 80], ['304', 6], ['301', 3], ['404', 7], ['500', 3], ['503', 1]];
  const stI = [['200', 38], ['500', 40], ['503', 18], ['404', 4]];
  const errMsg = {
    '500': [['upstream timeout contacting search-backend', 5], ['database pool exhausted, 0 of 40 connections free', 3], ['NullPointerException in OrderService.price()', 2]],
    '503': [['circuit breaker open for search-backend', 3], ['service unavailable: shard not allocated', 1]],
    '404': [['resource not found', 4], ['product id not found in catalogue', 2]]
  };
  // Incidente simulato: due giorni fa dalle 14:00, api-2 restituisce 5xx e rallenta.
  const d0 = new Date(now - 2 * D); d0.setHours(14, 0, 0, 0);
  const incFrom = d0.getTime(), incTo = incFrom + 2.5 * 36e5;
  const mk = (t, inc) => {
    let host = pick(hosts); if (inc && r() < 0.5) host = 'api-2';
    const api = host.startsWith('api');
    const path = api ? pick(apiPaths) : pick(paths);
    const status = inc && host === 'api-2' ? pick(stI) : pick(stN);
    let ms = (api ? 85 : 35) * Math.exp(r() * 1.1) + (r() < 0.04 ? r() * 900 : 0);
    if (inc && host === 'api-2') ms *= 4.5;
    const method = path.startsWith('/static') ? 'GET' : pick(methods);
    ms = Math.round(ms * 10) / 10;
    const message = errMsg[status] ? `${method} ${path} failed with ${status}: ${pick(errMsg[status])} after ${ms} ms`
      : ms > 600 ? `${method} ${path} slow request: ${ms} ms on ${host}` : `${method} ${path} ${status} in ${ms} ms`;
    return { '@timestamp': Math.round(t), host, method, path, status, country: pick(countries), bytes: Math.round(600 + Math.exp(r() * 10.2)), response_ms: ms, message };
  };
  const web = [];
  while (web.length < 26000) {
    const t = now - r() * span, d = new Date(t), hr = d.getHours() + d.getMinutes() / 60;
    const w = (0.16 + 0.84 * Math.pow(Math.max(0, Math.sin((hr - 5) / 19 * Math.PI)), 1.4)) * (d.getDay() % 6 === 0 ? 0.7 : 1);
    if (r() > w) continue;
    web.push(mk(t, t >= incFrom && t <= incTo));
  }
  for (let i = 0; i < 900; i++) web.push(mk(incFrom + r() * (incTo - incFrom), true));

  const cats = [['Elettronica', 22, 60, 900], ['Casa', 20, 15, 220], ['Libri', 18, 8, 40], ['Sport', 14, 20, 260], ['Moda', 16, 18, 180], ['Giochi', 10, 10, 90]];
  const orders = [];
  let i = 0;
  while (orders.length < 3800) {
    const t = now - r() * span, hr = new Date(t).getHours();
    const w = 0.12 + 0.88 * Math.pow(Math.max(0, Math.sin((hr - 7) / 17 * Math.PI)), 1.2) * (hr >= 19 && hr <= 22 ? 1 : 0.75);
    if (r() > w) continue;
    const c = pick(cats.map(x => [x, x[1]]));
    const items = 1 + Math.floor(Math.pow(r(), 2.2) * 6);
    const price = c[2] + Math.pow(r(), 2) * (c[3] - c[2]);
    orders.push({ order_date: Math.round(t), order_id: 'ORD-' + (204100 + i++), status: pick([['completato', 80], ['in attesa', 9], ['rimborsato', 7], ['annullato', 4]]), category: c[0], country: pick(countries), items, total: Math.round(items * price * 100) / 100 });
  }
  web.forEach((d, n) => Object.defineProperty(d, '_id', { value: 'w' + n.toString(36) }));
  orders.forEach((d, n) => Object.defineProperty(d, '_id', { value: 'o' + n.toString(36) }));
  DATA = { 'ax-weblogs': web, 'ax-orders': orders };
  return DATA;
}
