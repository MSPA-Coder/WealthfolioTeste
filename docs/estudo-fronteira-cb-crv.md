# Estudo: a fronteira entre o CB e o CRV, com corte em 01/01/2026

Estudo de 18/10/2026, só de leitura. Nada foi alterado no CB, no CRV nem no
Wealthfolio. Fontes: Postgres de produção do CB e do CRV (VPS1), e o myProfit
(programa de IR do mantenedor), lido pelo navegador interno, com um relatório
emitido de janeiro a outubro de 2026.

O Wealthfolio é consequência e não norteia nada aqui; ele aparece só no
apêndice. O objetivo é integração total com a máxima precisão, no nível
gerencial. O cálculo de imposto de renda continua no myProfit.

## 1. Princípio

**O CB é dono de todo movimento de dinheiro, em qualquer conta, inclusive nas
das corretoras. O CRV é dono dos papéis: quantidade, preço médio, resultado por
operação, opções, cotações e risco.** A origem dos dados é oficial: extratos de
bancos e corretoras para o CB, e o myProfit (que lê a B3) para os negócios do
CRV.

Todas as categorias que aparecem hoje nas 7 contas de corretora do CB:

| Fato na conta da corretora | Dono | Observação |
| --- | --- | --- |
| Transferência, aporte, retirada | CB | |
| Liquidação de pregão (`Operações em Bolsa`) | CB (dinheiro) | o CRV guarda a operação; ver seção 3 |
| Corretagem, IRRF e taxas de pregão | CB | |
| Proventos, JCP, aluguel de ações, e a corretagem e o IRRF do aluguel | CB | seção 4 |
| Ajuste de day trade de mini-contrato (`Resultado em Bolsa`) | CB | o CRV não trata futuros (R$ 52 de resultado em 2026) |
| Aplicações dentro da corretora (Tesouro, CDB) | CB | o CRV não trata renda fixa |
| Posição, preço médio, resultado por operação, opções, cotações, risco | CRV | |

Só a compra e venda tem dois registros: a operação (CRV) e a liquidação (CB).

## 2. Corte em 01/01/2026

- **CB:** já nasce em 31/12/2025, com saldo inicial por conta, e só tem
  lançamentos desde 01/01/2026. Não haverá controle para trás.
- **CRV:** vale o mesmo corte. O estado de abertura são as posições de
  31/12/2025; de 01/01/2026 em diante, as operações vêm do myProfit.
- **Proventos:** até 31/12/2025 ficam congelados no CRV (40 linhas,
  R$ 10.949,33); de 01/01/2026 em diante vêm do CB.
- **Passado no CRV (desejável, não prioritário).** O myProfit tem o histórico
  completo, porque a B3 entrega desde que a integração foi ligada. O
  importador de operações pode aceitar uma data inicial anterior. Reconstruir o
  passado exige repetir as operações em ordem e pode conflitar com posições
  lançadas à mão (o RAIZ4 de 2022, por exemplo). Fica como etapa opcional,
  depois do corte funcionar.

## 3. Compra e venda: a operação no CRV, a liquidação no CB

**O que o extrato traz.** Uma linha por nota de corretagem:
`Operações Bolsa D+2 Pr 27/01/2026 Nc. 543216`, com o valor líquido, a data do
pregão e o número da nota. Não traz ativo nem quantidade. Em março, o número da
nota vem mascarado.

**O que o myProfit traz** (relatório `Histórico de investimentos`, Excel): uma
linha por negócio, com data, instituição, número (`B3_GENIAL_27012026`, que
embute a data do pregão), moeda, total de taxas, ativo, grupo (ações, opções,
ETF, índice futuro, Tesouro, ações EUA), quantidade, lado, preço sem e com taxas,
total sem e com taxas, e se foi day trade. Sem número de nota.

**Regra.** O CRV recebe as operações do myProfit. A conferência junta a
liquidação do CB e as operações do CRV pela corretora e pela data do pregão.
Nenhum lado grava no outro; a diferença é só mostrada.

