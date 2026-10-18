# Estudo: o que é uma "conta" no CB, no CRV e no Wealthfolio

Estudo de 17/10/2026, anterior à Fase 3 (CB em modo transações). Fontes: dados
de leitura do CB e do CRV (MCP `financas`), código do Wealthfolio 3.10 e dos
patches 0000–0012. Nada foi alterado nos bancos do CB e do CRV.

## 1. Os conceitos lado a lado

| Conceito | CB | CRV | Wealthfolio 3.10 |
| --- | --- | --- | --- |
| Unidade básica | **Conta** (`conta`, `aplicacao`, `cartao_credito`), com titular, instituição, finalidade e moeda | **Posição** por corretora × carteira; só há 5 corretoras e 2 carteiras | **Account**: tipo `SECURITIES`, `CASH`, `CREDIT_CARD` ou `CRYPTOCURRENCY`, uma moeda, um modo (snapshot ou transações) |
| Instituição | `instituicao` + `tipo_instituicao` (Banco ou Corretora) | `corretora` | `platform` (tabela fixa de logos; não há como criar) |
| Dono | `titular` (Mariano, Claudia, Esther) | `owner_id` (só o 1) | **Não existe.** Só `group` (texto livre) e *Portfolios* |
| "Carteira" | não existe | **balde de moeda**: carteiras "BRL" e "USD" (não são estratégias) | *Portfolio* = escopo de relatório sobre um conjunto de contas (nada a ver com o do CRV) |
| Finalidade | `pessoal` ou `administrada` | não existe | não existe |
| Caixa | saldo da conta | não tem (só posições) | por conta, em dinheiro ou derivado das atividades |
| Posições | não tem | quantidade, custo médio, preço | por conta (`SECURITIES`/`CASH` em modo snapshot) |
| Aplicação (CDB, caixinha, Tesouro) | conta comum com saldo | fora de escopo | **não existe**: ou é caixa (`CASH`) ou ativo com quantidade e preço |
| Cartão | conta com saldo negativo (fatura) | — | `CREDIT_CARD`: passivo, só em modo transações, entra no Spending e no patrimônio |
| Transferência entre contas próprias | par de lançamentos (`transferencia`) | — | par `TRANSFER_OUT`/`TRANSFER_IN` com o mesmo `source_group_id` |

## 2. Inventário real (17/10/2026, saldos realizados)

**CB, 23 contas:** 14 contas, 7 aplicações e 2 cartões.

| Titular · finalidade | Contas | Aplicações | Cartões |
| --- | --- | --- | --- |
| Mariano · pessoal | 10 (4 em bancos, 6 em corretoras; 1 em USD cada em Avenue, Nomad e Revolut) | 5 · R$ 80.407,46 | 2 (saldo realizado 0; R$ 5.034,58 vencidos em aberto) |
| Claudia · pessoal | 3 | 1 · R$ 9.478,94 | |
| Claudia · **administrada** | 1 (C6 Conta 02, R$ 0,63) | 1 (Caixinha C6, R$ 9.643,93) | |
| Esther · pessoal | 1 (R$ 0,49) | | |

Soma das aplicações: **R$ 99.530,33**. O Wealthfolio hoje **não importa
aplicações nem cartões** (o patch 0005 os pula), então o patrimônio de
R$ 361.175,01 está **R$ 99,5 mil abaixo** do que o CB considera caixa e
aplicações.

**CRV, posições abertas de ações** (todas do `owner_id` 1, nenhuma simulada):

| Corretora | Moeda | Posições | Valor de mercado |
| --- | --- | --- | --- |
| Genial | BRL | 5 | R$ 167.264,00 |
| XP | BRL | 1 | R$ 76.545,00 |
| Genial | USD | 1 | US$ 87,79 (aberta em 09/10) |
| Avenue | USD | 1 | US$ 9.208,85 |
| Nomad | USD | 1 | US$ 2.516,95 |
| Revolut | USD | 1 | US$ 243,84 |

