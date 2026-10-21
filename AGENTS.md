# AGENTS.md — XERJ Vega Board

Istruzioni per agent AI (e persone) che estendono o personalizzano questo progetto.
Leggi tutto prima della prima modifica: il progetto è piccolo, ma ha contratti precisi.

## In breve

- Interfaccia leggera per XERJ e per qualsiasi motore con API Elasticsearch: **Dashboard**, **Discover**, **Dev Tools**.
  Con XERJ (e in demo) anche **Ricerca** (codice e documenti di `xerj autoindex`), **Indici** (mapping, impostazioni, index pattern),
  **Memoria agenti** (`/_memory`) e **Metriche** (`/v1/metrics`);
  con Elasticsearch/OpenSearch la board resta quella classica.
- **Niente build.** ES modules nativi, serviti così come sono. Vega, Vega-Lite e vega-embed arrivano da CDN come globali (`index.html`).
- **Tutto si estende aggiungendo file e una riga in un manifest.** Non serve toccare il core per aggiungere un widget o una pagina.
- Interfaccia **bilingue** (inglese di default, italiano se il browser lo preferisce): vedi «Lingue». I messaggi diagnostici per sviluppatori (contratto, validatore, motore demo) sono in inglese.
- Prima di consegnare una modifica: `node tools/validate.mjs` deve finire con `0 errori`.

## Mappa

```
index.html                 shell HTML: header, slot pagine, script CDN, avvio di core/app.js
config.json                pagine (ordine = tab) e manifest dei widget da caricare  ← punto di estensione
core/
  app.js                   shell: router #/<pagina>, stato globale (tempo, connessione), oggetto `app`
  registry.js              carica i manifest dei widget, importa i moduli, li valida; compila i widget dichiarativi
  declarative.js           widget dichiarativi: documento JSON → widget (template, percorso delle righe, spec Vega-Lite)
  contract.js              contratti di widget, pagine e dashboard (usato anche da validate.mjs)
  kit.js                   toolkit per i widget: parametri comuni, helper Vega-Lite, formattazione
  backend.js               client XERJ/ES (msearch, mapping, salvataggio dashboard) + switch demo
  query.js                 costruzione delle query (tempo, query string, filtri include/esclude)
  time.js                  intervalli relativi/assoluti e scelta dell'intervallo degli istogrammi
  vega.js                  tema → config Vega, embed, brush → filtro temporale, formati Vega nella lingua attiva
  ui.js                    componenti condivisi: time picker, query bar, chip filtri, form dei parametri
  util.js                  utilità pure (escape, formattazione numeri/date, localStorage tollerante)
  i18n.js                  lingua dal browser, t('chiave') per il core, L({ en, it }) per i widget
  i18n/en.js, i18n/it.js   cataloghi delle stringhe del core (stesse chiavi)
  styles.css               token di colore e stili condivisi (stile «classic»: barra in alto)
  skins/nova.css           stile «nova»: sidebar, blu notte e indaco; ridefinisce i token sotto [data-skin="nova"]
                           (ispirato al concept XERJ Companion di @pilahito, xerj-org/xerj#1755)
  demo/data.js             dati sintetici (ax-weblogs, ax-orders, ax-orbit)
  demo/corpus.js           corpus «come autoindex» per la Ricerca in demo (ax-orbit: file e simboli)
  demo/memory.js           Agent Memory in demo: namespace di esempio in RAM (stesso contratto di /_memory)
  demo/metrics.js          /v1/metrics in demo: testo Prometheus sintetico con i nomi delle metriche di XERJ
  demo/engine.js           motore che esegue il sottoinsieme di query DSL usato qui + router REST per Dev Tools
pages/
  dashboard/               index.js, dashboard.css, examples.json (dashboard demo)
  discover/                index.js, discover.css
  devtools/                index.js, devtools.css
  search/                  index.js, search.css   (solo XERJ e demo)
  indices/                 index.js, indices.css  (solo XERJ e demo)
  corpus/                  index.js, corpus.css   (solo XERJ: Corpus Hub, endpoint /_hub/v1)
  memory/                  index.js, memory.css   (XERJ e demo: Agent Memory, endpoint /_memory/{namespace})
  metrics/                 index.js, metrics.css  (XERJ e demo: metriche Prometheus campionate, /v1/metrics)
  settings/                index.js, settings.css (XERJ e demo: pagine visibili; esporta, importa, ripristina la configurazione)
widgets/
  dist/                    widget standard + index.json   (non modificarli per personalizzare)
  declarative/seed.json    widget dichiarativi di esempio (JSON), copiati nell'indice dei widget
  custom/                  widget personalizzati + index.json + _template.js
schemas/dashboard.schema.json   JSON Schema della definizione di dashboard
tools/validate.mjs         validazione in Node di pagine, widget e dashboard di esempio
```

