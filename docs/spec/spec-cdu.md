# Extensão de Debug para Fluig — Casos de Uso e Requisitos

Documento inicial de levantamento. Descreve o problema atual, os casos de uso
reais do dia a dia da equipe e o que a extensão precisa fazer. Serve de base
para o desenho técnico e o primeiro release.

---

## Objetivo

Criar uma extensão de navegador (Chrome/Edge) que elimine o trabalho manual e
repetitivo de inspecionar e manipular formulários Fluig durante o debug de
processos. Hoje esse trabalho é feito na mão via F12 + console; a extensão
transforma isso em ações de um clique.

---

## Problema atual (como é feito hoje)

Quando um processo apresenta um comportamento inesperado em produção, o
desenvolvedor precisa investigar o estado do formulário e, muitas vezes,
corrigir valores. O fluxo manual atual é:

1. Abrir o F12 (DevTools).
2. Clicar em "Select an element".
3. Clicar na região do formulário para localizar o campo.
4. Procurar o campo no DOM/Elements e ler o `value`.
5. Ir ao código para entender a causa.
6. Escrever/colar no console um comando jQuery, ex: `$("#campo").val("valor");`
7. Executar o comando para ajustar o valor.

**Dores:** processo lento, repetitivo, manual e sujeito a erro. Cada
investigação repete os mesmos passos mecânicos antes de chegar à parte que
realmente exige raciocínio (entender a causa no código).

---

## Casos de uso

### CU-01 — Investigar e corrigir o valor de um campo (bug em produção)

**Contexto:** um processo em produção apresentou um comportamento que não
deveria ocorrer. O desenvolvedor suspeita que um campo específico influenciou o
acontecimento.

**Fluxo desejado com a extensão:**
1. Abrir a extensão no formulário em questão.
2. Localizar rapidamente o campo suspeito e ler seu valor atual (sem caçar no
   DOM manualmente).
3. Após entender a causa no código, ajustar o valor do campo direto pela
   extensão, sem colar script no console.

**Substitui:** os 7 passos manuais descritos acima.

### CU-02 — Exportar o estado completo do formulário (contexto para IA/análise)

**Contexto:** o desenvolvedor quer capturar como todos os campos estão
preenchidos, seja para documentar o estado, seja para colar como contexto em uma
ferramenta de IA (ex: Claude Code) e pedir análise do problema.

**Fluxo desejado com a extensão:**
1. Um clique para "dump" de todos os campos e seus valores atuais.
2. Saída em formato copiável e estruturado (ex: JSON), pronto para colar em
   outra ferramenta.

**Valor:** transforma "coletar o estado campo a campo" em uma ação única, e
entrega o contexto num formato que a IA entende bem.

**Ampliação (implementada):** além de exportar, *olhar*. A partir da v2 a mesma
varredura tem duas apresentações, em **abas**:
- **Campos** (padrão) — o grid: uma linha por ocorrência crua de campo simples,
  com nome, tipo e valor **editável**; filtro incremental por **nome ou valor**;
  tabelas pai-filho como **planilha** (ver abaixo); por linha, "setar" (abre o
  editor inline) e "nome" (copia o `name`/`id` cru).
- **Estado** — a saída agrupada em JSON, para colar como contexto, com
  numeração de linha e realce.

**Decisões:**
- As duas abas são *views* do resultado do `buildDumpExpr`, **não** varreduras
  distintas: trocar de aba não revarre a página. Dois caminhos coletando o mesmo
  dado divergiriam na primeira mudança de regra. Na v2 esse princípio virou
  arquitetura: o índice do autocomplete também é derivado dessa varredura, e a
  segunda expressão que existia só para ele (`buildFieldIndexExpr`) foi removida.
- Linha por entrada **crua**, não por campo lógico: campo espelhado em outro
  frame precisa aparecer separado para ser depurável. O agrupamento por nome
  lógico continua sendo papel do JSON.
