# Proposta de configuração do Wealthfolio (18/10/2026)

Base: dados de produção do CB e do CRV (leitura), jan a set/2026, e o estado da
instância depois dos patches 0013 a 0015. Nada aqui foi aplicado, exceto o item 1
(patch 0016). Os números são fatos do seu histórico; as decisões de quanto ter
em cada classe ou de quanto poupar são suas (não é recomendação de investimento).

## 1. Aplicações como renda fixa (feito no patch 0016)

As 7 aplicações do CB (CDB, Caixinha, Cofrinho, Rende Fácil e Tesouro Direto,
R$ 170,9 mil) hoje entram na alocação como `Cash`. O Wealthfolio guarda a classe
do caixa de uma conta em `meta.allocation.cashCategoryId`. Testado na instância
com uma conta temporária (já excluída): com `FIXED_INCOME`, a conta aparece 100%
como Fixed Income.

O 0016 faz o importador gravar essa classe nas contas do grupo `Aplicações`:

- `meta` passa de texto puro (`controlePatrimonial:...`) para JSON com a mesma
  chave e a classe: `{"controlePatrimonial":"...","allocation":{"cashCategoryId":"FIXED_INCOME"}}`.
  A adoção por marcador lê os dois formatos.
- Uma classe escolhida na tela não é sobrescrita, e as outras chaves do JSON
  ficam como estão.
- Efeito esperado: `Cash` cai de 44% para uns 12% (conta corrente e caixa de
  corretora), e `Fixed Income` sobe de 0,1% para uns 32%. O patrimônio não muda.

## 2. Orçamento (budget)

O CB de produção não tem orçamento. A proposta sai do gasto real do Mariano
(contas correntes e cartões, só despesa gerencial, jan a set/2026), um alvo por
categoria no mesmo grupo que o CB já usa. Alvo = média mensal arredondada para
cima de R$ 10. Total R$ 7.760 por mês (média real: R$ 7.663).

| Grupo | Categoria | Média | Mediana | Máximo | Meses com gasto | Alvo |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Alimentação | Supermercado | 830 | 734 | 1.464 | 9 | 830 |
| Alimentação | Alimentação | 683 | 468 | 1.635 | 9 | 690 |
| Bancos e cartões | Cartão de Crédito | 98 | 98 | 98 | 9 | 100 |
| Compras | Compras online | 161 | 80 | 519 | 8 | 170 |
| DBR | Despesas reembolsáveis | 209 | 170 | 532 | 6 | 210 |
| Impostos | Impostos e Tributos | 390 | 0 | 1.984 | 3 | 390 (rollover) |
| Imóvel Butantã | Imóvel Butantã | 31 | 0 | 280 | 1 | 40 (rollover) |
| Lazer | Lazer | 332 | 279 | 974 | 9 | 340 |
| Lazer | Loterias | 105 | 84 | 236 | 8 | 110 |
| Moradia | Casa | 1.046 | 1.177 | 1.290 | 9 | 1.050 |
| Outros | Outros | 191 | 194 | 321 | 9 | 200 |
| Pessoal | Pessoais - Roupas, beleza, etc | 807 | 771 | 1.151 | 9 | 810 |
| Pessoal | Educação | 13 | 0 | 119 | 1 | 20 (rollover) |
| Saúde | Farmácia | 683 | 593 | 1.071 | 9 | 690 |
| Saúde | Saúde | 288 | 40 | 1.297 | 5 | 290 |
| Saúde | Plano de saúde | 99 | 0 | 891 | 1 | 100 (rollover) |
| Trabalho e tecnologia | Custos Diversos Associados ao Trabalho | 294 | 236 | 692 | 9 | 300 |
| Transporte | Veículos | 561 | 559 | 762 | 9 | 570 |
| Viagem | Viagem | 842 | 0 | 4.865 | 2 | 850 (rollover) |

Por grupo: Alimentação 1.520, Bancos e cartões 100, Compras 170, DBR 210,
Impostos 390, Imóvel Butantã 40, Lazer 450, Moradia 1.050, Outros 200, Pessoal
830, Saúde 1.080, Trabalho e tecnologia 300, Transporte 570, Viagem 850.

Categorias de gasto irregular (mediana 0 ou poucos meses com gasto) ficam com
`rollover`: o que sobra de um mês acumula para o seguinte. `Despesas
reembolsáveis` (DBR) volta como reembolso; vale decidir se entra no orçamento.

