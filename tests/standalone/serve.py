"""Serve the independent test package on loopback only (Python 3.11+)."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import argparse

parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8800);args=parser.parse_args()
root=Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()
    def do_GET(self):
        if any(part.startswith('.') for part in self.path.split('/') if part):self.send_error(404);return
        super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'Text Memory independent web test: http://127.0.0.1:{args.port}/',flush=True)
server.serve_forever()
