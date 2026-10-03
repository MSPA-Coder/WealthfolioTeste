# Controle Patrimonial addon

Since 0.4.0 this addon no longer writes to Wealthfolio. Accounts and balances
are imported by the server (patch 0004, `apps/server/src/api/patrimonio_sync.rs`),
which has a single mapping from the CB and CRV `patrimonio/v4` snapshots to
Wealthfolio accounts and holdings snapshots. It runs every 15 minutes by itself,
so the daily snapshot never depends on someone having this page open. The older
versions imported from the browser with a different mapping, and the two together
left every account duplicated.

What the addon still does is read-only:

- It shows the state of the server-side import for each source (up to date,
  late, failed, token not configured), read from the `server.status.cb` and
  `server.status.crv` storage keys that the server writes after each run.
- It keeps a local, searchable copy of the source records: every CB cash entry,
  category, account and transfer group, all persisted CRV income records, every
  page of the CRV position ledger, and the CRV closed-activity summaries. They
  are only shown here; they are not converted into Wealthfolio activities or
  cash balances.
- It stores the two Bearer tokens in the secret vault. The server reads the same
  keys (`cb.token`, `crv.token`), so the tokens are configured once, on this page.

The permissions are `secrets` and `network` only. There is no `accounts` or
`snapshots` permission, so the addon cannot create, change or archive an account
or a snapshot.

After the tokens are saved, the enabled addon refreshes its local copy and repeats
it every 15 minutes while its runtime is active. Concurrent cycles are coalesced,
and `lastManualSyncAt` is written only after both sources finish. When a publisher
exposes its phase-4 change feed, the addon asks for one change page, refreshes its
copy only when that page has an invalidation, then persists the returned
watermark. A publisher without the feed stays on the full-snapshot fallback.

Each accepted response is checked for the v4 source and snapshot identifier.
CRV holdings must explicitly declare `instrument_type: "equity"`, so an option can
never be treated as an equity.

CRV income is explicitly analytic and may already be represented as cash in CB.
The CRV ledger is prospective; the source does not provide a historical backfill
before its declared coverage revision. CRV market price history is omitted from
the request to stay below the local network response limit. The addon requires the
custom Wealthfolio image and the exact local targets documented in the parent
README.

The CRV activities endpoint includes persisted income summaries and result
summaries for closed transactions. Closed transactions do not include full
execution lots or individual execution prices, so the source continues to
declare complete trades unavailable. Income entries already shown in the CRV
income table are not duplicated in the closed-activity table.

Requests use the private Docker HTTP aliases and send `X-Forwarded-Proto: https`,
matching CB's HTTPS-enforcement middleware and the server-side importer. The
public apps remain behind their HTTPS proxy.

Run `docker compose -f compose.addon-build.yaml run --rm addon-build` from the
parent directory to create `release/controle-patrimonial-sync.zip`. Install that
ZIP from Wealthfolio Settings > Addons and approve only the literal hosts declared
in `manifest.json`. After installing a new version, reload the Wealthfolio page.
