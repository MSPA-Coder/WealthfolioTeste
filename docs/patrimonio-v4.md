# Contrato Patrimônio v4

Este contrato alimenta o Wealthfolio sem transferir a responsabilidade dos
dados operacionais. Controle Bancário (CB) e Controle de Renda Variável (CRV)
continuam sendo as fontes de verdade; cada uma publica somente leitura e o
conector do Wealthfolio grava o checkpoint apenas depois de aplicar um lote.

## Regras comuns

- Todos os valores monetários e quantidades são strings decimais. Datas usam
  ISO 8601 e moeda usa ISO 4217.
- `source_id` é estável, opaco e prefixado pela fonte. Um `delete` é um
  tombstone, nunca uma ausência silenciosa.
- Quando `capabilities.changes` é verdadeiro, `cursor` é opaco e monotônico
  por fonte. Uma leitura retorna `high_watermark`; o consumidor somente usa
  `next_cursor` após persistir todo o lote. Repetir um lote precisa ser seguro.
- Enquanto uma fonte ainda não tiver outbox transacional, ela declara
  `changes: false` e usa `high_watermark: null`. Seu snapshot continua sendo
  uma visão consistente, mas cada execução substitui a coleção inteira.
- Nesta fase, `changes` é um feed de invalidação transacional: seus itens
  mandam o consumidor buscar um novo snapshot, em vez de recriar fatos
  operacionais a partir de eventos. O snapshot representa uma visão consistente
  até `high_watermark`; o cursor só é confirmado depois de aplicar esse
  snapshot.
- A origem informa `capabilities` e `coverage`. Dado não publicado é marcado
  como ausente, nunca convertido em zero.
- O consumidor só pode limpar um recurso que desapareceu de uma foto quando a
  cobertura daquela coleção declara completude. CB usa
  `coverage.account.state: "complete"`; CRV usa
  `coverage.holdings.complete: true`, cujo escopo continua limitado a posições
  abertas de ações em carteiras reais.

## Recursos

| Fonte | Recursos | Semântica de importação |
| --- | --- | --- |
| CB | `account`, `cash_entry`, `category`, `transfer` | Conta inclui saldo e data iniciais. Lançamento realizado usa data e valor realizados; pendente ou projetado mantém o status. Transferências têm as duas pontas e não são receita ou despesa. |
| CRV | `holding`, `income`, `price_current`, `price_history`, `position_ledger` | Holdings são fotografias para o modo `HOLDINGS`. Cada holding declara `instrument_type`; no piloto o único valor aceito é `equity`. Renda é provento efetivamente recebido. Preços atuais e diários são informativos. O ledger de posição é prospectivo e não recria caixa. |

## Endpoints

Cada fonte publica metadata e snapshot. Só publica changes após instalar o
outbox transacional:

```text
GET /patrimonio/v4/metadata
GET /patrimonio/v4/snapshot
# condicional: GET /patrimonio/v4/changes?after=<cursor>&limit=<1..500>
```

`snapshot` contém `contrato`, `sistema`, `generated_at`, `snapshot_id`,
`high_watermark`, `capabilities`, `coverage` e `items`. `changes` contém `high_watermark`,
`next_cursor`, `has_more` e itens com:

```json
{
  "cursor": "opaco",
  "resource": "cash_entry",
  "source_id": "controle-bancario:entry:...",
  "operation": "upsert",
  "changed_at": "2026-09-28T12:00:00Z",
  "payload": { "mode": "snapshot_required" }
}
```

Em `operation: "delete"`, `payload` é omitido. A fonte grava o evento e a
mutação operacional na mesma transação. O consumidor não aplica o payload
individualmente nesta fase: ele busca `snapshot`, persiste os dados e só então
salva `next_cursor`.

Não há retenção automática da outbox nesta fase. Ela preserva os tombstones
para uma retomada segura; uma política futura de retenção deverá expor um piso
de cursor e exigir um novo snapshot de cursores antigos.

## Limites declarados do piloto

- O CB mantém o token de integração atual durante o piloto; ele ainda tem
  acesso global, sem filtro por titular.
- O CRV fornece holdings, proventos e preços atuais. Movimentos de posições
  fechadas antes do novo ledger não são promovidos a negócios completos; a
  cobertura histórica precisa informar `derived` ou `unavailable`.
- Compras de ativos só geram uma atividade de caixa quando a conta de liquidação
  correspondente puder ser ligada. Sem essa ligação, o conector sinaliza a
  conciliação em vez de duplicar patrimônio.
- Opções e carteiras simuladas do CRV estão fora do snapshot. O consumidor
  rejeita um holding sem `instrument_type: "equity"`, para que uma expansão de
  cobertura exija contrato e mapeamento explícitos antes da importação.
