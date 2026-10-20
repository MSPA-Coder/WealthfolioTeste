# Matriz operacional enxuta

Esta matriz separa as validações por superfície de mudança. Ela não cria um
novo processo de deploy: o deploy continua exclusivamente no repositório
`manutencao` (`~/deploy.sh wealthfolio`), só quando o usuário mandar.

A checagem local é a que vale: rode-a completa na máquina antes do commit, que
vai direto ao `main`, sem PR. Os workflows do GitHub rodam depois de cada push
só como aviso e não bloqueiam nada; se falharem, investigue.

| Mudança | Checagem local oficial | Gate no GitHub | Compose / sinal de saúde |
| --- | --- | --- | --- |
| Add-on (`addons/controle-patrimonial-sync`) | `docker compose --profile build -f addons/controle-patrimonial-sync/compose.yaml run --rm addon-build`, seguido de `docker compose -f addons/controle-patrimonial-sync/compose.yaml run --rm addon-sim` | **CI** recria e executa a simulação; também abre e executa o ZIP | `addons/controle-patrimonial-sync/compose.yaml`; sem rede durante a simulação |
| Patches ou `Dockerfile` | `docker build --target testes .` e `docker build -t wealthfolio-teste:local .` | **CI** confere aplicação; **Imagem** roda os testes upstream, build, smoke e Trivy | `compose.yaml`; `GET /api/v1/healthz` deve responder exatamente `ok` |
| Configuração do serviço | `docker compose config --quiet` e `docker compose -f compose.yaml -f compose.patrimonio-internal.yaml config --quiet` | **CI** executa ambos com valores inofensivos de interpolação | Compose base e override VPS; o health check interno usa a mesma rota `healthz` |
| Documentação ou `.env.example` | conferir os comandos e variáveis citados contra `compose.yaml` | **CI** ainda protege patches, add-on e Compose; **Imagem** não é necessária se nada que entre nela mudou | não há alteração de runtime |

## Limites de segurança e concorrência

- **CI** e **Imagem** cancelam execuções obsoletas da mesma referência porque
  são apenas validações e não alteram infraestrutura.
- A atualização de upstream mantém uma execução por vez e abre ou atualiza um
  único PR, que não é integrado automaticamente: revise os checks e faça o
  squash merge conscientemente. Dependabot mantém no máximo uma PR por
  ecossistema, com os checks obrigatórios e auto-merge. Não use cancelamento
  nessas automações, pois elas escrevem branches e pull requests.
- Não execute `git pull`, build ou `docker compose up` manualmente no checkout
  do VPS. O `~/deploy.sh wealthfolio` faz o backup, fast-forward, build,
  health check e rollback de imagem/código de forma centralizada.
- Alteração local comum não exige criar backup: a recuperação normal é o
  backup diário de produção. Para migração, transformação persistente ou
  mudança de criptografia/backup, defina antes o procedimento de dados, pois
  rollback de imagem e código não desfaz migrações no SQLite.

Para comandos de primeiro uso, geração de patches e implantação, consulte o
[`README`](../README.md). O teste ponta a ponta do importador é seletivo:
execute-o quando `patrimonio_sync.rs`, `scheduler.rs` ou `profiles.rs` mudarem,
conforme [`tests/e2e-servidor/README.md`](../tests/e2e-servidor/README.md).
