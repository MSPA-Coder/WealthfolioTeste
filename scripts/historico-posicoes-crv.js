// Historico de posicoes do CRV no Wealthfolio (uso unico, executado em 18/10/2026).
//
// O contrato v4 do CRV publica so as posicoes atuais. O extrato de posicoes do
// CRV (leitura.movimento_posicao) e o saldo diario do CB (leitura.conta e
// leitura.lancamento realizados) foram lidos em modo somente leitura e
// reproduzidos aqui. Cada dia com movimento vira um snapshot completo (posicoes
// + caixa) nas contas de corretora; o Wealthfolio nao grava nada no CB nem no CRV.
//
// Como usar: logado em https://wealthfolio-mspa.duckdns.org, cole este arquivo
// no console do navegador e rode `await historicoPosicoes(false)`. Com `true`
// so conta quantos snapshots gravaria. O importador (patch 0014) nao regrava o
// caixa de uma corretora que ja tem historico com posicoes.
//
// Para refazer: atualize M com o extrato atual do CRV (corretora, moeda,
// mercado, ativo, data, quantidade e custo medio resultantes) e CASH com o saldo
// diario das contas de corretora do CB.
async function historicoPosicoes(DRY) {
  const CASH = {}; // { Genial: [["2025-12-31","951.99"], ...], XP: [...], Avenue: [...], Nomad: [...], Revolut: [...] }
  const M = [
    // ['Avenue','USD','NASDAQ','CGC','2026-06-16',5000,0.95],
  ];
  const MIC = { B3: 'BVMF', NYSE: 'XNYS', NASDAQ: 'XNAS' };
  const accounts = await (await fetch('/api/v1/accounts?includeArchived=true')).json();
  const report = [];
  for (const [broker, ccy] of [...new Set(M.map(m => m[0] + '|' + m[1]))].map(k => k.split('|'))) {
    const acc = accounts.find(a => a.name === `${broker} · ${ccy}` && a.isActive && !a.isArchived);
    if (!acc) { report.push([broker, ccy, 'conta nao encontrada']); continue; }
    const moves = M.filter(m => m[0] === broker && m[1] === ccy);
    const first = moves.map(m => m[4]).sort()[0];
    const series = CASH[broker] || [];
    const snaps = await (await fetch('/api/v1/snapshots?accountId=' + acc.id)).json();
    const dates = [...new Set([...snaps.map(s => s.snapshotDate), ...moves.map(m => m[4]), ...series.map(s => s[0])])]
      .filter(d => d >= first).sort();
    let written = 0, failed = 0;
    for (const d of dates) {
      const held = {};
      for (const m of moves.filter(m => m[4] <= d).sort((a, b) => a[4].localeCompare(b[4]))) held[m[3]] = m;
      const holdings = Object.values(held).filter(m => m[5] > 0).map(m => ({
        symbol: m[3], quantity: String(m[5]), currency: ccy, averageCost: String(m[6]),
        exchangeMic: MIC[m[2]], quoteCcy: ccy, instrumentType: 'EQUITY',
      }));
      let cash = 0;
      for (const [cd, amount] of series) if (cd <= d) cash = Number(amount);
      const body = { accountId: acc.id, holdings, cashBalances: cash === 0 ? {} : { [ccy]: cash.toFixed(2) }, snapshotDate: d };
      if (DRY) { written++; continue; }
      const r = await fetch('/api/v1/snapshots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status < 300) written++; else { failed++; report.push([broker, ccy, d, r.status, (await r.text()).slice(0, 120)]); }
    }
    report.push([broker, ccy, first, dates.length + ' datas', written + ' ok', failed + ' falhas']);
  }
  // Depois de gravar: POST /api/v1/market-data/sync com {"assetIds":null,"refetchAll":true}
  // para buscar as cotacoes do periodo antigo.
  return JSON.stringify(report);
}
