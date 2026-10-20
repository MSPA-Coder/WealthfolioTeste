# Plano de implementação: fronteira entre CB e CRV (corte em 01/01/2026)

Plano de 18/10/2026 para executar o que o [estudo](estudo-fronteira-cb-crv.md)
decidiu. Escopo escolhido pelo mantenedor: tudo de uma vez, conduzido por plano
aprovado por repositório, um PR por repositório e deploy só com autorização a
cada vez. O CB e o CRV estão em produção: toda mudança de schema é migração
aditiva, com backup validado do BackupRestore antes de tocar dado real.

Ordem do contrato da fonte para o consumidor: CB, depois CRV, depois
Wealthfolio (que fica fora desta rodada).

## Visão geral

| PR | Repo | O que entrega | Depende de | Altera dado real? |
| --- | --- | --- | --- | --- |
| CB-1 | ControleBancario | ativo e tipo de renda no lançamento, liquidação de pregão estruturada, contrato v4 aditivo | nada | só preenche campos novos |
| CRV-1 | ControleRendaVariavel | execuções importadas do myProfit e tela de conferência por pregão | nada (a conferência usa o CB-1) | não mexe em posições |
| CRV-2 | ControleRendaVariavel | proventos de 2026 em diante lidos do CB | CB-1 em produção | grava proventos novos; não altera os 40 de até 2025 |
| CRV-3 | ControleRendaVariavel | aplicar as execuções de 2026 às posições, com ensaio | CRV-1 | **sim**, só após revisão do ensaio |

CB-1 e CRV-1 não dependem um do outro e podem rodar em paralelo, em sessões
separadas (repositórios distintos, sem arquivo em comum). CRV-2 espera o CB-1
chegar ao VPS; CRV-3 espera o CRV-1.

## CB-1: dado estruturado no extrato

1. **Parser puro** `bank_statements/investimentos.py`, a partir da descrição:
   - ativo: código tipo ISIN (`Brraizacnpr6` = RAIZ4; `ACNOR` = 3, `ACNPR` = 4,
     `CTF` = 11) ou ticker escrito (`EALT4`); units e BDR sem regra ficam sem ativo;
   - tipo de renda: aluguel (`Taxa de Remuneração Empréstimo`), JCP (`Juros S/
     Capital`), dividendo (`Dividendos`, `Cred Reembolso Jcp-Btc`);
   - papel da linha: crédito, `irrf_aluguel` (`Irrf S/Rendimentos Empréstimos`),
     `corretagem_aluguel` (`Corretagem Executor - Btc`);
   - liquidação de pregão: data do pregão e número da nota de `Operações Bolsa D+N
     Pr dd/mm/aaaa Nc. n` (nota mascarada `*` vira nula).
2. **Armazenamento**: tabela 1:1 com o lançamento (`EntryInvestmentDetail`),
   para não inflar `CashFlowEntry` nem mexer nas views `leitura` já em uso.
   Migração aditiva.
3. **Quando roda**: no fim da importação de qualquer adaptador de extrato, e em
   um comando de preenchimento dos lançamentos existentes, idempotente, com
   `--dry-run` que lista o que mudaria.
4. **Contrato v4**: `cash_entry` ganha campos opcionais `instrument`,
   `income_kind`, `income_role` e `settlement` (`pregao_date`, `note`). As quatro
   cópias do schema, `tests/contrato` e `verificar.py` mudam na mesma entrega.
   A conferir: se o schema aceita campo adicional sem trocar de versão.
5. **Testes**: o parser contra as descrições reais de 2026 (sem valores); o
   preenchimento idempotente; o contrato validado.
6. **Aceite**: os 73 créditos de proventos com tipo; ativo em todos menos os sem
   código; as 13 liquidações da Genial com data de pregão; contrato v4 válido.

## CRV-1: execuções do myProfit e conferência

1. **Tabelas novas** (migração aditiva): `execution_imports` (arquivo, período,
   `sha256`, linhas, data) e `executions` (dono, corretora, data do pregão,
   documento, ativo, grupo, lado, quantidade, preço, taxas, totais com e sem
   taxas, day trade, moeda, ordem da linha no documento, `content_hash`).
   Chave de idempotência: documento, ordem da linha e `content_hash`, porque o
   relatório não traz identificador por negócio.
2. **Importador** `app/executions/myprofit.py` (openpyxl, já dependência):
   exige as colunas do relatório `Histórico de investimentos`; as duas linhas de
   cabeçalho (nome e CPF) são descartadas e nunca gravadas; datas em número
   serial do Excel; grupo mapeia para ação, opção, ETF, índice futuro, Tesouro,
   ação EUA.
3. **Entrada**: `flask importar-negocios-myprofit <arquivo>` e tela de envio. O
   padrão é ensaio (novas, repetidas, alteradas), e só grava com confirmação.
4. **Cliente do CB** `app/patrimonio/cb_client.py`, só leitura, pelo contrato v4,
   com token em segredo de arquivo (`*_FILE`). A conferir: a rede entre CB e CRV
   no VPS1 e o token novo de consumidor do CB.