- Teto de **300 linhas** renderizadas por vez, com aviso no rodapé — mesma
  preocupação do `MAX_SUGGESTIONS` do autocomplete: formulário Fluig grande
  passa de mil entradas e travaria o painel. Teto **nunca é silencioso**: o
  rodapé diz quantas ficaram de fora.
- Só o índice numérico da linha vai para atributo HTML (`data-i`): o `esc()` do
  painel não escapa aspas, e nome de campo vem da página. Onde um nome precisa
  ir para atributo (`title`, `data-band`), passa por `escAttr()`.
- **A varredura acontece ao abrir o painel**, sem exigir clique em "gerar dump":
  se o grid é a tela principal, ele não pode nascer vazio.

### CU-03 — Inspecionar variáveis / dataset do Fluig

**Contexto:** além dos campos do formulário, o desenvolvedor precisa ver
variáveis de contexto do Fluig (ex: dados do processo, usuário logado, dados de
dataset) que hoje só são acessíveis digitando comandos no console.

**Fluxo desejado com a extensão:**
1. Visualizar num painel as variáveis de contexto relevantes já resolvidas
   (sem digitar comando).

**Decidido (1ª fatia — implementada):** o foco é o **documentId da
solicitação**, resolvido automaticamente ao abrir o painel:
- O **número da solicitação** vem do parâmetro de URL da `pageworkflowview`. O
  nome do parâmetro **varia conforme por onde a solicitação foi aberta**
  (`app_ecm_workflowview_detailsProcessInstanceID` pela consulta/detalhes,
  `app_ecm_workflowview_processInstanceId` pela tarefa/movimentação), então a
  extensão não fixa um nome: aceita **qualquer parâmetro terminado em
  `processInstanceId`** (case-insensitive) com valor numérico.
- O **documentId** é resolvido consultando o dataset `workflowProcess` (via
  `DatasetFactory` **client-side** do Fluig, disponível no contexto do
  formulário), filtrando por `workflowProcessPK.processInstanceId` e lendo o
  campo `cardDocumentId`.

**Princípio adotado:** variáveis de contexto que na origem são **server-side**
(nº da solicitação, documentId etc.) são obtidas pelo **valor autoritativo** —
API/dataset do próprio Fluig — e **não** por garimpo de hidden input, global
injetada ou heurística sobre o HTML (frágil e dependente do ambiente).

Próximas fatias (mesmo padrão): usuário logado, atividade atual e outras
variáveis a definir com a equipe.

---

## Funcionalidades do primeiro release (prioridades)

Com base nos casos de uso acima, o primeiro release foca em:

1. **Ler o valor de um campo específico** (CU-01) — localizar por nome e exibir
   o valor atual.
2. **Setar o valor de um campo específico** (CU-01) — alterar o valor sem
   console.
3. **Dump do estado de todos os campos** (CU-02) — exportar em formato copiável
   (JSON), pensado para uso como contexto em IA.
4. **Inspecionar variáveis/dataset do Fluig** (CU-03) — exibir variáveis de
   contexto relevantes.

---

## Direção técnica (preliminar)

### Interface: DevTools panel

A recomendação é implementar a extensão como um **painel no DevTools** (uma aba
nova no F12), e não como popup ou painel injetado na página. Motivos:

- As funções são de debug/inspeção, feitas por desenvolvedor — o DevTools é o
  lugar natural onde o dev já está quando investiga um problema.
- Tem espaço para exibir estado e variáveis de forma legível e fixa ao lado da
  página.
- Não polui a tela do Fluig nem corre risco de colidir com o CSS/JS do
  formulário (risco de um painel injetado na página).

### Método de leitura/escrita: jQuery (confirmado)

No contexto do navegador, o Fluig já carrega o jQuery em todo formulário. O
método que a equipe usa hoje no console e que a extensão vai automatizar é:

```javascript
// Ler valor
$("#campo").val();

// Setar valor
$("#campo").val("valor");
```

