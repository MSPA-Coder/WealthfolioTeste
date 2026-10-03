// Confere o ZIP empacotado (release/) e executa o dist/addon.js DE DENTRO do ZIP
// contra o host simulado pelo caminho automático (enable). Só imprime metadados.
//   docker run --rm --network none -v <addon>:/workspace:ro -w /workspace node:24-alpine node sim/verify-package.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHost } from './host.mjs';
import { buildFixtures } from './fixtures.mjs';

const zip = 'release/controle-patrimonial-sync.zip';
const dir = mkdtempSync(join(tmpdir(), 'pkg-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules')); // resolve react como o host faz
const listing = execFileSync('unzip', ['-l', zip]).toString().split('\n')
  .map((l) => l.match(/^\s*\d+\s+\S+\s+\d\d:\d\d\s+(.+?)\s*$/)?.[1]).filter((n) => n && !n.endsWith('/'));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

const packed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const local = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const dist = readFileSync(join(dir, 'dist/addon.js'), 'utf8');
check('conteúdo do ZIP: manifest.json, dist/addon.js, README.md', ['manifest.json', 'dist/addon.js', 'README.md'].every((f) => listing.includes(f)) && listing.length === 3, listing.join(', '));
check(`versão ${packed.version} igual em manifest.json, package.json e no ZIP`, packed.version === '0.3.3' && local.version === packed.version && pkg.version === packed.version);
check('manifesto do ZIP idêntico ao do repositório', JSON.stringify(packed) === JSON.stringify(local));
const perms = packed.permissions.map((p) => `${p.category}.${p.functions.join('+')}`).join(', ');
check('permissões: accounts.getAll+create, snapshots.save, secrets.set+use, network.request', perms === 'accounts.getAll+create, snapshots.save, secrets.set+use, network.request', perms);
check('hosts declarados: host.docker.internal, cb-api, crv-api', JSON.stringify(packed.network.allowedHosts) === JSON.stringify(['host.docker.internal', 'cb-api', 'crv-api']));
check('dist do ZIP envia isDefault:false na criação de conta', /isDefault:\s*!?1|isDefault:\s*false/.test(dist), (dist.match(/isDefault:\s*[^,\s]+/) ?? [''])[0]);
check('dist não contém tokens ou segredos literais', !/Bearer [A-Za-z0-9_-]{20,}/.test(dist) && !/TEST-C/.test(dist));

const fx = buildFixtures({ descriptionPad: 90 });
const bodies = { cb: JSON.stringify(fx.cbSnapshot), crv: JSON.stringify(fx.crvSnapshot) };
const base = '/patrimonio/v4';
const serve = (system, token, snapshot) => async ({ path, query, headers, bearer }) => {
  const sub = path.slice(base.length);
  if (bearer !== token) return { status: 401, body: '{}' };
  if (system === 'cb' && headers['X-Forwarded-Proto'] !== 'https') return { status: 400, body: '{}' };
  if (sub === '/changes') return { body: fx.changes(system) };
  if (sub === '/snapshot') return { body: snapshot };
  if (sub === '/ledger') return { body: fx.ledger };
  if (sub === '/activities') return { body: fx.activitiesPage(Number(query.get('page')), Number(query.get('page_size'))) };
  return { status: 404, body: '{}' };
};
const host = createHost({
  manifest: packed, addonId: packed.id, today: '2026-09-29',
  privateTargets: [{ scheme: 'http', host: 'cb-api', port: 8000, pathPrefix: base }, { scheme: 'http', host: 'crv-api', port: 5003, pathPrefix: base }],
  routes: { 'cb-api:8000': serve('cb', 'T-CB', bodies.cb), 'crv-api:5003': serve('crv', 'T-CRV', bodies.crv) },
});
host.secrets.set('cb.token', 'T-CB'); host.secrets.set('crv.token', 'T-CRV');
await host.ctx.api.storage.set('sync.enabled', 'true');
const mod = await import(pathToFileURL(join(dir, 'dist/addon.js')).href);
mod.default(host.ctx);
const st = async (k) => JSON.parse((await host.ctx.api.storage.get(k)) ?? 'null');
const deadline = Date.now() + 60000;
while (Date.now() < deadline && !((await st('sync.status.cb'))?.status === 'current' && (await st('sync.status.crv'))?.status === 'current')) await new Promise((r) => setTimeout(r, 100));
check('dist do ZIP via enable(): CB e CRV ficam "current" (importação inicial automática)', (await st('sync.status.cb'))?.status === 'current' && (await st('sync.status.crv'))?.status === 'current');
check('nenhuma criação de conta rejeitada pelo host; contas e snapshots gravados', host.calls.createRejected === 0 && host.accounts.length === 15 && host.snapshots.size === 15, `${host.accounts.length} contas, ${host.snapshots.size} snapshots`);
check('rota /addons/controle-patrimonial-sync registrada', host.routesAdded.some((r) => r.path === '/addons/controle-patrimonial-sync'));
host.disposers.forEach((f) => f());
console.log(`\nRESUMO: ${results.filter(Boolean).length}/${results.length} verificações passaram.`);
process.exit(results.every(Boolean) ? 0 : 1);
