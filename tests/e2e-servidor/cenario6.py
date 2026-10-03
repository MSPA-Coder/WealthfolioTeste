import base64, json, os, subprocess, sys, time
from pathlib import Path
AQUI = Path(__file__).resolve().parent; W = AQUI / "run"; CTL = W / "ctl.json"; LOG = W / "log.txt"
BIN = sys.argv[1]
CTL.write_text(json.dumps({"wm": "w1", "a1": "1000.00"})); LOG.write_text("")
fontes = subprocess.Popen([sys.executable, str(AQUI / "fontes.py"), str(CTL), str(LOG)])
env = {**os.environ, "WF_SECRET_KEY": base64.b64encode(b"k" * 32).decode(), "WF_DB_PATH": str(W / "dados" / "wealthfolio.db"),
       "WF_LISTEN_ADDR": "127.0.0.1:18090", "WF_STATIC_DIR": str(W / "dist"),
       "WF_ADDON_NETWORK_PRIVATE_TARGETS": "http://cb-api:8000/patrimonio/v4,http://crv-api:5003/patrimonio/v4",
       "WF_PATRIMONIO_SYNC_INTERVAL_SECS": "60", "RUST_LOG": "info,wealthfolio_server::api::patrimonio_sync=debug"}
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"): env.pop(k, None)
srv = subprocess.Popen([BIN], env=env, stdout=open(W / "s6.log", "wb"), stderr=subprocess.STDOUT, cwd=W)
t0 = time.time(); print("início", time.strftime("%H:%M:%S"))
bumped = False
try:
    while time.time() - t0 < 140:
        time.sleep(5)
        if not bumped and time.time() - t0 > 80:
            c = json.loads(CTL.read_text()); c.update(wm="w2", a1="1111.00"); CTL.write_text(json.dumps(c)); bumped = True
            print(time.strftime("%H:%M:%S"), "mudança publicada (w2)")
finally:
    srv.terminate(); fontes.terminate()
print(LOG.read_text())