**Prova de que a regra fecha.** Os 13 pregões de 2026 da Genial, comparando a
liquidação do CB com a soma dos negócios do myProfit (com taxas):

| Pregão | CB | myProfit | Diferença | O que foi negociado |
| --- | ---: | ---: | ---: | --- |
| 27/01 | +19.606,79 | +19.607,04 | 0,25 | venda de 370 WEGE3 |
| 28/01 | +1.952,32 | +1.952,41 | 0,09 | venda de opção RAIZA20 |
| 29/01 | +198,67 | +198,76 | 0,09 | venda de opção RAIZI16 |
| 11/02 | +2.244,83 | +2.245,02 | 0,19 | venda de RAIZO700 (2 lotes) |
| 13/02 | +3.193,55 | +3.193,75 | 0,20 | venda de RAIZO600 e RAIZO700 |
| 20/03 | −30.511,31 | −30.508,99 | 2,32 | exercício de RAIZO600E e RAIZO700E |
| 26/03 | −16.114,31 | −16.116,30 | 1,99 | compra de 265 HODL11 |
| 11/05 | +548,19 | +548,28 | 0,09 | venda de SMTOA220 |
| 02/06 | −11.263,37 | −11.264,36 | 0,99 | compra de 200 HODL11 |
| 24/06 | +44,51 | +42,71 | 1,80 | venda de 230 WEGE3, compra de 202 HODL11 |
| 12/08 | −1.175,30 | −1.174,55 | 0,75 | venda de 432 HODL11, compra de 100.000 RAIZ4 |
| 13/08 | +2.395,72 | +2.395,81 | 0,09 | venda de BBDCH11 |
| 28/08 | −2.574,46 | −2.578,05 | 3,59 | venda de 235 HODL11, compra de 84.000 RAIZ4 |

**13 de 13 pregões fecham em até R$ 3,59**, em liquidações de R$ 44 a R$ 30 mil. A
diferença é pequena e não sei dizer de quê (arredondamento de preço, taxas de
liquidação ou IRRF de pregão lançado à parte).

**Isso explica tudo o que a primeira conciliação (mês a mês) chamou de furo:**

- *R$ 27 mil de vendas em janeiro e fevereiro sem operação no CRV:* são WEGE3 e
  opções de RAIZ. **O CRV não tem nenhuma operação de WEGE3** (600 ações,
  vendidas em 27/01 e 24/06, com dividendo de R$ 247,69 em 12/08) e **nenhuma
  das opções de RAIZ vendidas ou exercidas**, só a RAIZH150.
- *Março, R$ 16 mil a mais no CRV:* o CRV lançou as 667 cotas de HODL11 de uma
  vez, em 23/03. Na B3 foram 265 em 26/03, 200 em 02/06 e 202 em 24/06.
- *Compra de junho sem par no CRV:* são os 200 HODL11 de 02/06, que o CRV
  consolidou em março.
- *Compra de março em RAIZ4 a R$ 0,5572:* é o exercício das puts. O CRV guarda o
  custo líquido do prêmio já recebido (R$ 25.074); o caixa pagou o preço de
  exercício (R$ 30.511). A diferença de R$ 5.437 é o prêmio das quatro vendas
  de fevereiro. Os dois lados estão certos; medem coisas diferentes.

**Posições abertas hoje, CRV contra myProfit:** AURE3, AZZA3, BBAS3, RAIZ4,
SMTO3, EALT4, RECVB119 e RAIZH150 batem na quantidade. Divergem as contas no
exterior: CGC (CRV 13.522, myProfit 12.042), SGOV (25,05 contra 19,15) e BRK.B
(0,48 na Revolut no CRV; no myProfit foi vendida na Avenue em 01/10).

**Custos.** O CRV não guarda custos de operação (o resultado é em preço
cheio). O custo real aparece como a diferença da conferência. As taxas do
myProfit são só as da B3 (cerca de 0,04%); a comissão da corretora só entra lá
se for lançada à mão, e o mantenedor confirmou que não é.

## 4. Proventos: o primeiro caso aplicado

