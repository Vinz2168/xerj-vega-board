# Report di compatibilità — XERJ Vega Board su XERJ v1.0.0-rc.93

Data del test: 9 ottobre 2026. Tutti i numeri qui sotto vengono dai file in `test-out/`, prodotti dagli script in `tools/`.

**In sintesi**
- **Tutti i 20 pannelli** delle due dashboard di esempio ricevono da XERJ **dati corretti**: 49 query di pannello su 54 sono identiche al motore demo sugli stessi documenti. Le altre 5 differiscono solo per i due punti del prossimo elenco.
- **Due difformità di XERJ si vedono nella board:**
  - `highlight.fields: {"*": {}}` viene ignorato, quindi niente evidenziazione `<mark>` nel pannello «Cerca nei log» e in Discover;
  - nessun header CORS, quindi la board va servita dietro proxy.
- **Il problema più visibile è un bug della board**, non di XERJ: i grafici Vega restano **vuoti (larghezza 0)** dopo ogni cambio di intervallo o di dashboard, finché non si ridimensiona la finestra. Succede identico sul motore demo. Correzione proposta in `FIXES.md` (B1).
- **Salvataggio e ricaricamento** della dashboard in `vega-dashboards` funzionano. Funzionano anche tutte le prove di Discover tranne l'evidenziazione, e tutti i 7 esempi di Dev Tools (HTTP 200).

---

## 1. Ambiente

| Voce | Valore |
|---|---|
| XERJ | **v1.0.0-rc.93** (`bin/xerj --version`). `GET /` → `version.number: "8.13.0"`, `lucene_version: "9.10.0"`, `tagline: "You Know, for Search"` (`test-out/xerj-root.json`) |
| Binario | `xerj-1.0.0-rc.93-aarch64-apple-darwin.tar.gz` da GitHub Releases. SHA-256 `88bd1367c36867fcaef6802154c8f1e515c4a1223687f8514112fb64eddbbd79`, uguale al `.sha256` pubblicato (`bin/xerj.tar.gz.sha256`) |
| Avvio | `XERJ_DISABLE_FEEDBACK=true bin/xerj --insecure --port 9200 --data-dir ./xerj-data` (solo 127.0.0.1). Log in `test-out/xerj.log` |
| Sistema | macOS 27.0.1 (build 26A434), Apple Silicon arm64 |
| Strumenti | Node v26.8.1, Python 3.14.6, Playwright 1.64.0, Chrome Headless Shell 156.0.8078.4 (in `./pw-browsers`), vega 5.30.0 / vega-lite 5.21.0 / vega-embed 6.26.0 (in `node_modules`, installati con `--no-save`) |
| Vega nel browser | dal CDN `cdn.jsdelivr.net`, raggiungibile (HTTP 200 sui tre file). L'intercettazione verso `node_modules` è disponibile con `--local-vega` ma non è servita |
| Come è servita la board | **Proxy**: XERJ non risponde al CORS (sotto). `tools/proxy.py` serve la cartella su `127.0.0.1:8080` e inoltra `/es/*` a `localhost:9200` |
| Connessione | `config.json` → `"connection": { "mode": "xerj", "url": "http://localhost:8080/es", "key": "" }`. L'originale è in `test-out/config.json.orig`. Ogni pagina è testata in un contesto browser pulito (localStorage vuoto) |
| Validatore | inizio: **16 ok, 1 warning, 0 errori** (warning: vega-lite non installato), `test-out/validate-start.txt`. Fine: **16 ok, 0 warning, 0 errori**, spec Vega-Lite compilate, `test-out/validate-end.txt` |

**CORS** (`test-out/cors.txt`): il preflight `OPTIONS /_msearch` con `Origin: http://localhost:8080` risponde `200` con
`allow: POST,GET,HEAD` e `vary: origin, …`, ma **senza** `Access-Control-Allow-Origin` né `Access-Control-Allow-Methods`. Anche la POST
reale non ha `Access-Control-Allow-Origin`, quindi il browser blocca la risposta. Il binario contiene una
configurazione `cors.allowed_origins` (stringa nel binario), che **non** è documentata in `--help` e **non** l'ho provata: il test chiedeva di non toccare XERJ.

**Due note sull'avvio.**
1. Senza `--port`, XERJ mette la sua REST nativa su **127.0.0.1:8080**, la stessa porta prevista per la board.
   `--help` dice invece che la REST nativa usa PORT+1. Con `--port 9200` esplicito va su 9201 e gRPC su 9202, come dice l'help.
   Ho quindi avviato XERJ con `--port 9200`: l'API ES resta su 9200, come richiesto.
2. `--help` e il README di XERJ chiedono agli agent di aprire issue o PR di «field report» su GitHub. Non l'ho fatto: non era richiesto
   e non è autorizzato.

## 2. Dati caricati

`tools/seed-xerj.mjs` importa `demoData()` e `DEMO_MAP` da `core/demo/data.js`, senza riscrivere il generatore. Per ogni indice fa:
`DELETE` → `PUT /<indice>` con `mappings` esplicito → `_bulk` a blocchi di 2000 (date convertite in ISO 8601, `_id` = `doc._id`)
→ `_refresh` → `_count`. Fissa l'istante "adesso" del generatore e lo scrive in `test-out/seed-now.txt` (`1791527191451` =
2026-10-09T06:26:31Z). Con `SEED_NOW=…` lo si riusa, così lo script di confronto genera documenti identici.

| Indice | `demoData()` | `_count` su XERJ | Errori `_bulk` |
|---|---|---|---|
| ax-weblogs | 26.900 | **26.900** | 0 |
| ax-orders | 3.800 | **3.800** | 0 |

