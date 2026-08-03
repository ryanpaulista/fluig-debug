# Fluig Debug — extensão de debug para formulários Fluig

Ferramenta de debug para desenvolvedores que trabalham com formulários TOTVS
Fluig. É um **painel no DevTools** (aba nova no F12) que substitui o trabalho
manual de caçar campos no DOM e colar comandos jQuery no console.

Publicada na Chrome Web Store como **não listada** (instalação por link, uso
interno da equipe) e também carregável em modo desenvolvedor. Especificação
completa em [`docs/spec/spec-cdu.md`](docs/spec/spec-cdu.md).

## Estrutura

```
extension/
├── manifest.json     # Manifest V3 — declara só o devtools_page (zero permissões)
├── devtools.html     # página oculta do DevTools; carrega devtools.js
├── devtools.js       # detecta se a página é Fluig e, só então, cria o painel
├── panel.html        # UI do painel (sem JS inline — CSP do MV3)
└── panel.js          # ponte painel → página (inspectedWindow.eval) + lógica da UI
docs/
├── spec/spec-cdu.md      # casos de uso, decisões técnicas e de interface
├── store-listing.md      # textos da ficha da Chrome Web Store
└── mockups/panel-v2.html # mockup da interface v2
test/
└── panel-smoke.js    # smoke test do painel em Node (ver "Testes")
```

### A ponte painel → página (núcleo técnico)

`panel.js` expõe `evalInPage(expression)`: avalia uma expressão **no contexto da
página inspecionada** (onde o jQuery do Fluig existe) via
`chrome.devtools.inspectedWindow.eval` e devolve o retorno já serializado. É esse
mecanismo que substitui o "colar comando no console" — e a base reutilizada pelas
funções de ler / setar / varrer.

**Iframe:** o formulário Fluig (`pageworkflowview`) é renderizado dentro de um
`<iframe>`. O campo não está no frame de cima (o portal), e é por isso que, no
console manual, `$("#campo")` só funciona depois de usar *Select an element*
dentro do formulário (isso troca o contexto para o iframe). A ponte resolve isso
sozinha: varre `window` + iframes de mesma origem e usa o jQuery do frame onde o
campo realmente está — sem você precisar selecionar nada antes.

### Uma varredura alimenta tudo

`buildDumpExpr()` é a **única** coleta de campos da extensão. O grid, o
autocomplete, o JSON da aba Estado e a aba Logs saem todos do mesmo resultado.
Isso é decisão de arquitetura, não economia: dois caminhos coletando o mesmo dado
divergem na primeira mudança de regra (o que conta como campo, como se lê o
valor, o que fazer com `radio` desmarcado).

### Por que zero permissões no manifest

Um painel do DevTools usa `chrome.devtools.inspectedWindow.eval()` para rodar
jQuery no contexto da página — essa API já é liberada para páginas do DevTools
**sem exigir `permissions` nem `host_permissions`**. Como todas as funções só
precisam disso, o manifest não pede permissão nenhuma. Sem `<all_urls>`, sem
acesso de rede, sem código remoto. (Efeito colateral prático: a revisão da Chrome
Web Store costuma sair em horas a 1–2 dias.)

### Como a extensão se restringe a ambientes Fluig

Os hostnames dos servidores Fluig da empresa **não são padronizados** (prod,
homologação etc.), então uma allowlist de URL geraria falso-negativo. Em vez
disso, `devtools.js` faz *fingerprint* da página: só cria a aba **Fluig Debug**
se detectar os globais que só existem na plataforma (`WCMAPI` ou `FLUIGC`). Em
qualquer página não-Fluig, a extensão fica inerte (a aba nem aparece).

## Como carregar a extensão (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** (*Load unpacked*).
4. Selecione a pasta **`extension/`** deste repositório.

### Como recarregar após mudanças

1. Em `chrome://extensions`, clique no ícone de **recarregar** (↻) no card da
   extensão.
2. **Feche e reabra o DevTools** na aba do Fluig (a página do DevTools só relê a
   extensão ao ser reaberta).

---

# A interface (v2)

A v2 troca a metáfora do painel: de **documento** (seções empilhadas, cada uma
com formulário e saída própria) para **cliente de dados** — a referência é
DBeaver / DataGrip. O painel do DevTools é largo e curto, então tudo tem altura
fixa e só o miolo rola.