**Hoje.** O CRV recebe proventos por planilha, cujas colunas são exatamente as
do Painel de proventos do myProfit (Ativo, Corretora, Recebido, Data pgto., Data
COM, YOC, DY, Cotas, Preço médio, Cotação, Valor por cota). O CB tem 73
créditos desde 08/01/2026 na categoria `Aluguel de Açoes / Dividendos / JCP`,
nas contas da Genial e da SCP XP.

**Conciliação de 2026 (CB contra CRV, linha a linha).** Dividendo e JCP batem
ao centavo e na mesma data. O aluguel diverge de três formas:

1. O CRV (e o myProfit) mostram **57,5% do crédito bruto**; o caixa recebe
   **47,5%**. O CB lança o bruto e, no mesmo dia, a corretagem (30%) e o IRRF
   (22,5%). Exemplo, RAIZ4 em 29/01: bruto 352,56; corretagem 105,76; IRRF
   79,32. O CRV tem 202,73.
2. A data do CRV é 0 a 3 dias antes da do CB; nenhum par cruza a virada de mês.
3. Um crédito do CB pode virar 2 ou 3 linhas no CRV.

Depois dessas regras, de 73 créditos, 65 têm par. Os 8 sem par (R$ 372,35): WEGE3
(5, incluindo o dividendo de R$ 247,69), AURE3 (R$ 0,01) e dois RAIZ4 de
setembro (atraso do CRV). O myProfit também mostra "Aluguel" na Avenue
(R$ 32,61 em 17/09, R$ 15,36 em 19/08, R$ 5,66 em 16/07), que não está no CRV
nem no CB.

| Visão de 2026 | Valor |
| --- | ---: |
| CB, crédito bruto | 8.896,38 |
| IRRF sobre aluguel | −885,16 |
| Corretagem do aluguel (líquida de estornos) | −1.195,77 |
| Taxas pequenas | −0,20 |
| **Caixa líquido que entrou** | **6.815,25** |
| CRV | 6.904,68 |

**O que muda no desenho.** O ativo e o tipo de renda só existem como texto na
descrição (`Brraizacnpr6`). Hoje o patch 0012 do Wealthfolio já converte o
código; o CRV seria o segundo. Recomendo que o **importador de extratos do CB
grave o ativo e o tipo de renda no lançamento** e os publique no contrato v4,
estendendo as famílias de `bank_statements/familias.py`. Assim CRV e
Wealthfolio só leem o campo.

**Saldo de corte dos proventos (até 31/12/2025):**

| Ativo | Corretora | Linhas | Total |
| --- | --- | ---: | ---: |
| AURE3 | XP | 3 | 3.609,00 |
| EALT4 | XP | 6 | 3.362,40 |
| RAIZ4 | XP | 14 | 1.477,17 |
| AZZA3 | Genial | 6 | 1.251,65 |
| SMTO3 | Genial | 4 | 617,84 |
| RAIZ4 | Genial | 2 | 426,33 |
| BBAS3 | Genial | 4 | 130,80 |
| AURE3 | Genial | 1 | 74,14 |
| **Total** | | **40** | **10.949,33** |

As 40 linhas ficam como estão (origem `planilha`), e o saldo de corte aparece
como subtotal "até 31/12/2025". Reduzi-las a um saldo agregado perderia o ano a
ano e o mês a mês, sem ganho. Conferência de fronteira: nenhuma linha do CRV em
31/12/2025, e o primeiro aluguel do CB (08/01) liga com o CRV de 07/01.

## 5. Fluxo de dados proposto

| Fato | Origem | Destino | Como |
| --- | --- | --- | --- |
| Dinheiro de toda conta | extrato do banco ou da corretora | CB | importação de extrato, como já é |
| Negócios (ativo, quantidade, preço, data) | B3, via myProfit | CRV | importador novo do relatório `Histórico de investimentos` |
| Proventos recebidos | extrato | CB, e o CRV lê do CB | CB grava ativo e tipo; CRV importa pelo contrato v4 |
| Conferência por pregão | CB e CRV | tela de conferência | só leitura |
| IR e apuração | B3, via myProfit | myProfit | fora do escopo |

