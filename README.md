# XERJ Vega Board

Dashboard, Discover e Dev Tools leggeri per [XERJ](https://github.com/xerj-org/xerj) e per qualsiasi endpoint
compatibile con l'API Elasticsearch. Ogni grafico è un widget modulare con la sua query e una spec Vega-Lite.

- **Dashboard** — griglia a 12 colonne, catalogo di widget, editor laterale, filtri incrociati, zoom temporale col trascinamento, salvataggio nell'indice `vega-dashboards`.
- **Discover** — istogramma, campi con valori più frequenti, documenti espandibili, filtri include/esclude, «Aggiungi alla dashboard».
- **Dev Tools** — console REST in stile Kibana (Ctrl+Invio), cronologia, copia come curl, elenco dei widget registrati.

Nessuna build: ES modules nativi e Vega da CDN. Interfaccia in inglese o italiano, scelta dalla lingua del browser.

## Avvio

```sh
python3 -m http.server 8080
# http://localhost:8080 — parte in modalità demo con dati sintetici
```

Per XERJ: pulsante «Demo» → XERJ → URL del nodo o del proxy (serve CORS verso questa origine).

## Estendere

- Nuovo widget: copia `widgets/custom/_template.js`, registralo in `widgets/custom/index.json`.
- Sostituire un widget standard: stesso `type` in `widgets/custom/`.
- Nuova pagina: `pages/<id>/index.js` + una riga in `config.json`.
- Verifica: `node tools/validate.mjs`.

Contratti e ricette complete in [AGENTS.md](AGENTS.md).
