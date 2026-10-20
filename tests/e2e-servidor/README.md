# Teste ponta a ponta do servidor

Constrói o servidor a partir do commit fixado e de todos os patches e executa
a integração real com fontes CB/CRV sintéticas. Docker fornece também o Python
do driver; não é preciso instalar ferramentas nem alterar o arquivo hosts do
Windows.

```powershell
docker build -t wealthfolio-teste:e2e-runtime .
docker compose -f compose.e2e.yaml run --build --rm servidor-testes
```

Para reutilizar uma candidata já construída, defina `WF_E2E_RUNTIME_IMAGE`
com sua tag ou digest antes do segundo comando. A imagem deve corresponder ao
commit e aos patches que se quer validar.

O Compose tem rede desativada e apenas aliases de loopback. As fontes falsas
escutam dentro do próprio contêiner; nenhuma conexão chega aos bancos ou APIs
do operador. Banco cifrado, chave sintética e estado do servidor vivem num
diretório temporário, removido ao concluir. A autenticação do servidor fica
desligada somente nesse processo de ensaio; as fontes exigem seus Bearers de
teste.

O driver confere a adoção de contas legadas, preservação das arquivadas e das
contas não gerenciadas, separação de moedas, cartão como passivo, ausência de
saldo sem inventar zero, posição CRV persistida, ledger de caixa CB,
idempotência, atualização de valor sem duplicação, falha parcial entre fontes,
recusa de cobertura incompleta e recuperação. Depois reinicia o servidor e
confere que o agendador importa uma mudança sem navegador e consulta somente
o feed quando não há novidade. As fontes recebem somente GET.

O resultado é um resumo JSON e código de saída diferente de zero quando uma
regra falha. O intervalo mínimo real do agendador torna a rodada mais longa
que os testes unitários. `fontes.py` e `cenario6.py` são protótipos históricos
do importador de snapshots e não compõem este runner atual de ledger.
