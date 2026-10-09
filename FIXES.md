# FIXES — bug della board trovati durante il test di compatibilità con XERJ

Correzioni **proposte e non applicate** (tranne B1 e B6, applicate dopo il test: vedi sotto) (le regole del test vietano di modificare `core/`, `pages/`, `widgets/`).
Le difformità di XERJ rispetto a Elasticsearch non sono qui: vanno corrette in XERJ e sono in `REPORT.md` (§4).

---

## B1 — I grafici Vega restano vuoti (larghezza 0) finché la finestra non viene ridimensionata

> **Applicata il 9 ottobre 2026**, su richiesta, dopo la chiusura del test di compatibilità (`core/vega.js`, funzione `embed`:
> `host` viene agganciato a `el` prima di `vegaEmbed`). Verifica: `node tools/validate.mjs` → 16 ok, 0 errori;
> `tools/e2e-xerj.mjs --only dashboard` su XERJ, demo e OpenSearch → tutti i pannelli `drawn` già «as rendered», anche dopo il
> ricaricamento; istogramma di Discover largo 1050 px senza resize. Le altre voci (B2–B6) restano non applicate.

**Gravità: alta.** Riguarda tutti i pannelli Vega-Lite (metric, bullet, stacked, donut, heatmap, topn, timeseries, vegalite)
e l'istogramma di Discover. Succede **anche in modalità demo**, quindi non dipende da XERJ.

**Sintomo.** Dopo un cambio di intervallo, un cambio di dashboard o un ricaricamento, i pannelli mostrano l'intestazione
(«6844 doc · 9 ms») ma il corpo è vuoto. Basta ridimensionare la finestra e i grafici compaiono.
Il primo disegno dopo «Applica» a volte si vede e a volte no: dipende da una gara con il `resize` che la dashboard
emette 120 ms dopo una variazione della griglia (`pages/dashboard/index.js:42`).

**Prove.**
- `test-out/screenshots/dash-*-as-rendered.png` (vuoti) contro `dash-*.png` (dopo `resize`), su XERJ e in `test-out/demo/screenshots/`.
- `test-out/e2e-results.json` → `dashboards[].asRendered[].svgW = 0`, `panels[].svgW > 0` dopo il resize;
  Discover: `discover.base.histW = 0`, `discover.baseAfterResize.histW = 1050`.
- Caso minimo senza la board: `test-out/repro/vega-detached.mjs` → `{"detachedThenAppended":0,"attachedBefore":600,"detachedAfterResize":600}`.

**Causa.** `core/vega.js:56-59`: la spec usa `width: "container"` (`kit.baseSpec`), ma `vegaEmbed` disegna in un `div`
creato e **non ancora nel documento**. Vega-Lite legge la larghezza del contenitore all'avvio (0 in un nodo staccato) e la
rilegge solo sull'evento `window:resize`.

**Correzione proposta** (`core/vega.js`, funzione `embed`): agganciare `host` prima di disegnare.

```diff
 export async function embed(el, spec, { onClick } = {}) {
   const t = theme();
   const host = document.createElement('div'); host.style.width = '100%';
-  const res = await globalThis.vegaEmbed(host, spec, { actions: false, renderer: 'svg', config: vegaConfig(t), tooltip: { theme: isDark() ? 'dark' : 'light' } });
-  el.innerHTML = ''; el.appendChild(host);
+  el.innerHTML = ''; el.appendChild(host);   // nel documento prima del disegno: width "container" misura la larghezza vera
+  const res = await globalThis.vegaEmbed(host, spec, { actions: false, renderer: 'svg', config: vegaConfig(t), tooltip: { theme: isDark() ? 'dark' : 'light' } });
   const view = res.view;
```

Se si vuole evitare lo sfarfallio (il vecchio grafico sparisce prima che il nuovo sia pronto), in alternativa:
agganciare `host` con `visibility:hidden; position:absolute; inset:0` accanto al vecchio contenuto e, a disegno finito,
togliere il vecchio e rendere visibile `host`. Il `window.dispatchEvent(new Event('resize'))` di
`pages/dashboard/index.js:42` resta utile per i cambi di larghezza dei pannelli.

**Verifica dopo la correzione.** `PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node tools/e2e-xerj.mjs` (e con `--demo`):
le righe `as rendered` devono essere tutte `drawn`.

---

## B2 — Motore demo: niente evidenziazione quando la query sta in `bool.filter` (Discover)

**Gravità: bassa** (solo demo). In demo, Discover con una query (es. `timeout`) non mostra mai `<mark>`.

**Causa.** `core/demo/engine.js:156`: l'highlight (e lo score) si calcolano solo dal `query_string` dentro `bool.must`;
Discover costruisce la query con `buildQuery()` (`core/query.js:11`), che mette la query string in `bool.filter`.
Elasticsearch e XERJ evidenziano anche le clausole in filter (verificato su XERJ: `test-out/compare/check-highlight-con-query-in-bool-filter-discover.json`).

