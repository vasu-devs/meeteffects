"""Small loopback-only preview server. No compiler, dependencies or persistence."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import os

ROOT = Path(__file__).resolve().parents[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        if self.path == '/':
            self.send_response(302)
            self.send_header('Location', '/extension/studio.html')
            self.end_headers()
        elif any(part.startswith('.') for part in unquote(urlsplit(self.path).path).split('/')):
            self.send_error(404)
        else:
            super().do_GET()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        print(f'MeetEffects studio: http://localhost:{args.port} (PID {os.getpid()})', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
