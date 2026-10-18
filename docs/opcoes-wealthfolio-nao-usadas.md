# Opções do Wealthfolio 3.10 que a instância não usa, e como atendê-las

Levantamento de 18/10/2026, feito na instância do VPS1 depois da Fase 3 (patches
0013 e 0014). Cada linha diz o que a tela mostra hoje, de onde viria o dado e se
exige recompilar o servidor (35 a 60 minutos no VPS) ou se basta configurar.

## 1. O que já funciona

| Tela | Estado |
| --- | --- |
| Dashboard, abas Investments, Net Worth e Spending | Patrimônio de R$ 522 mil (ativos R$ 532 mil menos o cartão Carbon de R$ 9,9 mil). Histórico desde 09/05/2022 (início das posições do CRV). |
| Insights, Overview | Alocação, setores, regiões, moedas e concentração calculados. |
| Spending | 6 contas do Mariano. Gasto de janeiro a setembro fecha com o CB: R$ 68.117,43 (R$ 68.964,71 de despesa menos R$ 847,28 de estornos de cartão). |
| Portfolios | `Mariano`, `Claudia`, `Esther`, `Família` e `Patrimônio próprio` (sem as duas contas administradas). |
| Contas | 23 ativas, em `group` (`Contas correntes`, `Aplicações`, `Cartões`, `Corretoras`). Saldo de cada conta igual ao do CB, ao centavo. |

## 2. O que não é usado

| # | Opção | Estado hoje | Como atender | Recompila? | Recomendação |
| --- | --- | --- | --- | --- | --- |
| 1 | **Income** (renda de proventos) | Era R$ 5,59: o lote com um erro derrubava as 65 atividades de renda das corretoras. O 0014 isolou a falha (68 de 73 entraram, R$ 8.616,51 de R$ 8.896,38) e o 0015 corrige os 5 que faltavam (ativo novo sem moeda de cotação). | Patches 0014 e 0015. | feito | Conferir R$ 8.896,38 depois do deploy do 0015. |
| 2 | **Performance (TWR/MWR)** | "Indisponível para escopo misto" (contas em transações e em snapshot juntas). Só há valor de ganho/perda. | (a) Selecionar só as corretoras: continua sem TWR, porque o snapshot não tem fluxo de caixa. (b) Colocar as corretoras em modo transações com as compras do CRV como `BUY` e os aportes como depósitos: exige casar a liquidação do CB com as operações do CRV, o que a regra D3 recusou. | sim | Não agora. É o item mais caro e o de maior risco de dupla contagem. |
| 3 | **Classe de ativo das aplicações** | R$ 170,9 mil de CDB, Caixinha e Tesouro entravam como `Cash` (44% da carteira). | Patch 0016: `meta.allocation.cashCategoryId = FIXED_INCOME` nas contas do grupo `Aplicações`. | feito (0016) | Ver `docs/proposta-configuracao-wealthfolio.md`. |
| 4 | **Orçamento (budget)** | Nenhuma meta; 1 grupo `Other`. O CB de produção não tem orçamento. | Criar pelas telas, ou por script a partir da mediana mensal por categoria dos últimos 9 meses. | não | Vale: o Spending já tem as categorias. Posso gerar uma proposta. |
| 5 | **Regras de categorização** | 0 regras; 3 atividades recentes sem categoria. | Telas de regras, por padrão de descrição. | não | Criar quando aparecerem recorrências sem categoria. |
| 6 | **Eventos (viagens, mudanças)** | Nenhum. O CB de produção não tem projetos nem etiquetas. | Criar pela tela. | não | Opcional. |
| 7 | **Metas (Goals)** | Nenhuma. | Telas; pode apontar para um Portfolio (por exemplo, reserva de emergência = `Aplicações` do Mariano). | não | Decisão sua. |
| 8 | **Alocação alvo** | "No target allocation yet". | Tela, por classe, região ou setor. | não | Decisão sua. |
| 9 | **Benchmarks** (comparar com IBOV, CDI) | Nenhum. | "Add Benchmark" na aba Performance, com um símbolo do Yahoo (por exemplo `^BVSP`). | não | Útil para a carteira de ações. |
| 10 | **Limites de aporte** | Nenhum. São modelos de conta americana (IRA, 401k). | Dá para cadastrar PGBL como limite anual, mas o cálculo não conhece a regra dos 12% da renda. | não | Ignorar. |
| 11 | **Opções da B3** | Fora. O CRV tem posições de opções. | Fase 4: instrumento `OPTION` com multiplicador de contrato, mais as pernas. | sim | Fase própria (já combinado). |
| 12 | **Ativos alternativos e passivos** (imóvel, veículo, financiamento) | Só o cartão aparece como passivo. | Cadastro manual na tela de Holdings. O CB não tem imóvel nem veículo. | não | Se houver patrimônio fora do CB e do CRV. |
| 13 | **Assistente de IA e AI Providers** | Desligados. | Exigem chave de um provedor, que é sua. | não | Só se quiser. |
| 14 | **Acesso por agente (MCP)** | "Off on this server". | `WF_MCP_ENABLED=true` no `.env` do VPS e reiniciar; depois criar token com escopo só de leitura. | não | O domínio é público (`duckdns.org`): ligar só com token de leitura e se houver uso real. |
| 15 | **Wealthfolio Connect** (corretoras na nuvem) | "Not configured for this build". | Não se aplica: as corretoras são do Brasil e o dado vem do CB e do CRV. | n/a | Manter desligado. |
| 16 | **Saúde dos dados** | 1 erro: 3 ativos antigos (`crv-asset-*`, mercado `NYSE` e `NASDAQ`) falham ao buscar cotação. | Ativos órfãos da importação de 29/09 (os ativos atuais usam `XNYS` e `XNAS`). Excluir em Settings, Securities (exclusão permanente fica com você). | não | Excluir os 3. |
| 17 | **Plataformas das contas** (logos) | Sem plataforma. A tabela é fixa. | O importador pode preencher `platformId` quando a corretora existir na tabela. | sim | Estético, baixo valor. |
| 18 | **Importar CSV** (extratos e faturas) | Não usado: o CB importa os extratos. | Nada a fazer; o CB continua sendo a porta de entrada. | n/a | Manter. |

## 3. Pendências abertas da Fase 3

- A primeira importação só categoriza contas que já estão no escopo do Spending;
  as contas adotadas (que já existiam) não entram sozinhas. Depois de mudar o
  escopo, rodar a importação de novo.
- O histórico de posições do CRV foi gravado por script a partir do extrato de
  posições (`scripts/historico-posicoes-crv.js`). Compras novas entram pelo
  snapshot diário; o passado não muda.
