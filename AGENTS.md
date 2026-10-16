# WealthfolioTeste — guia de trabalho

## Escopo e fontes de verdade

Este repositório constrói o Wealthfolio a partir de commit upstream fixado e de
`patches/`, além do add-on `controle-patrimonial-sync`. Leia `README.md`,
`.github/workflows/ci.yml` e `.github/workflows/imagem.yml` antes de mexer em
build, patches ou pacote. O contrato e a operação estão em
`docs/patrimonio-v4.md` e `docs/plano-execucao-cb-crv-wealthfolio.md`.

Use somente Docker e Compose. Chave mestra, hash de senha e `.env` ficam fora
do Git. Preserve banco cifrado, volume nomeado, porta em loopback, chave
somente leitura e rede interna do VPS.

## Limites que não podem mudar por acidente

- `WEALTHFOLIO_COMMIT` e patches devem gerar imagem reproduzível; não use um
  checkout upstream modificado como substituto de patch versionado.
- CB e CRV são as fontes operacionais. A sincronização é somente de leitura,
  idempotente e não cria fatos operacionais no Wealthfolio.
- Não abra APIs privadas, enfraqueça criptografia nem apague volume, chave ou
  backup para resolver uma falha.

## Validação proporcional

| Mudança | Validação mínima antes de concluir |
| --- | --- |
| Documentação | Conferir comandos, links e coerência com o contrato v4. |
| Add-on, contrato ou pacote ZIP | Executar os passos de simulação e verificação de pacote em `.github/workflows/ci.yml`. |
| Patch ou `WEALTHFOLIO_COMMIT` | Confirmar aplicação limpa dos patches e executar `Imagem`, ou seus equivalentes locais de testes, build e healthcheck. |
| Compose, Dockerfile, rede ou segredo | `docker compose config --quiet` com valores de teste; validar também `compose.patrimonio-internal.yaml` quando afetado. |
| Sincronização, agendamento ou dados persistidos | Além do acima, provar reexecução idempotente, recuperação após reinício e ausência de duplicação com dados de teste. |
| VPS, backup, proxy ou volume | Ler o plano e os scripts canônicos em `manutencao`; validar backup e healthcheck pós-deploy. Não operar VPS sem autorização explícita. |

Não deixe dois processos alterar o mesmo checkout, volume ou Compose ao mesmo
tempo. Entre CB, CRV e Wealthfolio, mantenha a ordem: contrato da fonte,
consumidor e infraestrutura.