**Wealthfolio hoje (lido pela API logada, só GET):** 19 contas ativas (14 do
CB em `CASH`/snapshot e 5 do CRV em `SECURITIES`/snapshot) e 28 arquivadas (as
legadas). Nenhuma tem `group`, não há **nenhum Portfolio**, e o escopo do
Spending está vazio (`accountIds: []`), por isso a tela de Spending mostra zero.
Os nomes repetem: `CB · Conta 01` aparece 3 vezes, `CB · Conta 02` e
`CB · Conta 03` 2 vezes, `CB · Conta em dólar` 3 vezes. A moeda base é BRL.

## 3. Os descompassos (o que muda de significado)

1. **A mesma corretora real existe nos dois sistemas.** O CB guarda o *caixa*
   da corretora (conta com `tipo_instituicao = Corretora`); o CRV guarda as
   *posições*. No Wealthfolio isso é **uma só conta** (caixa + posições do mesmo
   dia). Hoje o importador cria duas contas separadas (`CB · Conta 03` e
   `CRV · Genial · BRL`), então o total por corretora, a alocação e o caixa
   não investido por corretora não existem.

   | Corretora | CB (caixa) | CRV (posições) |
   | --- | --- | --- |
   | Genial | Conta 03 (BRL, R$ 1.506,80) | BRL e USD |
   | XP | Conta 05 "SCP XP Investimentos" (R$ 0,00) | BRL |
   | Avenue | Conta em dólar (USD 6.391,72) e Conta Brasileira (BRL) | USD |
   | Nomad | Conta em dólar (USD 0) | USD |
   | Revolut | Conta em dólar (USD 0) | USD |

   Observação: "XP" aparece três vezes no CB: a corretora (SCP XP, Conta 05),
   o banco (Conta 04) e a renda fixa (Tesouro Direto, R$ 30.458,65, que
   fisicamente está na corretora).
2. **"Carteira" do CRV é um balde de moeda**, não um portfólio do Wealthfolio.
3. **Dono.** O Wealthfolio não tem titular. As 23 contas do CB têm 3 titulares;
   misturar tudo faz o patrimônio de Claudia e de Esther contar como do Mariano.
4. **Finalidade.** "Administrada" (dinheiro que o Mariano administra, não é
   dele) não tem equivalente. Contar essas contas infla o patrimônio próprio
   em R$ 9.644,56 hoje.
5. **Nomes ambíguos.** "Conta 01" existe 3 vezes, "Conta 02" e "Conta 03" 2
   vezes, "CDB", "Cofrinho" e "Conta em dólar" também. Só titular + instituição
   desfazem a ambiguidade.
6. **Aplicação não existe no Wealthfolio.** CDB/caixinha/Tesouro como `CASH`
   distorcem a alocação (R$ 99,5 mil de renda fixa viram "Cash"). O Wealthfolio
   tem um mecanismo para isso (`meta.allocation.cashCategoryId`, classifica o
   caixa da conta numa classe de ativo), mas ele exige `meta` em JSON, e o
   marcador atual é texto puro.
7. **Cartão é passivo** (`CREDIT_CARD`), só em modo transações.
8. **Destinos que o CB não tem como conta.** O CB manda dinheiro para o
   *Mercado Bitcoin* (cripto): R$ 10.000 (Conta 01 Mariano), R$ 2.490 e
   R$ 3.000 (Genial) e um retorno de R$ 15.946,72. Esse caixa sai da vista dos
   dois sistemas. Como transferência, é "poupança" (Saving) no Spending.
9. **Moeda.** Contas em USD no CB, posições em USD no CRV, base BRL no
   Wealthfolio. Uma conta Wealthfolio tem uma moeda.
