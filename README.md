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
