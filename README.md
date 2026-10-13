# Wealthfolio greenfield

Isolated Wealthfolio web installation built from the latest tested stable
upstream release with the local network-broker extension required for the CB
and CRV APIs.
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
[`compose.yml`](https://github.com/wealthfolio/wealthfolio/blob/main/compose.yml)
and [self-hosting guide](https://github.com/wealthfolio/wealthfolio/blob/main/docs/self-host/README.md).

The integration contract used by the publishers and the connector is in
[`docs/patrimonio-v4.md`](docs/patrimonio-v4.md).

## Local source APIs

This Compose file builds Wealthfolio from the last tested upstream release
commit pinned in the `Dockerfile`, plus the patches in `patches/` (see "Build e patches"
below). Patch 0000 makes that build accept only exact
`http://host:port/patrimonio/v4` values in
`WF_ADDON_NETWORK_PRIVATE_TARGETS`, only `GET` requests, and only addons that
declare the host literally in `network.allowedHosts`. The example targets point
to CB (`5201`) and CRV (`5301`) through Docker Desktop for Windows. Keep the
source applications bound to loopback; this setting does not publish them on
the network.

## Connector scheduling

The server imports the CB and CRV snapshots by itself. `WF_PATRIMONIO_SYNC_CRON`
is a five-field cron expression evaluated in `America/Sao_Paulo`; it defaults to
`0 8,14 * * 1-5` (08:00 and 14:00, Monday through Friday). It accepts `*`,
comma-separated values, ranges and `/step`; both `0` and `7` mean Sunday. When
the cron variable is empty or absent, the legacy
`WF_PATRIMONIO_SYNC_INTERVAL_SECS` interval is used instead (default: 900
seconds; `0` disables it). Cron takes precedence when both are present.

Changing only `WF_PATRIMONIO_SYNC_CRON` in `.env` is a runtime configuration
change: recreate the service with the existing image (`docker compose up -d
--no-build --force-recreate wealthfolio`) and no compilation is required. The
worker needs no browser; the server opens each profile at startup while either
scheduler is enabled, because the profile workers otherwise start only after a
request.

Each run asks the source's change feed first. With nothing new since the last
checkpoint, and a successful import already done today, it only touches the status
and returns. A new day always imports, because the balances the sources publish
are "as of today". `POST /api/v1/patrimonio-sync/sync` runs one import on demand
and ignores that shortcut; `GET /api/v1/patrimonio-sync/status` shows each source.

The tokens are the ones saved in the add-on page (`cb.token` and `crv.token` in
its secret vault). Until they exist, the status is `not_configured`, which is not a
failure.

The mapping is a single rule. CB: one account per cash account, named
`CB · <name>`, with one cash balance per day; cards, applications and accounts
without a published balance are not imported. CRV: one account per (account,
portfolio, currency), named `CRV · <account> · <portfolio>`, in the holdings
currency, with the open equity positions. An account that leaves a source, which
the source must declare as a complete collection, gets an empty snapshot instead of
keeping a stale one.

The accounts are found by the `meta` marker the older add-on wrote
(`controlePatrimonial:...`), then by provider identity, so accounts created before
the worker are adopted rather than duplicated. **Archived accounts are never
touched.** To retire a duplicate, archive it in Settings > Accounts; do not delete
it. A source account with no live account gets a new one.

This deployment is a single Wealthfolio instance: device sync must remain
disabled because addon storage can be replicated between devices.

## Addon simulation (run before packaging)

Nothing is packaged, installed or imported until the simulation passes. It runs
the real `src/addon.tsx` against an in-memory Wealthfolio host whose validation
rules are ported from the Wealthfolio 3.9.1 source (account schema, snapshot
handler, network broker limits, storage limits and permission guards), with no
network and no writes to CB, CRV or Wealthfolio:

```powershell
docker compose -f addons/controle-patrimonial-sync/compose.yaml run --rm addon-sim
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
docker compose -f addons/controle-patrimonial-sync/build/compose.yaml run --rm addon-build
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
Ele baixa o Wealthfolio no commit da release validada (`WEALTHFOLIO_COMMIT`),
aplica os arquivos de `patches/` na ordem do nome e compila com as mesmas
etapas do Dockerfile do upstream. As tags móveis das imagens-base são
reconstruídas e testadas semanalmente.
O `git apply` não tem tolerância de espaço: patch que não casa exato para o
build.

| Patch | O que faz |
|---|---|
| `0000-addon-network-private-targets` | Libera no broker de rede dos add-ons os alvos locais exatos de `WF_ADDON_NETWORK_PRIVATE_TARGETS`, só GET. Sem a variável, nada muda em relação ao upstream. |
| `0001-patrimonio-server-sync` | Sincronização dos snapshots v4 do CB e do CRV no servidor, pela rede Docker interna e com os segredos cifrados do add-on. |
| `0002-patrimonio-sync-runtime-fixes` | Correções de transporte interno e de criação de snapshots. |
| `0003-fix-patrimonio-account-id-linkage` | Vínculo do id da conta entre o snapshot e a conta criada. |
| `0004-crv-market-to-mic` | Traduz o mercado do CRV (`B3`, `NYSE`, `NASDAQ`) para o MIC que o Wealthfolio usa para achar o sufixo do Yahoo (`BVMF`, `XNYS`, `XNAS`). Sem isso, as ações da B3 pediam o ticker puro e davam 404. |
| `0005-patrimonio-sync-scheduler-and-adoption` | Importação agendada pelo servidor, com um só mapeamento: adota as contas que o add-on criou, ignora as arquivadas, importa a cada 15 minutos (com atalho pelo feed de mudanças e foto garantida a cada dia) e abre o perfil na partida. Inclui o mapeamento de mercado do 0004. |
| `0006-patrimonio-sync-run-log` | Uma linha de log por execução da importação (`Patrimonio sync run finished: cb=ready crv=ready`), boa ou má. Antes, uma execução bem-sucedida não deixava rastro, e o vigia não distinguia importador vivo de importador parado. |

Até 03/10/2026 o build usava `../CodexTemp/wealthfolio-v3.9.1`, uma cópia do
upstream com os patches aplicados à mão. O 0000 só existia lá. Upstream mais
0000 a 0003 foi conferido igual, arquivo a arquivo, a essa cópia.

A CI tem duas partes. O `ci.yml` roda em todo push: confere que os patches
aplicam no commit fixado, roda a simulação do add-on e valida o Compose. O
`imagem.yml` constrói a imagem, roda os testes do upstream nos módulos que os
patches mexem (`docker build --target testes .`) e sobe a imagem até o
`/api/v1/healthz` responder. Ele só roda quando o `Dockerfile` ou `patches/`
mudam, e também toda semana com `--pull` para validar as tags móveis das bases.
`upstream.yml` consulta semanalmente a última release estável do Wealthfolio,
abre um PR com o commit correspondente e dispara os dois workflows de teste.

Para criar ou alterar um patch, parta do mesmo ponto que o build:

```bash
git clone https://github.com/wealthfolio/wealthfolio wf && cd wf
git checkout <WEALTHFOLIO_COMMIT>
for p in ../WealthfolioTeste/patches/*.patch; do git apply "$p"; done
git add -A && git commit -qm "patches atuais"
# edite e teste com cargo test; depois:
git diff > ../WealthfolioTeste/patches/0007-<nome>.patch
```

O workflow `upstream.yml` verifica a última release estável uma vez por semana.
Ele abre um PR que atualiza `WEALTHFOLIO_COMMIT`; os testes confirmam que os
patches aplicam, os módulos afetados passam e a imagem sobe com health check e
scan de vulnerabilidades. A automação integra somente o commit exato aprovado
por esses checks.

### Implantar uma mudança de patch no VPS

Publique por branch, pull request com checks obrigatórios verdes e squash merge.
O checkout do VPS é somente um espelho do `main`: não faça `git pull`, build ou
commit manual nele. O timer central verifica diariamente commits com CI verde
e reconstrói semanalmente as tags-base móveis depois dos testes de imagem. Para
uma atualização imediata depois do merge, execute:

```bash
~/deploy.sh wealthfolio
```

O script central atualiza por fast-forward, reconstrói com o Compose correto,
aguarda o contêiner e confirma a saúde pelo endereço público. Em falha posterior
ao fast-forward, restaura o commit e a imagem anteriores. `~/deploy.sh --status`
continua disponível apenas para diagnóstico transversal.

Antes de cada deploy ou reconstrução, o fluxo central exige backup verificado.
O rollback restaura a imagem e o código anteriores, mas não reverte migrações
ou gravações feitas no SQLite depois da troca; mantenha as migrações
retrocompatíveis e trate transformações de dados com um procedimento próprio.

Dois cuidados que custaram caro: o Wealthfolio não atualiza o MIC de um ativo
que já existe, então mudar o MIC cria ativos novos e os antigos ficam sem
posição (a limpeza é pela tela); e, enquanto o add-on for anterior à 0.4.0, a
sincronização da tela passa por ele, não pelo servidor, então uma correção de
dados costuma precisar do patch e de uma nova versão do add-on, instalada em
**Settings > Addons**.

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
