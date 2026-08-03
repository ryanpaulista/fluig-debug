# Chrome Web Store — listagem (rascunho)

Visibilidade pretendida: **Não listada** (acessível só por link; passa por revisão do
Google normalmente). Textos abaixo prontos para colar no Developer Dashboard.

---

## Nome
Fluig Debug

## Descrição curta (máx. 132 caracteres)
> Aba no DevTools para depurar formulários TOTVS Fluig: ler e alterar campos pelo nome, gravar no banco e exportar o estado.

(122 caracteres — dentro do limite.)

**Este texto tem de ser igual ao `description` do `manifest.json`.** Esse campo é
o "Resumo do pacote" da loja e **não é editável no Dashboard** — só sai por
upload de versão nova. Foi o que fez o acento de "formulários" ficar faltando da
v1.0.0 até a v2.0.0.

## Categoria
Ferramentas para desenvolvedores (Developer Tools)

## Idioma
Português (Brasil)

## Descrição detalhada

**Atenção ao formato:** o campo "Descrição" do Dashboard é **texto puro** — ele
não renderiza markdown. Nada de `**negrito**`, `` `código` `` ou `#` de título,
senão os caracteres aparecem literais na loja. Só quebras de linha, MAIÚSCULAS
para os títulos de seção e `-` para as listas. O texto abaixo já está nesse
formato: copiar e colar como está, do `Fluig Debug adiciona…` até a última linha.

```text
Fluig Debug adiciona uma aba "Fluig Debug" ao DevTools do Chrome (F12), que aparece automaticamente quando a página aberta é da plataforma TOTVS Fluig. Ela substitui o trabalho manual de caçar campos no DOM e colar comandos jQuery no console durante a depuração de formulários e solicitações de workflow.

POR QUE ELA EXISTE

No Fluig, o id/name de um campo não é fixo — muda conforme o estado do formulário:

- Campo desabilitado por evento server-side ganha prefixo "_": o campo "codigo" aparece no HTML como "_codigo".
- Campo de tabela pai-filho ganha sufixo "___N": "descricao___1", "descricao___2", uma ocorrência por linha.
- Em modo de visualização e em solicitação finalizada, o Fluig troca o input por um <span>, que mantém o name/id mas guarda o valor no texto.
- O formulário é renderizado dentro de um iframe, então um $("#campo") no console só funciona depois de trocar o contexto do console à mão.

O resultado prático é que boa parte do tempo de depuração vai em descobrir o seletor certo antes de conseguir olhar o valor. A extensão resolve isso: você digita o nome "limpo" do campo e ela varre a página e os iframes de mesma origem, encontra a ocorrência real e usa o jQuery do frame onde o campo de fato está.

FUNCIONALIDADES

Todos os campos numa tabela editável
O painel abre já com a lista completa dos campos da página, um por linha, com nome, tipo e valor. Ler é olhar; alterar é dar um duplo clique no valor e digitar o novo. O filtro busca por nome ou por valor — dá para partir de um valor que você vê na tela e descobrir de que campo ele veio.

Tabelas pai-filho como planilha
Cada tabela pai-filho aparece em um bloco próprio, no formato de planilha: as colunas são os campos e as linhas são as linhas da tabela. Comparar o mesmo campo entre linhas é olhar para baixo, em vez de caçar sufixos numa lista. O número da linha fica fixo ao rolar de lado, cada célula é editável e há um atalho para copiar a linha inteira. Um campo que existe em outras linhas mas falta naquela aparece marcado como ausente, em vez de vazio.

O estado de cada campo é visível na própria linha
Uma faixa colorida na borda esquerda diz o que é aquele campo sem você ler nada: campo desabilitado, campo somente leitura, campo oculto, linha de tabela pai-filho. O prefixo "_" e o sufixo "___N" aparecem esmaecidos dentro do nome, porque é justamente ali que mora a confusão.

Ler um campo pelo nome
Uma linha de comando na base do painel lê o valor atual direto da página, destaca a linha correspondente na tabela e mostra o resultado. O autocomplete sugere os campos existentes conforme você digita — não é preciso saber o nome exato de cabeça — com o valor atual de cada um. Navegação por setas, Enter lê, Tab completa, Esc fecha. Digitar "___" troca para a escolha da linha da tabela pai-filho.

Alterar o valor no formulário
O editor que abre na célula mostra o valor atual riscado ao lado do novo, então você vê exatamente o que está sendo trocado antes de aplicar. A alteração mira a ocorrência exata daquela linha, sem ambiguidade.

Gravar direto no banco
Grava o valor via o dataset dsSetCardValue e o documentId da solicitação. Serve para os casos em que alterar o formulário não resolve — o principal é a solicitação finalizada. Por não ter como desfazer, essa ação tem uma confirmação própria, que mostra a solicitação, o documentId, o valor atual e o novo.

Solicitação e documentId
Ao abrir o painel sobre uma solicitação de workflow, resolve sozinho o número da solicitação (pelo parâmetro da URL) e o documentId, consultando o dataset workflowProcess do próprio Fluig. O número e o documentId ficam visíveis no alto do painel, e uma aba própria mostra o detalhe da resolução. O valor vem do dataset, não de heurística sobre o HTML.

Exportar o estado
Exporta em JSON todos os campos e valores, as tabelas pai-filho agrupadas por linha e as mensagens de console capturadas, com hora. Pronto para copiar e colar como contexto em uma análise, ou salvar em arquivo.

Mensagens de console em aba própria
Os console.log, avisos e erros capturados desde a abertura do DevTools ficam listados com hora e nível, com filtro por texto e por nível.

Histórico das ações
Uma lista do que passou pelo painel na sessão, marcando o tipo de cada ação (leitura, alteração no formulário, gravação no banco), com o valor anterior e o novo. Restaurar leva o valor anterior de volta ao mesmo caminho de alteração, sem pular a confirmação. O histórico existe apenas enquanto o DevTools está aberto.

PRIVACIDADE E ESCOPO

- A extensão não declara nenhuma permissão no manifest além de devtools_page. Não há host_permissions e não há acesso a <all_urls>.
- Toda a interação com a página usa a API padrão de DevTools (chrome.devtools.inspectedWindow.eval), que só age sobre a aba que você já está inspecionando com o F12 aberto.
- Nenhum dado é enviado para servidores externos. Tudo acontece dentro do navegador, para exibir no painel do próprio desenvolvedor.
- Todo o código executado está empacotado na extensão. Nada é buscado remotamente.
- Nem o dump nem o histórico são persistidos: o histórico vive só enquanto o DevTools está aberto e o dump fica apenas na tela.
- Em página que não seja Fluig, a aba nem aparece: a extensão só se ativa ao detectar os objetos globais da plataforma (WCMAPI ou FLUIGC).

LIMITAÇÕES CONHECIDAS

- Ao alterar um valor no formulário, a extensão aplica o valor sem disparar os eventos change e blur, igual ao que se faz no console. Lógicas dependentes (cálculos, validações, zoom) podem não reexecutar.
- Em modo de visualização e em solicitação finalizada, o campo é um <span>: alterá-lo troca só o texto exibido, sem persistir nada. Nesses casos o caminho é a gravação no banco.
- A captura de mensagens de console só pega o que acontece a partir da abertura do DevTools.
- Na gravação no banco, o valor anterior exibido é lido do formulário, porque o dataset de gravação não tem leitura correspondente. A interface rotula esse valor como tal.
- A lista mostra até 300 linhas por vez em formulários muito grandes, e avisa quantas ficaram de fora — use o filtro.
- Campos dentro de iframes de outra origem não são acessíveis.

Ferramenta interna de apoio ao desenvolvimento, publicada como não listada para uso da equipe.
```

