import { useEffect, useState } from 'react';
import type { AddonContext, AddonEnableFunction, SnapshotHoldingInput } from '@wealthfolio/addon-sdk';

const CB_BASE_URLS = [
  'http://host.docker.internal:5201/patrimonio/v4',
  'http://cb-api:8000/patrimonio/v4',
];
const CRV_BASE_URLS = [
  'http://host.docker.internal:5301/patrimonio/v4',
  'http://crv-api:5003/patrimonio/v4',
];
const CB_TOKEN_KEY = 'cb.token';
const CRV_TOKEN_KEY = 'crv.token';
const ACCOUNT_META_KEY = 'controlePatrimonial';
const AUTO_SYNC_ENABLED_KEY = 'sync.enabled';
const AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const CB_CHECKPOINT_KEY = 'checkpoint.cb';
const CRV_CHECKPOINT_KEY = 'checkpoint.crv';
const CB_SYNC_STATUS_KEY = 'sync.status.cb';
const CRV_SYNC_STATUS_KEY = 'sync.status.crv';
const CB_RECORDS_KEY = 'records.cb.v1';
const CRV_RECORDS_KEY = 'records.crv.v1';
const STATUS_REFRESH_INTERVAL_MS = 5 * 1000;
const RECORDS_PAGE_SIZE = 50;
const STORAGE_CHUNK_LIMIT_BYTES = 180_000;
const SANITIZED_FAILURE = 'Falha ao sincronizar esta fonte. Verifique a disponibilidade e tente novamente.';

let activeSync: Promise<void> | undefined;

interface CbAccount {
  source_id: string;
  name: string;
  account_type: string;
  currency: string;
  balance: string | null;
}

interface CrvHolding {
  source_id: string;
  account: string;
  account_name: string;
  portfolio: string;
  instrument: string;
  market: string;
  currency: string;
  quantity: string;
  average_cost: string;
  current_price: string | null;
  instrument_type: 'equity';
}

interface SnapshotEnvelope {
  contrato?: string;
  sistema?: string;
  snapshot_id?: string;
  generated_at?: string;
  high_watermark?: string | null;
  accounts?: CbAccount[];
  items?: Array<{ resource: string; source_id?: string; payload: Record<string, unknown> }>;
  holdings?: CrvHolding[];
  income?: CrvIncome[];
  data_de_referencia?: string;
  snapshot_as_of?: string;
  coverage?: {
    account?: { state?: string };
    cash_entry?: Record<string, unknown>;
    holdings?: { complete?: boolean };
    income?: { included?: number; scope?: string; role?: string; do_not_rebook_as_cash?: boolean };
  };
}

type SourceRecord = Record<string, unknown>;

interface CrvIncome {
  source_id: string;
  date: string;
  instrument: string;
  kind: string;
  currency: string;
  amount: string;
  role: 'analytic_only';
  cash_accounting_role: 'not_a_cash_entry';
  duplicate_risk: string;
  account_name: string;
}

interface CachedCbRecords {
  cacheId: string;
  syncedAt: string;
  snapshotId: string;
  entries: SourceRecord[];
  accounts: SourceRecord[];
  categories: SourceRecord[];
  transfers: SourceRecord[];
  coverage: Record<string, unknown>;
}

interface CachedCrvRecords {
  cacheId: string;
  syncedAt: string;
  snapshotId: string;
  income: CrvIncome[];
  ledger: SourceRecord[];
  incomeCoverage: Record<string, unknown>;
  ledgerCoverage: Record<string, unknown>;
  ledgerComplete: boolean;
}

interface LedgerEnvelope {
  contrato?: string;
  sistema?: string;
  coverage?: Record<string, unknown>;
  paginacao?: { pagina?: number; tem_proxima?: boolean; total?: number };
  itens?: SourceRecord[];
}

interface NetworkResponse {
  status: number;
  body: string;
}

type SourceStatusValue = 'not_synced' | 'current' | 'stale' | 'failed';

interface SourceSyncStatus {
  status: SourceStatusValue;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  snapshotId: string | null;
  generatedAt: string | null;
  highWatermark: string | null;
  coverageComplete: boolean | null;
  failure: string | null;
}

interface AppliedSnapshot {
  snapshotId: string;
  generatedAt: string;
  highWatermark: string | null;
  coverageComplete: boolean;
}

const emptySourceStatus = (): SourceSyncStatus => ({
  status: 'not_synced',
  lastAttemptAt: null,
  lastSuccessAt: null,
  snapshotId: null,
  generatedAt: null,
  highWatermark: null,
  coverageComplete: null,
  failure: null,
});

