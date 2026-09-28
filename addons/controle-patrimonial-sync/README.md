# Controle Patrimonial addon

Importer for the CB and CRV `patrimonio/v4/snapshot` endpoints.
It creates only missing accounts and replaces same-day `HOLDINGS` snapshots.

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

The addon never creates CRV BUY/SELL or DIVIDEND activities, so it does not
double-count cash already controlled by CB. It requires the custom Wealthfolio
image and the exact local targets documented in the parent README.

Run `docker compose -f compose.addon-build.yaml run --rm addon-build` from the
parent directory to create `release/controle-patrimonial-sync.zip`. Install
that ZIP from Wealthfolio Settings > Addons and approve only the literal hosts
declared in `manifest.json`.
