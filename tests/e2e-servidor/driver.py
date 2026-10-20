"""Contrato atual: ledger CB, holdings CRV, idempotência e recuperação no servidor real."""

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlparse

API = "http://127.0.0.1:18090/api/v1"
PREFIXO = "controle-bancario:"
HOJE = date.today().isoformat()
INICIO = (date.today() - timedelta(days=10)).isoformat()
estado = {"wm": "w1", "despesa": "50.00", "falha_crv": False, "incompleto": False}
pedidos = []
total = 0


def conferir(condicao, regra):
    global total
    assert condicao, regra
    total += 1
    print("ok:", regra, flush=True)


def snapshot_cb():
    contas = [("a1", "Conta", "conta", "BRL", "1000.00", str(Decimal(1000) - Decimal(estado["despesa"]))),
              ("a2", "Reserva", "conta", "BRL", "250.50", "250.50"),
              ("a3", "Dólar", "conta", "USD", "300.00", "300.00"),
              ("a4", "Cartão", "cartao_credito", "BRL", "0.00", "-500.00"),
              ("a5", "Sem cobertura", "conta", "BRL", None, None)]
    itens = [{"resource": "account", "source_id": f"{PREFIXO}account:{i}", "payload": {
        "source_id": f"{PREFIXO}account:{i}", "name": nome, "account_type": tipo, "currency": moeda,
        "initial_balance": inicial, "initial_balance_date": INICIO, "balance": saldo, "balance_as_of": HOJE,
        "owner_name": "Titular teste", "institution_name": "Banco teste", "institution_type": "Banco",
    }} for i, nome, tipo, moeda, inicial, saldo in contas]
    categoria = PREFIXO + "category:pesquisa"
    itens.append({"resource": "category", "source_id": categoria,
                  "payload": {"source_id": categoria, "name": "Pesquisa", "kind": "gerencial"}})
    for i, conta, valor in (("despesa", "a1", estado["despesa"]), ("cartao", "a4", "500.00")):
        chave = f"{PREFIXO}cash-entry:{i}"
        itens.append({"resource": "cash_entry", "source_id": chave, "payload": {
            "source_id": chave, "account_id": f"{PREFIXO}account:{conta}", "category_id": categoria,
            "category_kind": "gerencial", "status": "realizado", "entry_type": "despesa",
            "realized_date": HOJE, "realized_amount": valor, "currency": "BRL", "description": "Pesquisa sintética",
        }})
    cobertura = {tipo: {"state": "complete", "count": sum(i["resource"] == tipo for i in itens)}
                 for tipo in ("account", "cash_entry", "category")}
    if estado["incompleto"]:
        cobertura["cash_entry"]["state"] = "partial"
    return {"contrato": "patrimonio/v4", "sistema": "controle-bancario", "snapshot_id": estado["wm"],
            "generated_at": HOJE + "T12:00:00Z", "snapshot_as_of": HOJE, "high_watermark": estado["wm"],
            "items": itens, "coverage": cobertura}


def snapshot_crv():
    return {"contrato": "patrimonio/v4", "sistema": "controle-renda-variavel", "snapshot_id": estado["wm"],
            "generated_at": HOJE + "T12:00:00Z", "data_de_referencia": HOJE, "high_watermark": estado["wm"],
            "holdings": [{"source_id": "crv:petr4", "account": "xp", "account_name": "XP", "portfolio": "Real",
                          "instrument": "PETR4", "market": "B3", "currency": "BRL", "quantity": "100",
                          "average_cost": "30.00", "current_price": None, "instrument_type": "equity"}],
            "income": [], "coverage": {"holdings": {"complete": True}, "income": {"included": 0}}}


