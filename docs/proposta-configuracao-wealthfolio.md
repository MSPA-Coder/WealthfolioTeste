# Configuração do Wealthfolio para a casa (18/10/2026)

Mariano, Cláudia e Esther são uma pessoa só para orçamento, metas e alocação:
despesas e receitas dos três são usadas em conjunto e não há meta individual. Os
portfolios `Mariano`, `Claudia` e `Esther` ficam só como filtro de consulta; o
orçamento, a meta e o alvo valem para a casa inteira.

Base: dados de produção do CB e do CRV (leitura), jan a set/2026, e a instância
depois dos patches 0013 a 0016. Itens 1 a 5 e 7 já estão aplicados na instância
do VPS1. As decisões de quanto ter em cada classe ou de quanto poupar são suas
(não é recomendação de investimento).

## 1. Aplicações como renda fixa (patch 0016, aplicado)

As 7 aplicações do CB (CDB, Caixinha, Cofrinho, Rende Fácil e Tesouro Direto,
R$ 170,9 mil, dos três titulares) entravam na alocação como `Cash`. O
Wealthfolio guarda a classe do caixa de uma conta em
`meta.allocation.cashCategoryId`, e o importador passa a gravar `FIXED_INCOME`
nas contas do grupo `Aplicações`:

- `meta` passa de texto puro (`controlePatrimonial:...`) para JSON com a mesma
  chave e a classe. A adoção por marcador lê os dois formatos.
- Uma classe escolhida na tela não é sobrescrita, e as outras chaves do JSON
  ficam como estão.
- Resultado medido depois do deploy: Equity 55,8%, Fixed Income 32,2% e Cash
  12,0%, sobre R$ 532.089 de ativos (antes: Cash 44%, Fixed Income 0,1%).

## 2. Escopo do Spending e orçamento (aplicado)

O escopo do Spending tem as contas correntes e os cartões dos três: 6 do
Mariano, 3 da Cláudia e 1 da Esther. As aplicações ficam fora, porque os
lançamentos delas são movimentação (por exemplo, a conta `Tesouro Direto`, com
R$ 8,8 mil de saídas que não são gasto). `Despesas reembolsáveis` fica fora do
orçamento por decisão do usuário.

Gasto médio da casa jan a set/2026: **R$ 15.344 por mês** (Mariano cerca de
R$ 7,6 mil, Cláudia cerca de R$ 7,9 mil, Esther quase zero). Orçamento
aplicado: **R$ 15.450 por mês**, o alvo de cada categoria é a média arredondada
para cima de R$ 10. Os grupos têm os mesmos nomes dos grupos do CB.

| Grupo | Categoria | Média | Mediana | Máximo | Meses com gasto | Alvo |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Alimentação | Mercado (VA) | 1.628 | 1.600 | 1.664 | 9 | 1.630 |
| Alimentação | Supermercado | 835 | 734 | 1.508 | 9 | 840 |
| Alimentação | Alimentação | 689 | 468 | 1.635 | 9 | 690 |
| Bancos e cartões | Cartão de Crédito | 98 | 98 | 98 | 9 | 100 |
| Compras | Compras online | 161 | 99 | 519 | 8 | 170 |
| Impostos | Impostos e Tributos | 911 | 1.180 | 1.984 | 7 | 920 (rollover) |
| Imóvel Butantã | Imóvel Butantã | 55 | 247 | 280 | 2 | 60 (rollover) |
| Imóvel Jardim Iva | Jardim Iva | 1.698 | 681 | 8.781 | 9 | 1.700 (rollover) |
| Lazer | Lazer | 395 | 279 | 1.149 | 9 | 400 |
| Lazer | Loterias | 105 | 102 | 236 | 8 | 110 |
| Moradia | Casa | 2.272 | 2.396 | 2.690 | 9 | 2.280 |
| Outros | Outros | 211 | 217 | 321 | 9 | 220 |
| Pessoal | Pessoais - Roupas, beleza, etc | 821 | 800 | 1.201 | 9 | 830 |
| Pessoal | Educação | 87 | 330 | 330 | 3 | 90 (rollover) |
| Saúde | Plano de saúde | 1.761 | 1.672 | 2.518 | 9 | 1.770 |
| Saúde | Saúde | 751 | 533 | 5.467 | 5 | 760 (rollover) |
| Saúde | Farmácia | 683 | 593 | 1.071 | 9 | 690 |
| Saúde | Bem-estar | 260 | 390 | 390 | 6 | 260 (rollover) |
| Trabalho e tecnologia | Custos Diversos Associados ao Trabalho | 294 | 236 | 692 | 9 | 300 |
| Transporte | Veículos | 572 | 570 | 762 | 9 | 580 |
| Viagem | Viagem | 1.047 | 2.022 | 4.865 | 4 | 1.050 (rollover) |

A mediana é a dos meses com gasto. Categorias de gasto irregular (poucos meses
com gasto ou máximo muito acima da média) têm `rollover`: o que sobra de um mês
acumula para o seguinte, a partir de out/2026. A categoria `DBR` (R$ 73 em um
único mês) ficou sem alvo.

## 3. Regras de categorização (nenhuma)

O CB já categoriza todos os lançamentos, e o Wealthfolio recebe a categoria
junto (nenhuma despesa sem categoria em jan a out/2026). Uma regra por texto da
descrição só atrapalharia a categoria que veio do CB. Criar regra só se um dia o
Wealthfolio receber lançamentos que não passem pelo CB (por exemplo, CSV
importado direto). As transferências entre os três já estão marcadas como
transferência no CB, então não contam como gasto nem como renda.

## 4. Meta (aplicada)

**Reserva de liquidez**: R$ 92.100, 6 meses do gasto médio da casa
(R$ 15.344 × 6), do tipo fundo de emergência. É financiada pelas 7 aplicações
(100% de cada), hoje R$ 170,9 mil: a meta já nasce atingida, com cobertura de
cerca de 11 meses. Para 12 meses, o valor seria R$ 184 mil (basta editar o valor
da meta). Outras metas (compra, viagem, aposentadoria) dependem de objetivo e
prazo que o CB e o CRV não têm.

## 5. Alocação alvo (aplicada)

Alvo da casa (escopo "todas as contas", classes de ativo), igual ao peso do dia
18/10/2026, só para a tela mostrar desvios sem eu decidir quanto ter em cada
classe. Faixa de tolerância de 5 pontos percentuais e gatilho manual.

| Classe | Valor | Peso atual | Alvo |
| --- | ---: | ---: | ---: |
| Equity (ações e ETFs) | R$ 297,0 mil | 55,8% | 56% |
| Fixed Income (aplicações) | R$ 171,3 mil | 32,2% | 32% |
| Cash (contas correntes e caixa das corretoras) | R$ 63,8 mil | 12,0% | 12% |

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