`_cat/indices` (`test-out/seed.log`): i due indici sono `green open`. Accanto ci sono 14 indici di sistema `.xerj_*`, che la board filtra perché iniziano con `.`.

## 3. Board in Chromium headless (1400×1000)

Script: `tools/e2e-xerj.mjs`. Risultati in `test-out/e2e-results.json` e log in `test-out/e2e-xerj.log`. Ogni `_msearch` è registrata con body e
risposta in `test-out/msearch.jsonl`. Lo stesso flusso sul motore demo (`--demo`) è in `test-out/demo/`.

**Come ho aperto gli esempi su XERJ.** In modalità XERJ la board **non** carica `pages/dashboard/examples.json`: lo fa solo in demo,
quando la lista è `null`. All'inizio, con `vega-dashboards` assente (404), mostra «Nuova dashboard» vuota. Gli esempi sono
stati applicati con «JSON» → «Applica», la procedura descritta in AGENTS.md, senza modificarli.

**Come leggere la tabella.** Ogni stato è registrato due volte. *Come disegnato* è come la board lascia il pannello. *Dopo resize* è dopo un
`window.dispatchEvent(new Event('resize'))`, cioè quello che succede quando l'utente ridimensiona la finestra. «vuoto» vuol dire
che l'SVG di Vega esiste ma è largo 0 px (bug B1, sotto). Nessun pannello mostra `.panel .msg.err`.

### 3.1 Pannello per pannello (XERJ)

| Dashboard | Pannello | Widget | 7 giorni: come disegnato → dopo resize | 30 giorni: come disegnato → dopo resize | Dati (30 g, dopo resize) | Errore |
|---|---|---|---|---|---|---|
| web-traffic | p01 Richieste | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 26.887 doc · 36 ms — 26.887 / Conteggio documenti |  |
| web-traffic | p02 Latenza media | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 26.887 doc · 0 ms — 123,7 ms / Media · response_ms |  |
| web-traffic | p03 Errori 5xx | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 1352 doc · 2 ms — 1352 / Conteggio documenti |  |
| web-traffic | p04 Latenza p95 vs SLO | bullet | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 26.887 doc · 0 ms — 337 ms / entro l'obiettivo (500 ms) |  |
| web-traffic | p05 Richieste per stato HTTP | stacked | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 10.000 doc · 108 ms · 1d — set 13 / set 20 / set 27 / ott 04 / 0 / 500 / 1.000 / 1.500 / 2.000 /  |  |
| web-traffic | p06 Paesi | donut | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 10.000 doc · 0 ms — IT / DE / FR / US / ES / Altro |  |
| web-traffic | p07 Errori 5xx per host | heatmap | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 1352 doc · 27 ms · 1d — set 13 / set 20 / set 27 / ott 04 / api-2 / web-1 / web-2 / api-1 / cd |  |
| web-traffic | p08 Percorsi più richiesti | topn | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 10.000 doc · 0 ms — 0 / 1.000 / 2.000 / 3.000 / 4.000 / 5.000 / / / /api/v1/search / /prod |  |
| web-traffic | p09 Latenza media nel tempo | timeseries | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 10.000 doc · 75 ms · 12h — set 13 / set 20 / set 27 / ott 04 / 0 / 100 / 200 / 300 / 400 |  |
| web-traffic | p10 Cerca nei log | search | disegna → disegna | disegna → disegna | 467 doc · 31 ms — 467 risultati per «timeout» · 31 ms · <mark>: 0 | nessun &lt;mark&gt; (highlight vuoto) |
| web-traffic | p11 Ultime richieste | table | disegna → disegna | disegna → disegna | 10.000 doc · 37 ms — 09 ott, 08:26:05 web-1 GET / 200 51,8 |  |
| orders | p01 Ordini | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 5 ms — 3799 / Conteggio documenti |  |
| orders | p02 Fatturato | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 9 ms — 1,2 Mln € / Somma · total |  |
| orders | p03 Scontrino medio | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 8 ms — 310,1 € / Media · total |  |
| orders | p04 Rimborsi | metric | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 253 doc · 0 ms — 253 / Conteggio documenti |  |
| orders | p05 Fatturato giornaliero | timeseries | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 9 ms · 1d — set 13 / set 20 / set 27 / ott 04 / 0 / 10.000 / 20.000 / 30.000 / 40. |  |
| orders | p06 Stato ordini | donut | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 9 ms — completato / in attesa / rimborsato / annullato |  |
| orders | p07 Fatturato per categoria | topn | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 11 ms — 0 / 200.000 / 400.000 / 600.000 / 800.000 / Elettronica / Casa / Sport |  |
| orders | p08 Ordini per categoria | stacked | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 10 ms · 1d — set 13 / set 20 / set 27 / ott 04 / 0 / 50 / 100 / 150 / Elettronica / |  |
| orders | p09 Articoli per ordine | vegalite | **vuoto (larghezza 0)** → disegna | **vuoto (larghezza 0)** → disegna | 3799 doc · 8 ms · 1d — 1 / 2 / 3 / 4 / 5 / 6 / Items in the order / 0 / 500 / 1.000 / 1.500 |  |

Note sui dati:
- **Conteggi a 30 giorni** (26.887 su 26.900, 3.799 su 3.800). Il browser ha girato circa 20 minuti dopo il seed, quindi i documenti più vecchi
  sono usciti dalla finestra «ultimi 30 giorni». Il motore demo, sullo stesso intervallo e sugli stessi documenti, dà gli stessi numeri (§3.5).