```
┌───────────────────────────────────────────────────────────────┐
│ ▪ fluig debug │ solicitação 40812 · doc 152847 · iframe    ↻  │ toolbar
├───────────────────────────────────────────────────────────────┤
│ Campos 87 │ Estado │ Logs 6 │ Processo                        │ abas
├───────────────────────────────────────────────────────────────┤
│ [filtrar por nome ou valor] 87 ocorrências  3 tabelas    json │ barra de ação
├────┬─────────────────┬────────┬───────────────────────────────┤
│  # │ campo           │ tipo   │ valor                         │ grid
│  1 │ empresa         │ select │ 1 - STRATEGI       setar nome │
│  5 │ valorTotal      │ text   │ [12500.00] 10000  DOM  banco  │ ← em edição
├────────────────────────────────────────────────────────────────┤
│ ▾ tabela itens · 3 linha(s) · 4 campo(s)                       │ banda
├─────┬────────────┬──────────────────┬─────┬───────────────────┤
│ ___ │ codProduto │ descProduto      │ qtd │ valorUnit         │ planilha
│  1  │ 000114     │ Monitor 27" IPS  │ 5   │ 1890.00           │
│  3  │ 000237     │ Dock USB-C       │ 2   │  —                │
├───────────────────────────────────────────────────────────────┤
│ › nome do campo — Enter lê e localiza no grid   ler histórico │ command bar
├───────────────────────────────────────────────────────────────┤
│ ▪ valorTotal setado no DOM: 10000.00 → 12500.00      14:07:42 │ status bar
└───────────────────────────────────────────────────────────────┘
```

**Onde ficou o que era da v1:**

| v1 (seções) | v2 |
| --- | --- |
| Solicitação (topo) | toolbar (número + `documentId`) e aba **Processo** |
| Ler campo | prompt `›` na command bar + o próprio grid |
| Setar campo | editor inline na célula de valor |
| Setar campo no banco | botão `banco` no editor + faixa de confirmação |
| Dump → Tabela | aba **Campos** (o grid) |
| Dump → JSON | aba **Estado** |
| logs (dentro do JSON) | aba **Logs** (e continuam no JSON) |
| Histórico (3 botões) | um botão `histórico` na command bar |

O painel **acompanha o tema do DevTools** (`prefers-color-scheme`): o desenho é
escuro, e o tema claro é troca de variável CSS.

## Ver todos os campos (aba Campos)

A varredura roda **ao abrir o painel** — não há mais "gerar dump". A aba tem
**duas apresentações**, porque campo simples e tabela pai-filho não se leem do
mesmo jeito:

**Campos simples** — uma linha por ocorrência **crua** (campo espelhado em outro
frame aparece separado), com nome, tipo e valor.

- **Estado do campo é a faixa de 2px na borda esquerda**, não uma tag: âmbar =
  desabilitado (`_`), cinza = `span` só-leitura, violeta = `hidden`.
- **`_` e `___N` aparecem esmaecidos** dentro do nome — é ali que mora a confusão
  do Fluig, e o grid mostra o nome real sem esconder o artefato.
- Por linha: **setar** (abre o editor) e **nome** (copia o `name`/`id` cru).

**Tabelas pai-filho — planilha.** Cada tabela vira um bloco com **colunas =
campos** e **linhas = `___N`**, atrás de uma banda colapsável
(`▾ tabela itens · 3 linha(s) · 4 campo(s)`).

- Uma tabela com 6 campos e 5 linhas dava **30 linhas soltas** no grid, e a
  relação entre elas — que é o que se quer ver — ficava só no sufixo `___N`. Como
  planilha, comparar a mesma coluna entre linhas volta a ser olhar para baixo.
- **A coluna `___` fica fixa** quando a planilha rola na horizontal, para você não
  perder a referência de qual linha está lendo. Tabela larga rola **dentro do
  próprio bloco**: o painel nunca rola de lado.
- **Ordem das colunas é a de aparição no formulário**, não alfabética. Ordem das
  linhas é numérica, e a numeração do Fluig costuma ter buracos (`1`, `3`, `5`) —
  ela é mostrada como está.
- **Campo que existe em outras linhas mas falta nesta vira `—`**, não célula
  vazia: vazio é um valor possível e não pode ser confundido com ausente.
- **Duplo clique em qualquer célula** edita (mesmo editor, com `DOM` e `banco`).
  A faixa de estado aparece na própria célula.
- **`⧉` no número da linha** (aparece ao passar o mouse) copia a linha inteira
  como JSON `{campo: valor}` — numa tabela, o que se quer levar para fora quase
  nunca é um campo isolado.