function readSourceStatus(value: string | null | undefined): SourceSyncStatus {
  if (!value) return emptySourceStatus();
  try {
    const parsed = JSON.parse(value) as Partial<SourceSyncStatus>;
    const statuses: SourceStatusValue[] = ['not_synced', 'current', 'stale', 'failed'];
    if (!statuses.includes(parsed.status as SourceStatusValue)) return emptySourceStatus();
    return {
      status: parsed.status as SourceStatusValue,
      lastAttemptAt: typeof parsed.lastAttemptAt === 'string' ? parsed.lastAttemptAt : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === 'string' ? parsed.lastSuccessAt : null,
      snapshotId: typeof parsed.snapshotId === 'string' ? parsed.snapshotId : null,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : null,
      highWatermark: typeof parsed.highWatermark === 'string' ? parsed.highWatermark : null,
      coverageComplete: typeof parsed.coverageComplete === 'boolean' ? parsed.coverageComplete : null,
      failure: typeof parsed.failure === 'string' ? SANITIZED_FAILURE : null,
    };
  } catch {
    return emptySourceStatus();
  }
}

async function loadSourceStatus(ctx: AddonContext, storageKey: string) {
  return readSourceStatus(await ctx.api.storage.get(storageKey));
}

async function storeSourceStatus(ctx: AddonContext, storageKey: string, status: SourceSyncStatus) {
  await ctx.api.storage.set(storageKey, JSON.stringify(status));
}

async function storeRecordSet(ctx: AddonContext, prefix: string, records: SourceRecord[]) {
  const metaKey = `${prefix}.meta`;
  const chunks: SourceRecord[][] = [];
  let current: SourceRecord[] = [];
  for (const record of records) {
    const candidate = [...current, record];
    const bytes = new TextEncoder().encode(JSON.stringify(candidate)).length;
    if (bytes > STORAGE_CHUNK_LIMIT_BYTES && current.length > 0) {
      chunks.push(current);
      current = [record];
    } else {
      current = candidate;
    }
    if (new TextEncoder().encode(JSON.stringify(current)).length > STORAGE_CHUNK_LIMIT_BYTES) {
      throw new Error(SANITIZED_FAILURE);
    }
  }
  if (current.length) chunks.push(current);
  for (let index = 0; index < chunks.length; index += 1) {
    await ctx.api.storage.set(`${prefix}.${index}`, JSON.stringify(chunks[index]));
  }
  // Publish the new chunk count only after every chunk is safely written.
  await ctx.api.storage.set(metaKey, JSON.stringify({ chunks: chunks.length }));
}

async function deleteRecordSet(ctx: AddonContext, prefix: string) {
  const raw = await ctx.api.storage.get(`${prefix}.meta`);
  if (!raw) return;
  const count = Number((JSON.parse(raw) as { chunks?: number }).chunks ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > 1000) return;
  for (let index = 0; index < count; index += 1) await ctx.api.storage.delete(`${prefix}.${index}`);
  await ctx.api.storage.delete(`${prefix}.meta`);
}

async function loadRecordSet(ctx: AddonContext, prefix: string): Promise<SourceRecord[]> {
  const raw = await ctx.api.storage.get(`${prefix}.meta`);
  if (!raw) return [];
  let count: number;
  try {
    count = Number((JSON.parse(raw) as { chunks?: number }).chunks ?? 0);
  } catch {
    throw new Error(SANITIZED_FAILURE);
  }
  if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error(SANITIZED_FAILURE);
  const records: SourceRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = await ctx.api.storage.get(`${prefix}.${index}`);
    if (!chunk) throw new Error(SANITIZED_FAILURE);
    const parsed = JSON.parse(chunk) as unknown;
    if (!Array.isArray(parsed)) throw new Error(SANITIZED_FAILURE);
    records.push(...parsed as SourceRecord[]);
  }
  return records;
}

function sourceAccountId(source: string) {
  return `${ACCOUNT_META_KEY}:${source}`;
}

async function requestFromSource(
  ctx: AddonContext,
  baseUrls: string[],
  suffix: string,
  secretKey: string,
): Promise<NetworkResponse> {
  let lastError: unknown;
  for (const baseUrl of baseUrls) {
    try {
      return await ctx.api.network.request({
        url: `${baseUrl}${suffix}`,
        method: 'GET',
        // CB enforces HTTPS at the application layer. This private Docker
        // hop remains HTTP, while the trusted-proxy signal matches the
        // server-side sync client used by the same installation.
        headers: { 'X-Forwarded-Proto': 'https' },
        auth: { type: 'bearer', secretKey },
      }) as NetworkResponse;
    } catch (error) {
      lastError = error;
    }
  }
  // Network exceptions can contain a URL or request details. Never expose them.
  void lastError;
  throw new Error(SANITIZED_FAILURE);
}

