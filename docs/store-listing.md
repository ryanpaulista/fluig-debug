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
> **Fluig Debug** adiciona um painel "Fluig Debug" ao DevTools do Chrome (F12) que
> aparece automaticamente quando a página é da plataforma TOTVS Fluig. É uma
> ferramenta de apoio ao desenvolvimento/depuração de formulários Fluig.
>
> Recursos:
> - **Ler campo** — mostra o valor atual de um campo pelo nome lógico, resolvendo
>   as variações de nome que o Fluig aplica em runtime (campo desabilitado ganha
>   prefixo `_`; campo de tabela pai/filho ganha sufixo `___N`). Ao informar uma
>   linha específica (`campo___0`), exibe também os demais campos daquela linha.
> - **Setar campo** — altera o valor de um campo no formulário (com confirmação).
> - **Setar campo no banco** — grava o valor direto no banco (dataset
>   `dsSetCardValue`) para casos em que o DOM não persiste (ex.: solicitação
>   finalizada). Ação sensível, com confirmação obrigatória.
> - **Solicitação** — resolve automaticamente o número da solicitação e o
>   `documentId`, consultando o dataset `workflowProcess` do próprio Fluig.
> - **Dump do estado** — exporta todos os campos, tabelas e logs de console
>   capturados, para copiar/colar em análises.
>
> A extensão funciona inteiramente dentro do DevTools da sua própria aba. Não
> envia nenhum dado para servidores externos.

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
