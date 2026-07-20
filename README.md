# Fluig Debug — extensão de debug para formulários Fluig

Ferramenta **interna** de debug para desenvolvedores que trabalham com
formulários TOTVS Fluig. É um **painel no DevTools** (aba nova no F12) que
substitui o trabalho manual de caçar campos no DOM e colar comandos jQuery no
console.

Não é um produto para a Chrome Web Store. Carregada em modo desenvolvedor,
usada apenas pela equipe. Especificação completa em
[`docs/spec/spec-cdu.md`](docs/spec/spec-cdu.md).

## Estrutura

```
extension/
├── manifest.json     # Manifest V3 — declara só o devtools_page (zero permissões)
├── devtools.html     # página oculta do DevTools; carrega devtools.js
├── devtools.js       # detecta se a página é Fluig e, só então, cria o painel
├── panel.html        # UI do painel (sem JS inline — CSP do MV3)
└── panel.js          # ponte painel → página (inspectedWindow.eval) + lógica da UI
```

### A ponte painel → página (núcleo técnico)

`panel.js` expõe `evalInPage(expression)`: avalia uma expressão **no contexto da
página inspecionada** (onde o jQuery do Fluig existe) via
`chrome.devtools.inspectedWindow.eval` e devolve o retorno já serializado. É esse
mecanismo que substitui o "colar comando no console" — e a base reutilizada pelas
funções de ler / setar / dump.

### Por que zero permissões no manifest

Um painel do DevTools usa `chrome.devtools.inspectedWindow.eval()` para rodar
jQuery no contexto da página — essa API já é liberada para páginas do DevTools
**sem exigir `permissions` nem `host_permissions`**. Como as 3 funções do MVP
(ler / setar / dump) só precisam disso, o manifest não pede permissão nenhuma.
Sem `<all_urls>`, sem acesso de rede, sem código remoto.

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

## Como testar a Etapa 1 (esqueleto)

1. Carregue a extensão (passos acima).
2. Abra um **formulário Fluig real** no navegador.
3. Abra o DevTools (**F12**).
4. **Esperado:** aparece uma aba nova chamada **Fluig Debug**. Ao clicar nela,
   você vê o cabeçalho "Fluig Debug" e a mensagem de painel carregado.
5. **Controle negativo:** abra o F12 em uma página **não-Fluig** (ex:
   `google.com`). A aba **Fluig Debug não deve aparecer**.

> Se a aba não aparecer num Fluig real, deixe o DevTools aberto alguns segundos
> (a detecção re-tenta enquanto o Fluig carrega) ou recarregue a página com o
> F12 aberto. Se persistir, me avise qual servidor era — pode ser um caso em que
> `WCMAPI`/`FLUIGC` não estão presentes.

## Como testar a Etapa 2 (ponte painel → página)

1. Recarregue a extensão e **reabra o DevTools** (ver "Como recarregar").
2. Abra um formulário Fluig que tenha o campo `empresa` preenchido e vá na aba
   **Fluig Debug**.
3. **Esperado:** ao abrir o painel (e ao clicar em **Testar ponte**), aparece:
   - Seletor: `#empresa`
   - Encontrado: **sim (1)**
   - Valor: o valor atual do campo na página.
   - Frame: `iframe` (o campo mora no iframe do formulário — ver abaixo).
4. Se o campo existir mas estiver vazio, o valor aparece como `(vazio)`. Se não
   for encontrado, aparece **não (0)** — nesta etapa ainda **não** tratamos o
   prefixo `_` de campo desabilitado (isso é a Etapa 3).

> **Iframe:** o formulário Fluig (`pageworkflowview`) é renderizado dentro de um
> `<iframe>`. O campo não está no frame de cima (o portal), e é por isso que, no
> console manual, `$("#campo")` só funciona depois de usar *Select an element*
> dentro do formulário (isso troca o contexto para o iframe). A ponte resolve
> isso sozinha: varre `window` + iframes de mesma origem e usa o jQuery do frame
> onde o campo realmente está — sem você precisar selecionar nada antes.