async function fetchSnapshot(
  ctx: AddonContext,
  baseUrls: string[],
  secretKey: string,
  system: 'controle-bancario' | 'controle-renda-variavel',
): Promise<SnapshotEnvelope> {
  const suffix = system === 'controle-renda-variavel' ? '/snapshot?include_prices=false' : '/snapshot';
  const response = await requestFromSource(ctx, baseUrls, suffix, secretKey);
  if (response.status !== 200) throw new Error(SANITIZED_FAILURE);
  let snapshot: SnapshotEnvelope;
  try {
    snapshot = JSON.parse(response.body) as SnapshotEnvelope;
  } catch {
    throw new Error(SANITIZED_FAILURE);
  }
  if (
    snapshot.contrato !== 'patrimonio/v4'
    || snapshot.sistema !== system
    || typeof snapshot.snapshot_id !== 'string'
    || typeof snapshot.generated_at !== 'string'
    || (snapshot.high_watermark !== null && typeof snapshot.high_watermark !== 'string')
  ) {
    throw new Error(SANITIZED_FAILURE);
  }
  if (system === 'controle-bancario' && !Array.isArray(snapshot.items)) {
    throw new Error(SANITIZED_FAILURE);
  }
  if (system === 'controle-renda-variavel' && !Array.isArray(snapshot.holdings)) {
    throw new Error(SANITIZED_FAILURE);
  }
  if (system === 'controle-renda-variavel' && snapshot.holdings?.some((holding) => holding.instrument_type !== 'equity')) {
    throw new Error(SANITIZED_FAILURE);
  }
  return snapshot;
}

async function fetchCrvLedger(ctx: AddonContext): Promise<{ items: SourceRecord[]; coverage: Record<string, unknown> }> {
  const items: SourceRecord[] = [];
  let coverage: Record<string, unknown> = {};
  let page = 1;
  while (true) {
    const response = await requestFromSource(ctx, CRV_BASE_URLS, `/ledger?page=${page}&page_size=100`, CRV_TOKEN_KEY);
    if (response.status !== 200) throw new Error(SANITIZED_FAILURE);
    let body: LedgerEnvelope;
    try {
      body = JSON.parse(response.body) as LedgerEnvelope;
    } catch {
      throw new Error(SANITIZED_FAILURE);
    }
    if (body.contrato !== 'patrimonio/v4' || body.sistema !== 'controle-renda-variavel'
      || !Array.isArray(body.itens) || body.paginacao?.pagina !== page) {
      throw new Error(SANITIZED_FAILURE);
    }
    coverage = body.coverage ?? {};
    items.push(...body.itens);
    if (!body.paginacao.tem_proxima) break;
    page += 1;
    if (page > 1000) throw new Error(SANITIZED_FAILURE);
  }
  return { items, coverage };
}

async function changedSinceCheckpoint(
  ctx: AddonContext,
  baseUrls: string[],
  secretKey: string,
  checkpointKey: string,
): Promise<string | null> {
  const checkpoint = await ctx.api.storage.get(checkpointKey);
  const suffix = checkpoint ? `?after=${encodeURIComponent(checkpoint)}&limit=1` : '?limit=1';
  const response = await requestFromSource(ctx, baseUrls, `/changes${suffix}`, secretKey);
  // Mantém compatibilidade durante uma atualização gradual dos três serviços
  // no VPS: a fonte sem outbox continua no snapshot integral.
  if (response.status === 404) return 'snapshot-only';
  if (response.status !== 200) throw new Error(SANITIZED_FAILURE);
  let body: { items?: unknown[]; high_watermark?: string };
  try {
    body = JSON.parse(response.body) as { items?: unknown[]; high_watermark?: string };
  } catch {
    throw new Error(SANITIZED_FAILURE);
  }
  if (!body.items?.length) {
    // Sem checkpoint ainda não existe uma base local para o snapshot. A foto
    // inicial precisa ser feita mesmo quando a outbox está vazia.
    if (!checkpoint) return body.high_watermark ?? 'snapshot-only';
    if (body.high_watermark) await ctx.api.storage.set(checkpointKey, body.high_watermark);
    return null;
  }
  if (!body.high_watermark) throw new Error(SANITIZED_FAILURE);
  return body.high_watermark;
}

async function findOrCreateAccount(
  ctx: AddonContext,
  source: string,
  name: string,
  currency: string,
  accountType: 'CASH' | 'SECURITIES',
) {
  const marker = sourceAccountId(source);
  const existing = (await ctx.api.accounts.getAll()).find((account) => account.meta === marker);
  if (existing) return existing;
  return await ctx.api.accounts.create({
    name,
    accountType,
    currency,
    trackingMode: 'HOLDINGS',
    isActive: true,
    meta: marker,
  }) as { id: string };
}

