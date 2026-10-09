// Accesso ai dati: XERJ (o qualsiasi endpoint compatibile Elasticsearch) oppure la demo nel browser.

import { store } from './util.js';
import { demoSearch, demoIndices, demoMapping, demoRoute } from './demo/engine.js';

/** Tipo logico di un campo del mapping. */
export function kindOf(t) {
  if (t === 'date' || t === 'date_nanos') return 'date';
  if (['keyword', 'constant_keyword', 'ip', 'boolean', 'wildcard'].includes(t)) return 'keyword';
  if (['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float', 'unsigned_long'].includes(t)) return 'number';
  if (t === 'text' || t === 'match_only_text') return 'text';
  return null;
}
/** properties del mapping → [{name, type}] con sottocampi (es. message.keyword). */
export function flattenMapping(props, pre = '', out = []) {
  for (const [k, v] of Object.entries(props || {})) {
    const name = pre + k;
    if (v.properties) { flattenMapping(v.properties, name + '.', out); continue; }
    const t = kindOf(v.type); if (t) out.push({ name, type: t });
    for (const [sk, sv] of Object.entries(v.fields || {})) { const st = kindOf(sv.type); if (st) out.push({ name: name + '.' + sk, type: st }); }
  }
  return out;
}

/* Credenziali: solo per la sessione del browser (sessionStorage), mai nel localStorage.
   XERJ → { key } inviata come `ApiKey`; altri motori (Elasticsearch, OpenSearch) → { user, pass } in Basic. */