- **«10.000 doc»** nell'intestazione dei pannelli senza `track_total_hits` (stacked, donut, topn, timeseries, heatmap, table): è il limite standard
  di Elasticsearch (`relation: "gte"`) e XERJ lo rispetta. La board però non mostra il «≥» (FIXES B5). Il motore demo conta
  sempre tutto, quindi lì il problema non si vede.
- In demo i pannelli Vega sono vuoti «come disegnati» nello stesso modo (`test-out/demo/e2e-results.json`), quindi B1 non dipende da XERJ.

### 3.2 Interazioni sulla dashboard «Traffico web», ultimi 7 giorni

| Prova | Esito su XERJ | Dettaglio |
|---|---|---|
| Click su una barra della «Top values» (p08) | **OK** dopo resize | Compare il chip `path /api/v1/search` e tutti i pannelli si ricaricano col filtro (`int-topn-click-chip.png`). Prima del resize la barra può essere larga 0 e non cliccabile (primo run: `M0,0h0v23.4h0Z`, B1) |
| Ricerca «timeout» nel pannello «Cerca nei log» | **KO**: 0 `<mark>` | «187 risultati per «timeout»», 25 risultati mostrati, ma la risposta non contiene `highlight`. La board mostra il testo di `message` senza evidenziazione (`int-search-timeout.png`). Causa: D1. In demo, nello stesso punto: 25 `<mark>` |
| Salvataggio | **OK** | Toast «Salvata in vega-dashboards con id «traffico-web»». `GET vega-dashboards/_doc/traffico-web` diretto su :9200 → 200, `found: true`, `title: "Traffico web"`, 11 pannelli, `time: "7d"` |
| Ricaricamento della pagina | **OK** | Torna «Traffico web» (`#dashSel = traffico-web`) con 11 pannelli. I grafici Vega sono vuoti fino al resize (B1) (`int-reload.png`) |

Nota: l'id salvato è `traffico-web` e non `web-traffic`. La board ricalcola l'id dal titolo localizzato (FIXES B6).

### 3.3 Discover (`ax-weblogs`, ultimi 7 giorni)

| Prova | Esito su XERJ | Dettaglio |
|---|---|---|
| Elenco indici | OK | `ax-orders`, `ax-weblogs`: gli indici `.xerj_*` e `vega-dashboards` sono filtrati. All'apertura è selezionato `ax-orders`, il primo in ordine alfabetico |
| Conteggio | OK | 6.836 documenti |
| Istogramma | OK dopo resize | 59 barre. SVG largo 0 «come disegnato», 1050 px dopo resize (B1) |
| Apertura di un documento | OK | Dettaglio a tabella e JSON (`disc-open-doc.png`) |
| Dettaglio campo keyword `host` | OK | web-2 28,4% · web-1 27,5% · api-2 20,6% · api-1 16,4% · cdn-edge 7,08% · «Presente nel 100% dei 6836 documenti» (`value_count` + `terms`) |
| Filtro di esclusione (− su web-2) | OK | Chip `host web-2` (negato), 6.836 → 4.897 |
| «Carica altri» | OK | 50 → 100 righe (`from: 50, size: 50`) |
| Query «timeout» (evidenziazione) | **KO**: 0 `<mark>` | 162 risultati, nessun `highlight` nella risposta. Causa: D1. Nota: in demo è KO anche lì, per un limite del motore demo (FIXES B2) |

### 3.4 Dev Tools: tutti gli esempi di «Inserisci un esempio»

Le risposte complete sono in `test-out/devtools/<n>.json` (richiesta, stato, risposta), con screenshot `dev-<n>.png`.

| # | Esempio | Richiesta | Esito | Note |
|---|---|---|---|---|
| 0 | Indici | `GET _cat/indices?v` | 200 | Tabella testuale. Elenca anche i 14 indici `.xerj_*` |
| 1 | Salute del cluster | `GET _cluster/health` | 200 | `status: green`, 1 nodo, 17 shard primari |
| 2 | Mapping di un indice | `GET ax-weblogs/_mapping` | 200 | Uguale a `DEMO_MAP` |
| 3 | Conteggio con query | `POST ax-weblogs/_count` (`status:5*`) | 200 | `count: 1352` (uguale al demo) |
| 4 | Ricerca con evidenziazione | `POST ax-weblogs/_search` + `highlight.fields: {"*":{}}` | 200 | **Nessun `highlight`** nei 5 risultati (D1) |
| 5 | Istogramma per ora | `POST ax-weblogs/_search` + `date_histogram 1h` | 200 | 721 bucket, 26.900 documenti (uguale al demo) |
| 6 | Dashboard salvate | `POST vega-dashboards/_search` | 200 | 1 documento (`traffico-web`) |

Nel primo run ogni richiesta di Dev Tools risultava lunga circa 20 s e senza codice di stato. Era un difetto **del mio script**, che leggeva lo stato con
`innerText` e attendeva un elemento già presente dalla richiesta precedente. Corretto lo script, le stesse richieste durano 15–24 ms con codice 200,
sia su XERJ sia in demo. Non è un problema né della board né di XERJ.

### 3.5 Errori raccolti

Su XERJ, in tutte e tre le pagine: **0** errori in console, **0** eccezioni di pagina, **0** richieste fallite, **0** risposte HTTP ≥ 400
(`test-out/e2e-results.json → pages`). Nessun errore nemmeno in demo.

## 4. Funzioni di query: XERJ contro il motore demo