A extensão executa esse mesmo jQuery no contexto da página. Como o jQuery já
está presente, não é preciso injetar biblioteca alguma — apenas avaliar o
comando no contexto correto.

### Tratamento de `id`/`name` instável (importante)

O `id`/`name` de um campo Fluig **não é fixo**, e isso afeta diretamente as
funções de localizar/ler/setar campo:

- **Campo desabilitado:** quando um campo é desabilitado via `setEnabled(false)`
  em evento server-side, o Fluig **prefixa `_`** no `name` e no `id` do campo no
  HTML. Ou seja, o campo `codigo` pode aparecer como `_codigo` no DOM em certas
  atividades. Um seletor `$("#codigo")` falha nesse caso — a extensão deve
  procurar também a variante com `_`.
- **Tabela pai-filho:** campos de tabela filho recebem sufixo `___N`
  (ex: `descricao___1`, `descricao___2`). O dump de estado (CU-02) precisa
  capturar essas variações para não perder as linhas filhas.

Por isso a extensão **não deve assumir "campo = id fixo"**. Ela deve varrer os
inputs efetivamente presentes no DOM pelo `name`/`id` reais daquele momento,
lidando com o prefixo `_` e o sufixo `___N`. Isso é justamente o que a extensão
agrega sobre o console manual: tira a adivinhação de qual é o seletor certo.

### Autocomplete de nome de campo (implementado)

Consequência direta do item acima: se o `name` real é instável, o desenvolvedor
também **não sabe de cabeça o nome do campo**. O prompt de ler (na v1, os três
inputs de nome) sugere os campos presentes na página conforme se digita.

**Decidido:**

- **Fonte:** a mesma varredura do dump (`input, select, textarea, span[name]` em
  todos os frames de mesma origem), agrupada por **nome lógico**. Não há lista
  fixa de campos nem consulta ao servidor — só o DOM daquele momento.
- **Granularidade:** por padrão a lista mostra **nomes lógicos** (com badge de
  quantas linhas/ocorrências existem), porque é o que o usuário digita. As
  ocorrências `___N` aparecem **sob demanda**, quando o texto contém `___`.
  Isso é o atalho para o caso em que o setar bloqueia por ambiguidade e exige a
  ocorrência exata.
- **Dropdown próprio** (não `<datalist>`): permite mostrar os mesmos badges do
  resultado do ler (desabilitado, somente leitura, tipo, tabela) e um preview do
  valor atual, além de controlar o ranking (prefixo antes de substring).
- **Degrada em silêncio:** se a varredura falhar, o input segue aceitando o nome
  digitado à mão. A sugestão é conveniência, não pré-requisito.

**Revisado na v2:**

- **Índice derivado, não coletado.** Some a varredura própria do autocomplete
  (`buildFieldIndexExpr`) e com ela o cache com TTL de 3s: o índice é calculado
  em JS a partir de `model.entries`, a mesma lista que alimenta o grid. Uma
  varredura, uma verdade — e o autocomplete passa a mostrar exatamente o que o
  grid mostra, que antes podia divergir por um instante.
- **Enter escolhe *e* lê.** Na v1 o Enter só preenchia o input, porque preencher
  e executar eram passos de seções diferentes. Com o prompt dedicado à leitura, o
  passo seguinte óbvio depois de escolher um campo é ver o valor dele — então o
  Enter faz os dois. **Tab** continua só completando, para quem quer escolher sem
  disparar nada.

### Histórico de ações (implementado)

Complemento do CU-01: ao investigar um bug você seta um valor para testar, e
muitas vezes precisa **voltar o valor anterior** — hoje isso dependia de você ter
anotado qual era.

**Decidido:**

- **Uma lista única** (na v1 era um histórico por seção), atrás do botão
  **histórico (N)** na command bar, com o tipo de cada ação marcado —
  `ler` / `DOM` / `banco`. A v1 tinha três listas porque tinha três seções; com um
  grid só, três listas seriam três lugares para procurar a mesma coisa.