5. **Conferência por pregão** (tela e comando, só leitura): por corretora e data
   do pregão, a liquidação do CB contra a soma assinada das execuções (venda
   positiva, compra negativa, total com taxas). Estados: confere, diferença, só
   no CB, só no CRV; tolerância configurável (padrão R$ 5); mostra o custo
   implícito. Tabela de correspondência corretora do CRV e conta do CB.
6. **Testes**: os 13 pregões da Genial como fixture; idempotência; linha igual
   legítima no mesmo documento; arquivo com colunas faltando.
7. **Aceite**: 13 de 13 pregões da Genial em "confere" contra o CB de produção.

## CRV-2: proventos do CB

1. **Migração aditiva em `dividends`**: `origin` (`planilha` por padrão, ou
   `cb`), `origin_id`, `gross_amount`, `withheld_amount`; índice único parcial
   por dono e `origin_id` onde `origin = 'cb'`. A chave antiga continua valendo
   para `planilha`.
2. **Importador** `flask importar-proventos-cb`, idempotente, só toca `origin =
   'cb'`, só de 01/01/2026 em diante (corte configurável). Para cada crédito com
   tipo de renda: valor líquido = crédito menos o IRRF do mesmo ativo e dia
   (exato) menos a corretagem de aluguel do dia (rateada pelo crédito). O bruto e
   as retenções ficam nos campos novos; a data é a realizada no CB.
3. **Fila de revisão** para crédito sem ativo, em tela, sem gravar nada até o
   mantenedor indicar o ativo.
4. **Telas**: marca de origem em cada linha, linhas do CB somente leitura,
   subtotal "até 31/12/2025", importação por planilha e formulário recusando
   pagamento de 2026 em diante, YOC e DY calculados sobre as posições quando o
   campo vier em branco.
5. **Contrato v4 (renda do CRV)**: campo opcional `origin`; o `duplicate_risk`
   passa a dizer que linha `cb` já existe como lançamento do CB. Quatro cópias do
   schema.
6. **Aceite**: 2026 fecha em R$ 6.815,25 líquidos (Genial e SCP XP), com dividendo
   e JCP idênticos aos de hoje, o WEGE3 incluído, e as 40 linhas até 31/12/2025
   (R$ 10.949,33) intactas.

## CRV-3: aplicar as execuções às posições

Só depois do CRV-1 e de revisão do ensaio. É o único passo que altera dado
real de posição.

1. **Backup validado** do banco do CRV pelo BackupRestore antes de aplicar.
2. **Ensaio** `flask reconstruir-2026 --dry-run` (padrão): estado de abertura de
   31/12/2025, execuções de 2026 repetidas pelos serviços que o CRV já usa
   (`create_or_merge_position`, `apply_position_closure`), em uma transação que
   é desfeita. Compara com o estado atual do CRV e com a posição do myProfit, e
   lista as diferenças: WEGE3 ausente, HODL11 lançado em 23/03, opções de RAIZ
   ausentes, CGC, SGOV e BRK.B.
3. **Opções**: o relatório não traz strike nem vencimento. Opção sem contrato no
   CRV vai para uma lista de pendências, que o mantenedor completa. O exercício
   segue a regra de custo líquido do prêmio: o ensaio **propõe** o custo
   (preço de exercício menos os prêmios recebidos da mesma série) e o
   mantenedor confirma.
4. **Fora do escopo desta etapa**: futuros (WIN), Tesouro Direto e as contas no
   exterior (Avenue, Nomad, Revolut), que divergem do myProfit e pedem uma
   decisão de qual fonte vale.
5. **Aprovação explícita** do ensaio antes de qualquer gravação.
6. **Aceite**: abertura mais execuções reproduz a posição do myProfit em
   quantidade para Genial e XP (8 ativos mais as opções).

## Como cada PR chega à produção

Branch por PR (`feat/`), testes focados no Docker, PR com squash merge e
auto-merge, CI obrigatória verde (CB: `Qualidade` e `CodeQL`; CRV:
`Qualidade`, `Contratos de runtime` e `CodeQL`, que rodam o `quality`
completo). Desde 20/10/2026 o deploy é automático: depois do merge, o
`atualizar-stacks.timer` do VPS espera a CI do `main`, faz backup verificado e
roda o `deploy.sh`, sem espera nem comando à mão. A documentação do CB (`docs/architecture.md`,
`docs/domain.md`) e do CRV (`docs/architecture.md`, `AGENTS.md` quando uma regra
de produto mudar) é atualizada na mesma entrega.

## Pontos a confirmar durante a execução

- Se o schema v4 aceita campo adicional sem mudar de versão.
- A rede entre CB e CRV no VPS1 e o segredo do token de consumidor.
- Os adaptadores de extrato da XP, Avenue e Nomad: o parser de CB-1 é
  independente do adaptador, mas a descrição varia entre eles.
- O formato do relatório em períodos anteriores a 2026 (teste do importador
  antes de qualquer reconstrução do passado).

## Fora desta rodada

Wealthfolio (renda líquida e histórico até 2025), passado de 2019 a 2025 no
CRV, proventos em dólar e na Avenue (esperam extrato da Nomad e da Avenue).