**Acesso ao myProfit.** O relatório sai de um GET autenticado
(`/API/Report?report=0&format=xls&from=...&to=...`), com a sessão do usuário. Eu
consegui emitir pelo navegador logado, sem credencial minha. Duas formas de
manter isso: eu emito todo mês, com você logado; ou você baixa o arquivo e o
CRV o importa. Automatizar o login por programa exigiria guardar a senha do
myProfit fora do que já temos. Não recomendo, e fica como decisão sua. O
arquivo traz o CPF no cabeçalho; o importador ignora essas linhas.

## 6. Cuidados

- **Chave de duplicidade das operações.** O relatório não traz identificador
  por negócio, e há linhas iguais no mesmo documento (por exemplo, quatro
  vendas de HODL11 em 28/08 com quantidades diferentes). A chave tem de ser
  documento, ativo, quantidade, preço e ordem no documento. O importador deve
  ser reexecutável sem duplicar.
- **Opções exercidas.** O exercício do pregão de 20/03 aparece no relatório
  como compra das opções (`RAIZO600E`), não como compra do papel. O CRV hoje
  guarda o custo líquido do prêmio. O importador precisa de uma regra para o
  exercício; decisão de produto.
- **Contas no exterior.** O CRV e o myProfit divergem em CGC, SGOV e BRK.B. O
  importador resolve o que está certo, ou o myProfit passa a mandar.
- **Futuros (WIN).** O myProfit tem os mini-contratos; o CRV não trata futuros.
  Ficam só no CB (ajuste e corretagem) e no myProfit.
- **Tesouro Direto.** O myProfit tem quantidade e preço unitário, o CB só o
  saldo. Fica como aplicação no CB.
- **Quebra de série do aluguel.** Até 2025 vale a regra do myProfit (57,5%); de
  2026 em diante, o caixa. A série cai cerca de 17% por crédito, só pela regra.
- **Categoria por nome.** A categoria do CB tem erro de grafia (`Açoes`). O
  CRV deve configurá-la por identificador.
- **Linha vinda do CB é somente leitura no CRV.**

## 7. Decisões do mantenedor (18/10/2026)

1. **Valor do aluguel:** líquido do caixa (47,5% do bruto). O CRV guarda também
   o bruto e as retenções (corretagem e IRRF) ao lado.
2. **Proventos em dólar e na Avenue:** ficam no CRV até haver um extrato da
   Nomad e outro da Avenue com o evento; então migram para o CB.
3. **Como o relatório do myProfit chega:** Claude emite todo mês, com o
   mantenedor logado no navegador interno. Nenhuma senha é guardada.
4. **Exercício de opções:** custo líquido do prêmio, como o CRV faz hoje. A
   conferência mostra a diferença para o caixa como prêmio recebido.
5. **Passado (2019 a 2025):** fica para depois. O importador já nasce com data
   inicial configurável.
6. **Escopo:** tudo de uma vez (conferência, importador de operações e
   proventos do CB), conduzido por plano aprovado por repositório, PR por
   repositório e deploy só com autorização a cada vez.

## 8. O que este estudo não cobre

- A diferença de R$ 0,09 a R$ 3,59 entre liquidação e negócios não foi
  decomposta.
- Só olhei a Genial em profundidade; XP, Avenue, Nomad e Revolut só em
  posições e proventos.
- O formato do relatório foi lido de um único arquivo, de 2026.
- Um importador novo exige teste com o relatório de períodos anteriores a 2026.

## Apêndice: consequências para o Wealthfolio

O Wealthfolio lê hoje só o CB para renda (patch 0012, valor bruto: R$ 8.896,38
contra R$ 6.815,25 de caixa) e não importa os proventos do CRV. Com este
desenho, o Income deve usar o líquido do aluguel e ler do CB a partir de 2026 e
do CRV até 2025. O Wealthfolio não é pré-requisito de nada acima.