## 3. Regras de categorização

Não propor nenhuma. O CB já categoriza todos os lançamentos, e o Wealthfolio
recebe a categoria junto (nenhuma despesa sem categoria em jan a out/2026). Uma
regra por texto da descrição só atrapalharia a categoria que veio do CB. Criar
regra só se um dia o Wealthfolio receber lançamentos que não passem pelo CB
(por exemplo, CSV importado direto).

## 4. Metas (Goals)

Uma meta tem valor-alvo, data e contas que a financiam (com percentual por
conta). Proposta de uma meta, com a conta dos fatos:

- **Reserva de liquidez**, financiada pelas aplicações do Mariano
  (R$ 151,2 mil hoje: C6 CDB, Cofrinho, Rende Fácil e Tesouro Direto).
- Gasto médio mensal real: R$ 7.663. Valor-alvo por número de meses:
  3 meses R$ 22.988, 6 meses R$ 45.977, 12 meses R$ 91.953.
- Hoje as aplicações do Mariano cobrem 19,7 meses do gasto médio, então qualquer
  uma das três já nasce atingida. O número de meses que vale como meta é seu.

Outras metas (compra, viagem, aposentadoria) dependem de objetivo e prazo que o
CB e o CRV não têm.

## 5. Alocação alvo

Depois do 0016, as classes atuais são aproximadamente:

| Classe | Valor | Peso |
| --- | ---: | ---: |
| Equity (ações e ETFs) | R$ 297,0 mil | 55,8% |
| Fixed Income (aplicações) | R$ 171,3 mil | 32,2% |
| Cash (contas correntes e caixa das corretoras) | R$ 63,8 mil | 12,0% |

Proposta neutra: gravar o alvo igual ao peso atual (56 / 32 / 12). A tela passa
a mostrar o desvio a cada mudança, sem eu decidir quanto você deve ter em cada
classe. Os percentuais que você quiser trocar são edição de um campo.

## 6. Benchmark

Só tem sentido depois que a Performance (TWR e MWR) existir: o gráfico compara a
curva de retorno da conta com a do índice, e hoje as contas aparecem como
"indisponível para escopo misto". Quando chegar a hora:

- Ações da B3: `^BVSP` (Ibovespa), do Yahoo, sem custo extra.
- Ações e ETFs em dólar: `^GSPC`.
- Renda fixa: o CDI não existe no Yahoo. Dá para criar um ativo manual `CDI` e
  carregar a série diária do Banco Central por CSV.

## 7. Fase 4: opções da B3

**O que é.** Trazer para o Wealthfolio as posições de opções (calls e puts) que o
CRV controla, hoje fora da carteira.

**O que existe hoje na produção do CRV:**

| Item | Valor |
| --- | --- |
| Posições abertas | 2 calls compradas: `RECVB119` (RECV3, strike 10,68, vence 19/02/2027, 1.000, valor R$ 2.490) e `RAIZH150` (RAIZ4, strike 1,50, vence 20/08/2027, 20.000, valor R$ 1.000) |
| Valor total | R$ 3.490 (1,4% das ações) |
| Operações fechadas | 4 opções, resultado realizado de R$ 3.955,50 (BBDC4, VAMO3, SMTO3 e AURE3) |
| Posição vendida (lançada) | nenhuma |

**O que falta.**

- O contrato v4 do CRV declara "só ações" e o importador recusa qualquer outro
  instrumento. Publicar opções exige mudar o CRV (produção), o contrato canônico
  e as cópias nos 3 repositórios, e depois o importador.
- No Wealthfolio, cada opção da B3 seria um ativo próprio (símbolo, ativo-objeto,
  strike, vencimento), com preço manual vindo da cotação do CRV, porque nenhum
  provedor de preços cobre opções da B3. O multiplicador não é problema: o CRV
  guarda a quantidade em ações, e o Wealthfolio usa multiplicador 1.
- O resultado realizado de R$ 3.955,50 só entraria como atividade, o que
  depende de decidir como tratar o passado.

**Recomendação.** Deixar para depois: R$ 3,5 mil é 0,7% do patrimônio, e o custo é
alterar o CRV em produção. Se quiser o valor das duas calls no patrimônio agora,
o caminho barato é o mesmo do histórico de posições: gravar as duas por script,
sabendo que o preço delas deixa de acompanhar o CRV.
