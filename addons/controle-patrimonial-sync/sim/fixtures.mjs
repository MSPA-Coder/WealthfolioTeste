// Envelopes v4 sintéticos e determinísticos, com a mesma forma, as mesmas
// contagens e o mesmo tamanho medido nas APIs reais em 29/09/2026:
//   CB  /snapshot  ~1,28 MB: 1.475 lançamentos, 21 contas, 25 categorias, 92 transferências
//   CRV /snapshot  ~69 KB : 10 posições, 112 proventos
//   CRV /ledger    vazio e prospectivo; /activities 118 (6 encerramentos + 112 proventos)
// Nenhum dado real é usado ou gravado; textos incluem acentos, aspas e barras
// para exercitar o escape do armazenamento.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Modo real (SIM_REAL=1): as respostas reais chegam por stdin, ficam só em memória
// e nada delas é impresso; só contagens e resultados aparecem no relatório.
export function fixturesFromReal(real) {
  const cbSnapshot = real.cbSnapshot; const crvSnapshot = real.crvSnapshot; const ledger = real.ledger;
  const rows = real.activities.flatMap((p) => p.itens);
  const template = real.activities[0];
  const activitiesPage = (page, size) => {
    const slice = rows.slice((page - 1) * size, page * size);
    // cópia profunda: os cenários de falha mutam o corpo devolvido
    return structuredClone({ ...template, itens: slice, paginacao: { ...template.paginacao, pagina: page, paginas: Math.ceil(rows.length / size), tem_proxima: page * size < rows.length, total: rows.length } });
  };
  const changes = (system) => ({ contrato: 'patrimonio/v4', recurso: 'changes', sistema: system, mode: 'snapshot_invalidation', high_watermark: 'wm-changes-' + system, next_cursor: 'wm-changes-' + system, has_more: false, items: [] });
  const count = (res) => cbSnapshot.items.filter((i) => i.resource === res).length;
  const groups = new Set(crvSnapshot.holdings.map((h) => `${h.account}:${h.portfolio}:${h.currency}`));
  return {
    cbSnapshot, crvSnapshot, ledger, activitiesPage, changes,
    expected: { cbAccounts: count('account'), cbCategories: count('category'), cbEntries: count('cash_entry'), cbTransfers: count('transfer'), crvIncome: crvSnapshot.income.length, crvClosed: rows.filter((r) => r.origem === 'transacao').length, crvLedger: ledger.itens.length, crvHoldings: crvSnapshot.holdings.length, crvAccountGroups: groups.size },
  };
}

