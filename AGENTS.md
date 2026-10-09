# AGENTS.md — XERJ Vega Board

Istruzioni per agent AI (e persone) che estendono o personalizzano questo progetto.
Leggi tutto prima della prima modifica: il progetto è piccolo, ma ha contratti precisi.

## In breve

- Interfaccia leggera per XERJ e per qualsiasi motore con API Elasticsearch: **Dashboard**, **Discover**, **Dev Tools**.
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
  registry.js              carica i manifest dei widget, importa i moduli, li valida
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
  styles.css               token di colore e stili condivisi
  demo/data.js             dati sintetici (ax-weblogs, ax-orders)
  demo/engine.js           motore che esegue il sottoinsieme di query DSL usato qui + router REST per Dev Tools
pages/
  dashboard/               index.js, dashboard.css, examples.json (dashboard demo)
  discover/                index.js, discover.css
  devtools/                index.js, devtools.css
widgets/
  dist/                    widget standard + index.json   (non modificarli per personalizzare)
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

Per collegarsi a XERJ: pulsante «Demo» in alto → XERJ → URL. Serve CORS verso l'origine della pagina
(o servire la cartella dallo stesso host del proxy).

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
3. La pagina è raggiungibile da tab e da `#/<id>`.

### Creare una dashboard senza interfaccia

Una dashboard è un JSON descritto da `schemas/dashboard.schema.json`. Ogni pannello ha `type` (widget registrato),
`w` (3/4/6/8/12), `h` (s/m/l) e `params` (i valori dei parametri dichiarati dal widget; tutti quelli non indicati
prendono `init` del widget).

- In demo: incollala nel pulsante «JSON» della dashboard → «Applica» → «Salva».
- Su XERJ: `PUT vega-dashboards/_doc/<id>` con body `{ "title": "…", "updated_at": <epoch ms>, "definition": "<JSON della dashboard come stringa>" }`.
  L'`id` è lo slug del titolo (minuscole, trattini) al primo salvataggio, poi resta fisso: rinominare cambia solo `title`.
  Salvare di nuovo con lo stesso id sovrascrive. Per eliminarla: `DELETE vega-dashboards/_doc/<id>` (dall'interfaccia: «Modifica» → «Elimina»).
- Esempi completi: `pages/dashboard/examples.json`.

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
| `panelId` | Id del pannello (per id univoci nel DOM). |

### Convenzioni per le spec Vega-Lite

- Parti da `kit.baseSpec(ctx.height)` (larghezza `container`, autosize fit).
- Asse tempo su campo `t` con `kit.timeX`; per barre a intervallo usa `t`/`t2` **e metti `y2`**
  (`{ datum: 0 }` o un campo): con `x` + `x2` Vega-Lite tratta altrimenti `y` come banda e le barre diventano sottili.
  Per impilare barre a intervallo calcola `y0`/`y1` in `rows` (vedi `stacked.js`).
- Per lo zoom temporale aggiungi `params: [kit.brushParam(ctx.theme)]`: la shell ascolta il segnale `brush`.
- Colori solo da `ctx.theme` (categoriali in `c`, semantici in `ok`/`danger`): così il widget segue tema chiaro/scuro.
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
| `app.backend` | `msearch([{index, body}])`, `search(index, body)`, `fields(index)`, `indices()`, `request(method, path, body)`, `listDash()`, `saveDash(d)`, `deleteDash(id)`, `isDemo()`. |
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

- Discover pagina con `from`/`size` fino a 10.000 documenti; `search_after` + PIT richiederebbe `_pit` su XERJ.
- Il motore demo copre un sottoinsieme della query DSL: è un banco di prova, non un'implementazione di riferimento.
- Le dashboard in demo vivono nel `localStorage` del browser.