---

## Justificativas (aba Privacidade)

### Finalidade única (single purpose)
> Fornecer, dentro do DevTools do Chrome, um painel para inspecionar e depurar
> formulários da plataforma TOTVS Fluig na aba atualmente aberta.

### Justificativa de permissões
> A extensão **não declara nenhuma permissão** no manifest além de `devtools_page`.
> Toda a interação com a página usa as APIs padrão de DevTools
> (`chrome.devtools.inspectedWindow.eval`), que só operam sobre a aba que o
> desenvolvedor já está inspecionando com o F12 aberto. Não há `host_permissions`
> nem acesso a `<all_urls>`.

### Código remoto
> Não. Todo o código executado na página está empacotado na própria extensão
> (strings de expressão em `devtools.js` / `panel.js`). Nada é buscado
> remotamente.

### Uso de dados (declarações de coleta)
> A extensão **não coleta nem transmite** dados do usuário. Ela lê valores de
> campos e executa consultas a datasets **apenas dentro do navegador**, para
> exibir no painel do DevTools do próprio desenvolvedor. Nada sai da máquina.
>
> Marcar todas as categorias de dados como **não coletadas** e certificar:
> - Não vendo nem transfiro dados do usuário a terceiros (exceto casos permitidos).
> - Não uso os dados para fins não relacionados à finalidade única.
> - Não uso os dados para avaliar situação de crédito / empréstimos.

### Política de privacidade
> Não é obrigatória, pois a extensão não coleta dados do usuário. (Se o formulário
> do Dashboard exigir uma URL, publicar uma nota simples reafirmando o acima.)

---

## Assets a subir (feitos por você)
- **Ícone da loja 128×128**: usar `extension/icons/icon128.png`.
- **Screenshot** (mín. 1; 1280×800 ou 640×400): capturar o painel "Fluig Debug"
  aberto sobre uma solicitação real, na aba **Campos**, com a tabela preenchida,
  uma banda de tabela pai-filho visível e de preferência uma célula em edição —
  é o que mostra a proposta da v2 num quadro só. Cuidado com dado real de cliente
  na captura (nome, CPF, valor): prefira uma solicitação de homologação.

## Empacotamento
- Zipar **o conteúdo da pasta `extension/`** (manifest na raiz do zip), sem a
  pasta pai. Ex.: `cd extension && zip -r ../fluig-debug.zip .`

## Pendências fora do código
- Conta de desenvolvedor Google + taxa única de US$ 5.
- Definir e-mail de contato verificado no Dashboard.
