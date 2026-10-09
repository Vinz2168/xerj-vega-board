# XERJ Vega Board

*English · [Italiano](README.it.md)*

A lightweight, extensible Kibana-style UI (**Dashboard**, **Discover**, **Dev Tools**) for [XERJ](https://github.com/xerj-org/xerj)
and any engine with an Elasticsearch-compatible API. Every chart is a modular widget with its own query and a Vega-Lite spec.

![Dashboard](docs/screenshots/01-dashboard-light.png)

- **Lightweight**: about 73 KB of application code gzipped, no build step, no npm dependencies. Native ES modules, served as they are.
- **Extensible**: a new widget, control or page is one file plus one line in a manifest. The core never needs to change.

## Features

- **Dashboard**: 12-column grid, widget catalogue, side editor, query bar and include/exclude filter chips, cross-filtering by clicking a chart,
  drag-to-zoom on time, auto-refresh, saved to the `vega-dashboards` index. Controls bar with **options lists**
  (single or multiple values, include/exclude). **Stable colours**: a value keeps its colour in every panel, whatever the filters, and can be changed by hand.
- **Discover**: histogram, field list with top values, expandable documents (table or JSON), include/exclude filters, «Add to dashboard».
- **Dev Tools**: Kibana-style REST console (Ctrl+Enter), history, examples, copy as curl.
- **Login**: API token for XERJ (`Authorization: ApiKey …`), username and password for Elasticsearch/OpenSearch.
  Credentials live in the browser tab only (`sessionStorage`).
- **Widgets**: metric, time series, series by category, top values, distribution, double donut, heatmap, documents, search
  with highlighting, options list, free Vega-Lite, plus a target-vs-threshold bullet as a custom example.
- **Light and dark theme**; UI in English or Italian, following the browser language.

Tested against XERJ v1.0.0-rc.93 and OpenSearch 3.9 (see [REPORT.md](REPORT.md), in Italian).

## Getting started

The board is a folder of static files. It talks to the engine from the browser, so it needs either CORS on the engine or a
same-origin proxy. The included proxy serves the board and forwards `/es/*` to the engine:

```sh
python3 tools/proxy.py --port 8080 --upstream http://localhost:9200
# open http://localhost:8080 (config.json points to http://localhost:8080/es)
```

For an HTTPS engine with a self-signed certificate (e.g. OpenSearch's demo setup), add `--insecure`. With no engine at hand,
choose **Use the demo data** on the login screen: synthetic data generated in the browser, queried with the same JSON.

## Configuration

Everything is in `config.json`. The `connection` section controls the login:

| Key | Values | Effect |
|---|---|---|
| `engine` | `xerj`, `elasticsearch`, `opensearch` | XERJ asks for an API token; the others ask for username and password. |
| `engineSelectable` | `true` / `false` | `true` shows a XERJ switch on the login screen; the browser remembers its position. |
| `url` | URL | Default engine or proxy URL. |
| `urlEditable` | `true` / `false` | `false`: the URL is fixed and read-only. |
| `showUrl` | `true` / `false` | `false`: the URL field is hidden (and fixed). |
| `revealPassword` | `true` / `false` | `false`: no eye button to show the password or token. |
| `demo` | `true` / `false` | `false`: no «Use the demo data» button. |

`pages` lists the pages (their order is the tab order) and `widgets` the widget manifests to load.

## Extending

- **New widget**: copy `widgets/custom/_template.js` and register it in `widgets/custom/index.json`.
- **Replace a standard widget**: put a widget with the same `type` in `widgets/custom/`. Existing dashboards keep working.
- **New page**: `pages/<id>/index.js` plus one line in `config.json`.
- **Check**: `node tools/validate.mjs` runs every widget against the demo engine and must end with `0 errors`.

Contracts and recipes are in [AGENTS.md](AGENTS.md) (in Italian), written for both people and coding agents.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Vincenzo Lombardo.

Vega, Vega-Lite and vega-embed (BSD-3-Clause) are loaded from a CDN and are not included in this repository.
