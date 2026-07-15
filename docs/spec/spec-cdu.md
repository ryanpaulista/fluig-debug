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

### CU-03 — Inspecionar variáveis / dataset do Fluig

**Contexto:** além dos campos do formulário, o desenvolvedor precisa ver
variáveis de contexto do Fluig (ex: dados do processo, usuário logado, dados de
dataset) que hoje só são acessíveis digitando comandos no console.

**Fluxo desejado com a extensão:**
1. Visualizar num painel as variáveis de contexto relevantes já resolvidas
   (sem digitar comando).
2. (A definir com a equipe quais variáveis entram no primeiro release — ver
   seção "Pontos a confirmar".)

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