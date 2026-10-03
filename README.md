# Wealthfolio greenfield

Isolated Wealthfolio web installation built from Wealthfolio `v3.9.1` with the
local network-broker extension required for the CB and CRV APIs.
It starts with a new, exclusive Docker volume and does not use the reference
installation's `wealthfolio-data` volume. The web interface is published only
on this computer at <http://127.0.0.1:18088>.

## First start

1. Create a private host file containing one base64-encoded 32-byte master
   key, outside this repository. Copy `.env.example` to `.env`, set
   `WF_SECRET_KEY_HOST_PATH` to that file's absolute host path, and set
   `WF_AUTH_PASSWORD_HASH` to the Argon2id PHC hash for the login password.
   Preserve the master key for future restarts and backups.
2. From this directory, start the service with `docker compose up -d`.
3. Open <http://127.0.0.1:18088>.

Authentication is enabled and the published port remains bound to
`127.0.0.1`. The application creates its new SQLite database encrypted because
`WF_DB_REQUIRE_ENCRYPTION=1` is fixed before its first start. The master key is
mounted read-only from outside the repository; no key or password hash is
included here.

The named volume is `wealthfolio-teste-data`. This project does not attach to,
rename, or migrate data from the reference installation. The official image
configuration and self-hosting requirements are documented in the upstream
[`compose.yml`](https://github.com/wealthfolio/wealthfolio/blob/v3.9.1/compose.yml)
and [self-hosting guide](https://github.com/wealthfolio/wealthfolio/blob/v3.9.1/docs/self-host/README.md).

The integration contract used by the publishers and the connector is in
[`docs/patrimonio-v4.md`](docs/patrimonio-v4.md).

## Local source APIs

This Compose file builds Wealthfolio from the upstream v3.9.1 commit pinned
in the `Dockerfile`, plus the patches in `patches/` (see "Build e patches"
below). Patch 0000 makes that build accept only exact
`http://host:port/patrimonio/v4` values in
`WF_ADDON_NETWORK_PRIVATE_TARGETS`, only `GET` requests, and only addons that
declare the host literally in `network.allowedHosts`. The example targets point
to CB (`5201`) and CRV (`5301`) through Docker Desktop for Windows. Keep the
source applications bound to loopback; this setting does not publish them on
the network.

## Connector scheduling

The `controle-patrimonial-sync` addon stores both Bearer tokens in the local
system keyring. Once configured, it imports the two complete snapshots at
startup and every 15 minutes while the addon runtime is active; concurrent runs
are coalesced. With the phase-4 publisher outboxes installed, it saves a
checkpoint after a successful snapshot and skips the next snapshot when the
feed is unchanged. This deployment is a single Wealthfolio instance: device
sync must remain disabled because addon storage can be replicated between
devices.

## Addon simulation (run before packaging)

Nothing is packaged, installed or imported until the simulation passes. It runs
the real `src/addon.tsx` against an in-memory Wealthfolio host whose validation
rules are ported from the Wealthfolio 3.9.1 source (account schema, snapshot
handler, network broker limits, storage limits and permission guards), with no
network and no writes to CB, CRV or Wealthfolio:

```powershell
docker compose -f compose.addon-sim.yaml run --rm addon-sim
```

The simulation compiles the addon with the `esbuild` from `node_modules`, so
run the package build below (or `npm ci`) once before it on a fresh clone.

With `-e SIM_REAL=1` and the real API envelopes piped to stdin
(`docker run -i --network none -e SIM_REAL=1 ...`) the same checks run against
real responses, kept in memory only; the report contains counts, never values.
`sim/verify-package.mjs` checks the built ZIP and runs its `dist/addon.js`.
After installing a new add-on version, reload the Wealthfolio page before
clicking **Importar agora**; the previous runtime stays loaded until then.

## Addon package

Build the installable ZIP without Node.js on the host:

```powershell
docker compose -f compose.addon-build.yaml run --rm addon-build
```

The resulting
`addons/controle-patrimonial-sync/release/controle-patrimonial-sync.zip` is
installed through **Settings > Addons** in Wealthfolio. Approve only the three
literal network hosts shown by the manifest: `host.docker.internal`, `cb-api`
and `crv-api`. The token inputs are stored by Wealthfolio's secret store; the
addon itself never reads them back.

## VPS network

For a VPS that runs all three services, create patrimonio-internal once with
docker network create --internal patrimonio-internal, then start each project
with its compose.patrimonio-internal.yaml override. Only the CB and CRV web
services join that network, using the aliases cb-api and crv-api. Wealthfolio
then calls their APIs over Docker DNS and does not need a public HTTPS route
for this machine-to-machine traffic. The connector attempts these aliases after
the Docker Desktop local targets. The browser-facing services continue behind
the HTTPS reverse proxy.

## Build e patches

A imagem sai do `Dockerfile` deste repositório, sem nenhuma pasta fora do Git.
Ele baixa o Wealthfolio no commit fixado da tag v3.9.1 (`WEALTHFOLIO_COMMIT`),
aplica os arquivos de `patches/` na ordem do nome e compila com as mesmas
etapas do Dockerfile do upstream, com as imagens-base fixadas por digest.
O `git apply` não tem tolerância de espaço: patch que não casa exato para o
build.

| Patch | O que faz |
|---|---|
| `0000-addon-network-private-targets` | Libera no broker de rede dos add-ons os alvos locais exatos de `WF_ADDON_NETWORK_PRIVATE_TARGETS`, só GET. Sem a variável, nada muda em relação ao upstream. |
| `0001-patrimonio-server-sync` | Sincronização dos snapshots v4 do CB e do CRV no servidor, pela rede Docker interna e com os segredos cifrados do add-on. |
| `0002-patrimonio-sync-runtime-fixes` | Correções de transporte interno e de criação de snapshots. |
| `0003-fix-patrimonio-account-id-linkage` | Vínculo do id da conta entre o snapshot e a conta criada. |
| `0004-crv-market-to-mic` | Traduz o mercado do CRV (`B3`, `NYSE`, `NASDAQ`) para o MIC que o Wealthfolio usa para achar o sufixo do Yahoo (`BVMF`, `XNYS`, `XNAS`). Sem isso, as ações da B3 pediam o ticker puro e davam 404. |

Até 03/10/2026 o build usava `../CodexTemp/wealthfolio-v3.9.1`, uma cópia do
upstream com os patches aplicados à mão. O 0000 só existia lá. Upstream mais
0000 a 0003 foi conferido igual, arquivo a arquivo, a essa cópia.

A CI tem duas partes. O `ci.yml` roda em todo push: confere que os patches
aplicam no commit fixado, roda a simulação do add-on e valida o Compose. O
`imagem.yml` constrói a imagem, roda os testes do upstream nos módulos que os
patches mexem (`docker build --target testes .`) e sobe a imagem até o
`/api/v1/healthz` responder. Ele só roda quando o `Dockerfile` ou `patches/`
mudam, e uma vez por mês.

Para criar ou alterar um patch, parta do mesmo ponto que o build:

```bash
git clone https://github.com/wealthfolio/wealthfolio wf && cd wf
git checkout <WEALTHFOLIO_COMMIT>
for p in ../WealthfolioTeste/patches/*.patch; do git apply "$p"; done
git add -A && git commit -qm "patches atuais"
# edite e teste com cargo test; depois:
git diff > ../WealthfolioTeste/patches/0005-<nome>.patch
```

Para subir de versão, troque `WEALTHFOLIO_COMMIT` pelo commit da tag nova,
confira que os patches ainda aplicam e compare as etapas do `Dockerfile` com
as do upstream nessa tag.

## Backup

No VPS, o rótulo `mspa.backup.volume: /data` do `compose.yaml` coloca o volume
`wealthfolio-teste-data` no backup diário (`manutencao/vps/backup-db.sh`): o
diretório é copiado em `.tar.gz` com o contêiner pausado por segundos, porque
o SQLite em modo WAL copiado com a aplicação escrevendo pode sair inconsistente
sem dar erro. O BackupRestore busca a cópia e a guarda fora do servidor, em
`projects\wealthfolio_teste_vps\volume\`.

A cópia leva o banco cifrado, o `-wal` e o cofre de segredos (os tokens do
add-on para o CB e o CRV), e **só abre com a chave mestra**: guarde o arquivo
de `WF_SECRET_KEY_HOST_PATH` e o `.env` no cofre de recuperação, como pede o
`KIT_RECUPERACAO.md` do BackupRestore. O procedimento de volta está no
`RESTAURAR.md` de lá. Se o diretório de dados mudar, mude o rótulo junto: sem
ele, nada daqui entra no backup.
