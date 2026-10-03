// Simulação ponta a ponta do add-on contra um host Wealthfolio simulado.
// Executa a lógica REAL de src/addon.tsx (compilada em memória pelo esbuild).
// Só imprime metadados: nomes de cenário, contagens, tamanhos e PASS/FAIL.
//   docker compose -f compose.addon-sim.yaml run --rm addon-sim
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createHost } from './host.mjs';
import { buildFixtures, fixturesFromReal } from './fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const source = readFileSync(join(root, 'src/addon.tsx'), 'utf8');
const TODAY = '2026-09-29';
const CB_TOKEN = 'TEST-CB-TOKEN-0000';
const CRV_TOKEN = 'TEST-CRV-TOKEN-1111';
const ROUTE_BASE = '/patrimonio/v4';
// Alvos privados do Wealthfolio no VPS (WF_ADDON_NETWORK_PRIVATE_TARGETS). host.docker.internal
// NÃO está configurado lá: o add-on precisa cair no alias cb-api / crv-api.
const PRIVATE_TARGETS = [
  { scheme: 'http', host: 'cb-api', port: 8000, pathPrefix: ROUTE_BASE },
  { scheme: 'http', host: 'crv-api', port: 5003, pathPrefix: ROUTE_BASE },
];

const results = [];
const check = (scenario, name, ok, detail = '') => {
  results.push({ scenario, name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${detail ? ' — ' + detail : ''}`);
};

async function compile(label, transform) {
  let text = transform(source);
  text += '\nexport { syncAll, loadRecordSet, readServerStatus, describeServerStatus };\n';
  const out = await build({
    stdin: { contents: text, resolveDir: root, loader: 'tsx', sourcefile: 'addon.tsx' },
    bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false, jsx: 'automatic',
    external: ['@wealthfolio/addon-sdk'], logLevel: 'error',
  });
  const dir = mkdtempSync(join(tmpdir(), 'addonsim-'));
  const file = join(dir, `${label}.mjs`);
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

const REAL = process.env.SIM_REAL === '1';
const fx = REAL ? fixturesFromReal(JSON.parse(readFileSync(0, 'utf8'))) : buildFixtures({ descriptionPad: 90 });
console.log(REAL ? '### MODO REAL: respostas reais em memória (somente leitura), só contagens são impressas ###' : '### MODO SINTÉTICO ###');
if (REAL) {
  const x = fx.expected;
  check('real', 'contagens reais publicadas: CB 1475/21/25/92; CRV 112 proventos, 6 encerramentos, ledger 0, 10 posições', x.cbEntries === 1475 && x.cbAccounts === 21 && x.cbCategories === 25 && x.cbTransfers === 92 && x.crvIncome === 112 && x.crvClosed === 6 && x.crvLedger === 0 && x.crvHoldings === 10, JSON.stringify(x));
}
const bodies = {
  cbSnapshot: JSON.stringify(fx.cbSnapshot),
  crvSnapshot: JSON.stringify(fx.crvSnapshot),
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeRoutes(faults = {}) {
  const seen = { cb: [], crv: [] };
  const serve = (system, token, snapshotBody) => async ({ path, query, headers, bearer }) => {
    const sub = path.slice(ROUTE_BASE.length);
    seen[system].push(sub);
    if (bearer !== token) return { status: 401, body: '{"erro":"nao autorizado"}' };
    // O CB impõe HTTPS na camada da aplicação: sem o sinal do proxy, recusa.
    if (system === 'cb' && headers['X-Forwarded-Proto'] !== 'https') return { status: 400, body: '{"erro":"https"}' };
    const f = faults[`${system}${sub.split('?')[0]}`] ?? faults[`${system}${sub.split('?')[0]}:${query.get('page') ?? ''}`];
    if (f?.status) return { status: f.status, body: f.body ?? '{}' };
    if (f?.raw) return { status: 200, body: f.raw };
    let body;
    if (sub === '/changes') body = fx.changes(system === 'cb' ? 'controle-bancario' : 'controle-renda-variavel');
    else if (sub === '/snapshot') body = f?.mutate ? f.mutate(clone(JSON.parse(snapshotBody))) : snapshotBody;
    else if (system === 'crv' && sub === '/ledger') body = f?.mutate ? f.mutate(clone(fx.ledger)) : fx.ledger;
    else if (system === 'crv' && sub === '/activities') {
      body = fx.activitiesPage(Number(query.get('page')), Number(query.get('page_size')));
      if (f?.mutate) body = f.mutate(body);
    } else return { status: 404, body: '{}' };
    return { status: 200, body };
  };
  return {
    seen,
    routes: {
      'cb-api:8000': serve('cb', CB_TOKEN, bodies.cbSnapshot),
      'crv-api:5003': serve('crv', CRV_TOKEN, bodies.crvSnapshot),
    },
  };
}

function newEnv({ faults, hooks, tokens = true } = {}) {
  const r = makeRoutes(faults);
  const host = createHost({ manifest, addonId: manifest.id, privateTargets: PRIVATE_TARGETS, routes: r.routes, today: TODAY, hooks });
  if (tokens) { host.secrets.set('cb.token', CB_TOKEN); host.secrets.set('crv.token', CRV_TOKEN); }
  return { host, seen: r.seen };
}

const status = async (host, key) => JSON.parse((await host.ctx.api.storage.get(key)) ?? 'null');
const settle = async (promise) => { try { await promise; return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } };
const bytes = (s) => Buffer.byteLength(s, 'utf8');

function expectedCbCashAccounts() {
  return fx.cbSnapshot.items.filter((i) => i.resource === 'account')
    .filter((a) => a.payload.balance !== null && a.payload.account_type !== 'cartao_credito' && a.payload.account_type !== 'aplicacao');
}

// ------------------------------------------------------------------ cenários
const fixed = await compile('fixed', (s) => s);

console.log('== Amostra sintética ==');
console.log(`CB /snapshot: ${bytes(bodies.cbSnapshot)} bytes (real 29/09: 1275688; limite do broker 2097152); CRV /snapshot: ${bytes(bodies.crvSnapshot)} bytes (real: 68635)`);
console.log(`Manifesto: v${manifest.version}; permissões: ${manifest.permissions.map((p) => p.category + '.' + p.functions.join('+')).join(', ')}`);
check('amostra', 'tamanho do CB compatível com o real (±15%)', Math.abs(bytes(bodies.cbSnapshot) - 1275688) / 1275688 < 0.15);

// A — o add-on não escreve no Wealthfolio: contas e saldos são do servidor (patch 0004)
{
  const perms = manifest.permissions.map((p) => p.category);
  check('A sem escrita no host', 'o manifesto não pede permissão de contas nem de snapshots', !perms.includes('accounts') && !perms.includes('snapshots'), perms.join(', '));
  const { host } = newEnv();
  const r = await settle(fixed.syncAll(host.ctx, true));
  check('A sem escrita no host', 'uma importação completa conclui sem criar conta nem gravar snapshot', r.ok && host.accounts.length === 0 && host.snapshots.size === 0 && host.calls.save === 0 && host.calls.createRejected === 0);
}

// B — rascunho corrigido, importação inicial completa
let baseline;
{
  const { host, seen } = newEnv();
  const t0 = Date.now();
  const r = await settle(fixed.syncAll(host.ctx, true));
  const ms = Date.now() - t0;
  const cb = await status(host, 'sync.status.cb'); const crv = await status(host, 'sync.status.crv');
  console.log(`   (importação simulada em ${ms} ms; chamadas de rede: ${host.calls.network}, rejeitadas: ${host.calls.networkRejected}; gravações de storage: ${host.calls.storageSet})`);
  check('B rascunho corrigido', 'syncAll conclui sem erro e ambas as fontes ficam "current"', r.ok && cb.status === 'current' && crv.status === 'current' && cb.coverageComplete === true && crv.coverageComplete === true, r.error);
    check('B rascunho corrigido', 'lastManualSyncAt gravado só após as duas fontes', host.store.has('lastManualSyncAt'));
  check('B rascunho corrigido', 'checkpoints gravados (cb e crv)', host.store.has('checkpoint.cb') && host.store.has('checkpoint.crv'));
  check('B rascunho corrigido', 'fallback de rede: host.docker.internal recusado, alias cb-api/crv-api atendeu', host.calls.networkRejected >= 1 && seen.cb.includes('/snapshot') && seen.crv.includes('/snapshot'));

  const cbMeta = JSON.parse(host.store.get('records.cb.v1')); const crvMeta = JSON.parse(host.store.get('records.crv.v1'));
  const load = (name, p) => fixed.loadRecordSet(host.ctx, `${p}.${name}`);
  const entries = await load('entries', `records.cb.v1.${cbMeta.cacheId}`);
  const cbAccounts = await load('accounts', `records.cb.v1.${cbMeta.cacheId}`);
  const cats = await load('categories', `records.cb.v1.${cbMeta.cacheId}`);
  const trans = await load('transfers', `records.cb.v1.${cbMeta.cacheId}`);
  const income = await load('income', `records.crv.v1.${crvMeta.cacheId}`);
  const ledger = await load('ledger', `records.crv.v1.${crvMeta.cacheId}`);
  const closed = await load('closed-activities', `records.crv.v1.${crvMeta.cacheId}`);
  const e = fx.expected;
  check('B rascunho corrigido', `CB armazenado: ${entries.length} lançamentos, ${cbAccounts.length} contas, ${cats.length} categorias, ${trans.length} transferências`, entries.length === e.cbEntries && cbAccounts.length === e.cbAccounts && cats.length === e.cbCategories && trans.length === e.cbTransfers);
  check('B rascunho corrigido', `CRV armazenado: ${income.length} proventos, ${closed.length} encerramentos, ${ledger.length} movimentos de ledger`, income.length === e.crvIncome && closed.length === e.crvClosed && ledger.length === e.crvLedger);
  const ids = (list) => new Set(list.map((x) => x.source_id));
  const srcIds = (res) => new Set(fx.cbSnapshot.items.filter((i) => i.resource === res).map((i) => i.source_id));
  check('B rascunho corrigido', 'ids dos lançamentos armazenados idênticos aos da fonte (nada perdido/duplicado pelos chunks)', ids(entries).size === e.cbEntries && [...srcIds('cash_entry')].every((id) => ids(entries).has(id)));
  check('B rascunho corrigido', 'ledger prospectivo declarado (ledgerComplete=false, backfill=false), sem histórico inventado', crvMeta.ledgerComplete === false && crvMeta.ledgerCoverage.backfill === false && ledger.length === 0);
  check('B rascunho corrigido', 'atividades: total 118 = 6 encerramentos + 112 proventos', crvMeta.activitiesTotal === 118 && closed.length + income.length === 118);

  let maxValue = 0; let maxPayload = 0; let maxKey = 0;
  for (const [k, v] of host.store) { maxValue = Math.max(maxValue, bytes(v)); maxPayload = Math.max(maxPayload, bytes(JSON.stringify({ addon_id: manifest.id, key: k, value: v }))); maxKey = Math.max(maxKey, k.length); }
  console.log(`   (maior valor: ${maxValue} B; maior payload do host: ${maxPayload} B de ${host.MAX_STORAGE_PAYLOAD}; maior chave: ${maxKey} de 128; chaves no storage: ${host.store.size})`);
  check('B rascunho corrigido', 'todos os chunks dentro do limite de 250.000 B do host (com escape) e chaves ≤128', maxPayload <= host.MAX_STORAGE_PAYLOAD && maxKey <= 128);
  check('B rascunho corrigido', 'nenhum token vaza para o storage nem para o log', ![...host.store.values()].some((v) => v.includes(CB_TOKEN) || v.includes(CRV_TOKEN)) && !JSON.stringify(host.log).includes('TEST-'));
  baseline = { host, seen, keyCount: host.store.size, cbMeta, crvMeta, fixedMod: fixed };
}

// C — segunda execução completa reconstrói o cache sem duplicar nada
{
  const { host, cbMeta } = baseline;
  const before = { keys: host.store.size };
  const r = await settle(fixed.syncAll(host.ctx, true));
  const meta2 = JSON.parse(host.store.get('records.cb.v1'));
  check('C reimportação forçada', 'conclui, cache novo publicado e o antigo removido (sem chaves órfãs)', r.ok && meta2.cacheId !== cbMeta.cacheId && host.store.size === before.keys && ![...host.store.keys()].some((k) => k.includes(cbMeta.cacheId)));
  const cacheBefore = JSON.parse(host.store.get('records.cb.v1')).cacheId;
  const r2 = await settle(fixed.syncAll(host.ctx, false));
  check('C sincronização incremental', 'sem mudanças na fonte, não refaz a cópia local e mantém "current"', r2.ok && JSON.parse(host.store.get('records.cb.v1')).cacheId === cacheBefore && (await status(host, 'sync.status.cb')).status === 'current');
}

// D — falhas nunca viram importação completa
const failCases = [
  ['CRV /activities página 2 com HTTP 500', { 'crv/activities:2': { status: 500 } }, 'crv'],
  ['CRV /ledger com total incoerente', { 'crv/ledger': { mutate: (b) => { b.paginacao.total = 3; return b; } } }, 'crv'],
  ['CRV proventos: cobertura declara 111, snapshot traz 112', { 'crv/snapshot': { mutate: (b) => { b.coverage.income.included = 111; return b; } } }, 'crv'],
  ['CRV atividades: coverage.complete=false', { 'crv/activities': { mutate: (b) => { b.coverage.complete = false; return b; } } }, 'crv'],
  ['CRV holding com instrument_type=option', { 'crv/snapshot': { mutate: (b) => { b.holdings[0].instrument_type = 'option'; return b; } } }, 'crv'],
  ['CB cobertura declara 1474, itens 1475', { 'cb/snapshot': { mutate: (b) => { b.coverage.cash_entry.count = 1474; return b; } } }, 'cb'],
  ['CB corpo que não é JSON', { 'cb/snapshot': { raw: '<html>502</html>' } }, 'cb'],
  ['CB HTTP 401', { 'cb/snapshot': { status: 401 } }, 'cb'],
];
for (const [name, faults, which] of failCases) {
  const { host } = newEnv({ faults });
  const r = await settle(fixed.syncAll(host.ctx, true));
  const st = await status(host, `sync.status.${which}`);
  const other = await status(host, `sync.status.${which === 'cb' ? 'crv' : 'cb'}`);
  check('D falhas', `${name}: fonte falha, importação não é marcada como completa`, !r.ok && st.status === 'failed' && !host.store.has(`records.${which}.v1`) && !host.store.has(`checkpoint.${which}`) && !host.store.has('lastManualSyncAt'), st.status);
  check('D falhas', `${name}: a outra fonte segue independente (${other.status})`, other.status === 'current');
}
{
  // falha de armazenamento no meio da gravação dos chunks: o ponteiro do cache não avança
  let armed = true;
  const { host } = newEnv({ hooks: { beforeStorageSet: (key) => { if (armed && key.includes('.entries.3')) throw new Error('disco cheio simulado'); } } });
  const r = await settle(fixed.syncAll(host.ctx, true));
  check('D falhas', 'erro de storage no meio dos chunks: CB falha e o ponteiro records.cb.v1 não é publicado', !r.ok && (await status(host, 'sync.status.cb')).status === 'failed' && !host.store.has('records.cb.v1'));
  armed = false;
}
{
  const { host } = newEnv({ tokens: false });
  const r = await settle(fixed.syncAll(host.ctx, true));
  check('D falhas', 'sem tokens no cofre: as duas fontes falham sem gravar dados', !r.ok && (await status(host, 'sync.status.cb')).status === 'failed' && !host.store.has('records.cb.v1'));
}
{
  // falha depois de uma importação boa: fica "stale", com o cache anterior íntegro
  const good = newEnv();
  await fixed.syncAll(good.host.ctx, true);
  const pointer = good.host.store.get('records.crv.v1');
  good.seen.crv.length = 0;
  const faultyRoutes = makeRoutes({ 'crv/activities:2': { status: 500 } });
  const host2 = createHost({ manifest, addonId: manifest.id, privateTargets: PRIVATE_TARGETS, routes: faultyRoutes.routes, today: TODAY });
  for (const [k, v] of good.host.store) host2.store.set(k, v);
  host2.secrets.set('cb.token', CB_TOKEN); host2.secrets.set('crv.token', CRV_TOKEN);
  const r = await settle(fixed.syncAll(host2.ctx, true));
  const meta = JSON.parse(host2.store.get('records.crv.v1'));
  const income = await fixed.loadRecordSet(host2.ctx, `records.crv.v1.${meta.cacheId}.income`);
  check('D falhas', 'falha após sucesso anterior: CRV fica "stale", ponteiro e cache antigos intactos e legíveis', !r.ok && (await status(host2, 'sync.status.crv')).status === 'stale' && host2.store.get('records.crv.v1') === pointer && income.length === 112);
}

// E — caminho automático (enable) e coalescência de execuções concorrentes
{
  const { host } = newEnv();
  await host.ctx.api.storage.set('sync.enabled', 'true');
  fixed.default(host.ctx);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const a = await status(host, 'sync.status.cb'); const b = await status(host, 'sync.status.crv');
    if (a?.status === 'current' && b?.status === 'current') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check('E caminho automático', 'enable() registra a rota e a sincronização automática inicial conclui (CB e CRV "current")', host.routesAdded.length === 1 && host.routesAdded[0].path === '/addons/controle-patrimonial-sync' && (await status(host, 'sync.status.cb'))?.status === 'current' && (await status(host, 'sync.status.crv'))?.status === 'current');
  host.disposers.forEach((f) => f());
}
{
  const { host, seen } = newEnv();
  const a = fixed.syncAll(host.ctx, true); const b = fixed.syncAll(host.ctx, true);
  await Promise.all([a, b]);
  const snapshotCalls = (list) => list.filter((x) => x === '/snapshot').length;
  check('E concorrência', 'duas chamadas simultâneas são coalescidas (um só /snapshot por fonte)', snapshotCalls(seen.cb) === 1 && snapshotCalls(seen.crv) === 1);
}

// F — estado que o servidor grava para a tela (server.status.*)
{
  const agora = Date.parse('2026-10-03T12:00:00Z');
  const pronto = (updatedAt) => JSON.stringify({ source: 'cb', state: 'ready', updatedAt, snapshotId: 's1', highWatermark: 'w1', itemCount: 9, accountsImported: 3, snapshotsImported: 3, error: null, appliedOn: '2026-10-03' });
  const ler = (raw) => fixed.readServerStatus(raw);
  const desc = (raw) => fixed.describeServerStatus(ler(raw), agora).label;
  check('F estado do servidor', 'estado pronto e recente aparece "Em dia", com contagens e dia importado', desc(pronto('2026-10-03T11:50:00Z')) === 'Em dia' && ler(pronto('2026-10-03T11:50:00Z')).accountsImported === 3 && ler(pronto('2026-10-03T11:50:00Z')).appliedOn === '2026-10-03');
  check('F estado do servidor', 'sem verificar há mais de uma hora aparece "Atrasada"', desc(pronto('2026-10-03T10:30:00Z')) === 'Atrasada');
  check('F estado do servidor', 'falha, token ausente e importando têm rótulos próprios', desc(JSON.stringify({ state: 'failed', error: 'Fonte cb retornou HTTP 500.' })) === 'Falhou' && desc(JSON.stringify({ state: 'not_configured' })) === 'Token não configurado' && desc(JSON.stringify({ state: 'running' })) === 'Importando');
  check('F estado do servidor', 'a mensagem de erro do servidor é mostrada, limitada a 160 caracteres', ler(JSON.stringify({ state: 'failed', error: 'Fonte cb retornou HTTP 500.' })).error === 'Fonte cb retornou HTTP 500.' && ler(JSON.stringify({ state: 'failed', error: 'x'.repeat(500) })).error.length === 160);
  check('F estado do servidor', 'ausente, lixo ou estado desconhecido aparece "Ainda não rodou", sem quebrar a tela', ['', null, undefined, 'não é json', '{"state":"inventado"}', '[]'].every((raw) => desc(raw) === 'Ainda não rodou'));
  const { host } = newEnv();
  await host.ctx.api.storage.set('server.status.cb', pronto('2026-10-03T11:55:00Z'));
  check('F estado do servidor', 'o valor gravado no storage pelo servidor é lido pelo add-on', ler(await host.ctx.api.storage.get('server.status.cb')).state === 'ready');
}

// ------------------------------------------------------------------ resumo
const failed = results.filter((r) => !r.ok);
console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} verificações passaram; ${failed.length} falharam.`);
process.exit(failed.length ? 1 : 0);
