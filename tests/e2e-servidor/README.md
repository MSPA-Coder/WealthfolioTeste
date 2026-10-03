# Teste ponta a ponta do importador do servidor

Sobe o `wealthfolio-server` de verdade, com um banco novo, e dois sistemas
falsos no lugar do CB e do CRV (`fontes.py`). Confere o que os testes
unitários do patch 0005 não alcançam: o servidor falando com as fontes pela
rede, o agendador rodando sem nenhuma requisição, e o banco ficando como
esperado.

Não toca em nenhum dado seu: tudo vive em `run/` (ignorado pelo Git), com tokens
e chave de cifra falsos.

## O que o `driver.py` confere (29 verificações)

1. Sem token configurado, a fonte não é falha.
2. Com tokens no cofre do add-on e contas já existentes (como no VPS), o
   servidor adota as contas em vez de duplicá-las e deixa as arquivadas intactas.
3. Sincronização manual.
4. Repetir a importação não duplica conta nem snapshot.
5. O estado fica copiado no storage do add-on, para a tela ler.
6. O agendador (a cada 60 s) importa sem nenhuma requisição depois da partida.
7. Conta que some da fonte recebe foto zerada, sem ser apagada.

`cenario6.py` roda só o cenário do agendador por 140 s, com intervalo de 60 s e
uma mudança publicada no meio.

## Como rodar

Precisa de um binário do servidor compilado a partir do upstream com **todos**
os patches de `patches/` aplicados (ver a seção "Build e patches" do README
principal), e de dois apelidos locais para as fontes falsas:

```bash
echo "127.0.0.1 cb-api crv-api" | sudo tee -a /etc/hosts

# binário: compile o upstream com os patches e use o resultado
#   cargo build -p wealthfolio-server        (debug basta)
python3 tests/e2e-servidor/driver.py /caminho/para/wealthfolio-server
```

O `driver.py` sobe e derruba as fontes falsas sozinho (portas 8000 e 5003) e o
servidor (porta 18090). Termina com `RESUMO` e código de saída diferente de zero
se alguma verificação falhar.

Se `HTTP_PROXY`/`HTTPS_PROXY` estiverem definidos na sua máquina, o driver os
remove do ambiente do servidor, para o broker de rede não sair pelo proxy.

## Estado

Última execução completa: **29/29**, contra a versão do patch anterior à
reconciliação com o `0004` (mapeamento de MIC). O patch atual passa nos testes
unitários e na CI, mas este ponta a ponta ainda não foi repetido com ele.
Rode-o ao mexer em `patrimonio_sync.rs`, `scheduler.rs` ou `profiles.rs`.

Não roda na CI: exige compilar o servidor, o que a CI já faz na imagem, e
as fontes falsas ocupam portas fixas.