- **Efêmero, só em memória do painel:** sobrevive à navegação da página (rever o
  que foi setado antes de recarregar o formulário é justamente um dos usos) e
  morre ao fechar o DevTools. **Nada em `storage`** — mesmo princípio do dump.
- **Restaurar leva o valor anterior ao mesmo caminho de escrita da ação
  original** — editor inline para o `DOM`, faixa de confirmação para o `banco` —
  em vez de aplicar direto. A regra de que toda ação que altera estado passa por
  confirmação continua valendo; o histórico só encurta o caminho até ela.
- **Registra o efeito, não a intenção:** o valor novo gravado é o *read-back*.
  Alteração cancelada ou que falhou não entra. Leitura não encontrada entra.
- **Leitura repetida idêntica colapsa** em contador (`N×`); escrita nunca.
- **Limite de 50 entradas.**

**Limitação assumida — o "anterior" do setar no banco:** o `dsSetCardValue` não
tem leitura correspondente, então o valor anterior dessa seção é lido do **DOM** e
rotulado como `anterior (DOM)` em toda a UI. No caso principal (solicitação
finalizada) o `<span>` contém o valor persistido, mas não há garantia. Quando não
é possível afirmar um único valor (campo ausente, ou ocorrências espelhadas
divergentes), a UI mostra **não disponível** e não oferece Restaurar.

### Reformulação da interface (v2 — implementado)

Até a v1.1 o painel era um **documento**: `<section>`s empilhadas (Solicitação,
Ler campo, Setar campo, Setar no banco, Dump), cada uma com formulário próprio e
um bloco de saída embaixo que empurrava o conteúdo para baixo a cada ação. Num
painel do DevTools — largo e **curto** — isso gastava altura demais e obrigava a
rolar para trocar de função.

A v2 troca a metáfora: de documento para **cliente de dados**. A referência é
DBeaver / DataGrip, não dashboard.

**Decidido:**

- **O grid é a tela principal, não um resultado.** Se todos os campos já estão
  numa tabela editável, *ler é olhar* e *setar é digitar na célula*. As seções
  "Ler campo" e "Setar campo" deixam de existir como formulários; o que sobra é
  um **prompt** na command bar para o caso de saber o nome e querer o valor de
  agora.
- **Escrita a partir do grid não passa por resolução de ambiguidade.** A linha
  conhece o `name`/`id` **cru**, então ela mira a ocorrência exata. O erro
  "ambíguo: casa com N ocorrências" da v1 era consequência de digitar o nome
  lógico — some no caminho do grid e continua valendo para o prompt.
- **Alturas fixas e um único scroll.** Toolbar 27px, tabs 28px, barra de ação
  29px, status bar 22px; só o miolo rola. A `<section>` com margem de 22px cede
  lugar a hairline de 1px.