- **Redimensionar como numa planilha:** arraste a **borda direita do cabeçalho**
  para mudar a largura da coluna, ou a **borda de baixo do número da linha** para
  mudar a altura daquela linha. **Duplo clique na alça** volta ao automático. As
  alças ficam só nessas duas bordas de propósito — uma faixa sensível na borda de
  qualquer célula roubaria o duplo clique que abre o editor. O que você ajustou é
  guardado por tabela + nome da coluna (nunca por posição), então **sobrevive a
  filtro, colapso e revarredura**.
- Linha com altura arrastada passa a cortar pela **caixa da linha**, não pelo
  clamp global — é isso que faz o texto ir aparecendo conforme você arrasta. Ela
  solta a altura enquanto você edita uma célula e volta ao fechar.

**A linha modelo.** A tabela pai-filho do Fluig carrega um molde cujos campos vêm
**sem** o `___N` (`ENTRY_ID` ao lado de `ENTRY_ID___1`). Esses campos entram na
planilha como primeira linha, marcada `mod`:

- Numa tabela **que tem registros**, o molde só aparece se tiver algum valor.
  Molde vazio (o caso normal) não aparece e **não conta**: uma tabela de 2 linhas
  diz `2 linha(s)`, não 3. Quando aparece, a banda avisa `+ modelo`. Os campos
  omitidos continuam no JSON da aba Estado e no autocomplete do prompt, e o
  `title` da banda diz quantos foram.
- Numa tabela **sem nenhum registro**, o molde **sempre** aparece, mesmo vazio —
  ele é a única representação daqueles campos, e sem ele eles ficariam invisíveis
  e ineditáveis no grid. A contagem continua `0 linha(s)` e a banda diz
  `sem registros — só a linha modelo`.

**Como um campo sem sufixo é atribuído a uma tabela** — dois critérios, conforme a
força do sinal:

- **`[tablename]` é prova definitiva.** Esse atributo só existe em tabela
  pai-filho do Fluig, então um campo dentro dele pertence a ela, ponto — inclusive
  quando a tabela não tem nenhuma linha `___N`. É o caso da tabela sem registros
  (`timesDeleted`), que antes nem existia como tabela e deixava os campos do molde
  soltos na lista geral.
- **Qualquer outro container** (id ou posição do `<table>`, `<div>` com id) é sinal
  fraco, então exige **também** que o nome do campo seja uma das **colunas** da
  tabela. Sem essa segunda condição, um campo comum dentro de uma `<table>` usada
  para diagramar — coisa comum em formulário Fluig — seria sequestrado para dentro
  dela.

**Como as tabelas são identificadas.** O agrupamento tenta, em ordem:
`[tablename]` → id do `<table>` → posição do `<table>` no documento → container
com id (tabela montada com `<div>`). Quando **não** foi pelo `tablename`, a banda
diz isso em âmbar (`sem tablename — agrupada pela posição da tabela`), porque
agrupamento torto é quase sempre falta desse atributo. Campo `___N` que não caiu
em nenhuma tabela vai para um bloco `linhas sem tabela identificada`.

**Vale para as duas apresentações:**

- **Filtro incremental** por **nome ou valor**. Procurar pelo valor que se vê na
  tela para descobrir de que campo ele veio é um dos usos principais. Numa
  planilha, o filtro esconde **linhas** (não colunas); casar o nome da tabela ou
  de uma coluna mantém a tabela inteira, porque aí é a tabela que interessa.
- Com filtro ativo o colapso é ignorado — quem filtrou quer ver o que casou, onde
  estiver.
- Passe o mouse num nome ou célula para ver `name`/`id` cru, nome lógico, tipo,
  frame, tabela e linha.
- **Altura das linhas**: o controle `altura 1 · 2 · 5 · tudo` na barra de ação diz
  quantas linhas de texto cada célula mostra antes de cortar; `tudo` remove o
  corte. Vale para o grid plano e para as planilhas de uma vez, e **não
  re-renderiza** — não perde o scroll nem a edição em curso.
- Formulário grande: renderiza no máximo **4.000 células** por vez, com teto de
  **50 linhas por tabela** para que uma tabela gigante não deixe as seguintes sem
  nada. O corte respeita linhas inteiras e é dito em voz alta: na banda
  (`mostrando 25 de 48 linha(s) · teto de render`) e no rodapé do grid. Se a banda
  disser `0 de 45 linha(s) · teto de render`, a tabela não está colapsada — ela
  não caberia; filtre ou colapse as tabelas que não interessam.
