#!/usr/bin/env python3
"""Creative Generator – kleiner lokaler Dateiserver (nur Python-Standardbibliothek).

Die App läuft komplett im Browser und spricht direkt mit dem KI-Server (Ollama, LM Studio …).
Dieser Server liefert nur die Dateien aus – jeder andere statische Server (oder GitHub Pages) geht genauso.

Start:  python3 server.py [port]      (Standard: 8765, nur 127.0.0.1)
"""
import json
import os
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    server_version = 'CreativeGenerator/2.0'

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # nur Fehler protokollieren
        if len(args) > 1 and str(args[1])[:1] in '45':
            sys.stderr.write(fmt % args + '\n')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')   # Änderungen sofort sichtbar
        super().end_headers()

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/__creative-generator':   # Erkennung einer laufenden Instanz
            data = json.dumps({'app': 'creative-generator'}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


def already_running(port):
    """Läuft auf dem Port schon ein Creative-Generator-Server?"""
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/__creative-generator' % port, timeout=2) as r:
            return json.loads(r.read()).get('app') == 'creative-generator'
    except (OSError, ValueError):
        return False


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8765))
    srv = None
    for p in range(port, port + 20):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            break
        except OSError as e:
            if e.errno not in (48, 98):  # 48 = macOS, 98 = Linux: Adresse belegt
                raise
            if p == port and already_running(p):
                print('Creative Generator läuft bereits: http://localhost:%d – einfach im Browser öffnen.' % p, flush=True)
                return
            print('Port %d ist von einem anderen Programm belegt, versuche %d …' % (p, p + 1), flush=True)
    if srv is None:
        sys.exit('Kein freier Port zwischen %d und %d gefunden.' % (port, port + 19))
    if srv.server_address[1] != port:
        print('Hinweis: Auf einem anderen Port hat der Browser eigene gespeicherte Einstellungen und Designs.', flush=True)
    port = srv.server_address[1]
    srv.daemon_threads = True
    print('Creative Generator läuft auf http://localhost:%d  (Strg+C beendet)' % port, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