async function syncCb(ctx: AddonContext): Promise<AppliedSnapshot> {
  const snapshot = await fetchSnapshot(ctx, CB_BASE_URLS, CB_TOKEN_KEY, 'controle-bancario');
  const accounts = snapshot.accounts ?? snapshot.items
    ?.filter((item) => item.resource === 'account')
    .map((item) => item.payload) ?? [];
  const date = snapshot.snapshot_as_of ?? new Date().toISOString().slice(0, 10);
  const importedSources = new Set<string>();
  for (const account of accounts) {
    importedSources.add(sourceAccountId(account.source_id));
    if (account.balance === null) continue;
    if (account.account_type === 'cartao_credito' || account.account_type === 'aplicacao') continue;
    const target = await findOrCreateAccount(ctx, account.source_id, `CB · ${account.name}`, account.currency, 'CASH');
    await ctx.api.snapshots.save(target.id, [], { [account.currency]: account.balance }, date);
  }
  const previousCbRaw = await ctx.api.storage.get(CB_RECORDS_KEY);
  let previousCbCacheId: string | null = null;
  try { previousCbCacheId = (JSON.parse(previousCbRaw ?? '{}') as { cacheId?: string }).cacheId ?? null; } catch { previousCbCacheId = null; }
  const cacheId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cachePrefix = `${CB_RECORDS_KEY}.${cacheId}`;
  const cbRecords = {
    cacheId,
    syncedAt: new Date().toISOString(),
    snapshotId: snapshot.snapshot_id!,
    entries: (snapshot.items ?? []).filter((item) => item.resource === 'cash_entry').map((item) => ({ source_id: item.source_id, ...item.payload })),
    accounts: (snapshot.items ?? []).filter((item) => item.resource === 'account').map((item) => ({ source_id: item.source_id, ...item.payload })),
    categories: (snapshot.items ?? []).filter((item) => item.resource === 'category').map((item) => ({ source_id: item.source_id, ...item.payload })),
    transfers: (snapshot.items ?? []).filter((item) => item.resource === 'transfer').map((item) => ({ source_id: item.source_id, ...item.payload })),
    coverage: snapshot.coverage ?? {},
  };
  await storeRecordSet(ctx, `${cachePrefix}.entries`, cbRecords.entries);
  await storeRecordSet(ctx, `${cachePrefix}.accounts`, cbRecords.accounts);
  await storeRecordSet(ctx, `${cachePrefix}.categories`, cbRecords.categories);
  await storeRecordSet(ctx, `${cachePrefix}.transfers`, cbRecords.transfers);
  await ctx.api.storage.set(CB_RECORDS_KEY, JSON.stringify({
    cacheId: cbRecords.cacheId,
    syncedAt: cbRecords.syncedAt,
    snapshotId: cbRecords.snapshotId,
    coverage: cbRecords.coverage,
  }));
  if (previousCbCacheId) {
    for (const name of ['entries', 'accounts', 'categories', 'transfers']) {
      await deleteRecordSet(ctx, `${CB_RECORDS_KEY}.${previousCbCacheId}.${name}`);
    }
  }
  // A missing resource is not a zero balance. Only a source that explicitly
  // declares the account collection complete may clear a prior local snapshot.
  if (snapshot.coverage?.account?.state === 'complete') {
    const existing = await ctx.api.accounts.getAll();
    for (const account of existing) {
      if (!account.meta?.startsWith(`${ACCOUNT_META_KEY}:controle-bancario:account:`)) continue;
      if (importedSources.has(account.meta)) continue;
      await ctx.api.snapshots.save(account.id, [], { [account.currency]: '0.00' }, date);
    }
  }
  return {
    snapshotId: snapshot.snapshot_id!,
    generatedAt: snapshot.generated_at!,
    highWatermark: snapshot.high_watermark ?? null,
    coverageComplete: snapshot.coverage?.account?.state === 'complete',
  };
}