- **↻ revarrer** (toolbar) recoleta campos e logs. O formulário Fluig muda em
  runtime (linha nova na tabela, campo habilitado/desabilitado), então revarra
  depois de mexer nele.

## Ler um campo

Duas formas, e a diferença importa:

- **Olhar o grid** — instantâneo, mas mostra o valor da **última varredura**.
- **Prompt `›`** (command bar) — lê da **página, agora**. Digite o nome, Enter.
  O valor lido atualiza a linha no grid, **destaca e rola até ela**, e aparece na
  status bar. Se casar com várias ocorrências, todas são destacadas.

O prompt tem **autocomplete**: comece a digitar (ou tecle ↓ com o campo vazio
para listar tudo).

- **Nome lógico por padrão** — é o que você digita no dia a dia, já que a
  extensão resolve o `_` e o `___N` sozinha. Campo de tabela aparece uma vez, com
  `N linha(s)`.
- **Digite `___`** para trocar para o modo por linha e ver `campo___1`,
  `campo___2`… O número também filtra: `campo___1` mostra as linhas 1, 10, 11…
- **↑↓** navega, **Enter** escolhe **e lê**, **Tab** só completa, **Esc** fecha.
- O índice é **derivado da varredura** — o autocomplete mostra exatamente o que o
  grid mostra. Se ainda não houve varredura, a lista simplesmente não abre e o
  input continua aceitando o nome digitado à mão.
- **Botões ficam fora** (`button`/`submit`/`reset`/`image`): têm `name`, mas nunca
  são alvo de ler/setar.

## Alterar um campo no DOM

**Duplo clique na célula de valor** (ou o botão `setar` da linha) abre o editor.
Ele tem **duas formas**, escolhidas pelo tamanho do valor:

**Valor que cabe numa linha da célula → editor inline.** Um input na própria
célula, com o valor antigo **riscado** ao lado e os botões `DOM` e `banco`.
**Enter** aplica no DOM, **Esc** cancela. É o caminho rápido do dia a dia (`qtd`,
datas, códigos).

**Valor que não cabe → editor de valor longo**, ancorado acima da command bar, na
largura do painel. Um `<input>` de uma linha numa célula de 104px não serve para
um JSON de mil caracteres: aqui o valor aparece **inteiro** e você clica direto no
trecho que quer mexer.

- O critério é a **largura real da célula**, não um número fixo de caracteres — se
  você alargou a coluna, mais coisa cabe inline. Valor com quebra de linha vai
  sempre para o editor longo.
- **Ctrl+Enter** aplica no DOM (o Enter insere quebra de linha, que valor longo
  precisa), **Esc** cancela.
- A altura vem do conteúdo, com teto em ~45% do painel; passando disso o editor
  rola, e a borda de baixo dele **estica no arraste**.
- O caret começa no **início, sem selecionar tudo**: em valor longo o normal é
  mexer num trecho, e select-all faria a primeira tecla apagar mil caracteres.
- A célula **continua visível e destacada** enquanto você edita — como planilha
  com barra de fórmulas.

Vale para as duas formas:
- **O editor é a confirmação.** O valor atual fica visível ao lado do novo antes de
  qualquer coisa ser aplicada (riscado no inline, na própria célula no editor
  longo). Não existe mais a tela de confirmação separada da v1 para o caminho do
  DOM.
- A escrita mira a **ocorrência exata** daquela linha (o `name`/`id` cru), então o
  erro "ambíguo: casa com N ocorrências" da v1 não acontece a partir do grid.
- **Sem trigger:** aplica `.val()` puro, **sem** disparar `change`/`blur` (igual
  ao console de hoje). Lógicas dependentes (cálculos, validações, zoom) podem não
  reexecutar — limitação conhecida, registrada no spec.
- O valor que aparece depois é o **read-back** (o que de fato ficou no campo), não
  o que foi pedido.
- **`span` (modo VIEW / processo finalizado):** o editor deixa alterar, mas no DOM
  isso troca **só o texto exibido** — não é campo de formulário, nada persiste. O
  `title` do botão avisa. Nesses casos o caminho real é o `banco`.

## Gravar direto no banco

O botão **`banco`** (no editor) grava via o dataset `dsSetCardValue`, usando o
`documentId` da solicitação — **não mexe no DOM**. Serve para quando
`$(campo).val()` não resolve, principalmente **solicitação finalizada**.