export function buildFixtures({ cbEntries = 1475, descriptionPad = 0 } = {}) {
  const rnd = rng(20260929);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  const sid = (kind, len) => `${kind}:${hex(len - kind.length - 1)}`;
  const money = () => (Math.floor(rnd() * 500000) / 100).toFixed(2);
  const day = (from, span) => new Date(Date.parse(from) + Math.floor(rnd() * span) * 86400000).toISOString().slice(0, 10);
  const words = ['Mercado', 'Açúcar e café', 'Aluguel "centro"', 'Conta de luz', 'Cartão C:\\loja', 'Farmácia', 'Salário', 'Transferência PIX', 'Seguro', 'Escola'];

  // ---------- CB ----------
  const accounts = Array.from({ length: 21 }, (_, i) => {
    const type = i < 12 ? 'conta' : i < 16 ? 'cartao_credito' : i < 19 ? 'aplicacao' : 'conta';
    const source_id = sid('controle-bancario:account', 50);
    return {
      resource: 'account',
      source_id,
      payload: {
        source_id, name: `Conta ${i + 1}`, account_type: type, purpose: i % 9 === 8 ? 'administrada' : 'pessoal', currency: i === 20 ? 'USD' : 'BRL',
        owner: hex(8), owner_name: 'Titular ' + (i % 3), institution: hex(12), institution_name: 'Banco ' + (i % 5), institution_type: i % 5 === 4 ? 'Corretora' : 'Banco',
        initial_balance: money(), initial_balance_date: '2026-01-01',
        // duas contas sem saldo publicado: ausência não é saldo zero
        balance: i === 19 || i === 20 ? null : (i % 7 === 3 ? '-' + money() : money()),
        balance_as_of: i === 19 || i === 20 ? null : '2026-09-29', deep_link: `/banking/accounts/${i + 1}/?data=2026-09-29`,
      },
    };
  });
  const categories = Array.from({ length: 25 }, (_, i) => {
    const source_id = sid('controle-bancario:category', 51);
    return { resource: 'category', source_id, payload: { source_id, name: `Categoria ${i + 1}`, kind: i % 4 === 0 ? 'movimentacao' : 'gerencial', group: i % 3 === 0 ? 'Grupo ' + (i % 5) : null, created_at: null, updated_at: '2026-09-01T10:00:00.000000+00:00' } };
  });
  const entries = Array.from({ length: cbEntries }, () => {
    const source_id = sid('controle-bancario:cash_entry', 53);
    const status = pick(['realizado', 'vencidos', 'a_vencer']);
    return {
      resource: 'cash_entry',
      source_id,
      payload: {
        source_id, account_id: pick(accounts).source_id, category_id: pick(categories).source_id, transfer_id: null,
        description: pick(words) + ' '.repeat(descriptionPad).replace(/ /g, 'x'), entry_type: pick(['despesa', 'receita']), status, effective_status: status,
        category_kind: 'gerencial', currency: 'BRL', planned_amount: money(), realized_amount: money(),
        due_date: day('2026-01-02', 500), realized_date: day('2026-01-02', 500), operation_type: pick(['normal', 'transferencia']),
        installment: 1, installments: 1, is_recurring: rnd() > 0.7,
        created_at: '2026-01-02T10:00:00+00:00', updated_at: '2026-09-01T10:00:00.000000+00:00',
      },
    };
  });
  const transfers = Array.from({ length: 92 }, (_, i) => {
    const source_id = sid('controle-bancario:transfer', 51);
    const legCount = i === 0 ? 40 : 2; // um agrupador grande (~7,6 KB), como o maior medido
    return {
      resource: 'transfer', source_id,
      payload: { source_id, operation_type: 'transferencia_interna', status: 'realizado', legs: Array.from({ length: legCount }, (_, k) => ({ cash_entry_id: sid('controle-bancario:cash_entry', 53), account_id: pick(accounts).source_id, entry_type: k % 2 === 0 ? 'despesa' : 'receita', currency: 'BRL', planned_amount: money(), realized_amount: money() })) },
    };
  });
  const cbSnapshot = {
    contrato: 'patrimonio/v4', sistema: 'controle-bancario', generated_at: '2026-09-29T17:00:00+00:00',
    snapshot_id: 'cb-' + hex(40), high_watermark: 'wm-cb-' + hex(40),
    capabilities: { snapshot: true, changes: true, resources: { account: true, cash_entry: true, category: true, transfer: true }, decimal_strings: true, read_only: true },
    coverage: {
      account: { state: 'complete', count: accounts.length },
      cash_entry: { state: 'complete', count: entries.length, due_date_from: '2026-01-02', due_date_through: '2027-05-13', statuses: ['realizado', 'vencidos', 'a_vencer'] },
      category: { state: 'complete', count: categories.length },
      transfer: { state: 'complete', unlinked_cash_entries: 0, incomplete_groups: 0, note: 'Transferências são publicadas como agrupadores.' },
      incremental_changes: { state: 'available', endpoint: '/patrimonio/v4/changes', mode: 'snapshot_invalidation', high_watermark: 'wm-cb-changes' },
    },
    snapshot_as_of: '2026-09-29',
    items: [...accounts, ...categories, ...entries, ...transfers],
  };

  // ---------- CRV ----------
  const hold = (account, portfolio, instrument, i) => {
    const source_id = sid('controle-renda-variavel:holding', 56);
    return {
      account, account_name: account === 'XP' ? 'XP' : 'Inter', average_cost: (10 + i).toFixed(4), currency: 'BRL', current_price: null,
      deep_link: `/positions/${i + 1}`, id: source_id, instrument, instrument_type: 'equity', market: 'B3',
      market_value: null, portfolio, price_kind: 'unavailable', price_observed_at: null, price_status: null, quantity: String(100 + i * 10), side: 'long',
      snapshot_id: 'crv-snap', source_id, titular: 'Titular 1', valuation_method: 'unavailable_no_price',
    };
  };
  const holdings = [
    ...['AAAA3', 'BBBB4', 'CCCC3', 'DDDD4'].map((s, i) => hold('XP', 'PF1', s, i)),
    ...['EEEE3', 'FFFF4', 'GGGG3'].map((s, i) => hold('INTER', 'PF1', s, 4 + i)),
    ...['HHHH3', 'IIII4', 'JJJJ3'].map((s, i) => hold('INTER', 'PF2', s, 7 + i)),
  ];
  const income = Array.from({ length: 112 }, (_, i) => {
    const source_id = sid('controle-renda-variavel:income', 55);
    return {
      account: 'XP', account_name: 'XP', amount: money(), cash_accounting_role: 'not_a_cash_entry', currency: 'BRL', date: day('2025-01-02', 600),
      deep_link: `/dividends/${i + 1}/edit`, duplicate_risk: 'may_also_be_recorded_in_controle_bancario', id: source_id, instrument: pick(['AAAA3', 'BBBB4', 'CCCC3']),
      kind: pick(['dividendo', 'jcp', 'aluguel']), role: 'analytic_only', snapshot_id: 'crv-snap', source_id, titular: 'Titular 1',
    };
  });
  const crvSnapshot = {
    accounts: [], contrato: 'patrimonio/v4', sistema: 'controle-renda-variavel', recurso: 'snapshot',
    capacidades: { holdings: true, position_ledger: true, income: true, activities: true, prices: true, options: false, complete_trades: false, changes: true },
    coverage: {
      activities: { available: true }, changes: { available: true, endpoint: '/patrimonio/v4/changes', high_watermark: 'wm-crv', mode: 'snapshot_invalidation' },
      complete_trades: { available: false }, exclusions: { unpriced_holdings: holdings.length, excluded_options: 5, excluded_simulated: 10 },
      holdings: { complete: true, included: holdings.length, unpriced: holdings.length, scope: 'posições abertas de ações em carteiras reais' },
      income: { included: income.length, scope: 'proventos persistidos', role: 'analytic_only', do_not_rebook_as_cash: true },
      prices: { current_included: 0, history_included: 0, complete: false, omitted: 'consumer_requested' },
      options: { available: false, excluded_options: 5, excluded_simulated: 0 },
    },
    data_de_referencia: '2026-09-29', generated_at: '2026-09-29T17:00:00+00:00', gerado_em: '2026-09-29T17:00:00+00:00',
    high_watermark: 'wm-crv-' + hex(40), holdings, income, prices: { current: [], history: [] }, snapshot_id: 'crv-' + hex(40),
    source_id: 'controle-renda-variavel:source:' + hex(24),
  };
  const ledger = { contrato: 'patrimonio/v4', coverage: { backfill: false, completeness: 'prospective', scope: 'posições encerradas após a revisão 20260928_0024', since_revision: '20260928_0024' }, estado: 'ok', gerado_em: '2026-09-29T17:00:00+00:00', itens: [], paginacao: { anterior: null, pagina: 1, paginas: 0, proxima: null, tamanho: 100, tem_anterior: false, tem_proxima: false, total: 0 }, recurso: 'ledger', sistema: 'controle-renda-variavel' };
  const activityRows = [
    ...Array.from({ length: 6 }, (_, i) => ({ data: '2026-09-0' + (i + 1), data_realizacao: '2026-09-0' + (i + 1), descricao: 'Encerramento ' + i, id: hex(67), instituicao: 'XP', instrumento: 'AAAA3', moeda: 'BRL', origem: 'transacao', status: 'realizado', tipo: 'venda', titular: 'Titular 1', valor: money(), valor_realizado: money() })),
    ...Array.from({ length: 112 }, () => ({ data: day('2025-01-02', 600), data_realizacao: '2026-09-01', descricao: 'Provento', id: hex(67), instituicao: 'XP', instrumento: 'BBBB4', moeda: 'BRL', origem: 'provento', status: 'realizado', tipo: 'jcp', titular: 'Titular 1', valor: money(), valor_realizado: money() })),
  ];
  const activitiesPage = (page, size) => {
    const slice = activityRows.slice((page - 1) * size, page * size);
    return {
      contrato: 'patrimonio/v4', recurso: 'activities', sistema: 'controle-renda-variavel', gerado_em: '2026-09-29T17:00:00+00:00', high_watermark: 'wm-act',
      coverage: { closed_transactions_included: 6, complete: true, income_included: 112, limitations: 'resumos' }, filtros: {}, itens: slice,
      paginacao: { anterior: null, pagina: page, paginas: Math.ceil(activityRows.length / size), proxima: null, tamanho: size, tem_anterior: page > 1, tem_proxima: page * size < activityRows.length, total: activityRows.length },
    };
  };
  const changes = (system) => ({ contrato: 'patrimonio/v4', recurso: 'changes', sistema: system, mode: 'snapshot_invalidation', high_watermark: 'wm-changes-' + system, next_cursor: 'wm-changes-' + system, has_more: false, items: [] });

  return { cbSnapshot, crvSnapshot, ledger, activitiesPage, changes, expected: { cbAccounts: 21, cbCategories: 25, cbEntries: cbEntries, cbTransfers: 92, crvIncome: 112, crvClosed: 6, crvLedger: 0, crvHoldings: 10, crvAccountGroups: 3 } };
}
