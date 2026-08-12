#!/usr/bin/env python3
"""Dev server: http.server plus Cache-Control: no-store, because WebKit's HTTP
cache serves stale ES modules across app runs (the trap CLAUDE.md documents)."""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


class NoStoreHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
root = Path(__file__).resolve().parents[2]
HTTPServer(('127.0.0.1', port), partial(NoStoreHandler, directory=str(root))).serve_forever()