Isso não tem desfazer, então tem passo próprio: abre uma **faixa de confirmação
âmbar** com solicitação, `documentId`, campo, **atual (DOM)** e **novo**. Nada é
gravado até você clicar em **Confirmar gravação**. Âmbar é reservado a essa ação
em toda a interface.

Depois de gravar, **recarregue o formulário** para ver o valor novo — a gravação
foi no banco, não no DOM aberto.

Detalhes que importam:

- **`atual (DOM)`, não `atual (banco)`.** O `dsSetCardValue` grava mas **não tem
  leitura correspondente**, então o valor anterior sai do DOM. No caso principal
  (solicitação finalizada) o `<span>` carrega justamente o valor persistido, mas
  isso **não é garantido** — se o DOM estiver defasado, o "atual" será o do DOM.
- **Nome enviado ao dataset:** tira **só** o `_` de desabilitado (artefato de DOM,
  nunca faz parte do nome no banco). O `___N` **fica**, porque o `dsSetCardValue`
  não tem conceito de linha — mandar o nome cru é o mesmo que você digitaria, e a
  faixa avisa quando o alvo é linha de tabela.
- Depende do `documentId` resolver (ver aba Processo).

## Exportar o estado (aba Estado)

O mesmo resultado da varredura, agrupado, em JSON com numeração de linha e
realce:

- `meta` — origem da captura, nº de campos/tabelas/logs e lista de desabilitados;
- `fields` — campos simples (nome lógico → valor);
- `tables` — tabelas pai-filho agrupadas em linhas;
- `childFieldsSemTabela` — campos `___N` cujo `tablename` não deu para
  identificar;
- `logs` — `console.log`/`warn`/`error` capturados, com hora.

**copiar** leva para a área de transferência (pronto para colar como contexto numa
IA); **salvar .json** baixa o arquivo. O botão **json** na barra da aba Campos faz
o mesmo copiar, sem trocar de aba.

Campos duplicados (inputs espelhados do Fluig) com valores diferentes viram um
array, para sinalizar a ambiguidade em vez de escondê-la.

Nada é persistido em `storage` — o JSON existe só na tela.

## Logs (aba Logs)

Os `console.log` capturados agora têm aba própria, com **hora de cada linha**,
marcador de nível na borda (vermelho = erro, âmbar = aviso), filtro por texto e
por nível. Eles continuam indo no JSON da aba Estado.

Como funciona: ao detectar Fluig, o `devtools.js` instala um *hook* que envolve
`console.log`/`info`/`warn`/`error`/`debug` e captura erros não tratados,
guardando as últimas 300 mensagens **por frame** em um buffer na página
(`window.__FLUIG_DEBUG_LOGS__`), cada uma com timestamp. A varredura lê esse
buffer.

