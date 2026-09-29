# Controle Patrimonial addon

Read-only integration for the CB and CRV `patrimonio/v4` endpoints. It creates
only missing Wealthfolio accounts and replaces same-day `HOLDINGS` snapshots.
It also keeps a local, searchable source view of every CB cash entry, category,
account and transfer group, all persisted CRV income records, and every page of
the CRV position ledger. The source records are shown in the add-on and are not
converted into Wealthfolio activities or cash balances.

After the tokens are saved, the enabled addon makes one initial import and
repeats it every 15 minutes while its runtime is active. Concurrent cycles are
coalesced, and `lastManualSyncAt` is written only after both sources finish.
When a publisher exposes its phase-4 change feed, the addon asks for one change
page, refreshes its complete snapshot only when that page has an invalidation,
then persists the returned watermark. The checkpoint assumes the single
Wealthfolio instance used in this VPS deployment; do not enable device sync for
this instance. A publisher without the feed remains on the full-snapshot
fallback.

Each accepted response is checked for the v4 source and snapshot identifier.
An incremental source also supplies a watermark; a snapshot-only source may
declare it as `null`. CRV holdings must explicitly declare
`instrument_type: "equity"`, so an option can never be imported as an equity.
Holdings without a quotation are retained, and an account or
portfolio absent from a complete source snapshot receives an empty same-day
snapshot. The addon cannot delete or rename host accounts because those APIs
are intentionally outside its permissions.

CRV income is explicitly analytic and may already be represented as cash in CB.
The addon never creates CRV BUY/SELL or DIVIDEND activities, so it does not
double-count that cash. The CRV ledger is prospective; the source does not
provide a historical backfill before its declared coverage revision. CRV market
price history is omitted from the add-on request to stay below the local
network response limit; Wealthfolio continues to use its configured quote
provider. It requires the custom Wealthfolio image and the exact local targets
documented in the parent README.

The source tables are rebuilt with the full snapshot after a source change and
on manual import. CB coverage is reported by the publisher, including its
transfer completeness declaration. CRV ledger pages are read in order until
the publisher reports no next page. If that endpoint fails, the CRV holdings
snapshot still refreshes; the CRV source status is marked stale and the next
scheduled cycle retries the full source refresh.

Requests use the private Docker HTTP aliases and send
`X-Forwarded-Proto: https`, matching CB's HTTPS-enforcement middleware and the
server-side synchronizer. The public apps remain behind their HTTPS proxy.

Run `docker compose -f compose.addon-build.yaml run --rm addon-build` from the
parent directory to create `release/controle-patrimonial-sync.zip`. Install
that ZIP from Wealthfolio Settings > Addons and approve only the literal hosts
declared in `manifest.json`.
