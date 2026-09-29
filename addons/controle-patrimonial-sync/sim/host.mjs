// Mock em memória do host Wealthfolio 3.9.1. As regras abaixo foram portadas do
// fonte que roda no VPS (~/apps/CodexTemp/wealthfolio-v3.9.1):
//  - POST /accounts       apps/server/src/models.rs NewAccount (serde: campos sem Option
//                         e sem default são obrigatórios -> 422) + core NewAccount::validate
//  - POST /snapshots      api/holdings/handlers.rs save_manual_holdings_handler
//  - network.request      crates/core/src/addons/network.rs (2 MiB, GET, https ou alvo privado
//                         declarado, hosts literais, sem cabeçalho Authorization, timeout 10 s)
//  - storage              crates/core/src/addons/service.rs (chave <=128 [A-Za-z0-9_.:-],
//                         payload {addon_id,key,value} serializado <=250.000 bytes)
//  - permissões           apps/frontend/src/addons/type-bridge.ts (guard por categoria.função;
//                         network.request com auth exige também secrets.use)

const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STORAGE_PAYLOAD = 250_000;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class HostError extends Error {}

export function createHost({ manifest, addonId, privateTargets, routes, today = new Date().toISOString().slice(0, 10), hooks = {} }) {
  const granted = new Set(manifest.permissions.flatMap((p) => p.functions.map((f) => `${p.category}.${f}`)));
  const allowedHosts = manifest.network.allowedHosts.map((h) => h.toLowerCase());
  const store = new Map();
  const secrets = new Map();
  const accounts = [];
  const snapshots = new Map(); // `${accountId}_${date}` -> { accountId, date, holdings, cash }
  const calls = { create: 0, createRejected: 0, save: 0, network: 0, networkRejected: 0, storageSet: 0 };
  const log = [];
  let nextId = 1;

  const guard = (category, fn) => {
    if (!granted.has(`${category}.${fn}`)) throw new HostError(`Permission denied: ${category}.${fn}`);
  };

  const validateNewAccount = (a) => {
    // serde: JSON precisa ser objeto; name/accountType/currency string, isDefault/isActive bool
    const need = [['name', 'string'], ['accountType', 'string'], ['currency', 'string'], ['isDefault', 'boolean'], ['isActive', 'boolean']];
    for (const [field, type] of need) {
      if (!(field in a)) throw new HostError(`422 Failed to deserialize the JSON body into the target type: missing field \`${field}\``);
      if (typeof a[field] !== type) throw new HostError(`422 Failed to deserialize the JSON body: invalid type for \`${field}\``);
    }
    for (const opt of ['id', 'group', 'platformId', 'accountNumber', 'meta', 'provider', 'providerAccountId', 'trackingMode']) {
      if (opt in a && a[opt] !== null && typeof a[opt] !== 'string') throw new HostError(`422 invalid type for \`${opt}\``);
    }
    if ('isArchived' in a && typeof a.isArchived !== 'boolean') throw new HostError('422 invalid type for `isArchived`');
    // core NewAccount::validate
    if (!a.name.trim()) throw new HostError('400 Account name cannot be empty');
    if (!a.currency.trim()) throw new HostError('400 Currency cannot be empty');
    if (a.accountType === 'CREDIT_CARD' && a.trackingMode === 'HOLDINGS') throw new HostError('400 Credit card accounts cannot use HOLDINGS tracking mode');
    if (!['SECURITIES', 'CASH', 'CREDIT_CARD', 'CRYPTOCURRENCY'].includes(a.accountType)) throw new HostError('400 unknown account type');
  };

  const api = {
    accounts: {
      getAll: async () => { guard('accounts', 'getAll'); return accounts.map((a) => ({ ...a })); },
      create: async (input) => {
        guard('accounts', 'create');
        calls.create += 1;
        try { validateNewAccount(input); } catch (e) { calls.createRejected += 1; calls.lastCreateError = e.message; throw e; }
        const created = { id: `acc-${nextId++}`, trackingMode: 'NOT_SET', isArchived: false, group: null, platformId: null, accountNumber: null, provider: null, providerAccountId: null, meta: null, ...input };
        accounts.push(created);
        return { ...created };
      },
    },
    snapshots: {
      save: async (accountId, holdings, cashBalances, date) => {
        guard('snapshots', 'save');
        calls.save += 1;
        const account = accounts.find((a) => a.id === accountId);
        if (!account) throw new HostError('404 account not found');
        if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(Date.parse(date))) throw new HostError('400 Invalid date format');
        if (date > today) throw new HostError('400 InvalidSnapshotDate: date in the future');
        if (!Array.isArray(holdings) || typeof cashBalances !== 'object' || cashBalances === null || Array.isArray(cashBalances)) throw new HostError('422 invalid body');
        for (const h of holdings) {
          for (const f of ['symbol', 'quantity', 'currency']) if (typeof h[f] !== 'string') throw new HostError(`422 holding missing string \`${f}\``);
          if (!DECIMAL.test(h.quantity)) throw new HostError(`400 Invalid quantity for ${h.symbol}`);
          if (h.averageCost != null && h.averageCost !== '' && !DECIMAL.test(h.averageCost)) throw new HostError(`400 Invalid average cost for ${h.symbol}`);
        }
        for (const [ccy, amount] of Object.entries(cashBalances)) {
          if (typeof amount !== 'string' || !DECIMAL.test(amount)) throw new HostError(`400 Invalid cash amount for ${ccy}`);
        }
        snapshots.set(`${accountId}_${date}`, { accountId, date, holdings: holdings.map((h) => ({ ...h })), cash: { ...cashBalances } });
      },
    },
    network: {
      request: async (req) => {
        guard('network', 'request');
        if (req.auth) guard('secrets', 'use');
        calls.network += 1;
        const reject = (msg) => { calls.networkRejected += 1; throw new HostError(msg); };
        let url;
        try { url = new URL(req.url); } catch { reject('Invalid addon network URL'); }
        const host = url.hostname.toLowerCase();
        const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        const isPrivate = privateTargets.some((t) => t.scheme === url.protocol.slice(0, -1) && t.host === host && t.port === port && url.pathname.startsWith(t.pathPrefix));
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isPrivate)) reject('Addon network requests must use HTTPS');
        if (!allowedHosts.includes(host)) reject(`Addon network host '${host}' is not approved`);
        if (!isPrivate) reject('host not reachable (não é alvo privado configurado)');
        if ((req.method ?? 'GET').toUpperCase() !== 'GET') reject('Addon private network targets only allow GET');
        for (const name of Object.keys(req.headers ?? {})) if (name.toLowerCase() === 'authorization') reject('Authorization header must use request.auth.secretKey');
        let bearer = null;
        if (req.auth) {
          if (req.auth.type !== 'bearer') reject('auth type not supported');
          const secret = secrets.get(req.auth.secretKey);
          if (!secret || !secret.trim()) reject('Addon network auth secret was not found');
          bearer = secret;
        }
        const handler = routes[`${host}:${port}`];
        if (!handler) reject('host unreachable');
        const reply = await handler({ path: url.pathname, query: url.searchParams, headers: req.headers ?? {}, bearer });
        const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BODY_BYTES) reject('Addon network response body is too large');
        return { status: reply.status ?? 200, headers: {}, body };
      },
    },
    storage: {
      get: async (key) => (store.has(key) ? store.get(key) : null),
      set: async (key, value) => {
        calls.storageSet += 1;
        if (hooks.beforeStorageSet) hooks.beforeStorageSet(key, calls.storageSet);
        if (!key || key.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(key)) throw new HostError(`Invalid storage key (${key.length} chars)`);
        if (typeof value !== 'string') throw new HostError('storage value must be a string');
        const bytes = Buffer.byteLength(JSON.stringify({ addon_id: addonId, key, value }), 'utf8');
        if (bytes > MAX_STORAGE_PAYLOAD) throw new HostError(`Invalid storage value: too large to sync across devices (${bytes} > ${MAX_STORAGE_PAYLOAD})`);
        store.set(key, value);
      },
      delete: async (key) => { store.delete(key); },
    },
    secrets: {
      set: async (key, value) => { guard('secrets', 'set'); secrets.set(key, value); },
    },
    toast: { success: () => {}, error: () => {} },
    logger: { info: (m) => log.push(['info', String(m)]), error: (m) => log.push(['error', String(m)]) },
  };

  const routesAdded = [];
  const disposers = [];
  const ctx = { api, router: { add: (r) => routesAdded.push(r) }, onDisable: (f) => disposers.push(f) };
  return { ctx, store, secrets, accounts, snapshots, calls, log, routesAdded, disposers, MAX_STORAGE_PAYLOAD };
}