class Fonte(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        fonte = self.server.fonte
        pedidos.append((fonte, self.command, self.path))
        if self.headers.get("Authorization") != f"Bearer {fonte}token":
            self.send_error(401)
            return
        if fonte == "crv" and estado["falha_crv"]:
            self.send_error(503)
            return
        url = urlparse(self.path)
        if url.path.endswith("/metadata"):
            corpo = {"contrato": "patrimonio/v4", "sistema": fonte}
        elif url.path.endswith("/snapshot"):
            corpo = snapshot_cb() if fonte == "cb" else snapshot_crv()
        elif url.path.endswith("/changes"):
            cursor = parse_qs(url.query).get("after", [None])[0]
            corpo = {"contrato": "patrimonio/v4", "high_watermark": estado["wm"],
                     "items": [] if cursor == estado["wm"] else [{"cursor": estado["wm"], "operation": "upsert"}]}
        else:
            self.send_error(404)
            return
        dados = json.dumps(corpo).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_POST(self):
        pedidos.append((self.server.fonte, self.command, self.path))
        self.send_error(405)


def req(metodo, caminho, corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    requisicao = urllib.request.Request(API + caminho, data=dados, method=metodo,
                                       headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(requisicao, timeout=30) as resposta:
        bruto = resposta.read()
        return json.loads(bruto) if bruto else None


def contas():
    return req("GET", "/accounts?includeArchived=true")


def atividades():
    return req("POST", "/activities/search", {"page": 0, "pageSize": 1000})["data"]


def sincronizar():
    return {f["source"]: f["state"] for f in req("POST", "/patrimonio-sync/sync")["sources"]}


def nova(nome, origem=None, arquivada=False):
    conta = req("POST", "/accounts", {"name": nome, "accountType": "CASH", "currency": "BRL", "isActive": True,
                "isDefault": False, "trackingMode": "HOLDINGS",
                "meta": f"controlePatrimonial:{PREFIXO}account:{origem}" if origem else None,
                "provider": "PATRIMONIO_CB" if origem else None,
                "providerAccountId": f"{PREFIXO}account:{origem}" if origem else None})
    if arquivada:
        req("PUT", "/accounts/" + conta["id"], {**conta, "isArchived": True})
    return conta["id"]


def esperar(condicao, prazo=90):
    limite = time.monotonic() + prazo
    while time.monotonic() < limite:
        if condicao():
            return
        time.sleep(1)
    raise AssertionError("O servidor não convergiu no prazo.")


def main():
    fontes, processo = [], None
    with tempfile.TemporaryDirectory(prefix="wealthfolio-e2e-") as temporario:
        pasta = Path(temporario)
        log = (pasta / "servidor.log").open("wb")
        ambiente = {**os.environ, "WF_AUTH_REQUIRED": "false", "WF_DB_REQUIRE_ENCRYPTION": "1",
                    "WF_SECRET_KEY": base64.b64encode(b"s" * 32).decode(), "WF_DB_PATH": str(pasta / "wealthfolio.db"),
                    "WF_LISTEN_ADDR": "127.0.0.1:18090", "WF_PATRIMONIO_SYNC_CRON": "",
                    "WF_ADDON_NETWORK_PRIVATE_TARGETS": "http://cb-api:8000/patrimonio/v4,http://crv-api:5003/patrimonio/v4"}
        for chave in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            ambiente.pop(chave, None)

        def iniciar(intervalo):
            ambiente["WF_PATRIMONIO_SYNC_INTERVAL_SECS"] = str(intervalo)
            p = subprocess.Popen([sys.argv[1]], env=ambiente, cwd=pasta, stdout=log, stderr=log)

            def disponivel():
                if p.poll() is not None:
                    raise AssertionError("Servidor encerrou antes do health check.")
                try:
                    return urllib.request.urlopen(API + "/healthz", timeout=2).read() == b"ok"
                except (urllib.error.URLError, TimeoutError):
                    return False

            esperar(disponivel, 60)
            return p

        try:
            for porta, fonte in ((8000, "cb"), (5003, "crv")):
                servidor = ThreadingHTTPServer(("127.0.0.1", porta), Fonte)
                servidor.fonte = fonte
                Thread(target=servidor.serve_forever, daemon=True).start()
                fontes.append(servidor)
            processo = iniciar(0)
            conferir(set(sincronizar().values()) == {"not_configured"}, "ausência de token é distinguida de falha")
            for fonte in ("cb", "crv"):
                req("POST", "/addons/controle-patrimonial-sync/secrets", {"key": fonte + ".token", "secret": fonte + "token"})
            adotada = nova("Legada", "a1")
            arquivada = nova("Arquivada pelo operador", "a2", True)
            manual = nova("Conta manual do operador")
            conferir(set(sincronizar().values()) == {"ready"}, "fontes completas são importadas")
            conjunto = contas()
            vivas = [c for c in conjunto if not c["isArchived"]]
            origens = {c.get("providerAccountId"): c for c in vivas}
            conferir(origens[PREFIXO + "account:a1"]["id"] == adotada, "conta legada é adotada sem duplicação")
            conferir(origens[PREFIXO + "account:a1"]["trackingMode"] == "TRANSACTIONS", "caixa CB é explicado pelo ledger")
            conferir(origens[PREFIXO + "account:a2"]["id"] != arquivada, "conta arquivada não é reutilizada")
            conferir(next(c for c in conjunto if c["id"] == arquivada)["isArchived"], "arquivamento do operador é preservado")
            conferir(origens[PREFIXO + "account:a3"]["currency"] == "USD", "conta em dólar preserva moeda")
            conferir(origens[PREFIXO + "account:a4"]["accountType"] == "CREDIT_CARD", "cartão conserva seu tipo")
            conferir(PREFIXO + "account:a5" not in origens, "ausência de saldo não vira zero")
            conferir(next(c for c in conjunto if c["id"] == manual)["name"] == "Conta manual do operador", "conta não gerenciada é preservada")
            carteira = next(c for c in vivas if c["provider"] == "PATRIMONIO_CRV")
            holdings = req("GET", "/holdings?accountId=" + carteira["id"])
            conferir(any((h.get("instrument") or {}).get("symbol") == "PETR4" for h in holdings), "posição CRV é persistida na corretora")
            iniciais = atividades()
            chave = PREFIXO + "cash-entry:despesa"
            despesa = next(a for a in iniciais if a.get("sourceRecordId") == chave)
            conferir(Decimal(str(despesa["amount"])) == Decimal("50"), "valor realizado é preservado")
            conferir(despesa["sourceSystem"] == "CONTROLE_BANCARIO", "atividade identifica a fonte gerenciadora")
            ids = {a["id"] for a in iniciais}
            ids_contas = {c["id"] for c in conjunto}
            sincronizar()
            conferir({a["id"] for a in atividades()} == ids, "reexecução preserva identidades das atividades")
            conferir({c["id"] for c in contas()} == ids_contas, "reexecução não duplica contas")
            estado.update(falha_crv=True, despesa="60.00", wm="w2")
            parcial = sincronizar()
            conferir(parcial["cb"] == "ready" and parcial["crv"] != "ready", "falha CRV não oculta sucesso CB")
            atual = next(a for a in atividades() if a.get("sourceRecordId") == chave)
            conferir(Decimal(str(atual["amount"])) == Decimal("60"), "valor alterado na fonte atualiza atividade")
            conferir(len(atividades()) == len(iniciais), "alteração não duplica atividades")
            ids_antes_incompleto = {a["id"] for a in atividades()}
            estado.update(falha_crv=False, incompleto=True, wm="w3")
            conferir(sincronizar()["cb"] != "ready", "cobertura parcial é recusada")
            conferir({a["id"] for a in atividades()} == ids_antes_incompleto, "fonte incompleta não apaga histórico")
            estado.update(incompleto=False, wm="w4")
            conferir(set(sincronizar().values()) == {"ready"}, "recuperação das fontes é segura")
            processo.terminate()
            processo.wait(timeout=20)
            processo = iniciar(60)
            pedidos.clear()
            esperar(lambda: any("/changes" in caminho for _, _, caminho in pedidos))
            conferir(not any("/snapshot" in caminho for _, _, caminho in pedidos), "agendador sem mudança consulta só feed")
            estado.update(despesa="70.00", wm="w5")
            pedidos.clear()
            esperar(lambda: any(fonte == "cb" and "/snapshot" in caminho for fonte, _, caminho in pedidos))
            esperar(lambda: any(a.get("sourceRecordId") == chave and Decimal(str(a["amount"])) == Decimal("70") for a in atividades()))
            conferir(len(atividades()) == len(iniciais), "agendador converge após reinício sem duplicação")
            conferir(all(metodo == "GET" for _, metodo, _ in pedidos), "fontes recebem somente leitura")
            bancos = list(pasta.rglob("app.db"))
            conferir(bool(bancos) and all(b.read_bytes()[:16] != b"SQLite format 3\x00" for b in bancos),
                     "bancos dos perfis permanecem cifrados")
            print(json.dumps({"resultado": "aprovado", "verificacoes": total}))
        except BaseException:
            log.flush()
            print((pasta / "servidor.log").read_text(errors="replace")[-4000:])
            raise
        finally:
            if processo is not None and processo.poll() is None:
                processo.terminate()
                processo.wait(timeout=20)
            log.close()
            for servidor in fontes:
                servidor.shutdown()
                servidor.server_close()


if __name__ == "__main__":
    main()
