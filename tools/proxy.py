#!/usr/bin/env python3
"""Serve la board e inoltra /es/* a un nodo XERJ/ES (stessa origine → niente CORS).

Uso: python3 tools/proxy.py [--port 8080] [--root .] [--upstream http://localhost:9200] [--log test-out/proxy.log]

- File statici dalla cartella della board, con MIME espliciti (.js/.mjs → text/javascript, .json, .css, .svg).
- /es/<path>?<query> → <upstream>/<path>?<query>: metodo, body e content-type inoltrati così come sono;
  status, content-type e body della risposta restituiti così come sono (anche 4xx/5xx).
- Ascolta solo su 127.0.0.1. Solo libreria standard.
"""
import argparse
import http.client
import json
import os
import sys
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

MIME = {
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
    '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown',
}
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate'}


def make_handler(root, upstream, logf):
    up = urllib.parse.urlsplit(upstream)

    class H(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, **MIME}
        protocol_version = 'HTTP/1.1'

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def log_message(self, fmt, *args):
            pass  # i log vanno in logf

        def _log(self, rec):
            if logf:
                logf.write(json.dumps(rec) + '\n')
                logf.flush()

        def end_headers(self):
            if not self.path.startswith('/es/'):
                self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def _proxy(self):
            t0 = time.time()
            path = self.path[len('/es'):] or '/'
            n = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(n) if n else None
            headers = {}
            for k in ('Content-Type', 'Authorization', 'Accept'):
                if self.headers.get(k):
                    headers[k] = self.headers[k]
            conn = http.client.HTTPConnection(up.hostname, up.port or 80, timeout=120)
            try:
                conn.request(self.command, path, body=body, headers=headers)
                r = conn.getresponse()
                data = r.read()
                status = r.status
                rh = [(k, v) for k, v in r.getheaders() if k.lower() not in HOP and k.lower() != 'content-length']
            except Exception as e:  # upstream giù: 502 esplicito, distinguibile da un errore di XERJ
                status, rh = 502, [('Content-Type', 'application/json')]
                data = json.dumps({'error': {'type': 'proxy_error', 'reason': str(e)}}).encode()
            finally:
                conn.close()
            self.send_response(status)
            for k, v in rh:
                self.send_header(k, v)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
            rec = {'t': round(t0, 3), 'method': self.command, 'path': path, 'status': status,
                   'ms': round((time.time() - t0) * 1000), 'req_ct': headers.get('Content-Type'), 'req_len': n, 'resp_len': len(data)}
            if status >= 400:
                rec['req_body'] = (body or b'').decode('utf-8', 'replace')[:4000]
                rec['resp_body'] = data.decode('utf-8', 'replace')[:4000]
            self._log(rec)

        def _dispatch(self, static):
            if self.path.startswith('/es/') or self.path == '/es':
                return self._proxy()
            if static:
                return static()
            self.send_error(405)

        def do_GET(self):
            self._dispatch(super().do_GET)

        def do_HEAD(self):
            self._dispatch(super().do_HEAD)

        def do_POST(self):
            self._dispatch(None)

        def do_PUT(self):
            self._dispatch(None)

        def do_DELETE(self):
            self._dispatch(None)

        def do_OPTIONS(self):
            self._dispatch(None)

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--root', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    ap.add_argument('--upstream', default='http://localhost:9200')
    ap.add_argument('--log', default=None)
    a = ap.parse_args()
    logf = open(a.log, 'a') if a.log else None
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), make_handler(os.path.abspath(a.root), a.upstream, logf))
    print(f'serving {os.path.abspath(a.root)} on http://127.0.0.1:{a.port}  /es/* → {a.upstream}', file=sys.stderr, flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