## Como testar a Etapa 3 (ler campo)

1. Recarregue a extensão e reabra o DevTools.
2. Na aba **Fluig Debug**, digite o nome de um campo (ex: `empresa`) e clique
   em **Ler** (ou tecle Enter).
3. **Esperado:** aparece o `name` real encontrado no DOM e o **valor** atual.
4. Casos que a Etapa 3 já trata, sem você precisar saber o id exato:
   - **Campo desabilitado:** se o campo foi desabilitado via `setEnabled(false)`,
     ele está no DOM como `_campo`. Digitando `campo` a extensão acha `_campo`
     e marca a tag **desabilitado (_)**.
   - **Tabela pai-filho:** se o nome corresponder a um campo de tabela filha, as
     linhas (`campo___1`, `campo___2`, …) aparecem como ocorrências separadas,
     cada uma com a tag **linha N**.

A busca casa por `name` e por `id`, comparando pelo **nome lógico** (sem o `_`
inicial e sem o `___N` final), então você digita sempre o nome "limpo" do campo.

## Como testar a Etapa 4 (setar campo)

1. Recarregue a extensão e reabra o DevTools.
2. Na seção **Setar campo**, digite o nome do campo e o novo valor, e clique em
   **Setar**.
3. **Esperado:** aparece uma **confirmação** mostrando o `name` real, o frame, o
   **valor atual** e o **novo valor**. Nada é alterado ainda.
4. Clique em **Confirmar alteração**. A extensão aplica `$(campo).val(valor)` e
   faz *read-back* — o painel mostra "valor agora" com o valor aplicado. Confira
   no formulário que o campo mudou.
5. **Cancelar** descarta sem alterar nada.

Cuidados embutidos:

- **Confirmação obrigatória:** setar é uma ação que altera estado, então a UI
  sempre mostra o que será alterado antes de aplicar.
- **Ambiguidade:** se o nome casar com **várias** ocorrências (ex: linhas
  `___N` de tabela filha), a extensão **não altera nada** e pede o nome exato da
  ocorrência (ex: `descricao___1`).
- **Sem trigger:** aplica `.val()` puro, **sem** disparar `change`/`blur` (igual
  ao console de hoje). Lógicas dependentes (cálculos, validações, zoom) podem
  não reexecutar — isso é uma limitação conhecida, registrada no spec como
  melhoria futura.

## Como testar a Etapa 5 (dump do estado)

1. Recarregue a extensão e reabra o DevTools.
2. Na seção **Dump do estado**, clique em **Gerar dump**.
3. **Esperado:** o `<textarea>` mostra um JSON com:
   - `meta` — origem da captura, nº de campos/tabelas/logs e lista de campos
     desabilitados;
   - `fields` — campos simples (nome lógico → valor);
   - `tables` — tabelas pai-filho agrupadas em linhas (quando houver);
   - `logs` — mensagens de `console.log`/`warn`/`error` e erros não tratados
     capturados (quando houver — ver abaixo).
4. Clique em **Copiar** para levar o JSON para a área de transferência (ou use
   Ctrl+C direto no textarea). Cole numa ferramenta de IA como contexto do bug.

Notas:

- O dump é gerado **sob demanda** e fica só na tela — **nada é persistido** em
  storage.
- Campos duplicados (inputs espelhados do Fluig) com valores diferentes viram
  um array, para sinalizar a ambiguidade em vez de escondê-la.
- **Modo VIEW / processo finalizado:** nesses contextos o Fluig troca os inputs
  por `<span>` (mantendo `name`/`id`, com o valor no texto — ex.:
  `<span id="startDate" name="startDate">22/06/2026</span>`). As três funções
  (ler, setar e dump) varrem também `span[name]` e leem o valor pelo texto, então
  o dump não perde mais esses campos. No ler/setar eles aparecem com a tag
  **somente leitura**.