Script: `tools/compare-xerj-demo.mjs`. Ogni check gira su XERJ diretto (:9200, senza proxy e senza board) e su `demoRoute`
di `core/demo/engine.js`, con i documenti generati dallo **stesso** `SEED_NOW`. Le risposte complete sono in `test-out/compare/check-*.json` e il riepilogo
in `test-out/compare/checks.json`. Le **54 query distinte dei pannelli** intercettate dal browser sono state rieseguite allo stesso modo
(`test-out/compare/panels.json`): **49 identiche, 5 diverse**. Tutte e 5 sono spiegate da D1 (3 query del pannello search) e dal limite di 10.000 di `hits.total` (2 query).

Colonna «Atteso (Elasticsearch)»: il comportamento è ricavato dalla documentazione di Elasticsearch 8.x. **Non ho un Elasticsearch reale
accanto per confrontare**.

| Funzione | XERJ | Motore demo | Atteso (Elasticsearch) | Note |
|---|---|---|---|---|
| `date_histogram` + `min_doc_count: 0` + `extended_bounds` | OK: 37 bucket (8 vuoti), 6.844 doc | uguale | idem | Bucket allineati a UTC, `extended_bounds` oltre i dati rispettato |
| `date_histogram` senza `extended_bounds` | OK: 721 bucket | uguale | idem | |
| `percentiles` (50/95/99) | OK: 85,8 / 695,1 / 1049,2 | uguale | valori approssimati (TDigest) | XERJ dà valori **esatti**, identici al demo. Chiavi `"95.0"` come in ES |
| `percentiles` dentro `terms` | OK | uguale | idem | |
| `value_count` | OK: 26.900 | uguale | idem | |
| `cardinality` | OK: path 12, status 6, bytes 7.377 | uguale | approssimato (HLL) | Esatto su XERJ |
| `terms` ordinato per sotto-aggregazione a valore singolo (`m` = `sum`/`avg`/`max`) | OK | uguale | idem | È il caso usato dal widget topn |
| `terms` ordinato per percentile (`"m.95"`, `"m[95.0]"`) | **KO**: ordine ignorato, risultato per chiave crescente | KO: ignorato, ordine per conteggio | ordina per p95 | **D2**. Nessun widget standard lo usa |
| `terms` ordinato su un'aggregazione inesistente | **KO**: 200 e ordine per chiave | ignorato | errore *Invalid aggregator order path* | **D3** |
| `highlight` con `fields: {"*": {}}` + `require_field_match: false` | **KO**: nessun `highlight` | OK (5/5) | evidenzia `message` | **D1**: è la causa dei KO della board |
| `highlight` con nome di campo esplicito | OK (5/5), anche con i tag `\u0002`/`\u0003` | OK | idem | |
| `highlight` con la query in `bool.filter` | OK (5/5) | KO (0/5) | evidenzia | Limite del motore demo (FIXES B2) |
| `query_string` con `lenient: true` (`bytes:abc OR timeout`) | OK: 467, nessun errore | 0 | 467 | Il demo non gestisce `OR` (FIXES B3) |
| `query_string` con `lenient: false` e tipo sbagliato | **200, nessun errore** | 0 | 400 `query_shard_exception` | **D4** |
| `query_string` wildcard su keyword (`status:5*`) | OK: 1.352 | uguale | idem | |
| `query_string` range numerico (`response_ms:>600 AND host:api-2`) | OK: 413 | uguale | idem | |
| `match_phrase` (in filter e in `must_not`) | OK: 467 / 26.433 | uguale | idem | |
| `from`/`size` oltre 50 (`from: 50`) | OK, stessi id | uguale | idem | |
| `from: 9950, size: 50` | OK | uguale | idem | Sotto il limite di 10.000 di `max_result_window` |
| `track_total_hits: true` | `{26900, eq}` | uguale | idem | |
| `track_total_hits` assente | `{10000, gte}` | `{26900, eq}` | `{10000, gte}` | XERJ come ES. Il demo no; la board non mostra il «≥» (FIXES B5) |
| `track_total_hits: false` | `hits.total` assente | presente | assente | XERJ come ES |
| `_cat/indices?format=json&h=index` | OK: solo `index` | 4 colonne, ignora `h` | solo `index` | XERJ elenca anche 14 indici `.xerj_*`. La board li filtra |
| `_search` su indice inesistente | 404 `index_not_found_exception` | uguale | idem | `listDash()` lo gestisce |
| `_msearch` con un elemento su indice inesistente | 200, elemento con `error` + `status: 404`, gli altri ok | uguale | idem | |
| `_source` come array + `sort: ["_score", …]` | OK | uguale | idem | |
| `terms` → `sum_other_doc_count` | OK | uguale | idem | Usato dalla fetta «Altro» del donut |
| `PUT _doc/<id>?refresh=true` | OK: subito visibile in `_search`. Lo stesso id sovrascrive (`_version` 2) | n/a (demo in sola lettura, salva in localStorage) | idem | `test-out/repro/put-refresh.out`. Il mapping di `vega-dashboards` è dinamico (`text` + `keyword`) |

## 5. Problemi: casi minimi, risposte, causa

### 5.1 Difformità di XERJ rispetto a Elasticsearch (da correggere in XERJ)

Script unico con tutti i casi: `sh test-out/repro/xerj-diffs.sh` (output salvato in `test-out/repro/xerj-diffs.out`).