async function syncCrv(ctx: AddonContext): Promise<AppliedSnapshot> {
  const snapshot = await fetchSnapshot(ctx, CRV_BASE_URLS, CRV_TOKEN_KEY, 'controle-renda-variavel');
  const date = snapshot.data_de_referencia ?? new Date().toISOString().slice(0, 10);
  const grouped = new Map<string, CrvHolding[]>();
  for (const holding of snapshot.holdings ?? []) {
    const key = `${holding.account}:${holding.portfolio}:${holding.currency}`;
    grouped.set(key, [...(grouped.get(key) ?? []), holding]);
  }
  for (const [key, holdings] of grouped) {
    const first = holdings[0];
    const target = await findOrCreateAccount(
      ctx,
      `crv:${key}`,
      `CRV · ${first.account_name} · ${first.portfolio}`,
      first.currency,
      'SECURITIES',
    );
    const positions: SnapshotHoldingInput[] = holdings.map((holding) => ({
      symbol: holding.instrument,
      quantity: holding.quantity,
      currency: holding.currency,
      averageCost: holding.average_cost,
      quoteCcy: holding.currency,
      exchangeMic: holding.market,
      instrumentType: 'EQUITY',
      dataSource: 'controle-renda-variavel',
    }));
    await ctx.api.snapshots.save(target.id, positions, {}, date);
  }
  // Holdings are still refreshed if the optional ledger endpoint is temporarily
  // unavailable; the source is then marked stale and the next cycle retries it.
  const ledger = await fetchCrvLedger(ctx);
  const previousCrvRaw = await ctx.api.storage.get(CRV_RECORDS_KEY);
  let previousCrvCacheId: string | null = null;
  try { previousCrvCacheId = (JSON.parse(previousCrvRaw ?? '{}') as { cacheId?: string }).cacheId ?? null; } catch { previousCrvCacheId = null; }
  const cacheId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cachePrefix = `${CRV_RECORDS_KEY}.${cacheId}`;
  const crvRecords = {
    cacheId,
    syncedAt: new Date().toISOString(),
    snapshotId: snapshot.snapshot_id!,
    income: snapshot.income ?? [],
    ledger: ledger.items,
    incomeCoverage: snapshot.coverage?.income ?? {},
    ledgerCoverage: ledger.coverage,
    ledgerComplete: ledger.coverage.completeness === 'complete',
  };
  await storeRecordSet(ctx, `${cachePrefix}.income`, crvRecords.income as unknown as SourceRecord[]);
  await storeRecordSet(ctx, `${cachePrefix}.ledger`, crvRecords.ledger);
  await ctx.api.storage.set(CRV_RECORDS_KEY, JSON.stringify({
    cacheId: crvRecords.cacheId,
    syncedAt: crvRecords.syncedAt,
    snapshotId: crvRecords.snapshotId,
    incomeCoverage: crvRecords.incomeCoverage,
    ledgerCoverage: crvRecords.ledgerCoverage,
    ledgerComplete: crvRecords.ledgerComplete,
  }));
  if (previousCrvCacheId) {
    await deleteRecordSet(ctx, `${CRV_RECORDS_KEY}.${previousCrvCacheId}.income`);
    await deleteRecordSet(ctx, `${CRV_RECORDS_KEY}.${previousCrvCacheId}.ledger`);
  }
  const activeSources = new Set(
    [...grouped.keys()].map((key) => sourceAccountId(`crv:${key}`)),
  );
  // As with CB, absence is safe to reconcile only with an explicit complete
  // collection declaration for the documented CRV holdings scope.
  if (snapshot.coverage?.holdings?.complete === true) {
    const existing = await ctx.api.accounts.getAll();
    for (const account of existing) {
      if (!account.meta?.startsWith(`${ACCOUNT_META_KEY}:crv:`)) continue;
      if (activeSources.has(account.meta)) continue;
      await ctx.api.snapshots.save(account.id, [], {}, date);
    }
  }
  return {
    snapshotId: snapshot.snapshot_id!,
    generatedAt: snapshot.generated_at!,
    highWatermark: snapshot.high_watermark ?? null,
    coverageComplete: snapshot.coverage?.holdings?.complete === true,
  };
}

async function syncAll(ctx: AddonContext, force = false) {
  if (activeSync) return activeSync;
  activeSync = (async () => {
    const syncSource = async (
      storageKey: string,
      checkpointKey: string,
      baseUrls: string[],
      tokenKey: string,
      applySnapshot: () => Promise<AppliedSnapshot>,
    ) => {
      const attemptAt = new Date().toISOString();
      const previous = await loadSourceStatus(ctx, storageKey);
      await storeSourceStatus(ctx, storageKey, {
        ...previous,
        status: previous.lastSuccessAt ? 'stale' : 'not_synced',
        lastAttemptAt: attemptAt,
        failure: null,
      });
      try {
        const changed = await changedSinceCheckpoint(ctx, baseUrls, tokenKey, checkpointKey);
        const cacheKey = storageKey === CB_SYNC_STATUS_KEY ? CB_RECORDS_KEY : CRV_RECORDS_KEY;
        const cacheMissing = !(await ctx.api.storage.get(cacheKey));
        // A status record can be lost independently of its checkpoint. Without
        // a successful local snapshot, rebuild the local view before trusting
        // an empty incremental response. Snapshot-only sources and addon updates
        // that introduce a new source cache also arrive here.
        if (force || changed || !previous.lastSuccessAt || cacheMissing) {
          const applied = await applySnapshot();
          if (applied.highWatermark !== null) {
            await ctx.api.storage.set(checkpointKey, applied.highWatermark);
          }
          await storeSourceStatus(ctx, storageKey, {
            status: applied.coverageComplete ? 'current' : 'stale',
            lastAttemptAt: attemptAt,
            lastSuccessAt: new Date().toISOString(),
            snapshotId: applied.snapshotId,
            generatedAt: applied.generatedAt,
            highWatermark: applied.highWatermark,
            coverageComplete: applied.coverageComplete,
            failure: null,
          });
        } else if (previous.lastSuccessAt) {
          await storeSourceStatus(ctx, storageKey, {
            ...previous,
            status: 'current',
            lastAttemptAt: attemptAt,
            lastSuccessAt: new Date().toISOString(),
            highWatermark: (await ctx.api.storage.get(checkpointKey)) ?? previous.highWatermark,
            failure: null,
          });
        }
      } catch {
        await storeSourceStatus(ctx, storageKey, {
          ...previous,
          status: previous.lastSuccessAt ? 'stale' : 'failed',
          lastAttemptAt: attemptAt,
          failure: SANITIZED_FAILURE,
        });
        return false;
      }
      return true;
    };

    // Keep sources serial, while still attempting CRV if CB fails.
    const cbOk = await syncSource(
      CB_SYNC_STATUS_KEY,
      CB_CHECKPOINT_KEY,
      CB_BASE_URLS,
      CB_TOKEN_KEY,
      () => syncCb(ctx),
    );
    const crvOk = await syncSource(
      CRV_SYNC_STATUS_KEY,
      CRV_CHECKPOINT_KEY,
      CRV_BASE_URLS,
      CRV_TOKEN_KEY,
      () => syncCrv(ctx),
    );
    if (!cbOk || !crvOk) throw new Error('Uma ou mais fontes falharam. Consulte os estados por fonte.');
    await ctx.api.storage.set('lastManualSyncAt', new Date().toISOString());
  })();
  try {
    await activeSync;
  } finally {
    activeSync = undefined;
  }
}