### Captura de console (logs no dump)

Ao detectar Fluig, o `devtools.js` instala um *hook* que envolve `console.log`/
`info`/`warn`/`error`/`debug` e captura erros não tratados, guardando as últimas
300 mensagens por frame em um buffer na página (`window.__FLUIG_DEBUG_LOGS__`). O
dump lê esse buffer e inclui em `logs`.

- **Não usa a permissão `debugger`** (a que mostra o banner "está depurando este
  navegador") — só um hook local no `console`, reversível, que sempre chama o
  `console` original.
- **Limitação:** só captura logs **a partir do momento em que o DevTools foi
  aberto** (quando o hook é instalado). Logs anteriores não aparecem. Para
  capturar o log de uma ação, mantenha o F12 aberto e reproduza a ação.
- O hook é reinstalado a cada navegação (a página nova zera o buffer).

## Como testar a Etapa 6 (documentId da solicitação — CU-03)

1. Recarregue a extensão e reabra o DevTools.
2. Abra uma **solicitação de workflow** real (uma URL de `pageworkflowview` com o
   parâmetro `app_ecm_workflowview_detailsProcessInstanceID=<n>`).
3. Vá na aba **Fluig Debug**. A seção **Solicitação** fica no topo e resolve
   sozinha, **sem clique**:
   - **Solicitação:** o número lido da URL.
   - **documentId:** resolvido consultando o dataset `workflowProcess`.
4. Se o formulário ainda estava carregando quando o painel abriu (o
   `DatasetFactory` client-side pode não estar pronto), clique em **Recarregar**.

Como funciona (não garimpa o DOM):

- O número da solicitação vem do parâmetro de URL
  `app_ecm_workflowview_detailsProcessInstanceID`.
- Com esse número, a extensão executa **no contexto da página** uma consulta ao
  dataset `workflowProcess` (via `DatasetFactory` client-side do Fluig),
  filtrando por `workflowProcessPK.processInstanceId` e pedindo o campo
  `cardDocumentId` — que **é** o documentId da solicitação. O valor vem do
  próprio dataset do Fluig (autoritativo), não de heurística sobre o HTML.

> **Escopo atual:** a Etapa 6 foca no **documentId**. Outras variáveis de
> contexto (usuário, atividade etc.) ficam para fatias seguintes, no mesmo
> padrão (valor via API/dataset do Fluig, não via DOM).

## Como testar o "Setar campo no banco"

Além do **Setar campo** (que faz `$(campo).val()` no DOM), existe o **Setar campo
no banco**, que grava o valor **direto no banco** via o dataset
`dsSetCardValue`, usando o `documentId` da solicitação. Serve para os casos em
que o DOM não aceita a alteração — o principal é a **solicitação finalizada**
(campos viram `span`, `$(campo).val()` não persiste nada).

1. Recarregue a extensão e reabra o DevTools sobre uma solicitação de workflow.
2. Na seção **Setar campo no banco**, digite o nome do campo e o novo valor, e
   clique em **Setar no banco**.
3. **Esperado:** aparece uma **confirmação** mostrando a solicitação, o
   `documentId` resolvido, o campo e o novo valor. Nada é gravado ainda.
4. Clique em **Confirmar gravação**. A extensão resolve o `documentId` (via
   `workflowProcess`) e executa `dsSetCardValue` com `documentid` + `fieldName` +
   `fieldValue`. O painel confirma a gravação.
5. **Recarregue o formulário** para ver o valor novo — a gravação foi no banco,
   não no DOM aberto.

Cuidados:

- **Confirmação obrigatória**, como no setar do DOM — ainda mais importante aqui,
  porque grava no banco **ignorando** as validações/lógicas do formulário.
- Depende do `documentId` resolver (mesma base da seção **Solicitação**): só
  funciona sobre uma `pageworkflowview` com o parâmetro
  `app_ecm_workflowview_detailsProcessInstanceID` e com `DatasetFactory`
  client-side disponível.