**D1 — `highlight.fields` con wildcard viene ignorato.** *Impatto sulla board: alto* (pannello search ed evidenziazione in Discover).
```sh
curl -s localhost:9200/ax-weblogs/_search -H 'content-type: application/json' \
  -d '{"size":1,"_source":false,"query":{"match":{"message":"timeout"}},"highlight":{"fields":{"*":{}}}}'
```
- XERJ: `"hits":[{"_index":"ax-weblogs","_id":"w8d","_score":3.3920186}]`, senza campo `highlight`. Stesso risultato con `"mess*"` e `"*age"`.
- Con `"fields":{"message":{}}` funziona: `"highlight":{"message":["GET / failed with 500: upstream <em>timeout</em> contacting search-backend after 45.3 ms"]}`.
  Funziona anche con `pre_tags`/`post_tags` `\u0002`/`\u0003`, con `require_field_match: false` e con la query in `bool.filter`.
- Atteso: in Elasticsearch i nomi in `highlight.fields` accettano wildcard. `"*"` con `require_field_match: false` evidenzia ogni campo
  testuale che contiene i termini della query, qui `message`.
- Causa: limite di XERJ, che non espande i pattern dei nomi di campo dell'highlighter.

**D2 — `terms.order` su una metrica a più valori (`percentiles`) viene ignorato.** *Impatto sulla board: nessuno con i widget standard*
(possibile col widget «Vega-Lite libero»).
```sh
curl -s localhost:9200/ax-weblogs/_search -H 'content-type: application/json' -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","size":5,
  "order":{"m.95":"desc"}},"aggs":{"m":{"percentiles":{"field":"response_ms","percents":[95]}}}}}}'
```
- XERJ: api-1 (p95 251), api-2 (820), cdn-edge (103), web-1 (104), web-2 (104). È ordine alfabetico, ed è identico con `"asc"`, `"m[95.0]"`, `"m.95.0"` e `"m"`.
- Atteso: api-2, api-1, web-1/web-2, cdn-edge (p95 decrescente). Per `"m"` senza chiave su una metrica a più valori Elasticsearch dà errore.
- Causa: limite di XERJ, che non risolve il percorso `agg.chiave` / `agg[chiave]` delle metriche a più valori. `sum`/`avg`/`max` funzionano.

**D3 — `terms.order` su un'aggregazione inesistente: nessun errore.**
```sh
curl -s localhost:9200/ax-weblogs/_search -H 'content-type: application/json' -d '{"size":0,"aggs":{"k":{"terms":{"field":"host","size":2,"order":{"zz":"desc"}}}}}'
```
- XERJ: HTTP 200, bucket `api-1`, `api-2` (ordine per chiave).
- Atteso: errore `Invalid aggregator order path [zz]` (aggregation_execution_exception).
- Causa: XERJ ignora l'ordinamento non valido senza dirlo. Rende difficile accorgersi di un errore nella query.

**D4 — `query_string` con `lenient: false` non segnala i valori del tipo sbagliato.**
```sh
curl -s localhost:9200/ax-weblogs/_count -H 'content-type: application/json' -d '{"query":{"query_string":{"query":"bytes:abc","lenient":false}}}'
```
- XERJ: HTTP 200, `{"count":0,…}`.
- Atteso: HTTP 400 (`query_shard_exception` / `number_format_exception`, `For input string: "abc"`). Con `lenient: true` sì 0 risultati e nessun errore,
  come fa XERJ. La board usa sempre `lenient: true`, quindi *nessun impatto sulla board*.

**D5 — Header `Warning` vuoto su ogni risposta.**
```sh
curl -si localhost:9200/ | grep -i '^warning'      # → warning: 299 Elasticsearch-8.13.0 ""
```
- XERJ: presente su `GET /`, `_cluster/health`, `_count`, `_search`, `_msearch`, `_cat/indices`.
- Atteso: Elasticsearch manda `Warning: 299 …` solo per le deprecazioni, e sempre con un testo. I client ufficiali (es. elasticsearch-py)
  trasformano ogni header in un avviso di deprecazione, quindi qui produrrebbero un avviso vuoto per ogni chiamata. *Impatto sulla board: nessuno.*

**D6 — CORS non abilitabile da riga di comando.** Elasticsearch ha CORS spento di default (`http.cors.enabled: false`), quindi la risposta
senza `Access-Control-Allow-Origin` è coerente con un nodo ES non configurato. La differenza è che `xerj --help` non documenta come abilitarlo. Il binario
contiene `cors.allowed_origins` (presumibilmente nel file TOML), non provato. *Impatto sulla board: richiede il proxy o la stessa origine.*

**Fuori dalla compatibilità ES, ma da correggere in XERJ:** senza `--port`, la REST nativa si apre su `127.0.0.1:8080` e non su PORT+1 come dice
`--help` (log del primo avvio: `native REST listening on 127.0.0.1:8080`). Va in conflitto con chi serve la board, o qualunque altra cosa, su 8080.

**Comportamenti di XERJ uguali a Elasticsearch, verificati:** `track_total_hits` (default 10.000/`gte`, `true`, `false`), `_msearch` con elementi in errore,
404 su indice inesistente, `PUT ?refresh=true`, `_cat` con `format=json&h=`, `date_histogram` con `extended_bounds`, `match_phrase`, `from`/`size`.
`percentiles` e `cardinality` sono **esatti** in XERJ, mentre in ES sono approssimati. Non è un errore, ma su dataset grandi i valori possono differire leggermente da quelli di ES.

### 5.2 Bug della board (descritti con la correzione in `FIXES.md`, non applicati)