## Avvio

I moduli ES non si caricano da `file://`. Dalla cartella del progetto:

```sh
python3 -m http.server 8080      # oppure: npx serve .
# poi http://localhost:8080
```

All'avvio, se il server richiede credenziali, compare la schermata di accesso. Si configura tutto in
`config.json → connection`:

| Chiave | Valori | Effetto |
|---|---|---|
| `engine` | `xerj`, `elasticsearch`, `opensearch` | XERJ → token API (`Authorization: ApiKey …`); gli altri → utente e password (Basic). |
| `engineSelectable` | `true`/`false` | `true`: nel login compare il flag XERJ per scegliere; `engine` è la posizione iniziale, poi il browser ricorda l'ultima. |
| `url` | URL | Server o proxy predefinito. |
| `urlEditable` | `true`/`false` | `false`: URL fisso, in sola lettura nel login (quello salvato nel browser viene ignorato). |
| `showUrl` | `true`/`false` | `false`: il campo URL non compare (e l'URL è fisso). |
| `revealPassword` | `true`/`false` | `false`: niente occhio per vedere provvisoriamente password o token. |
| `demo` | `true`/`false` | `false`: niente «Usa i dati demo». |

Fuori da `connection`, `config.json → skin` sceglie lo stile predefinito dell'interfaccia: `nova` (sidebar a sinistra) o `classic`
(barra in alto). L'utente lo cambia dal selettore «Stile», accanto a quello del tema (sistema/scuro/chiaro); entrambe le scelte restano nel browser.
Uno stile cambia solo CSS e posizione della navigazione: pagine e widget usano i token `var(--…)`/`ctx.theme` e lo seguono da soli.

Le credenziali stanno solo in `sessionStorage`; «Esci» in alto le cancella, il pulsante della connessione riapre
la schermata. Su un 401 la shell torna al login. Serve CORS verso l'origine della pagina, oppure il proxy: `python3 tools/proxy.py --upstream https://… --insecure`
(stessa origine; toglie `WWW-Authenticate` così il browser non apre il suo popup).

## Ricette

### Aggiungere un widget

1. Copia `widgets/custom/_template.js` in `widgets/custom/<type>.js`.
2. Imposta `type` (kebab-case, univoco), `name`, `desc`, `icon`, `params`, `query`, `rows`, `spec` (o `render`).
   Ogni testo visibile all'utente si scrive `{ en: '…', it: '…' }` (vedi «Lingue»).
3. Aggiungi `{ "type": "<type>", "module": "./<type>.js" }` a `widgets/custom/index.json`.
4. `node tools/validate.mjs --widget <type>` finché è verde.
5. Se il widget usa query o aggregazioni non supportate dal motore demo, il validatore lo dice:
   estendi `core/demo/engine.js` (vedi sotto) oppure, se è una funzione che esiste solo su XERJ,
   segnalalo all'utente.

### Personalizzare un widget standard

Non modificare `widgets/dist/`. Copia il file in `widgets/custom/` mantenendo lo **stesso `type`** e registralo
in `widgets/custom/index.json`: i manifest custom sono caricati dopo e **sostituiscono** il widget standard
(nel catalogo compare il badge «sostituisce»). Le dashboard esistenti continuano a funzionare perché
puntano al `type`. Per disattivare un widget custom senza cancellarlo: `"enabled": false` nel manifest.

### Aggiungere una pagina

1. Crea `pages/<id>/index.js` con `export default { id: '<id>', mount(slots, app) { … } }` e, se serve, `pages/<id>/<id>.css`.
2. Aggiungi `{ "id": "<id>", "title": "…", "module": "pages/<id>/index.js", "css": "pages/<id>/<id>.css" }` a `config.json → pages`.
3. La pagina è raggiungibile da tab e da `#/<id>`. Facoltativo `"engines": ["xerj", "demo", "es"]`: con quali connessioni la pagina
   c'è (`es` = Elasticsearch/OpenSearch); senza, c'è sempre. La shell nasconde la pagina e, se è aperta, passa alla prima disponibile. Facoltativo `"icon"`: SVG inline 18×18 con `currentColor` per la sidebar dello stile nova
   (`dashboard`, `discover` e `devtools` hanno già la loro icona).

### Creare una dashboard senza interfaccia

Una dashboard è un JSON descritto da `schemas/dashboard.schema.json`. Ogni pannello ha `type` (widget registrato),
`w` (3/4/6/8/12), `h` (s/m/l) e `params` (i valori dei parametri dichiarati dal widget; tutti quelli non indicati
prendono `init` del widget).

- In demo: incollala nel pulsante «JSON» della dashboard → «Applica» → «Salva».
- Su XERJ: `PUT vega-dashboards/_doc/<id>` con body `{ "title": "…", "updated_at": <epoch ms>, "definition": "<JSON della dashboard come stringa>" }`.
  L'`id` è lo slug del titolo (minuscole, trattini) al primo salvataggio, poi resta fisso: rinominare cambia solo `title`.
  Salvare di nuovo con lo stesso id sovrascrive. Per eliminarla: `DELETE vega-dashboards/_doc/<id>` (dall'interfaccia: «Modifica» → «Elimina»).
- Colori: `colors: { "<campo>": { "<valore>": 0-5 } }` (posizione nella palette). Facoltativo: se manca si assegna da solo.
- Filtri di pagina: `{ field, value, neg? }` oppure, per più valori in OR, `{ field, values: [...], neg? }`.
- Esempi completi: `pages/dashboard/examples.json`.

### Widget dichiarativi (JSON, anche in un indice)

Con XERJ e in demo un widget può essere un **documento JSON** invece di un modulo JS: si salva nell'indice dei widget
(`config.json → widgetIndex`, default `vega-widgets`; in demo nel browser) e compare nel catalogo sotto «Dall'indice (JSON)»,
senza build né file. Stesso `type` di un widget in file = sostituzione. Esempi: `widgets/declarative/seed.json`
(copiati nell'indice al primo uso in demo e da Impostazioni → Ripristina), compilati da `core/declarative.js`.

```jsonc
{ "type": "json-terms", "name": { "en": "…", "it": "…" }, "params": [ …come i widget JS… ],
  "query": { "size": 0, "query": "{{ctx.q}}", "aggs": { "k": { "terms": { "field": "{{field}}", "size": "{{size}}" } } } },
  "rows":  { "path": ["aggregations.k.buckets"], "map": { "k": "key", "v": "doc_count" } },
  "spec":  { "mark": "bar", "encoding": { … } },
  "color": { "param": "split", "row": "k" }, "brush": true, "click": "field" }
```

- **Template**: `"{{x}}"` da solo mantiene il tipo (numero, oggetto); dentro un testo interpola. Variabili: i parametri,
  `ctx.q`, `ctx.interval`, `ctx.from`, `ctx.to`, `ctx.height`. Anche le chiavi sono template (`{ "{{fn}}": { "field": … } }`).
- **Righe**: `path` = un array per livello; nella `map`, `^.` risale di un livello (`"t": "^.key"`). Per un valore solo: `{ "value": "aggregations.m.value" }`.
- **Spec**: Vega-Lite senza `data` (arrivano le righe); i testi `{ en, it }` dentro la spec si risolvono nella lingua attiva.
  `color` colora con i colori stabili della dashboard, `brush` collega lo zoom temporale, `click` è il parametro da filtrare.
- **Solo dati**: niente funzioni, niente `url`/`href`/`$ref`/`loader`/`usermeta` (dati esterni e link), niente `icon` o `css`
  dal documento. `show` di un parametro è `{ key, eq }` o `{ key, ne }`. Le regole sono in `checkDeclarative`.
- Su XERJ: `PUT vega-widgets/_doc/<type>` con `{ "type", "source": "user"|"builtin", "updated_at", "definition": "<JSON come stringa>" }`.
- `node tools/validate.mjs` compila ed esegue anche `seed.json`.

### Esporta, importa, ripristina (pagina Impostazioni)

Un file JSON `{ "format": "xvb-bundle", "version": 1, "exported_at", "engine", "widgets": [], "dashboards": [], "patterns": [], "prefs": {} }`.
Le credenziali non ci entrano mai. L'importazione valida tutto e mostra un'anteprima (nuovi / sovrascrive / non validi), poi
per sezione «Unisci» o «Sostituisci». Prima di scrivere, e prima di un ripristino, la board salva un backup
(`localStorage['xvb.backup.last']`; il ripristino lo scarica anche) e offre «Annulla». Il ripristino su XERJ rimette i widget
di esempio; in demo anche dashboard e pattern di esempio. Dopo un cambio la pagina emette l'evento `config` (la dashboard
rilegge l'elenco).

### Index pattern

Come i data view di Kibana: un nome con wildcard o più nomi separati da virgola (`ax-*`, `logs-a,logs-b`) e un campo tempo facoltativo.
Si gestiscono dalla pagina **Indici**; compaiono per primi nei selettori di indice di Discover e delle dashboard, e il loro campo tempo
è quello proposto in automatico (`backend.fields()` lo marca con `primary: true`, `ui.pickField` lo preferisce).
Solo con XERJ e in demo: con Elasticsearch/OpenSearch `backend.listPatterns()` ritorna `[]`.

- In demo: nel `localStorage` del browser.
- Su XERJ: `PUT vega-index-patterns/_doc/<id>` con body `{ "title": "ax-*", "timefield": "@timestamp", "updated_at": <epoch ms> }`
  (`config.json → patternIndex`). L'`id` è lo slug del titolo con `*` scritto `star` (`ax-*` → `ax-star`).

### Nascondere pagine

Da Impostazioni → «Pagine» l'utente sceglie quali pagine compaiono nella navigazione (`localStorage['xvb.pages.hidden']`,
esportato con le preferenze). Una pagina nascosta non è raggiungibile nemmeno da `#/<id>` (la shell passa alla prima disponibile).
Impostazioni non si nasconde, e dove Impostazioni non c'è (Elasticsearch/OpenSearch) la scelta non vale: si nasconde solo
dove si può anche rimostrare. Dal codice: `app.pageList()` e `app.setHiddenPages(ids)` (evento `pages`).
Per togliere una pagina a tutti gli utenti, invece, si toglie da `config.json → pages`.

### Agent Memory (pagina Memoria agenti, XERJ e demo)

Legge e modifica la memoria degli agenti: `GET /_memory/<ns>?from&size` (elenco, dal più recente), `POST /_memory/<ns>/_recall`
(`query`, `k`, `semantic: true` o `hybrid: true`) e `DELETE /_memory/<ns>/<id>` (con conferma; «Annulla» riscrive la voce con
`POST /_memory/<ns>` e lo stesso id, testo e metadati, ma non un vettore fornito dall'agente). Non elimina mai un namespace intero.
XERJ non ha un endpoint che elenchi i namespace (gli indici `.xerj-memory-*` sono riservati e le wildcard non li includono):
la pagina ricorda nel browser quelli aperti (`xvb.memory`). Un elenco dei namespace va chiesto a XERJ, non aggirato qui.

### Metriche (pagina Metriche, XERJ e demo)

Legge `GET /v1/metrics` (testo Prometheus, montato anche sulla porta ES) ogni N secondi mentre la pagina è aperta e tiene in
memoria gli ultimi 180 campioni. Tassi (query/s, documenti/s) e latenze p50/p95/p99 vengono dalla differenza tra due letture
(interpolazione nei bucket di `xerj_query_latency_seconds`, come `histogram_quantile`); i gauge (documenti, segmenti, memoria,
WAL, query cache) dall'ultima. Tabella per indice da `xerj_queries_by_index_total` e `xerj_docs_indexed_by_index_total`.

### Corpus Hub (pagina Corpus, solo XERJ)

La pagina legge solo gli endpoint read-only del nodo: `GET /_hub/v1/catalogue` (catalogo firmato), `/_hub/v1/search?q=`,
`/_hub/v1/code/<slug>?q=` e `/_hub/v1/def/<slug>/<simbolo>`; i pack caricati li ricava da `_cat/indices/xc-*`
(un pack ripristinato è `xc-<slug>-b<build>-*`). Non scarica niente: per un corpus non caricato mostra `xerj hub pull <slug>`.
Il nodo deve avere `[hub] catalogue_path` (il file scritto da `xerj hub sync`), la cartella dei pack (`~/.xerj/hub/packs`) in
`[limits] snapshot_repo_allowlist`, e girare con la stessa home (`HOME` / `XERJ_CODE_HOME`) di chi esegue `xerj hub pull`:
altrimenti gli indici ci sono ma `/_hub/v1/code` e `/def` rispondono `corpus_not_loaded`.

### Estendere il motore demo

`core/demo/engine.js` → `qMatch` (query) e `runAgg` (aggregazioni). Ogni ramo restituisce la stessa forma di
risposta di Elasticsearch. Mantieni gli errori espliciti (`throw new Error('… non supportata in demo: …')`):
è così che il validatore e l'interfaccia segnalano i buchi.

## Contratto dei widget

Un widget è un modulo ES con `export default` di un oggetto. Il registry lo scarta (e lo elenca sotto il pulsante «!»
e in Dev Tools) se non rispetta il contratto in `core/contract.js`.

| Campo | Obbligatorio | Significato |
|---|---|---|
| `type` | sì | Identificatore kebab-case. Uguale a un widget dist = sostituzione. |
| `name`, `desc` | `name` sì | Etichette nel catalogo, come `{ en, it }`. |
| `icon` | no | SVG inline 30×30 con `currentColor`. |
| `defaults` | no | `{ w, h }` per un pannello nuovo: `w` tra 3, 4, 6, 8, 12; `h` tra `s`, `m`, `l`. |
| `init` | no | Valori iniziali dei parametri (non mettere `index`/`timefield`: li sceglie l'editor). |
| `params` | sì | Array di parametri (tabella sotto). Generano il form di configurazione. |
| `target` | no | Numero di bucket temporali desiderati: decide `ctx.iv` quando l'intervallo è automatico. |
| `query(p, ctx)` | sì | Ritorna il body di `_search`. Parti sempre da `ctx.q`. |
| `rows(resp, p, ctx)` | sì | Risposta → array di righe piatte. Un `throw` mostra il messaggio nel pannello. |
| `spec(p, rows, ctx)` | uno dei due | Spec Vega-Lite con `data: { values: rows }`. |
| `render(el, p, rows, ctx)` | uno dei due | Alternativa HTML (es. `table`, `search`). |
| `click(p)` | no | Ritorna il campo da filtrare: un click su un elemento con `datum.k` aggiunge il filtro `campo = k`. Righe con `other: true` non sono cliccabili. |
| `control` | no | `true` = controllo: va nella barra sopra la griglia (come i Controls di Kibana), senza intestazione né altezza; `w` decide la larghezza, il titolo del pannello è l'etichetta (`ctx.title`). Richiede `render`. Es. `options-list`. |
| `keepEmpty` | no | `true` = chiama comunque `render`/`spec` con zero risultati. |
| `css` | no | CSS iniettato una volta. **Prefissa i selettori con `.w-<type>`** e usa solo i token `var(--…)`. |

### Parametri

| `type` | Campi aggiuntivi | Controllo |
|---|---|---|
| `index` | — | select degli indici |
| `field` | `ftype`: `date`, `keyword`, `number`, `text` (o funzione `p => tipo`) | select dei campi di quel tipo |
| `fields` | `kinds` (default keyword/number/date), `optional` | checkbox multiple → array |
| `select` | `options: [[valore, etichetta], …]` | select |
| `number` | `min`, `max` (obbligatori) | input numerico |
| `text` | `placeholder` | input testo, aggiornamento live |
| `json` | — | textarea con validazione JSON |

Comuni a tutti: `key`, `label`, `help` (HTML breve), `show: p => boolean` (visibilità condizionale).
`label`, `help`, `placeholder` e le etichette delle `options` accettano una stringa (uguale in ogni lingua) o `{ en, it }`.
Parametri pronti in `kit.P`: `index`, `time`, `filter`, `interval`, `size(label, min, max)`. Funzioni di metrica in `kit.FN` / `kit.FN_LABEL`,
nome leggibile con `kit.fnLabel(fn)`, etichette comuni in `kit.LABELS` (`docs`, `from`).

### `ctx`

| Campo | Contenuto |
|---|---|
| `q` | Query bool già pronta: range temporale + query e filtri della pagina + `p.filter`. |
| `tr` | `{ from, to }` in epoch ms. |
| `iv` | `[etichetta, ms]` dell'intervallo per `date_histogram` (usa `kit.dateHisto(field, ctx)`). |
| `height` | Altezza in px dell'area grafico (dipende da `h`). Non impostare `width`: la decide il pannello. |
| `theme` | Colori correnti: `fg, muted, line, sunk, surface, accent, ok, warn, danger, other, c[0..5]`, `font`, `mono`. |
| `fields` | Campi dell'indice: `[{ name, type }]`. |
| `response` | Risposta grezza (in `render`). |
| `state` | Oggetto transitorio per pannello (non salvato), es. il testo di una casella di ricerca. |
| `rerender()` | Riesegue query e disegno di questo pannello. |
| `setQuery(text)` | Imposta la query string della pagina. |
| `addFilter(field, value, neg)` | Aggiunge un filtro di pagina. |
| `setFilter(field, values, neg)` | Sostituisce i filtri (include o esclude) su un campo: `[]` li toglie, un valore = `term`, più valori = `terms` («è uno di»). |
| `filterValues(field, neg)` | Valori attualmente filtrati su quel campo (per mostrare la selezione). |
| `queryWithout(field)` | Come `q` ma senza i filtri di pagina su quel campo: un selettore calcola le sue opzioni senza la propria selezione. |
| `panelId` | Id del pannello (per id univoci nel DOM). |
| `color(field, value)` | Colore stabile del valore (usalo tramite `kit.colorOf`). Solo in dashboard. |
| `title` | Titolo del pannello (per un controllo: l'etichetta; vuoto = scegli tu, es. il nome del campo). |

### Convenzioni per le spec Vega-Lite

- Parti da `kit.baseSpec(ctx.height)` (larghezza `container`, autosize fit).
- Asse tempo su campo `t` con `kit.timeX`; per barre a intervallo usa `t`/`t2` **e metti `y2`**
  (`{ datum: 0 }` o un campo): con `x` + `x2` Vega-Lite tratta altrimenti `y` come banda e le barre diventano sottili.
  Per impilare barre a intervallo calcola `y0`/`y1` in `rows` (vedi `stacked.js`).
- Per lo zoom temporale aggiungi `params: [kit.brushParam(ctx.theme)]`: la shell ascolta il segnale `brush`.
- Colori solo da `ctx.theme` (categoriali in `c`, semantici in `ok`/`danger`): così il widget segue tema chiaro/scuro.
- **Un valore categoriale si colora con `kit.colorOf(ctx, campo, valore, i)`**, non con `theme.c[i]`: in dashboard il colore
  viene dalla mappa `colors` della dashboard (assegnato alla prima apparizione, stabile con qualsiasi filtro, uguale in tutti
  i pannelli, modificabile nell'editor → «Colori»); fuori dalla dashboard vale la posizione `i`. Se ritorna `theme.other`
  la palette è esaurita: trattalo come «Altro». Le scale di intensità (es. heatmap) restano su `theme`.
- Titoli di assi e tooltip con `kit.L({ en, it })`; i formati numerici d3 (`',.2~f'`) seguono la lingua attiva (virgola decimale in italiano).

## Lingue

Come Kibana, l'interfaccia segue il browser: legge `navigator.languages` (la stessa lista che il browser manda
nell'header `Accept-Language`) e usa la prima lingua supportata; se nessuna lo è, inglese. Oggi: `en` e `it`.
Il selettore in alto permette di forzarla (salvata nel browser); il cambio ricarica la pagina, quindi la lingua
è fissa per tutta la vita della pagina e si può risolvere anche a livello di modulo.

- **Core e pagine**: `t('area.chiave', { variabili })` da `core/i18n.js`, con le stringhe in `core/i18n/en.js` e `it.js`
  (stesse chiavi; una chiave mancante ricade sull'inglese). I valori possono contenere HTML fidato (`<code>`).
- **Widget**: niente cataloghi, i testi stanno nel widget come `{ en: '…', it: '…' }`. Nel form li risolve la shell;
  dentro `rows`, `spec` e `render` usa `kit.L({ en, it })`. Una stringa semplice va bene solo se è uguale in ogni lingua
  (es. `'Query (JSON)'`, `'ms, €, B…'`).
- **Titoli di pagine e dashboard**: stringa o `{ en, it }` (in `config.json`, negli esempi, nelle dashboard create da un agent);
  vengono fissati nella lingua attiva al caricamento.
- **Numeri e date**: `kit.fmtNum`, `kit.fmtDate` e i formati Vega usano la lingua attiva.
- **Aggiungere una lingua**: crea `core/i18n/<codice>.js` con le stesse chiavi di `en.js`, registrala in `CATALOGS`, `LANGS`
  e `LOCALES` di `core/i18n.js`, poi aggiungi `<codice>` ai testi `{ en, it, … }` dei widget.
  Il validatore segnala chiavi e traduzioni mancanti come avvisi.

## Contratto delle pagine

```js
export default {
  id: 'nome',                          // uguale a config.json
  async mount({ main, bar, filters }, app) {},   // una volta, alla prima visita
  show() {}, hide() {},                // opzionali, a ogni cambio di tab
  refresh() {},                        // opzionale: tempo, connessione o tema cambiati
  onIntent(intent) {}                  // opzionale: dati passati da app.navigate(id, intent)
};
```

`main` è il corpo della pagina, `bar` la riga sotto la navigazione (time picker, query, azioni),
`filters` lo spazio per i chip dei filtri. Componenti pronti in `core/ui.js`: `timePicker`, `queryBar`,
`filterChips`, `paramControl`, `autofill`, `confirm({ title, html, ok, danger })` (modale di conferma → `Promise<boolean>`).

### `app`

| Membro | Uso |
|---|---|
| `app.backend` | `msearch([{index, body}])`, `search(index, body)`, `fields(index)`, `indices()`, `request(method, path, body)`, `listDash()`, `saveDash(d)`, `deleteDash(id)`, `isDemo()`, `conn` (`{ mode: demo/xerj/es, url }`), `loggedIn`. |
| `app.widgets` | `Map` type → definizione, con `source` uguale a `dist` o `custom`. `app.problems` = widget scartati. |
| `app.time` | `value`, `range()`, `set(v)`, `back()`, `refresh`, `setRefresh(sec)`. Tempo globale condiviso tra pagine. |
| `app.on(evt, fn)` | Eventi: `time`, `connection`, `theme`. Ritorna la funzione per disiscriversi. |
| `app.navigate(id, intent)` | Cambia pagina. Discover usa `{ addPanel: {…} }` verso la dashboard. |
| `app.setTitle(t, { editable, onInput })` | Titolo grande nell'header. |
| `app.toast(msg, azione?, fn?)`, `app.modal.open(html, { onClose })` | Feedback e dialoghi. `[data-close]` chiude la modale; `onClose` viene chiamata a ogni chiusura (pulsante, Esc, click fuori). |

In console del browser l'oggetto è disponibile come `window.xvb`.

## Regole

1. Non aggiungere dipendenze né build step. Una libreria nuova si carica da CDN in `index.html`, con versione esatta.
2. Le chiamate di rete passano solo da `app.backend`. Niente `fetch` verso altri host dai widget.
3. Ogni valore che arriva dai dati va in HTML solo passando da `kit.esc` (o `kit.hlHtml` per i frammenti evidenziati).
4. Non modificare `widgets/dist/` per esigenze di un singolo cliente: usa la sostituzione in `widgets/custom/`.
5. Query DSL: resta su ciò che XERJ dichiara compatibile (`_search`, aggregazioni standard, `_msearch`, highlight).
   Se usi qualcosa di nuovo, provalo con Dev Tools sul motore reale e annotalo nel commento del widget.
6. Dopo ogni modifica: `node tools/validate.mjs`. Con `npm i vega-lite` (fuori dal progetto o in node_modules)
   il validatore compila anche le spec.

## Verifica

```sh
node tools/validate.mjs                  # tutto
node tools/validate.mjs --widget bullet  # un widget
node tools/validate.mjs --json           # output strutturato
```

Il validatore importa pagine e widget in Node, esegue ogni widget sul motore demo (su `ax-weblogs`, poi `ax-orders`)
e prova ogni pannello delle dashboard di esempio. Controlla anche i cataloghi e che ogni testo dei widget abbia tutte le lingue
(i buchi sono avvisi, non errori). Exit code 1 se c'è almeno un errore.

## Limiti noti

- XERJ v1.0.0-rc.74 (verificato il 2026-10-20): `_msearch` non espande le wildcard nell'header (`{"index":"ax-*"}` → 404, mentre
  `ax-*/_search` funziona) e `post_filter` viene ignorato. La pagina Ricerca usa due ricerche in un `_msearch` invece di `post_filter`.
  Le wildcard vanno corrette in XERJ, non aggirate qui.

- Discover pagina con `from`/`size` fino a 10.000 documenti; `search_after` + PIT richiederebbe `_pit` su XERJ.
- Il motore demo copre un sottoinsieme della query DSL: è un banco di prova, non un'implementazione di riferimento.
- Le dashboard in demo vivono nel `localStorage` del browser.