10. **Modo de acompanhamento.** Corretoras ficam em snapshot (`HOLDINGS`)
    porque a liquidação de bolsa do CB não pode virar movimento de caixa
    (regra D3). Bancos, aplicações e cartões podem ir para transações. Em
    3.10, trocar o modo é limpo: os snapshots do outro modo ficam guardados e
    não são lidos, e dá para voltar.

## 4. Proposta de modelagem

### 4.1 Contas

| Origem | Conta no Wealthfolio | Modo | Tipo |
| --- | --- | --- | --- |
| CB conta em banco | uma por conta | transações | `CASH` |
| CB aplicação | uma por aplicação | transações | `CASH` |
| CB cartão | uma por cartão | transações | `CREDIT_CARD` |
| CB corretora + CRV da mesma corretora e moeda | **uma por corretora × moeda**, com caixa (CB) e posições (CRV) no mesmo snapshot | snapshot | `SECURITIES` |

Chave das corretoras: instituição normalizada + moeda. Genial BRL (caixa + 5
posições), Genial USD (1 posição, sem caixa), XP BRL (caixa da SCP XP + 1
posição), Avenue USD (caixa + posição), Avenue BRL (só caixa), Nomad USD,
Revolut USD. Mapeamento instituição CB→corretora CRV em uma tabela explícita
(`SCP XP Investimentos` → `XP`), nunca por similaridade de texto.

### 4.2 Nomes

`<Titular> · <Instituição> · <Conta>` nos bancos, aplicações e cartões (por
exemplo `Mariano · Mercado Pago · Conta 01`), e `<Corretora> · <Moeda>` nas
corretoras. O titular da corretora vem do CRV e do CB (hoje só Mariano).

### 4.3 Agrupamento

- **`group`** (um por conta, tipo de ativo): `Contas correntes`,
  `Aplicações`, `Corretoras`, `Cartões`.
- **Portfolios** (escopo de relatório, várias contas): `Mariano`, `Claudia`,
  `Esther`, `Família`, e `Patrimônio próprio` (sem as administradas). A tela de
  Performance e de Spending passa a poder ser filtrada por dono.
- O `group` e os Portfolios podem ser feitos **sem recompilar** (pela API ou
  pela tela); o importador já preserva `group` ao atualizar uma conta.

### 4.4 Classificação das aplicações

`group = Aplicações`, tipo `CASH`. Para a alocação ficar certa, o `meta` das
aplicações precisaria virar JSON (`{"controlePatrimonial":"…","allocation":{…}}`),
o que mexe na adoção por marcador. Fica como decisão separada.

## 5. O que exige recompilação

| Item | Recompila? | Observação |
| --- | --- | --- |
| Group e Portfolios das contas atuais | não | API ou tela, uma vez |
| Nomes das contas | **sim** | o importador regrava o nome a cada execução |
| Contas em modo transações (bancos, aplicações, cartões) | **sim** | cria atividades e troca o modo |
| Corretora única (caixa CB + posições CRV) | **sim** | o snapshot passa a juntar as duas fontes |
| Categorias do CB no Spending | **sim** | cria categorias e atribui por atividade |
| Meta em JSON e alocação das aplicações | **sim** | muda a adoção |
| Histórico de posições do CRV | **sim**, e muda o CRV | o contrato v4 só publica posições atuais; `posicao_historica` precisaria ser publicada pelo CRV (produção), pelo contrato canônico e pelos repositórios |

## 6. Decisões que dependem de você

1. Contas administradas entram no patrimônio próprio?
2. Quem é o titular das posições do CRV (`owner_id` 1)?
3. Quer a corretora única (caixa + posições) ou manter conta separada para o
   caixa e outra para as posições?
4. Aplicações como `CASH` no grupo "Aplicações", ou com classificação de renda
   fixa na alocação?
5. O Spending conta quais titulares (só Mariano, ou a família)?
6. O que fazer com o dinheiro que vai ao Mercado Bitcoin: tratar como poupança
   (saída para fora do mapa) ou criar uma conta "Mercado Bitcoin" só de caixa?
