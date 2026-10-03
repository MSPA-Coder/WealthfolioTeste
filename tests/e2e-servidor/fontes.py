"""CB e CRV falsos, só para o teste ponta a ponta do importador do servidor."""
import json, sys, threading
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

CTL = Path(sys.argv[1]); LOG = Path(sys.argv[2])
HOJE = date.today().isoformat()

def ctl():
    return json.loads(CTL.read_text())

def cb():
    c = ctl(); p = "controle-bancario:"
    contas = [
        ("a1", "Conta 1", "conta", "BRL", c["a1"]), ("a2", "Conta 2", "conta", "BRL", "250.50"),
        ("a3", "Conta em dólar", "conta", "USD", "300.00"), ("a4", "Cartão", "cartao_credito", "BRL", "-500.00"),
        ("a5", "Sem saldo", "conta", "BRL", None),
    ]
    if c.get("sem_a2"):
        contas = [x for x in contas if x[0] != "a2"]
    items = [{"resource": "account", "source_id": f"{p}account:{i}", "payload": {
        "source_id": f"{p}account:{i}", "name": n, "account_type": t, "currency": m, "balance": b,
        "balance_as_of": HOJE}} for i, n, t, m, b in contas]
    items += [{"resource": "category", "source_id": f"{p}category:{k}", "payload": {"source_id": f"{p}category:{k}", "name": f"Cat {k}", "kind": "gerencial"}} for k in range(2)]
    items += [{"resource": "cash_entry", "source_id": f"{p}cash-entry:{k}", "payload": {"source_id": f"{p}cash-entry:{k}"}} for k in range(3)]
    n = lambda r: sum(1 for x in items if x["resource"] == r)
    return {"contrato": "patrimonio/v4", "sistema": "controle-bancario", "snapshot_id": "snap-" + c["wm"],
            "generated_at": HOJE + "T12:00:00Z", "high_watermark": c["wm"], "snapshot_as_of": HOJE, "items": items,
            "coverage": {k: {"state": "complete", "count": n(k)} for k in ("account", "cash_entry", "category")}}

def crv():
    c = ctl()
    def h(conta, nome, cart, ativo, mercado, moeda, qtd, pm):
        return {"source_id": f"crv:{ativo}", "account": conta, "account_name": nome, "portfolio": cart, "instrument": ativo,
                "market": mercado, "currency": moeda, "quantity": qtd, "average_cost": pm, "current_price": None, "instrument_type": "equity"}
    hs = [h("acc-xp", "XP", "Carteira BRL", "PETR4", "B3", "BRL", "100", "30.00"),
          h("acc-xp", "XP", "Carteira BRL", "VALE3", "B3", "BRL", "50", "60.00"),
          h("acc-av", "Avenue", "Carteira USD", "AAPL", "NYSE", "USD", "10", "150.00")]
    return {"contrato": "patrimonio/v4", "sistema": "controle-renda-variavel", "snapshot_id": "snap-" + c["wm"],
            "generated_at": HOJE + "T12:00:00Z", "high_watermark": c["wm"], "data_de_referencia": HOJE, "holdings": hs,
            "income": [], "coverage": {"holdings": {"complete": True}, "income": {"included": 0}}}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        sistema, token = self.server.sistema, self.server.token
        with LOG.open("a") as f: f.write(f"{__import__('time').strftime('%H:%M:%S')} {sistema} {self.path}\n")
        if self.headers.get("Authorization") != f"Bearer {token}":
            self.send_response(401); self.end_headers(); return
        u = urlparse(self.path); rota = u.path.removeprefix("/patrimonio/v4")
        if rota == "/metadata": corpo = {"contrato": "patrimonio/v4", "sistema": sistema}
        elif rota == "/snapshot": corpo = cb() if sistema == "cb" else crv()
        elif rota == "/changes":
            depois = parse_qs(u.query).get("after", [None])[0]
            wm = ctl()["wm"]
            corpo = {"contrato": "patrimonio/v4", "high_watermark": wm,
                     "items": [] if depois == wm else [{"cursor": wm, "resource": "account", "operation": "upsert"}]}
        else:
            self.send_response(404); self.end_headers(); return
        b = json.dumps(corpo).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

for porta, sistema, token in ((8000, "cb", "cbtoken"), (5003, "crv", "crvtoken")):
    s = ThreadingHTTPServer(("127.0.0.1", porta), H); s.sistema, s.token = sistema, token
    threading.Thread(target=s.serve_forever, daemon=True).start()
threading.Event().wait()