- **Tabela pai-filho é planilha, não lista de campos.** Colunas = campos, linhas
  = `___N`. Uma tabela com 6 campos e 5 linhas virava 30 linhas soltas no grid, e
  a relação entre elas — que é o que se quer ver — ficava só no sufixo. Como
  planilha, comparar a mesma coluna entre linhas volta a ser olhar para baixo.
  Decisões dentro dela:
  - **Ordem das colunas é a de primeira aparição no DOM**, não alfabética: é a
    ordem em que as colunas estão no formulário, que é como o usuário as conhece.
  - **Ordem das linhas é numérica** e a numeração do Fluig tem buracos (`1`, `3`,
    `5`) — é exibida como está, sem renumerar. Renumerar esconderia que a linha 2
    foi excluída.
  - **Campo ausente naquela linha vira `—`**, não célula vazia: vazio é um valor
    possível e não pode ser confundido com ausente.
  - **A linha modelo** (campos sem `___N`, o molde que o Fluig mantém) entra na
    planilha, não na lista de campos simples — mas **só quando tem algum valor**.
    Molde vazio é o caso normal e não informa nada; pior, inflava a contagem da
    banda ("3 linha(s)" para uma tabela de 2). Vazio, não existe: nem linha, nem
    contagem. Os campos seguem no JSON e no autocomplete, e o `title` da banda diz
    quantos foram omitidos — omissão silenciosa se lê como "não existe".
  - **A contagem da banda é de linhas de DADOS.** A linha modelo, quando aparece,
    é anunciada separada (`+ modelo`): ela não é uma linha da tabela.
  - **Redimensionar no arraste**, como numa planilha: borda direita do cabeçalho
    muda a largura da coluna, borda de baixo do número da linha muda a altura
    daquela linha, duplo clique na alça volta ao automático. As alças ficam **só
    nessas duas bordas** — uma faixa sensível na borda de qualquer célula roubaria
    o duplo clique que abre o editor. O ajuste é guardado por tabela + nome da
    coluna (nunca por posição), então sobrevive a filtro, colapso e revarredura; e
    é aplicado direto no elemento durante o arraste, sem re-render.
  - **Arrastar a primeira coluna congela todas as larguras em px.** Com as
    vizinhas em `1fr`, encolher uma faria as outras se esticarem e a arrastada
    pareceria não mudar de tamanho.
  - **Coluna `___N` fixa (sticky)** ao rolar na horizontal; cada tabela rola
    dentro do próprio bloco, então o painel nunca rola de lado.
  - **Filtro esconde linhas, nunca colunas.** Casar o nome da tabela ou de uma
    coluna mantém a tabela inteira — nesses casos é a tabela que interessa.
  - **`⧉` copia a linha como JSON.** Numa tabela, o que se leva para fora quase
    nunca é um campo isolado.
  - **Teto de render conta célula** e corta em **linhas inteiras**: meia linha de
    planilha não ajuda ninguém.
- **Identificação de tabela com fallback.** Depender só de `[tablename]` não
  serve: em formulário real ele falta com frequência, e aí as linhas de tabelas
  diferentes caem num balaio único e se intercalam pelo número da linha (foi
  exatamente o que apareceu no primeiro teste da v2 numa solicitação com várias
  tabelas). A identificação desce por fallback — `[tablename]` → id do `<table>`
  → **posição do `<table>` no documento** → container com id (tabela montada com
  `<div>`) — e a UI **diz qual critério usou** quando não foi o `tablename`,
  porque agrupamento torto é quase sempre falta desse atributo.
- **Estado do campo entra na forma, não em pílula.** Faixa de 2px na borda
  esquerda da linha: âmbar = desabilitado (`_`), cinza = `span` só-leitura,
  violeta = `hidden`, aço = linha de tabela. Dá para varrer a coluna sem ler
  nenhuma palavra. As tags textuais da v1 (`desabilitado (_)`, `somente leitura`,
  `iframe`) saem da linha: tipo vira coluna própria e o resto vai para o `title`.
- **A solicitação sai do topo e vira contexto.** Número e `documentId` ficam na
  toolbar, sempre visíveis; o detalhe da resolução migra para a aba **Processo**.
  Recupera altura útil e dá um lar para as funções de workflow que vêm depois.
- **Status bar única** no lugar de um bloco de saída por seção. Marcador quadrado
  de 6px (neutro / ok / aviso / erro) + hora tabular.
- **Logs ganham aba própria.** Na v1 os `console.log` capturados só apareciam
  dentro do JSON do dump. Continuam indo no JSON, mas agora dá para olhar sem
  gerar nada, com filtro por nível e por texto.
- **Dark-first com token único.** O painel herda o tema do DevTools via
  `prefers-color-scheme`; o desenho é escuro por decisão e o tema claro é
  sobrescrita de ~20 variáveis. Nenhum componente referencia cor literal.