function ImportPage({ ctx }: { ctx: AddonContext }) {
  const [cbToken, setCbToken] = useState('');
  const [crvToken, setCrvToken] = useState('');
  const [status, setStatus] = useState('Configure os tokens e importe manualmente.');
  const [sourceStatuses, setSourceStatuses] = useState({ cb: emptySourceStatus(), crv: emptySourceStatus() });
  const [cbRecords, setCbRecords] = useState<CachedCbRecords | null>(null);
  const [crvRecords, setCrvRecords] = useState<CachedCrvRecords | null>(null);
  const [tab, setTab] = useState<'cb' | 'income' | 'ledger'>('cb');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const refreshSourceStatuses = async () => {
    const cb = await loadSourceStatus(ctx, CB_SYNC_STATUS_KEY);
    const crv = await loadSourceStatus(ctx, CRV_SYNC_STATUS_KEY);
    setSourceStatuses({ cb, crv });
    try {
      const [cbRaw, crvRaw] = await Promise.all([
        ctx.api.storage.get(CB_RECORDS_KEY),
        ctx.api.storage.get(CRV_RECORDS_KEY),
      ]);
      const cbMeta = cbRaw ? JSON.parse(cbRaw) as Omit<CachedCbRecords, 'entries' | 'accounts' | 'categories' | 'transfers'> : null;
      const crvMeta = crvRaw ? JSON.parse(crvRaw) as Omit<CachedCrvRecords, 'income' | 'ledger'> : null;
      const [entries, cbAccounts, categories, transfers, income, ledger] = await Promise.all([
        cbMeta ? loadRecordSet(ctx, `${CB_RECORDS_KEY}.${cbMeta.cacheId}.entries`) : Promise.resolve([]),
        cbMeta ? loadRecordSet(ctx, `${CB_RECORDS_KEY}.${cbMeta.cacheId}.accounts`) : Promise.resolve([]),
        cbMeta ? loadRecordSet(ctx, `${CB_RECORDS_KEY}.${cbMeta.cacheId}.categories`) : Promise.resolve([]),
        cbMeta ? loadRecordSet(ctx, `${CB_RECORDS_KEY}.${cbMeta.cacheId}.transfers`) : Promise.resolve([]),
        crvMeta ? loadRecordSet(ctx, `${CRV_RECORDS_KEY}.${crvMeta.cacheId}.income`) : Promise.resolve([]),
        crvMeta ? loadRecordSet(ctx, `${CRV_RECORDS_KEY}.${crvMeta.cacheId}.ledger`) : Promise.resolve([]),
      ]);
      setCbRecords(cbMeta ? { ...cbMeta, entries, accounts: cbAccounts, categories, transfers } : null);
      setCrvRecords(crvMeta ? { ...crvMeta, income: income as unknown as CrvIncome[], ledger } : null);
    } catch {
      setStatus('O cache de lançamentos está inválido. Execute a importação completa para reconstruí-lo.');
    }
  };
  useEffect(() => {
    void refreshSourceStatuses();
    const intervalId = setInterval(() => { void refreshSourceStatuses(); }, STATUS_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [ctx]);
  const saveTokens = async () => {
    if (cbToken) await ctx.api.secrets.set(CB_TOKEN_KEY, cbToken);
    if (crvToken) await ctx.api.secrets.set(CRV_TOKEN_KEY, crvToken);
    await ctx.api.storage.set(AUTO_SYNC_ENABLED_KEY, 'true');
    setCbToken(''); setCrvToken(''); setStatus('Tokens guardados no cofre. A sincronização automática foi ativada.');
  };
  const run = async () => {
    setStatus('Importando snapshots…');
    try {
      await syncAll(ctx, true);
      setStatus('Snapshots importados. Itens sem preço são identificados; cartões, aplicações e opções não entram nesta fase.');
      ctx.api.toast.success('Controle Patrimonial atualizado');
    } catch (error) {
      void error;
      setStatus('Uma ou mais fontes falharam. Confira o estado de CB e CRV abaixo e tente novamente.');
      ctx.api.toast.error('Não foi possível importar os snapshots');
    } finally {
      await refreshSourceStatuses();
    }
  };
  const renderSourceStatus = (name: string, source: SourceSyncStatus) => {
    const labels: Record<SourceStatusValue, string> = {
      not_synced: 'Ainda não sincronizado',
      current: 'Atual',
      stale: 'Desatualizado',
      failed: 'Falhou',
    };
    const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('pt-BR') : '—';
    return <section key={name} className="border rounded p-3 space-y-1">
      <h2 className="font-semibold">{name}: {labels[source.status]}</h2>
      <p className="text-sm">Última tentativa: {formatTime(source.lastAttemptAt)}</p>
      <p className="text-sm">Último sucesso: {formatTime(source.lastSuccessAt)}</p>
      <p className="text-sm">Snapshot: {source.snapshotId ?? '—'}</p>
      <p className="text-sm">Gerado em: {formatTime(source.generatedAt)}</p>
      <p className="text-sm">High watermark: {source.highWatermark ?? '—'}</p>
      {source.coverageComplete === false && <p className="text-sm text-amber-700">Cobertura parcial: valores ausentes foram preservados.</p>}
      {source.failure && <p className="text-sm text-red-700">{source.failure}</p>}
    </section>;
  };
  const categories = new Map((cbRecords?.categories ?? []).map((item) => [String(item.source_id ?? ''), String(item.name ?? '—')]));
  const accounts = new Map((cbRecords?.accounts ?? []).map((item) => [String(item.source_id ?? ''), String(item.name ?? '—')]));
  const transfers = new Map((cbRecords?.transfers ?? []).map((item) => [String(item.source_id ?? item.transfer_id ?? ''), item]));
  const rows: SourceRecord[] = tab === 'cb'
    ? (cbRecords?.entries ?? []).map((entry) => ({
      ...entry,
      account_name: accounts.get(String(entry.account_id ?? '')) ?? 'Conta não identificada',
      category_name: categories.get(String(entry.category_id ?? '')) ?? 'Categoria não identificada',
      transfer_group: entry.transfer_id ? (transfers.has(String(entry.transfer_id)) ? 'Sim' : 'Não localizado') : '—',
    }))
    : tab === 'income' ? (crvRecords?.income ?? []) as unknown as SourceRecord[] : (crvRecords?.ledger ?? []);
  const filteredRows = rows.filter((row) => search.trim() === '' || Object.values(row).some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR'))));
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / RECORDS_PAGE_SIZE));
  const visibleRows = filteredRows.slice((Math.min(page, pageCount) - 1) * RECORDS_PAGE_SIZE, Math.min(page, pageCount) * RECORDS_PAGE_SIZE);
  const columns = tab === 'cb'
    ? ['due_date', 'realized_date', 'description', 'account_name', 'category_name', 'entry_type', 'status', 'planned_amount', 'realized_amount', 'currency', 'operation_type', 'installment', 'installments', 'is_recurring', 'transfer_group']
    : tab === 'income'
      ? ['date', 'instrument', 'kind', 'amount', 'currency', 'account_name', 'role', 'cash_accounting_role']
      : ['date', 'instrument', 'kind', 'execution_side', 'quantity_delta', 'resulting_quantity', 'price', 'realized_result', 'currency', 'account_name', 'portfolio', 'cash_accounting_role'];
  const label = (key: string) => ({ due_date: 'Vencimento', realized_date: 'Realizado em', description: 'Descrição', account_name: 'Conta/corretora', category_name: 'Categoria', entry_type: 'Tipo', status: 'Status', planned_amount: 'Previsto', realized_amount: 'Realizado', currency: 'Moeda', operation_type: 'Operação', installment: 'Parcela', installments: 'Parcelas', is_recurring: 'Recorrente', transfer_group: 'Grupo transferência', date: 'Data', instrument: 'Ativo', kind: 'Tipo', amount: 'Valor analítico', role: 'Papel', cash_accounting_role: 'Papel no caixa', execution_side: 'Lado', quantity_delta: 'Variação quantidade', resulting_quantity: 'Quantidade final', price: 'Preço', realized_result: 'Resultado realizado', portfolio: 'Carteira' } as Record<string, string>)[key] ?? key;
  const formatCell = (value: unknown) => value === null || value === undefined || value === '' ? '—' : typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : String(value);
  const recordView = <section className="space-y-3">
    {tab === 'income' && <p className="text-sm text-amber-800">Proventos do CRV são analíticos e podem já constar como caixa no CB. Não são lançados nas atividades do Wealthfolio.</p>}
    {tab === 'ledger' && <p className="text-sm text-amber-800">Ledger prospectivo do CRV. Só cobre posições encerradas após 28/09/2026; não há backfill anterior. Os movimentos não são lançamentos de caixa.</p>}
    <div className="flex gap-2 items-center flex-wrap">
      <button className="border rounded p-2" onClick={() => { setTab('cb'); setPage(1); }}>Lançamentos CB ({cbRecords?.entries.length ?? 0})</button>
      <button className="border rounded p-2" onClick={() => { setTab('income'); setPage(1); }}>Proventos CRV ({crvRecords?.income.length ?? 0})</button>
      <button className="border rounded p-2" onClick={() => { setTab('ledger'); setPage(1); }}>Movimentos CRV ({crvRecords?.ledger.length ?? 0})</button>
      <input aria-label="Buscar registros" placeholder="Buscar" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="border rounded p-2" />
    </div>
    <p className="text-sm">Exibindo {filteredRows.length} registro(s) · página {Math.min(page, pageCount)} de {pageCount}. Valores e estados são os publicados pela fonte.</p>
    <div className="overflow-auto border rounded">
      <table className="text-sm min-w-full">
        <thead><tr>{columns.map((column) => <th key={column} className="text-left p-2 border-b whitespace-nowrap">{label(column)}</th>)}</tr></thead>
        <tbody>{visibleRows.map((row, index) => <tr key={String(row.source_id ?? row.id ?? index)} className="border-b">{columns.map((column) => <td key={column} className="p-2 whitespace-nowrap">{formatCell(row[column])}</td>)}</tr>)}</tbody>
      </table>
      {!visibleRows.length && <p className="p-3 text-sm">Nenhum registro nesta consulta.</p>}
    </div>
    <div className="flex gap-2">
      <button disabled={page <= 1} className="border rounded p-2 disabled:opacity-50" onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
      <button disabled={page >= pageCount} className="border rounded p-2 disabled:opacity-50" onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Próxima</button>
    </div>
    {tab === 'cb' && <p className="text-sm">Cobertura declarada pelo CB: {JSON.stringify(cbRecords?.coverage.cash_entry ?? 'aguardando primeira sincronização')} · transferências: {transfers.size}. Categorias de movimentação e grupos de transferência são mostrados para conciliação, sem ajustar saldos.</p>}
    {tab === 'income' && <p className="text-sm">Cobertura declarada pelo CRV: {JSON.stringify(crvRecords?.incomeCoverage ?? 'aguardando primeira sincronização')}.</p>}
    {tab === 'ledger' && <p className="text-sm">Cobertura do endpoint: {JSON.stringify(crvRecords?.ledgerCoverage ?? 'aguardando primeira sincronização')}{!crvRecords?.ledgerComplete && crvRecords && ' · O escopo informado pela fonte é prospectivo.'}</p>}
    <p className="text-xs text-muted-foreground">Última cópia local CB: {cbRecords?.syncedAt ? new Date(cbRecords.syncedAt).toLocaleString('pt-BR') : '—'} · CRV: {crvRecords?.syncedAt ? new Date(crvRecords.syncedAt).toLocaleString('pt-BR') : '—'}</p>
  </section>;
  return <main className="p-6 max-w-none space-y-4">
    <h1 className="text-2xl font-semibold">Controle Patrimonial</h1>
    <p>Snapshots patrimoniais e registros de origem em modo somente leitura. Lançamentos CB ficam visíveis para análise; proventos e movimentos CRV não são convertidos em caixa ou atividades.</p>
    <label className="block">Token CB<input value={cbToken} onChange={(e) => setCbToken(e.target.value)} type="password" className="block border rounded p-2 w-full" /></label>
    <label className="block">Token CRV<input value={crvToken} onChange={(e) => setCrvToken(e.target.value)} type="password" className="block border rounded p-2 w-full" /></label>
    <button onClick={saveTokens} className="border rounded p-2">Guardar tokens</button>{' '}
    <button onClick={run} className="border rounded p-2">Importar agora</button>
    <p className="text-sm">{status}</p>
    <div className="space-y-3">
      {renderSourceStatus('CB', sourceStatuses.cb)}
      {renderSourceStatus('CRV', sourceStatuses.crv)}
    </div>
    {recordView}
  </main>;
}

let addonCtx: AddonContext | undefined;
const Route = () => <ImportPage ctx={addonCtx!} />;
const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;
  ctx.router.add({ id: 'controle-patrimonial-sync', path: '/addons/controle-patrimonial-sync', component: Route });
  const runScheduledSync = async () => {
    if (await ctx.api.storage.get(AUTO_SYNC_ENABLED_KEY) !== 'true') return;
    try {
      await syncAll(ctx);
      ctx.api.logger.info('Sincronização automática concluída.');
    } catch {
      ctx.api.logger.error('Sincronização automática falhou em uma ou mais fontes. Consulte os estados por fonte.');
    }
  };
  void runScheduledSync();
  const intervalId = setInterval(() => { void runScheduledSync(); }, AUTO_SYNC_INTERVAL_MS);
  ctx.onDisable(() => { clearInterval(intervalId); addonCtx = undefined; });
};
export default enable;
