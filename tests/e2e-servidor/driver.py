import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
from datetime import date
from pathlib import Path

AQUI = Path(__file__).resolve().parent
BIN = Path(sys.argv[1]); PORT = 18090
API = f"http://127.0.0.1:{PORT}/api/v1"
W = AQUI / "run"; CTL = W / "ctl.json"; LOG = W / "log.txt"
HOJE = date.today().isoformat()
ADDON = "controle-patrimonial-sync"
falhas = []

def req(metodo, caminho, corpo=None, ok=(200, 204)):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    r = urllib.request.Request(API + caminho, data=dados, method=metodo, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            texto = resp.read().decode()
            return resp.status, (json.loads(texto) if texto.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def confere(cond, msg):
    print(("  ok  " if cond else "  FALHA ") + msg)
    if not cond: falhas.append(msg)

def ctl(**kw):
    c = json.loads(CTL.read_text()); c.update(kw); CTL.write_text(json.dumps(c))

def subir(intervalo):
    env = {**os.environ, "WF_SECRET_KEY": base64.b64encode(b"k" * 32).decode(), "WF_DB_PATH": str(W / "dados" / "wealthfolio.db"),
           "WF_LISTEN_ADDR": f"127.0.0.1:{PORT}", "WF_STATIC_DIR": str(W / "dist"),
           "WF_ADDON_NETWORK_PRIVATE_TARGETS": "http://cb-api:8000/patrimonio/v4,http://crv-api:5003/patrimonio/v4",
           "RUST_LOG": "info,wealthfolio_server::api::patrimonio_sync=debug"}
    env.pop("HTTP_PROXY", None); env.pop("HTTPS_PROXY", None); env.pop("http_proxy", None); env.pop("https_proxy", None)
    if intervalo: env["WF_PATRIMONIO_SYNC_INTERVAL_SECS"] = str(intervalo)
    log = open(W / "servidor.log", "ab")
    p = subprocess.Popen([str(BIN)], env=env, stdout=log, stderr=log, cwd=W)
    for _ in range(120):
        try:
            if urllib.request.urlopen(f"{API}/healthz", timeout=2).read() == b"ok": return p
        except Exception: time.sleep(1)
    p.kill(); raise SystemExit("servidor não subiu; veja run/servidor.log")

def parar(p):
    p.terminate()
    try: p.wait(15)
    except Exception: p.kill()

def contas():
    s, c = req("GET", "/accounts?includeArchived=true"); assert s == 200, c; return c

def caixa(conta_id):
    s, h = req("GET", f"/snapshots/holdings?accountId={conta_id}&date={HOJE}")
    if s != 200 or not isinstance(h, list): return None
    total = None
    for x in h:
        sim = (x.get("instrument") or {}).get("symbol", "") if isinstance(x.get("instrument"), dict) else ""
        if x.get("holdingType") == "cash" or "CASH" in str(sim).upper() or "CASH" in str(x.get("id", "")).upper():
            q = x.get("quantity", x.get("localCurrency"))
            total = (total or 0) + float(q if q is not None else 0)
    return total

def pedidos():
    return LOG.read_text().splitlines() if LOG.exists() else []

# ---------------------------------------------------------------- preparo
import shutil
shutil.rmtree(W, ignore_errors=True); (W / "dados").mkdir(parents=True); (W / "dist").mkdir()
CTL.write_text(json.dumps({"wm": "w1", "a1": "1000.00"})); LOG.write_text("")
fontes = subprocess.Popen([sys.executable, str(AQUI / "fontes.py"), str(CTL), str(LOG)])
time.sleep(1)
srv = subir(None)
try:
    print("== 1. sem token configurado: não é falha")
    s, st = req("POST", "/patrimonio-sync/sync")
    estados = {x["source"]: x["state"] for x in st["sources"]}
    confere(estados == {"cb": "not_configured", "crv": "not_configured"}, f"estados {estados}")

    print("== 2. tokens no cofre do add-on e contas já existentes (como no VPS)")
    for k, v in (("cb.token", "cbtoken"), ("crv.token", "crvtoken")):
        s, _ = req("POST", f"/addons/{ADDON}/secrets", {"key": k, "secret": v}); confere(s in (200, 204), f"segredo {k}: {s}")
    def nova(nome, tipo, moeda, meta, provider=None, pid=None):
        s, c = req("POST", "/accounts", {"name": nome, "accountType": tipo, "currency": moeda, "isDefault": False, "isActive": True,
                                           "meta": meta, "provider": provider, "providerAccountId": pid, "trackingMode": "HOLDINGS"})
        assert s == 200, (s, c); return c["id"]
    P = "controlePatrimonial:"
    a1 = nova("CB · Conta 1", "CASH", "BRL", P + "controle-bancario:account:a1")
    a2_arq = nova("Conta 2", "CASH", "BRL", json.dumps({"sourceId": "controle-bancario:account:a2"}), "PATRIMONIO_CB", "controle-bancario:account:a2")
    s, c = req("PUT", f"/accounts/{a2_arq}", {"name": "Conta 2", "accountType": "CASH", "isDefault": False, "isActive": True, "isArchived": True,
                                              "meta": json.dumps({"sourceId": "controle-bancario:account:a2"}), "provider": "PATRIMONIO_CB",
                                              "providerAccountId": "controle-bancario:account:a2", "trackingMode": "HOLDINGS"})
    confere(s == 200 and c["isArchived"] is True, "cópia do servidor arquivada pelo operador")
    a3 = nova("Conta em dólar", "CASH", "USD", json.dumps({"sourceId": "controle-bancario:account:a3"}), "PATRIMONIO_CB", "controle-bancario:account:a3")
    gone = nova("CB · Conta que saiu", "CASH", "BRL", P + "controle-bancario:account:gone")
    xp = nova("CRV · XP · Carteira BRL", "SECURITIES", "BRL", P + "crv:acc-xp:Carteira BRL:BRL")
    antes = len(contas())

    print("== 3. sincronização manual")
    s, st = req("POST", "/patrimonio-sync/sync")
    confere(s == 200, f"POST sync: {s}")
    estados = {x["source"]: x["state"] for x in st["sources"]}
    confere(estados == {"cb": "ready", "crv": "ready"}, f"estados {estados}; erros {[x['error'] for x in st['sources']]}")
    cs = contas(); por_id = {c["id"]: c for c in cs}
    vivas = [c for c in cs if not c["isArchived"]]
    nomes = sorted(c["name"] for c in vivas)
    print("   contas vivas:", nomes)
    confere(por_id[a1]["name"] == "CB · Conta 1", "a1 (marcador do add-on) adotada, mesma conta")
    confere(por_id[a3]["name"] == "CB · Conta em dólar" and por_id[a3]["meta"] == P + "controle-bancario:account:a3", "a3 (só identidade do servidor) adotada e renomeada")
    confere(por_id[a2_arq]["isArchived"] and por_id[a2_arq]["name"] == "Conta 2", "cópia arquivada não foi tocada")
    novas_a2 = [c for c in vivas if c["meta"] == P + "controle-bancario:account:a2"]
    confere(len(novas_a2) == 1 and novas_a2[0]["id"] != a2_arq, "a2 sem conta viva: criada uma nova, sem reaproveitar a arquivada")
    confere(caixa(novas_a2[0]["id"]) == 250.5, f"saldo da a2 nova: {caixa(novas_a2[0]['id'])}")
    confere(not any("Cartão" in n or "Sem saldo" in n for n in nomes), "cartão e conta sem saldo não viram conta")
    confere(por_id[xp]["name"] == "CRV · XP · Carteira BRL", "conta CRV do add-on adotada")
    av = [c for c in vivas if c["name"] == "CRV · Avenue · Carteira USD"]
    confere(len(av) == 1 and av[0]["currency"] == "USD" and av[0]["accountType"] == "SECURITIES", "conta CRV nova em USD, como o add-on faz")
    confere(len(cs) == antes + 2, f"só duas contas novas (a2 e Avenue): {antes} -> {len(cs)}")
    s, snaps = req("GET", f"/snapshots?accountId={a1}")
    confere(s == 200 and any(x.get("snapshotDate", x.get("date", "")).startswith(HOJE) for x in snaps), f"a1 tem foto de hoje ({len(snaps) if isinstance(snaps, list) else snaps})")
    s, h = req("GET", f"/snapshots/holdings?accountId={a1}&date={HOJE}")
    print("   amostra de holding de caixa:", json.dumps(h)[:300] if s == 200 else (s, h))
    confere(caixa(a1) == 1000.0, f"saldo de a1 na foto: {caixa(a1)}")
    s, snaps = req("GET", f"/snapshots?accountId={gone}")
    confere(s == 200 and len(snaps) >= 1, "conta que saiu da fonte recebeu a foto zerada")
    s, h = req("GET", f"/holdings?accountId={xp}")
    confere(s == 200 and sorted(x["instrument"]["symbol"] if isinstance(x.get("instrument"), dict) else x.get("symbol") for x in h) == ["PETR4", "VALE3"], f"posições da XP: {[ (x.get('instrument') or {}).get('symbol') for x in h]}")

    print("== 4. repetir não duplica")
    req("POST", "/patrimonio-sync/sync"); confere(len(contas()) == antes + 2, "segunda rodada: nenhuma conta nova")

    print("== 5. estado copiado para o add-on")
    s, v = req("GET", f"/addons/storage/{ADDON}/server.status.cb")
    confere(s == 200 and v and '"ready"' in (v if isinstance(v, str) else json.dumps(v)), f"server.status.cb legível pelo add-on: {str(v)[:90]}")
    parar(srv)

    print("== 6. agendador (a cada 60 s), sem nenhuma requisição depois da partida")
    LOG.write_text("")
    srv = subir(60)
    time.sleep(70)
    p = pedidos(); print("   pedidos:", p)
    confere(any("/changes" in x for x in p) and not any("/snapshot" in x for x in p), "sem mudança: só /changes, nenhum /snapshot")
    ctl(wm="w2", a1="1111.00"); LOG.write_text("")
    time.sleep(65)
    p = pedidos(); print("   pedidos:", p)
    confere(any("cb /patrimonio/v4/snapshot" in x for x in p), "com mudança: o snapshot do CB foi buscado")
    s, st = req("GET", "/patrimonio-sync/status")
    confere({x["source"]: x["state"] for x in st["sources"]} == {"cb": "ready", "crv": "ready"}, "estados prontos depois do agendador")
    confere(next(x for x in st["sources"] if x["source"] == "cb")["highWatermark"] == "w2", "checkpoint do CB avançou para w2")
    confere(caixa(a1) == 1111.0, f"saldo de a1 atualizado pelo agendador: {caixa(a1)}")

    print("== 7. conta some da fonte: foto zerada, sem apagar")
    ctl(wm="w3", sem_a2=True)
    time.sleep(65)
    a2_viva = next(c for c in contas() if c["meta"] == P + "controle-bancario:account:a2" and not c["isArchived"])
    confere(caixa(a2_viva["id"]) in (None, 0.0), f"conta que saiu da fonte deixou de ter os 250.50 (agora: {caixa(a2_viva['id'])})")
    confere(any(c["id"] == a2_viva["id"] for c in contas()), "a conta não foi apagada")
    confere(not any(c["id"] == a2_arq and not c["isArchived"] for c in contas()), "a cópia arquivada continua arquivada")
finally:
    parar(srv); fontes.terminate()
print("\nRESULTADO:", "tudo ok" if not falhas else f"{len(falhas)} falha(s): {falhas}")
sys.exit(1 if falhas else 0)