- **Nada de "cheiro de IA".** Raio máximo de 2px, sem cartão dentro de cartão,
  sem pílula de fundo tingido, sem um ícone colorido por seção, sem empty state
  centralizado com ícone gigante, tabs estreitas à esquerda com sublinhado de
  2px. Ferramenta de dev não é landing page.

**Confirmação — o que mudou e o que não:**

- **`DOM`: o editor É a confirmação.** Ele mostra o valor atual ao lado do novo e
  nada é aplicado sem clicar em `DOM` (ou Enter). Os dois valores seguem visíveis
  antes de aplicar, que é o que a regra pedia; o passo extra em tela separada era o
  que a v1 usava por não ter onde mostrar isso.
- **Duas formas de editor, escolhidas pela largura da célula.** Um `<input>` de
  uma linha numa célula de 104px não serve para um JSON de mil caracteres — na
  prática o campo de edição ficava menor que o conteúdo e não dava para ver o que
  se estava alterando. Então:
  - **Cabe numa linha da célula** → editor inline, na própria célula.
  - **Não cabe** (ou tem quebra de linha) → **editor de valor longo** ancorado
    acima da command bar, na largura do painel, altura pelo conteúdo (teto em ~45%
    da altura do painel, com `resize` vertical nativo para esticar).
  - O critério é a **largura real da célula**, não um número fixo de caracteres:
    coluna alargada no arraste passa a caber mais coisa inline.
  - No editor longo, **Enter insere quebra de linha** e **Ctrl+Enter aplica** —
    valor longo costuma ser multilinha, e perder a quebra ao aplicar seria pior que
    o atalho menos óbvio.
  - **Caret no início, sem select-all:** em valor longo o normal é mexer num
    trecho, e selecionar tudo faria a primeira tecla apagar mil caracteres.
  - A célula **não é esvaziada** — continua mostrando o valor atual, destacada,
    enquanto se edita (o padrão de planilha com barra de fórmulas).
- **`banco`: passo explícito, mantido.** `dsSetCardValue` grava fora do DOM e não
  tem desfazer, então continua exigindo uma **faixa de confirmação** própria, em
  âmbar, com solicitação, `documentId`, campo, atual (DOM) e novo. Âmbar é
  reservado a essa ação em toda a UI.
- **Nome que vai para o `dsSetCardValue`:** tira **só** o `_` de desabilitado, que
  é artefato de DOM e nunca faz parte do nome no banco. O `___N` **fica**: o
  dataset não tem conceito de linha, então mandar o nome cru é o mesmo que o
  usuário digitaria — não inventamos um mapeamento que a plataforma não garante.
  A faixa avisa quando o alvo é linha de tabela.

**Removido por redundância (não por corte de escopo):**

- `buildFieldIndexExpr` — o índice do autocomplete passou a ser derivado da
  varredura do dump.
- `buildRowExpr` + `renderRow` (o bloco "Linha completa" do ler) — a banda de
  tabela pai-filho no grid já mostra a linha inteira, e melhor.

### Restrição de arquitetura (Manifest V3)

O painel do DevTools **não** acessa diretamente o JavaScript da página
inspecionada. Para executar o jQuery no contexto da página (ler/setar campos,
ler variáveis), a extensão precisa avaliar o código nesse contexto e trazer o
resultado de volta para o painel. Essa ponte é o núcleo técnico da extensão e
precisa ser resolvida cedo.

---

## Pontos a confirmar com a equipe

Pontos já resolvidos (registrados na direção técnica):
- Método de leitura/escrita no navegador: **jQuery** (`$("#campo").val(...)`).
- Identificação de campos: tratar prefixo `_` (campo desabilitado) e sufixo
  `___N` (tabela pai-filho).

Ainda em aberto:

1. **O que significa "variáveis/dataset" no primeiro release?** Variáveis do
   formulário, variáveis do processo/workflow, datasets consultáveis, dados do
   usuário logado (`WCMAPI`)? Cada um se acessa de forma diferente — definir
   quais entram no MVP.

