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

This Compose file builds the local Wealthfolio source in
`../CodexTemp/wealthfolio-v3.9.1`. That build accepts only exact
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

## Patch de integração patrimonial

O código do Wealthfolio é mantido a partir da versão upstream 3.9.1. Antes de criar a imagem, execute `scripts/apply-upstream-patches.sh` contra o checkout indicado; o script é idempotente e aplica, em ordem, todos os `patches/*.patch`. O primeiro patch implementa a sincronização protegida de snapshots CB/CRV v4 usando somente a rede Docker interna e os segredos cifrados do add-on; o `0004` traduz o mercado do CRV (`B3`, `NYSE`, `NASDAQ`) para o MIC (`BVMF`, `XNYS`, `XNAS`), sem o qual o Yahoo recebe o ticker sem sufixo e responde 404.

### Implantar uma mudança de patch no VPS

O `deploy.sh wealthfolio` **não aplica patches** e responde "Nada a fazer" quando o `main` já está implantado, mesmo que o código-fonte tenha mudado. Para uma mudança em `patches/`, na ordem:

1. Mesclar o PR no `main`.
2. No VPS, aplicar os patches ao checkout do upstream (`apps/CodexTemp/wealthfolio-v3.9.1`): `sh scripts/apply-upstream-patches.sh ~/apps/CodexTemp/wealthfolio-v3.9.1`, a partir de `~/apps/wealthfolio-teste`. A mensagem `patch does not apply` que aparece antes é a verificação reversa do script e não indica falha; confira com `grep` por um símbolo do patch no código-fonte.
3. Rodar `~/backup-db.sh --forcar` (copia o volume com o contêiner pausado por segundos).
4. Reconstruir: `docker compose --env-file .env -f compose.yaml -f compose.patrimonio-internal.yaml up -d --build`, a partir de `~/apps/wealthfolio-teste`. A compilação do servidor leva cerca de 35 minutos.
5. Conferir `/health` e `docker inspect` (contêiner `healthy`).

A sincronização da tela passa pelo **add-on**, não pela rota do servidor (`POST /api/v1/snapshots` vem do navegador). Uma correção de dados enviados ao Wealthfolio costuma precisar das duas pontas: o patch e uma nova versão do add-on, instalada em **Settings > Addons**. Um ativo que já existe não é atualizado pelo Wealthfolio; mudar o MIC cria ativos novos, e os antigos ficam sem posição.

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