const AUTH_KEY = 'xvb.auth';
const session = {
  get() { try { const v = globalThis.sessionStorage?.getItem(AUTH_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(v) { try { if (v) globalThis.sessionStorage?.setItem(AUTH_KEY, JSON.stringify(v)); else globalThis.sessionStorage?.removeItem(AUTH_KEY); } catch (e) { /* ignorato */ } }
};
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Header Authorization per una connessione (null se non serve). */
export function authHeader(c, a) {
  if (!a || c.mode === 'demo') return null;
  if (c.mode === 'xerj') return a.key ? 'ApiKey ' + a.key : null;
  return a.user ? 'Basic ' + b64(a.user + ':' + (a.pass || '')) : null;
}

export function createBackend({ dashboardIndex = 'vega-dashboards', defaultConnection } = {}) {
  // modalità: demo | xerj | es (qualsiasi motore compatibile ES con utente e password).
  // Tutto da config.json → connection: engine (xerj → token, elasticsearch/opensearch → utente e password),
  // url, urlEditable (false = URL fisso), showUrl (false = campo nascosto, URL fisso), revealPassword (false = niente occhio),
  // demo (false = niente dati demo), engineSelectable (true = flag XERJ nel login, posizione ricordata nel browser). Nel browser restano solo URL e scelta della demo.
  const def = defaultConnection || {};
  const cfgEngine = def.engine ? (String(def.engine).toLowerCase() === 'xerj' ? 'xerj' : 'es') : (def.mode === 'es' ? 'es' : 'xerj');
  const engineSelectable = def.engineSelectable === true;
  let engine = engineSelectable ? (store.get('xvb.login.engine', cfgEngine) === 'es' ? 'es' : 'xerj') : cfgEngine;
  const urlShown = def.showUrl !== false || !def.url;
  const urlLocked = (def.urlEditable === false || !urlShown) && !!def.url;
  const demoAllowed = def.demo !== false;
  const saved = store.get('xvb.conn', null);
  let conn = {
    mode: demoAllowed && (saved ? saved.mode === 'demo' : def.mode === 'demo') ? 'demo' : engine,
    url: urlLocked ? def.url : (saved?.url || def.url || 'http://localhost:9200')
  };
  let auth = session.get() || (saved?.key || def.key ? { key: saved?.key || def.key } : null);
  if (saved?.key) store.set('xvb.conn', conn);   // vecchie versioni salvavano la key nel localStorage
  let indexCache = null;
  const fieldCache = {};

  async function http(method, path, body, ct = 'application/json', c = conn, a = auth) {
    const h = {}; if (body != null) h['content-type'] = ct;
    const ah = authHeader(c, a); if (ah) h.authorization = ah;
    const t0 = performance.now();
    const res = await fetch(c.url.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, ''), { method, headers: h, body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (res.status === 401 && c === conn) B.onUnauthorized?.();
    const txt = await res.text(); let parsed; try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }
    return { status: res.status, ok: res.ok, body: parsed, ms: Math.round(performance.now() - t0), size: txt.length };
  }
  async function api(method, path, body, ct) {
    const r = await http(method, path, body, ct);
    if (!r.ok) { const e = new Error(r.body?.error?.reason || r.body?.error?.type || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return r.body;
  }

  const B = {
    get conn() { return conn; },
    get dashboardIndex() { return dashboardIndex; },
    get auth() { return auth; },
    get loggedIn() { return !!authHeader(conn, auth); },
    isDemo: () => conn.mode === 'demo',
    /** `a` = credenziali ({ key } o { user, pass }); null le cancella. */
    get urlLocked() { return urlLocked; },
    get urlShown() { return urlShown; },
    get revealAllowed() { return def.revealPassword !== false; },
    get engine() { return engine; },
    get engineSelectable() { return engineSelectable; },
    /** Flag XERJ del login (solo con engineSelectable): 'xerj' | 'es', ricordato nel browser. */
    chooseEngine(e) { if (engineSelectable) { engine = e === 'es' ? 'es' : 'xerj'; store.set('xvb.login.engine', engine); } },
    get demoAllowed() { return demoAllowed; },
    setConnection(c, a = auth) {
      if (c.mode === 'xerj' || c.mode === 'es') B.chooseEngine(c.mode);
      conn = { mode: c.mode === 'demo' && demoAllowed ? 'demo' : engine, url: urlLocked ? def.url : c.url }; auth = a || null;
      store.set('xvb.conn', conn); session.set(auth); B.resetCaches();
    },
    logout() { auth = null; session.set(null); B.resetCaches(); },
    /** Prova una connessione senza adottarla: ritorna la risposta di GET / o lancia (e.status = 401 se rifiutata). */
    async probe(c, a) {
      if (c.mode === 'demo') return demoRoute('GET', '/').body;
      const r = await http('GET', '/', null, undefined, { ...c }, a);   // copia: un 401 qui non è una sessione scaduta
      if (!r.ok) { const e = new Error(r.body?.error?.reason || r.body?.error?.type || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      return r.body;
    },
    /** Chiamato su una risposta 401 della connessione corrente (la shell mostra il login). */
    onUnauthorized: null,
    resetCaches() { indexCache = null; for (const k in fieldCache) delete fieldCache[k]; },

    /** Richiesta grezza (Dev Tools). Ritorna {status, ok, body, ms, size}; non lancia per errori HTTP. */
    async request(method, path, body) {
      if (conn.mode === 'demo') {
        const t0 = performance.now();
        await new Promise(r => setTimeout(r, 0));
        const r = demoRoute(method, path, body);
        const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        return { status: r.status, ok: r.status < 400, body: r.body, ms: Math.max(1, Math.round(performance.now() - t0)), size: txt.length };
      }
      const nd = /(^|\/)_(msearch|bulk)(\?|$)/.test(path);
      // il browser non invia un corpo con GET/HEAD: come per ES, GET _search { … } equivale a POST
      if ((method === 'GET' || method === 'HEAD') && body != null && String(body).trim()) method = 'POST';
      return http(method, path, body == null ? null : (nd ? body : body), nd ? 'application/x-ndjson' : 'application/json');
    },
    async ping() { return B.probe(conn, auth); },
    async indices() {
      if (!indexCache) {
        try {
          indexCache = conn.mode === 'demo' ? demoIndices()
            : (await api('GET', '_cat/indices?format=json&h=index')).map(x => x.index).filter(n => n && !n.startsWith('.') && n !== dashboardIndex).sort();
        } catch (e) { indexCache = []; throw e; }
      }
      return indexCache;
    },
    /** Campi dell'indice (o pattern), in cache. Non lancia: in caso di errore ritorna []. */
    async fields(index) {
      if (!index) return [];
      if (!fieldCache[index]) {
        try {
          const r = conn.mode === 'demo' ? demoMapping(index) : await api('GET', encodeURIComponent(index) + '/_mapping');
          const seen = new Map();
          for (const m of Object.values(r)) for (const f of flattenMapping(m.mappings?.properties)) if (!seen.has(f.name)) seen.set(f.name, f);
          fieldCache[index] = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) { fieldCache[index] = []; }
      }
      return fieldCache[index];
    },
    cachedFields: index => fieldCache[index] || [],
    /** Più ricerche in una sola chiamata: [{index, body}] → [risposta | {error}]. */
    async msearch(reqs) {
      if (conn.mode === 'demo') { await new Promise(r => setTimeout(r, 0)); return reqs.map(q => demoSearch(q.index, q.body)); }
      const nd = reqs.map(q => JSON.stringify({ index: q.index }) + '\n' + JSON.stringify(q.body)).join('\n') + '\n';
      return (await api('POST', '_msearch', nd, 'application/x-ndjson')).responses;
    },
    async search(index, body) { return (await B.msearch([{ index, body }]))[0]; },

    /* Dashboard salvate: in demo nel browser, su XERJ in un indice dedicato (id = slug del titolo, upsert). */
    async listDash() {
      if (conn.mode === 'demo') return store.get('xvb.dash.demo.v4', null);
      try {
        const r = await api('POST', dashboardIndex + '/_search', { size: 200, _source: ['definition'] });
        return r.hits.hits.map(h => { try { return JSON.parse(h._source.definition); } catch (e) { return null; } }).filter(Boolean);
      } catch (e) { if (e.status === 404) return []; throw e; }
    },
    async saveDash(d, replacesId) {
      if (conn.mode === 'demo') {
        const all = store.get('xvb.dash.demo.v4', []).filter(x => x.id !== d.id && x.id !== replacesId);
        all.push(d); store.set('xvb.dash.demo.v4', all); return;
      }
      await api('PUT', dashboardIndex + '/_doc/' + encodeURIComponent(d.id) + '?refresh=true', { title: d.title, updated_at: Date.now(), definition: JSON.stringify(d) });
    },
    /** Elimina una dashboard salvata. Una dashboard mai salvata (404) non è un errore. */
    async deleteDash(id) {
      if (conn.mode === 'demo') { store.set('xvb.dash.demo.v4', store.get('xvb.dash.demo.v4', []).filter(x => x.id !== id)); return; }
      try { await api('DELETE', dashboardIndex + '/_doc/' + encodeURIComponent(id) + '?refresh=true'); }
      catch (e) { if (e.status !== 404) throw e; }
    },
    seedDemo(list) { store.set('xvb.dash.demo.v4', list); }
  };
  return B;
}