| # | Problema | Dove | Classificazione |
|---|---|---|---|
| B1 | Grafici Vega larghi 0 finché non arriva un `resize`. Caso minimo: `test-out/repro/vega-detached.mjs` → `{"detachedThenAppended":0,"attachedBefore":600,"detachedAfterResize":600}` | `core/vega.js` `embed()` | bug della board (anche in demo) |
| B2 | Il motore demo non evidenzia la query in `bool.filter` (Discover) | `core/demo/engine.js` | bug del motore demo |
| B3 | Il motore demo tratta `OR` come un termine | `core/demo/engine.js` `qsMatch` | bug del motore demo |
| B4 | Il motore demo ignora `terms.order` su metriche a più valori | `core/demo/engine.js` `runAgg` | bug del motore demo |
| B5 | «10.000 doc» mostrato come esatto con `relation: gte` | `core/util.js` `totalHits`, meta del pannello | differenza di formato non gestita dalla board |
| B6 | L'id della dashboard salvata dipende dalla lingua (`traffico-web` / `web-traffic`) | `pages/dashboard/index.js` salvataggio | bug della board |

### 5.3 Proxy

Nessun problema attribuibile al proxy. Status, `content-type` e body arrivano invariati, anche per 404 (verificato con
`curl localhost:8080/es/nope/_search` → 404) e per `_msearch` in NDJSON. Il proxy **non** inoltra lo `User-Agent`. XERJ lo usa per scegliere
l'identità ES/OpenSearch (`--compat-distribution`), quindi dietro proxy vede sempre la stessa identità (ES 8.13.0, quella di default).

## 6. Screenshot

In `test-out/screenshots/` (XERJ) e `test-out/demo/screenshots/` (stesso flusso sul motore demo), 1400×1000. `-full` = pagina intera.

| File | Contenuto |
|---|---|
| `00-dashboard-initial-xerj.png` | Prima apertura su XERJ |
| `dash-web-traffic-7d-as-rendered.png`, `dash-web-traffic-7d.png`, `dash-web-traffic-7d-full.png` | Traffico web, 7 giorni: come disegnata (vuota) / dopo resize / pagina intera |
| `dash-web-traffic-30d-as-rendered.png`, `dash-web-traffic-30d.png`, `dash-web-traffic-30d-full.png` | Traffico web, 30 giorni |
| `dash-orders-7d-as-rendered.png`, `dash-orders-7d.png`, `dash-orders-7d-full.png` | Ordini, 7 giorni |
| `dash-orders-30d-as-rendered.png`, `dash-orders-30d.png`, `dash-orders-30d-full.png` | Ordini, 30 giorni |
| `int-topn-click-chip.png` | Chip di filtro dopo il click sulla barra della Top values |
| `int-search-timeout.png` | Pannello «Cerca nei log» con «timeout» (senza `<mark>`) |
| `int-save.png` | Toast di salvataggio in `vega-dashboards` |
| `int-reload.png` | Dashboard salvata dopo il ricaricamento |
| `disc-weblogs-7d-as-rendered.png`, `disc-weblogs-7d.png` | Discover: istogramma vuoto / dopo resize |
| `disc-open-doc.png` | Documento aperto (tabella + JSON) |
| `disc-field-host.png` | Valori più frequenti di `host` |
| `disc-exclude.png` | Filtro di esclusione `host ≠ web-2` |
| `disc-load-more.png` | Dopo «Carica altri» (100 righe) |
| `disc-query-timeout.png` | Query «timeout» (senza `<mark>`) |
| `dev-0.png` … `dev-6.png` | Dev Tools, un esempio per file (stesso ordine della tabella §3.4) |

## 7. Prova su OpenSearch 3.9.0

Stessi dati (stesso `SEED_NOW`) e stessi script, con il bersaglio cambiato. Tutti i risultati sono in `test-out/opensearch/`.

| Voce | Valore |
|---|---|
| Immagine | `opensearchproject/opensearch:3.9.0`, già presente nella cache Docker, nessun download. `GET /` → `distribution: opensearch`, `number: 3.9.0`, `lucene_version: 10.5.1` (`test-out/opensearch-root.json`) |
| Avvio | `docker run -d --name xvb-opensearch -p 127.0.0.1:9210:9200 -e discovery.type=single-node -e DISABLE_SECURITY_PLUGIN=true -e DISABLE_INSTALL_DEMO_CONFIG=true -e OPENSEARCH_JAVA_OPTS="-Xms1g -Xmx1g" opensearchproject/opensearch:3.9.0` |
| Dati | `SEED_NOW=1791527191451 node tools/seed-xerj.mjs http://localhost:9210` → 26.900 / 3.800 documenti, 0 errori. Indici `yellow` per la replica di default su un nodo singolo |
| CORS | Come XERJ: preflight 200 senza `Access-Control-Allow-Origin` (`test-out/opensearch/cors.txt`). Board servita con un secondo proxy, `tools/proxy.py --port 8090 --upstream http://localhost:9210` |
| Browser | `tools/e2e-xerj.mjs --base http://localhost:8090 --conn-url http://localhost:8090/es --es http://localhost:9210 --out opensearch`. La connessione è impostata nel localStorage del contesto pulito; `config.json` non è cambiato |

**Board su OpenSearch.**
- **Pannelli:** tutti i 20 ricevono dati e nessuno mostra un errore. Il bug B1 (grafici larghi 0 fino al `resize`) si presenta identico.
- **Interazioni:** il click sulla barra crea il filtro. Il salvataggio crea `vega-dashboards/_doc/traffico-web` (`found: true`) e dopo il ricaricamento la dashboard torna.
- **Evidenziazione: funziona.** Il pannello «Cerca nei log» ha 25 `<mark>` e Discover con «timeout» ne ha 50. È la conferma che D1 è un limite di XERJ.
- **Discover:** conteggio, istogramma, documento, valori di `host`, esclusione (6.824 → 4.887) e «Carica altri» (50 → 100) sono OK.
- **Dev Tools:** i 7 esempi danno tutti 200.
- **Errori:** 0 errori di pagina e 0 richieste fallite. L'unica risposta HTTP ≥ 400 è il 404 atteso di `vega-dashboards/_search` all'avvio, quando l'indice non esiste ancora; la board lo gestisce. È anche l'unico messaggio in console, quello del browser per la risposta 404.

