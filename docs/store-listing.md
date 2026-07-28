# Chrome Web Store — listagem (rascunho)

Visibilidade pretendida: **Não listada** (acessível só por link; passa por revisão do
Google normalmente). Textos abaixo prontos para colar no Developer Dashboard.

---

## Nome
Fluig Debug

## Descrição curta (máx. 132 caracteres)
> Painel no DevTools para inspecionar e manipular formulários da plataforma TOTVS Fluig (ler/setar campos, dump de estado).

(121 caracteres — dentro do limite.)

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

Ler campo
Mostra o valor atual de um campo pelo nome lógico e marca o que encontrou: campo desabilitado, somente leitura, tipo do input, linha da tabela. Quando você informa uma linha específica ("descricao___1"), exibe também os demais campos daquela mesma linha da tabela pai-filho.

Autocomplete de nome de campo
Nos três campos de nome, as opções aparecem conforme você digita — não é preciso saber o nome exato de cabeça. Cada sugestão mostra o valor atual e os mesmos marcadores do resultado da leitura. Navegação por setas, Enter escolhe, Esc fecha; a seta para baixo com o campo vazio lista todos os campos da página. Digitar "___" troca para a escolha da linha da tabela pai-filho.

Setar campo (no formulário)
Altera o valor do campo na página. Sempre mostra uma confirmação com o nome real encontrado, o valor atual e o novo valor antes de aplicar. Se o nome digitado casar com várias ocorrências, nada é alterado e a extensão pede a ocorrência exata.

Setar campo no banco
Grava o valor direto no banco, via o dataset dsSetCardValue e o documentId da solicitação. Serve para os casos em que alterar o DOM não resolve — o principal é a solicitação finalizada. Também passa por confirmação obrigatória, que mostra o valor a ser sobrescrito.

Histórico por seção
Cada seção de interação guarda um histórico do que passou por ali. Nas seções de alteração, o valor anterior e o novo, com um botão para restaurar o anterior — que preenche os campos e abre a confirmação. Na leitura, os valores lidos, com opção de ler de novo. O histórico existe apenas enquanto o DevTools está aberto.

Solicitação (documentId)
Ao abrir o painel sobre uma solicitação de workflow, resolve sozinho o número da solicitação (pelo parâmetro da URL) e o documentId, consultando o dataset workflowProcess do próprio Fluig. O valor vem do dataset, não de heurística sobre o HTML.

Dump do estado
Exporta em JSON todos os campos e valores, as tabelas pai-filho agrupadas por linha e as mensagens de console e erros capturados desde a abertura do DevTools. Pronto para copiar e colar como contexto em uma análise.

PRIVACIDADE E ESCOPO

- A extensão não declara nenhuma permissão no manifest além de devtools_page. Não há host_permissions e não há acesso a <all_urls>.
- Toda a interação com a página usa a API padrão de DevTools (chrome.devtools.inspectedWindow.eval), que só age sobre a aba que você já está inspecionando com o F12 aberto.
- Nenhum dado é enviado para servidores externos. Tudo acontece dentro do navegador, para exibir no painel do próprio desenvolvedor.
- Todo o código executado está empacotado na extensão. Nada é buscado remotamente.
- Nem o dump nem o histórico são persistidos: o histórico vive só enquanto o DevTools está aberto e o dump fica apenas na tela.
- Em página que não seja Fluig, a aba nem aparece: a extensão só se ativa ao detectar os objetos globais da plataforma (WCMAPI ou FLUIGC).

LIMITAÇÕES CONHECIDAS

- Ao setar um valor no formulário, a extensão aplica o valor sem disparar os eventos change e blur, igual ao que se faz no console. Lógicas dependentes (cálculos, validações, zoom) podem não reexecutar.
- A captura de mensagens de console só pega o que acontece a partir da abertura do DevTools.
- No "setar campo no banco", o valor anterior exibido é lido do DOM, porque o dataset de gravação não tem leitura correspondente. A interface rotula esse valor como tal.
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
  aberto sobre uma solicitação real (aba do DevTools com as seções Solicitação /
  Ler campo / Dump visíveis).

## Empacotamento
- Zipar **o conteúdo da pasta `extension/`** (manifest na raiz do zip), sem a
  pasta pai. Ex.: `cd extension && zip -r ../fluig-debug.zip .`

## Pendências fora do código
- Conta de desenvolvedor Google + taxa única de US$ 5.
- Definir e-mail de contato verificado no Dashboard.