**Correzione proposta.** In `demoSearch`, cercare il `query_string` sia in `must` che in `filter`:

```diff
-      const sq = [].concat(body.query?.bool?.must || []).find(x => x.query_string)?.query_string;
+      const sq = [].concat(body.query?.bool?.must || [], body.query?.bool?.filter || []).find(x => x.query_string)?.query_string;
```

(Lo score resterebbe calcolato anche per le clausole filter: in ES non contano per lo score. Se serve fedeltà,
usare `sq` del filter solo per l'highlight.)

---

## B3 — Motore demo: `OR` nella query string viene trattato come un termine

**Gravità: bassa** (solo demo; la board usa `default_operator: AND`, ma l'utente può scrivere `OR`).
`bytes:abc OR timeout` → demo 0 risultati, XERJ 467 (`test-out/compare/checks.json`, check «query_string lenient true»).

**Causa.** `qsMatch` (`core/demo/engine.js:26-49`) salta solo `AND`/`NOT`; `OR` diventa testo libero «or» obbligatorio.

**Correzione proposta.** Gestire almeno `OR` di primo livello: dividere i token sui `OR` e restituire vero se almeno un gruppo
è soddisfatto (ogni gruppo valutato con la logica AND attuale). Oppure, se non si vuole supportarlo, lanciare
`throw new Error('query not supported by the demo engine: OR')`, coerente con la regola «errori espliciti» di AGENTS.md.

---

## B4 — Motore demo: `terms` ordinato su una metrica a più valori viene ignorato senza errore

**Gravità: bassa.** `order: {"m.95": "desc"}` con `m` = `percentiles`: la demo usa `x["m.95"]?.value` → `-Infinity`
per tutti i bucket e ricade sul `doc_count`. Nessun widget standard lo usa (topn ordina solo per count/avg/sum/max),
ma il widget «Vega-Lite libero» può.

**Correzione proposta** (`core/demo/engine.js:97`): risolvere il percorso `agg.chiave` / `agg[chiave]` su `values`, oppure
lanciare un errore esplicito «order path not supported by the demo engine».

---

## B5 — Conteggi «10.000 doc» mostrati come esatti quando il motore restituisce `relation: "gte"`

**Gravità: bassa.** Con 30 giorni, i pannelli che non chiedono `track_total_hits` (stacked, donut, topn, timeseries,
heatmap, table) mostrano nell'intestazione «10.000 doc», mentre i documenti sono 26.887. È il comportamento standard di
Elasticsearch (limite di 10.000 per default) e XERJ lo rispetta; il motore demo invece conta sempre tutto, per cui in demo il
problema non si vede.

**Causa.** `core/util.js:43` (`totalHits`) restituisce solo `value`; `pages/dashboard/index.js:250` lo stampa così com'è.

**Correzione proposta.** Esporre anche la relazione e mostrarla: per esempio una `totalRel(r)` in `util.js` e, nella meta del
pannello, `(rel === 'gte' ? '≥ ' : '') + fmtNum(total)`. In alternativa (più costosa) aggiungere `track_total_hits: true`
alle query dei widget. Per coerenza, il motore demo potrebbe applicare lo stesso limite di 10.000 quando `track_total_hits`
non è indicato.

---

## B6 — L'id di una dashboard salvata dipende dalla lingua dell'interfaccia

> **Applicata il 9 ottobre 2026**, su richiesta, insieme a un bug collegato emerso dopo: **rinominare** una dashboard già salvata
> creava un documento nuovo (id = slug del nuovo titolo) e lasciava il vecchio, quindi dopo un ricaricamento la dashboard compariva due volte.
> Ora l'id si calcola dal titolo solo per una dashboard nuova (id provvisorio `dashboard-…`); poi resta fisso e rinominare cambia solo il titolo.
> Nella stessa modifica: pulsante «Elimina» per le dashboard (in modalità «Modifica», con conferma e toast «Annulla» che la risalva,
> `backend.deleteDash(id)`), e conferma prima di rimuovere un pannello (`ui.confirm`). Verificato su OpenSearch 3.9.0 e in demo.

**Gravità: bassa.** Salvando l'esempio `web-traffic` con l'interfaccia in italiano l'id diventa `traffico-web`
(`slug(dash.title)` con il titolo già localizzato, `pages/dashboard/index.js:117`); in inglese diventerebbe `web-traffic`.
La stessa dashboard salvata da due utenti con lingue diverse crea due documenti in `vega-dashboards`.

**Correzione proposta.** Se la dashboard ha già un `id` che non è provvisorio (`dashboard-…`), mantenerlo invece di
ricalcolarlo dal titolo; ricalcolarlo solo per le dashboard nuove.
