"""
Servidor de desenvolvimento.

O `python -m http.server` não manda Cache-Control, então o navegador aplica
cache heurístico e continua servindo módulos ES antigos depois de uma edição —
o que faz parecer que a mudança não funcionou. Aqui todo arquivo vai com
no-store.

Uso: python scripts/dev-server.py [porta]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


class SemCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, formato, *args):  # menos ruído no terminal
        if not args or "200" not in str(args):
            super().log_message(formato, *args)


def main() -> None:
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = partial(SemCache, directory=str(RAIZ))
    with ThreadingHTTPServer(("127.0.0.1", porta), handler) as servidor:
        print(f"Obra Missionária em http://localhost:{porta} (sem cache)")
        servidor.serve_forever()


if __name__ == "__main__":
    main()