- **Não usa a permissão `debugger`** (a que mostra o banner "está depurando este
  navegador") — só um hook local no `console`, reversível, que sempre chama o
  `console` original.
- **Limitação:** só captura logs **a partir do momento em que o DevTools foi
  aberto** (quando o hook é instalado). Logs anteriores não aparecem. Para
  capturar o log de uma ação, mantenha o F12 aberto e reproduza a ação.
- O hook é reinstalado a cada navegação (a página nova zera o buffer).

## Processo / `documentId` (aba Processo)

A resolução roda sozinha ao abrir o painel, **sem clique**. A toolbar mostra o
resultado curto (`solicitação 40812 · doc 152847`); a aba Processo mostra o
detalhe: número, **qual parâmetro da URL** casou, `documentId`,
`cardIndexDocumentId`, em que frame o `DatasetFactory` foi encontrado e de qual
frame vieram os campos. Se falhar, mostra a mensagem e **em que etapa** falhou —
`↻ resolver de novo` tenta outra vez (útil quando o formulário ainda estava
carregando).

Como funciona (não garimpa o DOM):

- O número da solicitação vem de um parâmetro de URL. O Fluig **muda o nome desse
  parâmetro** conforme por onde a solicitação foi aberta — pela consulta/detalhes
  vem `app_ecm_workflowview_detailsProcessInstanceID=717`, pela
  tarefa/movimentação vem `app_ecm_workflowview_processInstanceId=698707`. Por
  isso a extensão não procura um nome fixo: varre a query e aceita **qualquer
  parâmetro cujo nome termine em `processInstanceId`** (ignorando
  maiúsculas/minúsculas) com valor numérico. O sufixo é específico o bastante para
  não confundir com os vizinhos (`currentMovto`, `taskUserId`, `managerMode`).
- Com esse número, a extensão executa **no contexto da página** uma consulta ao
  dataset `workflowProcess` (via `DatasetFactory` client-side do Fluig), filtrando
  por `workflowProcessPK.processInstanceId` e pedindo `cardDocumentId` — que **é**
  o documentId da solicitação. O valor vem do próprio dataset do Fluig
  (autoritativo), não de heurística sobre o HTML.

A aba lista também, em voz alta, o que **ainda não existe** (mover solicitação,
histórico de movimentações). É onde as funções de workflow entram.

## Histórico

O botão **histórico (N)** na command bar abre uma lista única do que passou pelo
painel nesta sessão, com o tipo marcado — `ler` / `DOM` / `banco` — hora, campo e
`anterior → novo`.

- **Restaurar** leva o valor anterior ao **mesmo caminho de escrita da ação
  original**: editor inline para o `DOM`, faixa de confirmação para o `banco`.
  Encurta o caminho, mas **não pula a confirmação**.
- **Efêmero de propósito.** Vive só em memória do painel: sobrevive à navegação da
  página (útil — dá para rever o que você setou antes de recarregar o formulário)
  e **desaparece quando o DevTools é fechado**. Nada vai para `storage`.
- **Registra o efeito, não a intenção.** O valor gravado é o *read-back*.
  Alteração cancelada ou que falhou não entra. Leitura **não encontrada** entra —
  saber que o campo não existia naquele momento é informação de debug.
- **Leitura repetida idêntica colapsa** em contador (`3×`); escrita nunca — cada
  gravação é um evento próprio.
- **Limite de 50 entradas.**

---

## Testes

O painel roda dentro do DevTools, o que dificulta teste automatizado de verdade.
`test/panel-smoke.js` é um **smoke test em Node**: carrega o `panel.js` real num
DOM falso cujos IDs vêm do `panel.html` real, simula a ponte
`inspectedWindow.eval` com um resultado de varredura fabricado e exercita os
caminhos de UI.

```bash
node test/panel-smoke.js
```

O que ele cobre:

- **Wiring de IDs:** qualquer `getElementById` para um id que não existe no
  `panel.html` é reportado (o erro clássico ao mexer nos dois arquivos).
- **JS injetado na página:** cada `build*Expr()` é validado por `new vm.Script`,
  então erro de sintaxe nas expressões — que só apareceria em runtime, dentro do
  Chrome — quebra aqui.
- **Render:** grid (faixas de estado, bandas de tabela, `_`/`___N` esmaecidos,
  escape de HTML vindo da página), logs, JSON e aba Processo.
- **Interação:** filtro (por nome e por valor), colapso de banda, editor inline,
  set no DOM com read-back, confirmação do banco (inclusive *que nada é gravado
  antes de confirmar*), autocomplete nos dois modos, ler pelo prompt, colapso de
  leitura repetida e restaurar do histórico.

Não substitui o teste manual no Fluig — as expressões são validadas
sintaticamente, não executadas contra um formulário real.

## Verificação manual no Fluig

Depois de recarregar a extensão e reabrir o DevTools sobre uma **solicitação de
workflow real**:

1. **Abre já com dados.** A aba Campos lista os campos sem clique nenhum, e a
   toolbar mostra `solicitação N · doc N`.
2. **Faixas de estado.** Um campo desabilitado via `setEnabled(false)` aparece com
   `_` esmaecido e faixa âmbar; em processo finalizado os campos aparecem como
   `span ro` com faixa cinza.
3. **Tabela pai-filho.** Numa solicitação com **várias** tabelas, cada uma vira
   uma planilha própria — colunas = campos, linhas = `___N` — e nenhuma linha de
   uma tabela aparece na planilha da outra. Colapsar e reabrir funciona por
   tabela. Se alguma banda avisar `sem tablename`, confira se o agrupamento
   daquela tabela ficou correto.
4. **Filtro por valor.** Digite um valor que você vê na tela do formulário e
   confirme que ele acha o campo.
5. **Editar.** Duplo clique num valor, digite outro, Enter. O campo muda no
   formulário e a status bar mostra `anterior → novo`.
6. **Banco.** Sobre uma solicitação **finalizada**, edite um campo e clique em
   `banco`; confirme na faixa âmbar, recarregue o formulário e veja o valor novo.
7. **Controle negativo.** Abra o F12 numa página não-Fluig (ex: `google.com`): a
   aba **Fluig Debug não deve aparecer**.
