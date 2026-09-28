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
const STATUS_REFRESH_INTERVAL_MS = 5 * 1000;
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
  items?: Array<{ resource: string; payload: CbAccount }>;
  holdings?: CrvHolding[];
  data_de_referencia?: string;
  snapshot_as_of?: string;
  coverage?: {
    account?: { state?: string };
    holdings?: { complete?: boolean };
  };
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
  const response = await requestFromSource(ctx, baseUrls, '/snapshot', secretKey);
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
        // A status record can be lost independently of its checkpoint. Without
        // a successful local snapshot, rebuild the local view before trusting
        // an empty incremental response. Snapshot-only sources also arrive here.
        if (force || changed || !previous.lastSuccessAt) {
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
  const refreshSourceStatuses = async () => {
    const cb = await loadSourceStatus(ctx, CB_SYNC_STATUS_KEY);
    const crv = await loadSourceStatus(ctx, CRV_SYNC_STATUS_KEY);
    setSourceStatuses({ cb, crv });
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
  return <main className="p-6 max-w-2xl space-y-4">
    <h1 className="text-2xl font-semibold">Controle Patrimonial</h1>
    <p>Fase 2: importa caixa CB e holdings CRV em contas separadas. Não cria compras, vendas ou proventos.</p>
    <label className="block">Token CB<input value={cbToken} onChange={(e) => setCbToken(e.target.value)} type="password" className="block border rounded p-2 w-full" /></label>
    <label className="block">Token CRV<input value={crvToken} onChange={(e) => setCrvToken(e.target.value)} type="password" className="block border rounded p-2 w-full" /></label>
    <button onClick={saveTokens} className="border rounded p-2">Guardar tokens</button>{' '}
    <button onClick={run} className="border rounded p-2">Importar agora</button>
    <p className="text-sm">{status}</p>
    <div className="space-y-3">
      {renderSourceStatus('CB', sourceStatuses.cb)}
      {renderSourceStatus('CRV', sourceStatuses.crv)}
    </div>
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