2. **Formulário-cobaia.** Escolher UM formulário real (o mais chato de debugar
   hoje) para validar o primeiro release. A extensão se prova deixando o debug
   desse formulário concreto mais rápido, e depois replica para os demais.

---

## Fora do escopo do primeiro release (adiado, não descartado)

Estes itens foram avaliados e deliberadamente deixados para depois, para manter
o MVP enxuto:

- **Disparar eventos ao setar (`.trigger("change")`).** Setar via `.val()` puro
  não aciona os eventos `change`/`blur` do campo, então lógicas dependentes
  (cálculos, validações, zoom) não são reexecutadas. Por ora a extensão replica
  o comportamento atual do console (`.val()` sem trigger). Fica registrado como
  melhoria futura, pois pode explicar casos de "setei mas não surtiu efeito".
- **Detecção de ambiente (dev/prod por URL).** Não entra no primeiro release.
  Fica como melhoria futura para reforçar avisos ao operar em produção.

## Fora de escopo (geral)

- Automação de testes (Playwright) — relacionada, mas tratada separadamente.
  Nota: os padrões de identificação de campo definidos aqui devem ser
  compartilhados com a estratégia de testes, para não manter lógica duplicada.
- Edição de múltiplos formulários em lote.

---

## Cuidados

- **Escopo de ativação:** a extensão só deve se ativar em domínios Fluig da
  empresa, para não rodar em páginas que não são alvo.
- **Ações sensíveis:** setar valor em um formulário é uma operação que altera
  estado. A extensão deve deixar claro qual campo e qual valor serão aplicados
  antes de executar.

---

## Ponto de partida para o desenvolvimento

### Stack

- Extensão Chrome/Edge, **Manifest V3**.
- Interface via **DevTools panel**.
- Sem framework obrigatório no MVP (HTML/CSS/JS simples no painel já atende).
  Framework pode ser avaliado depois se a UI crescer.

### Estrutura inicial sugerida do repositório

```
fluig-debug-extension/
├── manifest.json            # Manifest V3, declara o devtools page
├── devtools.html            # cria o painel no DevTools
├── devtools.js              # registra o painel
├── panel.html               # UI do painel (campos, botões, área de dump)
├── panel.js                 # lógica do painel + ponte com a página
├── README.md                # como instalar (modo desenvolvedor) e usar
└── docs/
    └── casos-de-uso.md       # este documento
```

### Núcleo técnico a resolver primeiro

A ponte painel → página. O painel avalia jQuery no contexto da página
inspecionada e recebe o resultado. Em Manifest V3, isso usa a API de DevTools
para executar código no contexto da inspeção. Resolver isso com um comando
simples (ex: ler `$("#campo").val()`) **antes** de construir a UII completa —
é o risco técnico principal.

### Ordem sugerida de implementação (MVP)

1. Esqueleto da extensão (manifest, devtools, painel vazio) carregando no
   navegador em modo desenvolvedor.
2. Ponte painel → página funcionando com um comando fixo (prova de conceito).
3. **Ler campo** por `id`/`name`, tratando prefixo `_`.
4. **Setar campo** via `$(seletor).val(valor)`.
5. **Dump de todos os campos** (CU-02), tratando sufixo `___N`, com saída JSON
   copiável.
6. **Inspecionar variáveis** (CU-03) — escopo a definir (ver pontos em aberto).

### Como orientar o Claude Code

- A skill `fluig-development` deve estar disponível no projeto — ela traz as
  convenções do Fluig (prefixo `_`, sufixo `___N`, jQuery presente, `WCMAPI`,
  `FLUIGC`) que informam as decisões da extensão.
- Começar pelo item 2 da ordem acima (a ponte), porque é o que trava tudo.
- Validar cada etapa em um formulário real antes de seguir para a próxima.