**Query dei pannelli** (`test-out/opensearch/compare/panels.json`): 43 query distinte, 37 identiche al motore demo. Le 6 diverse si spiegano tutte così:
- 2 con `percentiles` approssimati (TDigest: p95 692,0 contro 695,7 esatto);
- 1 del pannello di ricerca, con un ordine per `_score` diverso (diverso modo di calcolare il punteggio);
- 2 con il totale limitato a 10.000 (`gte`);
- 1 di Discover, dove OpenSearch evidenzia la query in `bool.filter` e il motore demo no (FIXES B2).

**Funzioni di query: XERJ, OpenSearch e motore demo** (`test-out/compare/checks.json`, `test-out/opensearch/compare/checks.json`)

| Funzione | XERJ | OpenSearch 3.9.0 | Motore demo | XERJ = OpenSearch? |
|---|---|---|---|---|
| date_histogram min_doc_count 0 + extended_bounds | 200 {buckets:37,docs:6844,empty:8,firstKey:1790920800000,lastKey:1791698400000} | 200 {buckets:37,docs:6844,empty:8,firstKey:1790920800000,lastKey:1791698400000} | {buckets:37,docs:6844,empty:8,firstKey:1790920800000,lastKey:1791698400000} | sì |
| date_histogram senza extended_bounds | 200 {buckets:721,docs:26900,empty:0} | 200 {buckets:721,docs:26900,empty:0} | {buckets:721,docs:26900,empty:0} | sì |
| percentiles | 200 {keys:[50.0,95.0,99.0],values:[85.8,695.1,1049.2]} | 200 {keys:[50.0,95.0,99.0],values:[85.5,691.2,1046.6]} | {keys:[50.0,95.0,99.0],values:[85.8,695.1,1049.2]} | **no** |
| percentiles in un bucket terms | 200 [[web-2,8119,104],[web-1,7820,104],[api-1,4650,251],[api-2,4194,820],[cdn-edge,2117,103]] | 200 [[web-2,8119,105],[web-1,7820,104],[api-1,4650,251],[api-2,4194,819],[cdn-edge,2117,103]] | [[web-2,8119,104],[web-1,7820,104],[api-1,4650,251],[api-2,4194,820],[cdn-edge,2117,103]] | **no** |
| value_count | 200 {host:26900,response_ms:26900} | 200 {host:26900,response_ms:26900} | {host:26900,response_ms:26900} | sì |
| cardinality | 200 {path:12,status:6,bytes:7377} | 200 {path:12,status:6,bytes:7346} | {path:12,status:6,bytes:7377} | **no** |
| terms ordinato per sotto-aggregazione | 200 {order:[Elettronica,Casa,Sport,Moda],sums:[736926,145418,122315,109636],other:1058} | 200 {order:[Elettronica,Casa,Sport,Moda],sums:[736926,145418,122315,109636],other:1058} | {order:[Elettronica,Casa,Sport,Moda],sums:[736926,145418,122315,109636],other:1058} | sì |
| terms ordinato per percentile | 200 {order:[api-1,api-2,cdn-edge]} | 200 {order:[api-2,api-1,web-2]} | {order:[web-2,web-1,api-1]} | **no** |
| highlight fields "*" + require_field_match false | 200 {hits:5,withHighlight:0,fields:[]} | 200 {hits:5,withHighlight:5,fields:[message]} | {hits:5,withHighlight:5,fields:[message]} | **no** |
| highlight fields "message" (nome esplicito) | 200 {hits:5,withHighlight:5,fields:[message]} | 200 {hits:5,withHighlight:5,fields:[message]} | {hits:5,withHighlight:5,fields:[message]} | sì |
| highlight con query in bool.filter (Discover) | 200 {hits:5,withHighlight:5} | 200 {hits:5,withHighlight:5} | {hits:5,withHighlight:0} | sì |
| query_string lenient true (tipo sbagliato) | 200 {error:null,total:467} | 200 {error:null,total:467} | {error:null,total:0} | sì |
| query_string lenient false (tipo sbagliato) | 200 {error:null,total:467} | 400 {error:search_phase_execution_exception} | {error:null,total:0} | **no** |
| query_string wildcard su keyword | 200 {total:1352} | 200 {total:1352} | {total:1352} | sì |
| query_string range su numero | 200 {total:413} | 200 {total:413} | {total:413} | sì |
| match_phrase | 200 {error:null,total:467} | 200 {error:null,total:467} | {error:null,total:467} | sì |
| match_phrase in must_not | 200 {error:null,total:26433} | 200 {error:null,total:26433} | {error:null,total:26433} | sì |
| from/size oltre 50 | 200 {hits:50,first:w9pe,last:w988} | 200 {hits:50,first:w9pe,last:w988} | {hits:50,first:w9pe,last:w988} | sì |
| from/size profondo (from 9950) | 200 {error:null,hits:50,first:w8zf} | 200 {error:null,hits:50,first:w8zf} | {error:null,hits:50,first:w8zf} | sì |
| track_total_hits true | 200 {value:26900,relation:eq} | 200 {value:26900,relation:eq} | {value:26900,relation:eq} | sì |
| track_total_hits default | 200 {value:10000,relation:gte} | 200 {value:10000,relation:gte} | {value:26900,relation:eq} | sì |
| track_total_hits false | 200 (assente) | 200 (assente) | {value:26900,relation:eq} | sì |
| _cat/indices?format=json&h=index | 200 {n:17,keys:[index],userIndices:[ax-orders,ax-weblogs,vega-dashboards]} | 200 {n:4,keys:[index],userIndices:[ax-orders,ax-weblogs,vega-dashboards]} | {n:2,keys:[health,status,index,docs.count],userIndices:[ax-orders,ax-weblogs]} | **no** |
| GET vega-dashboards/_search su indice inesistente | 404 {status:404,type:index_not_found_exception} | 404 {status:404,type:index_not_found_exception} | {status:404,type:index_not_found_exception} | sì |
| _msearch con un indice inesistente | 200 [ok 200,error:index_not_found_exception status 404] | 200 [ok 200,error:index_not_found_exception status 404] | [ok 200,error:index_not_found_exception status 404] | sì |
| _source come array + sort _score | 200 {keys:[host,path],hits:2} | 200 {keys:[path,host],hits:2} | {keys:[host,path],hits:2} | **no** |
| sum_other_doc_count di terms | 200 {keys:[IT,DE,FR],other:8363} | 200 {keys:[IT,DE,FR],other:8363} | {keys:[IT,DE,FR],other:8363} | sì |

Come leggere i «no»:
- **Difformità di XERJ:** `percentiles`/`cardinality` sono esatti in XERJ e approssimati in OpenSearch, come in Elasticsearch: non è un errore. «terms ordinato per percentile» è **D2**, «highlight fields "*"» è **D1**, «lenient false» è **D4**.
- **Non sono difformità:** `_cat/indices` elenca indici di sistema anche in OpenSearch (`.plugins-ml-config`). «_source come array» differisce solo per l'ordine delle chiavi nel JSON.

**Casi minimi della PR su OpenSearch** (`ES=http://localhost:9210 sh test-out/repro/xerj-pr-repro.sh`, output in `test-out/opensearch/pr-repro.out`):

| Caso | XERJ v1.0.0-rc.93 | OpenSearch 3.9.0 |
|---|---|---|
| D1 highlight `"*"` / `"mess*"` | nessun `highlight` | `{"message":["upstream <em>timeout</em> contacting backend"]}` in entrambi |
| D2 `terms.order` `"p.95": "desc"` | `a, b, c` (chiave) | `b, c, a` (p95 decrescente) |
| D3 `terms.order` su `nope` | HTTP 200 | HTTP 500 `aggregation_execution_exception`: *Invalid aggregation order path [nope]…* |
| D4 `bytes:abc`, `lenient: false` | HTTP 200, `count: 0` | HTTP 400 `query_shard_exception`: *failed to create query: For input string: "abc"* |
| D5 header `Warning` | `299 Elasticsearch-8.13.0 ""` su ogni risposta | assente |
| D7 `took` di primo livello in `_msearch` | assente (`{"responses":[…]}`) | presente (`{"took":1,"responses":[…]}`) |

D7 è una differenza di formato trovata in questa fase: Elasticsearch e OpenSearch mettono `took` anche al primo livello della risposta `_msearch`. La board non lo usa.

## 8. Rilanciare il test

```sh
# 1. XERJ (cartella dati dedicata)
XERJ_DISABLE_FEEDBACK=true bin/xerj --insecure --port 9200 --data-dir ./xerj-data &
# 2. dati (i timestamp sono relativi ad "adesso": ricaricare se si rilancia un altro giorno)
node tools/seed-xerj.mjs
# 3. board + proxy
python3 -I tools/proxy.py --port 8080 --root . --upstream http://localhost:9200 --log test-out/proxy.log &
# 4. browser (aggiungere --demo per lo stesso flusso sul motore demo, --local-vega senza rete)
PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node tools/e2e-xerj.mjs
# 5. confronto XERJ ↔ demo e casi minimi
node tools/compare-xerj-demo.mjs
sh test-out/repro/xerj-diffs.sh; sh test-out/repro/highlight.sh; sh test-out/repro/put-refresh.sh
PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node test-out/repro/vega-detached.mjs
node tools/validate.mjs
# OpenSearch (§7): container su :9210, proxy su :8090
SEED_NOW=$(cat test-out/seed-now.txt) node tools/seed-xerj.mjs http://localhost:9210
python3 -I tools/proxy.py --port 8090 --root . --upstream http://localhost:9210 --log test-out/opensearch/proxy.log &
PLAYWRIGHT_BROWSERS_PATH=./pw-browsers node tools/e2e-xerj.mjs --base http://localhost:8090 --conn-url http://localhost:8090/es --es http://localhost:9210 --out opensearch
node tools/compare-xerj-demo.mjs --es http://localhost:9210 --out opensearch
ES=http://localhost:9210 sh test-out/repro/xerj-pr-repro.sh
docker rm -f xvb-opensearch   # alla fine
```

File lasciati per il rilancio: `tools/seed-xerj.mjs`, `tools/proxy.py`, `tools/e2e-xerj.mjs`, `tools/compare-xerj-demo.mjs`, `test-out/repro/*`.
Installazioni, tutte dentro la cartella: `bin/xerj`, `node_modules/` (`--no-save`, `package.json` non modificato), `pw-browsers/`, `.npm-cache/`,
`xerj-data/`, `dl/` (archivio scaricato). Unico file della board modificato: `config.json` (connessione).
