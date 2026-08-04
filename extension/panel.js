// panel.js
//
// Ponte painel -> pagina + funcoes de debug de formulario Fluig.
//
// A ponte (evalInPage) avalia jQuery NO CONTEXTO DA PAGINA via
// chrome.devtools.inspectedWindow.eval e devolve o resultado ja serializado.
//
// IMPORTANTE (iframe): no Fluig o formulario e renderizado dentro de um iframe
// (ex: pageworkflowview). O eval roda por padrao no frame de cima (o portal),
// onde os campos NAO estao. Por isso toda expressao aqui varre window + iframes
// de mesma origem e usa o jQuery do frame onde o campo realmente esta.
//
// IMPORTANTE (id/name instavel): no Fluig o id/name de um campo NAO e fixo.
//   - Campo desabilitado (setEnabled(false)) ganha prefixo "_": codigo -> _codigo
//   - Campo de tabela pai-filho ganha sufixo "___N": descricao___1, descricao___2
// Por isso casamos pelo "nome logico" (sem o "_" e sem o "___N").
//
// ARQUITETURA DA UI (v2) --------------------------------------------------------
// UMA varredura alimenta TUDO. buildDumpExpr e a unica coleta de campos: o grid,
// o autocomplete, o JSON da aba Estado e os logs saem todos do mesmo resultado
// (model.entries / model.logs). Antes existia uma segunda varredura so para o
// indice do autocomplete; dois caminhos coletando o mesmo dado divergem na
// primeira mudanca de regra (o que conta como campo, como se le o valor).
//
// O grid e a tela principal, nao um relatorio: ler e olhar, setar e digitar na
// celula. O nome CRU de cada linha ja e conhecido, entao a escrita a partir do
// grid nao passa pela resolucao de ambiguidade — ela mira a ocorrencia exata.
// A resolucao por nome digitado (buildFindExpr) continua servindo o prompt.

// ---------------------------------------------------------------------------
// Ponte (nucleo tecnico)
// ---------------------------------------------------------------------------

function evalInPage(expression) {
  return new Promise(function (resolve, reject) {
    chrome.devtools.inspectedWindow.eval(expression, function (result, exceptionInfo) {
      if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
        reject(exceptionInfo);
        return;
      }
      resolve(result);
    });
  });
}

// Falha legivel, venha de onde vier.
//
// O .catch de uma corrente de promise pega DOIS tipos de erro: o do eval na
// pagina (um exceptionInfo, objeto simples do DevTools) e o de um bug no proprio
// painel dentro do .then de sucesso. O segundo chega como Error — e
// JSON.stringify de um Error da "{}", porque name/message/stack nao sao
// enumeraveis. Era isso que fazia uma acao BEM SUCEDIDA terminar com
// "Erro ao aplicar: {}": o valor tinha sido setado, e o estouro vinha depois, na
// hora de registrar no historico.
function describeFailure(err) {
  if (err == null) { return 'sem detalhes'; }
  if (typeof err === 'string') { return err; }
  // exceptionInfo do inspectedWindow.eval, nas duas formas documentadas.
  if (err.isError && err.description) { return String(err.description); }
  if (err.isException) { return String(err.value != null ? err.value : 'exceção na página'); }
  // Error (ou qualquer coisa com message): a mensagem e o que interessa.
  if (typeof err.message === 'string' && err.message) {
    return (err.name ? err.name + ': ' : '') + err.message;
  }
  var json = null;
  try { json = JSON.stringify(err); } catch (e) {}
  return json && json !== '{}' ? json : String(err);
}

// Helpers injetados dentro do IIFE de cada expressao (varredura de frames +
// normalizacao de nome).
var PAGE_HELPERS = [
  '  // nome logico: sem o "_" de desabilitado e sem o "___N" de tabela filha.',
  '  function logical(raw) {',
  '    if (raw == null) { return null; }',
  '    return String(raw).replace(/___\\d+$/, "").replace(/^_/, "");',
  '  }',
  '  // window + iframes acessiveis (mesma origem), recursivo.',
  '  function collectWindows(win, acc, depth) {',
  '    acc.push(win);',
  '    if (depth > 5) { return acc; }',
  '    var frames;',
  '    try { frames = win.frames; } catch (e) { return acc; }',
  '    for (var i = 0; i < frames.length; i++) {',
  '      try { var f = frames[i]; void f.document; collectWindows(f, acc, depth + 1); }',
  '      catch (e) { /* cross-origin: ignora */ }',
  '    }',
  '    return acc;',
  '  }',
  '  // Em modo VIEW / processo finalizado o Fluig troca inputs por <span> (mantendo',
  '  // name/id; o valor vira o texto). Estes helpers unificam a leitura.',
  '  function nodeIsControl(node) {',
  '    var t = String(node.tagName || "").toUpperCase();',
  '    return t === "INPUT" || t === "SELECT" || t === "TEXTAREA";',
  '  }',
  '  function readValue(node, jq) {',
  '    if (nodeIsControl(node)) {',
  '      try { return jq ? jq(node).val() : node.value; } catch (e) { return node.value; }',
  '    }',
  '    var txt = (node.textContent != null ? node.textContent : node.innerText);',
  '    return txt == null ? "" : String(txt).replace(/^\\s+|\\s+$/g, "");',
  '  }',
  '  // A que TABELA pai-filho um campo "___N" pertence.',
  '  //',
  '  // Depender so de [tablename] nao serve: em formulario real ele falta com',
  '  // frequencia, e ai todas as linhas de tabelas diferentes caem num balaio',
  '  // unico e se intercalam pelo numero da linha. A identificacao desce por',
  '  // fallback, do mais confiavel ao menos, e devolve `how` para a UI poder',
  '  // dizer POR QUE agrupou daquele jeito (o que explica um agrupamento torto).',
  '  function tableInfo(node, doc) {',
  '    if (!node.closest) { return { key: null, label: null, how: null }; }',
  '    var named = null;',
  '    try { named = node.closest("[tablename]"); } catch (e) {}',
  '    if (named) {',
  '      var nm = named.getAttribute("tablename");',
  '      if (nm) { return { key: "name:" + nm, label: nm, how: "tablename" }; }',
  '    }',
  '    var tbl = null;',
  '    try { tbl = node.closest("table"); } catch (e) {}',
  '    if (tbl) {',
  '      if (tbl.id) { return { key: "id:" + tbl.id, label: tbl.id, how: "id" }; }',
  '      // Sem tablename e sem id: a posicao do <table> no documento e estavel o',
  '      // bastante para separar uma tabela da outra dentro da mesma varredura.',
  '      var all = doc.getElementsByTagName("table");',
  '      for (var i = 0; i < all.length; i++) {',
  '        if (all[i] === tbl) { return { key: "pos:" + i, label: "tabela " + (i + 1), how: "posicao" }; }',
  '      }',
  '      return { key: "pos:?", label: "tabela", how: "posicao" };',
  '    }',
  '    // Tabela montada com <div> (form novo): agrupa pelo container com id.',
  '    var box = null;',
  '    try { box = node.closest("[id]"); } catch (e) {}',
  '    if (box && box.id) { return { key: "box:" + box.id, label: box.id, how: "container" }; }',
  '    return { key: null, label: null, how: null };',
  '  }'
].join('\n');

// ---------------------------------------------------------------------------
// Localizar campo (usado pelo prompt "ler")
// ---------------------------------------------------------------------------

// Localiza um campo pelo nome digitado, tratando "_" e "___N", e retorna todas
// as ocorrencias reais no DOM. Cada match traz `exact` (name/id igual ao
// digitado) para dar para mirar uma ocorrencia especifica.
function buildFindExpr(typed) {
  var typedLit = JSON.stringify(typed);
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var typed = ' + typedLit + ';',
    '  var base = logical(typed);',
    '  // Se o usuario digitou um "___N" explicito (ex: nome___1), mira SO aquela',
    '  // linha da tabela pai-filho. Sem sufixo, traz todas as ocorrencias.',
    '  var typedChildMatch = String(typed).match(/___(\\d+)$/);',
    '  var typedChild = typedChildMatch ? typedChildMatch[1] : null;',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var matches = [];',
    '',
    '  for (var i = 0; i < wins.length; i++) {',
    '    var w = wins[i];',
    '    var doc;',
    '    try { doc = w.document; } catch (e) { continue; }',
    '    var jq = null;',
    '    try { jq = w.jQuery || w.$ || null; } catch (e) {}',
    '    var nodes;',
    '    try { nodes = doc.querySelectorAll("input, select, textarea, span[name]"); } catch (e) { continue; }',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      if (logical(raw) !== base) { continue; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var rawChild = childMatch ? childMatch[1] : null;',
    '      // Filtro por linha: se pediu ___N, so casa a mesma linha.',
    '      if (typedChild !== null && rawChild !== typedChild) { continue; }',
    '',
    '      var v = readValue(node, jq);',
    '      if (v == null) { v = ""; }',
    '',
    '      var ti = tableInfo(node, doc);',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      matches.push({',
    '        name: raw,',
    '        id: id,',
    '        value: String(v),',
    '        disabled: disabled,',
    '        child: rawChild,',
    '        table: ti.label,',
    '        type: String(node.type || node.tagName || "").toLowerCase(),',
    '        frame: (w === window ? "top" : "iframe"),',
    '        exact: (String(raw) === typed)',
    '      });',
    '    }',
    '  }',
    '',
    '  return { typed: typed, base: base, matches: matches, framesScanned: wins.length };',
    '})()'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Setar campo (no DOM)
// ---------------------------------------------------------------------------

// Aplica um valor no campo cujo name/id seja EXATAMENTE `rawName`, via jQuery
// .val() (sem trigger de eventos — fora de escopo). Faz read-back.
function buildSetExpr(rawName, value) {
  var rawLit = JSON.stringify(rawName);
  var valLit = JSON.stringify(value);
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var target = ' + rawLit + ';',
    '  var value = ' + valLit + ';',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var setCount = 0;',
    '  var readBack = null;',
    '  var frameUsed = null;',
    '',
    '  for (var i = 0; i < wins.length; i++) {',
    '    var w = wins[i];',
    '    var doc;',
    '    try { doc = w.document; } catch (e) { continue; }',
    '    var jq = null;',
    '    try { jq = w.jQuery || w.$ || null; } catch (e) {}',
    '    var nodes;',
    '    try { nodes = doc.querySelectorAll("input, select, textarea, span[name]"); } catch (e) { continue; }',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      if (nm !== target && id !== target) { continue; }',
    '',
    '      if (nodeIsControl(node)) {',
    '        try { if (jq) { jq(node).val(value); } else { node.value = value; } } catch (e) { node.value = value; }',
    '      } else {',
    '        try { node.textContent = value; } catch (e) {}',
    '      }',
    '      setCount++;',
    '      try { readBack = String(readValue(node, jq)); } catch (e) { readBack = ""; }',
    '      frameUsed = (w === window ? "top" : "iframe");',
    '    }',
    '  }',
    '',
    '  return { target: target, setCount: setCount, readBack: readBack, frame: frameUsed };',
    '})()'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Varredura: todos os campos + logs capturados (a fonte unica da UI)
// ---------------------------------------------------------------------------

// Varre todos os input/select/textarea/span[name] de window + iframes e devolve
// uma lista crua de entradas. A estruturacao (fields/tables do JSON) e feita no
// painel, em JS normal, mais facil de manter que uma expressao gigante.
function buildDumpExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var wins = collectWindows(window, [], 0);',
    '  var entries = [];',
    '  var logs = [];',
    '  var perFrame = [];',
    '',
    '  for (var i = 0; i < wins.length; i++) {',
    '    var w = wins[i];',
    '    var doc;',
    '    try { doc = w.document; } catch (e) { continue; }',
    '    var jq = null;',
    '    try { jq = w.jQuery || w.$ || null; } catch (e) {}',
    '    var nodes;',
    '    try { nodes = doc.querySelectorAll("input, select, textarea, span[name]"); } catch (e) { continue; }',
    '    var url = null;',
    '    try { url = String(w.location.href); } catch (e) {}',
    '    var count = 0;',
    '',
    '    // Logs capturados pelo hook (devtools.js) neste frame.',
    '    try {',
    '      var flogs = w.__FLUIG_DEBUG_LOGS__ || null;',
    '      if (flogs) {',
    '        for (var m = 0; m < flogs.length; m++) {',
    '          logs.push({ frame: (w === window ? "top" : "iframe"), level: flogs[m].level, msg: flogs[m].msg, t: (flogs[m].t != null ? flogs[m].t : null) });',
    '        }',
    '      }',
    '    } catch (e) {}',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      var type = String(node.type || node.tagName || "").toLowerCase();',
    '      if (type === "button" || type === "submit" || type === "reset" || type === "image") { continue; }',
    '      // radio: so a opcao marcada interessa.',
    '      if (type === "radio" && !node.checked) { continue; }',
    '',
    '      var value;',
    '      if (type === "checkbox") { value = node.checked ? "true" : "false"; }',
    '      else if (type === "radio") { value = node.value || "on"; }',
    '      else { value = readValue(node, jq); }',
    '      if (value == null) { value = ""; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var ti = tableInfo(node, doc);',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '',
    '      entries.push({',
    '        raw: raw,',
    '        name: logical(raw),',
    '        value: String(value),',
    '        disabled: disabled,',
    '        child: childMatch ? childMatch[1] : null,',
    '        table: ti.label,',
    '        tableKey: ti.key,',
    '        tableHow: ti.how,',
    '        type: type,',
    '        frame: (w === window ? "top" : "iframe")',
    '      });',
    '      count++;',
    '    }',
    '    perFrame.push({ url: url, count: count });',
    '  }',
    '',
    '  var best = null;',
    '  for (var k = 0; k < perFrame.length; k++) { if (!best || perFrame[k].count > best.count) { best = perFrame[k]; } }',
    '',
    '  return { entries: entries, logs: logs, capturedFrom: best ? best.url : null, framesScanned: wins.length };',
    '})()'
  ].join('\n');
}

function addField(fields, name, value) {
  if (!(name in fields)) { fields[name] = value; return; }
  var cur = fields[name];
  if (Array.isArray(cur)) {
    if (cur.indexOf(value) < 0) { cur.push(value); }
  } else if (cur !== value) {
    fields[name] = [cur, value];
  }
}

// Estrutura o resultado cru no JSON que vai para a aba Estado: campos simples
// agrupados por nome logico, tabelas pai-filho agrupadas por ___N e os logs.
function structureDump(result) {
  var fields = {};
  var tablesTmp = {}; // tabela -> { N -> { campo: valor } }
  var ungrouped = {}; // campo filho sem tablename identificavel -> valor
  var disabled = {};

  (result.entries || []).forEach(function (e) {
    if (e.disabled) { disabled[e.name] = true; }

    if (e.child != null) {
      if (e.table) {
        tablesTmp[e.table] = tablesTmp[e.table] || {};
        tablesTmp[e.table][e.child] = tablesTmp[e.table][e.child] || {};
        tablesTmp[e.table][e.child][e.name] = e.value;
      } else {
        ungrouped[e.raw] = e.value;
      }
    } else {
      addField(fields, e.name, e.value);
    }
  });

  var tables = {};
  Object.keys(tablesTmp).forEach(function (t) {
    var rowsMap = tablesTmp[t];
    var ns = Object.keys(rowsMap).map(Number).sort(function (a, b) { return a - b; });
    tables[t] = ns.map(function (n) { return rowsMap[n]; });
  });

  // Epoch cru nao ajuda quem le (nem a IA que recebe o JSON colado): vira hora
  // legivel. Log capturado antes de o hook instalar nao tem timestamp.
  var logs = (result.logs || []).map(function (l) {
    var item = { level: l.level, msg: l.msg };
    if (l.t) { item.at = hhmmss(new Date(l.t)); }
    if (l.frame && l.frame !== 'top') { item.frame = l.frame; }
    return item;
  });

  var out = {
    meta: {
      capturedFrom: result.capturedFrom || null,
      framesScanned: result.framesScanned,
      fieldCount: Object.keys(fields).length,
      tableCount: Object.keys(tables).length,
      logCount: logs.length,
      disabled: Object.keys(disabled)
    },
    fields: fields
  };
  if (Object.keys(tables).length) { out.tables = tables; }
  if (Object.keys(ungrouped).length) { out.childFieldsSemTabela = ungrouped; }
  if (logs.length) { out.logs = logs; }
  return out;
}

// ---------------------------------------------------------------------------
// Solicitação: documentId a partir do nº da solicitação (CU-03)
// ---------------------------------------------------------------------------
//
// Fluxo (roda automatico ao abrir o painel, sem clique):
//   1. Le o numero da solicitacao na URL, em qualquer parametro do workflowview
//      terminado em processInstanceId (o nome muda conforme a origem da
//      abertura: _detailsProcessInstanceID na consulta, _processInstanceId na
//      tarefa). Ver numProcessFromUrl.
//   2. Consulta o dataset workflowProcess (via DatasetFactory CLIENT-SIDE, que
//      existe no contexto do formulario Fluig) filtrando por
//      workflowProcessPK.processInstanceId e pedindo cardDocumentId.
//   3. cardDocumentId e o documentId da solicitacao.
//
// Nao garimpamos o DOM: o valor vem do proprio dataset do Fluig (autoritativo).
// O DatasetFactory client-side devolve { columns, values }, onde values e um
// array de objetos indexados por nome de coluna (diferente do server-side).
var DATASET_HELPERS = [
  '  // Frame que expoe o DatasetFactory client-side do Fluig.',
  '  function findDatasetWin(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      try { if (wins[i].DatasetFactory && typeof wins[i].DatasetFactory.getDataset === "function") { return wins[i]; } } catch (e) {}',
  '    }',
  '    return null;',
  '  }',
  '  // Numero da solicitacao a partir da URL (param do workflowview). O nome do',
  '  // parametro MUDA conforme por onde a solicitacao foi aberta:',
  '  //   ...?app_ecm_workflowview_detailsProcessInstanceID=717  (consulta/detalhes)',
  '  //   ...?app_ecm_workflowview_processInstanceId=698707      (tarefa/movimentacao)',
  '  // Por isso nao fixamos um nome: varremos os parametros da query e aceitamos',
  '  // qualquer chave que termine em "processinstanceid" (case-insensitive) com',
  '  // valor numerico. O sufixo e especifico o bastante para nao pegar os vizinhos',
  '  // (currentMovto, taskUserId, managerMode).',
  '  // Devolve { key, val } — a chave que casou aparece na aba Processo, porque',
  '  // saber DE ONDE veio o numero e o que explica uma resolucao errada.',
  '  function numProcessFromUrl(href) {',
  '    var qs = String(href).split("#")[0].split("?").slice(1).join("?");',
  '    if (!qs) { return null; }',
  '    var parts = qs.split("&");',
  '    for (var i = 0; i < parts.length; i++) {',
  '      var eq = parts[i].indexOf("=");',
  '      if (eq < 0) { continue; }',
  '      var key, val;',
  '      try { key = decodeURIComponent(parts[i].slice(0, eq)); val = decodeURIComponent(parts[i].slice(eq + 1)); } catch (e) { continue; }',
  '      if (!/processinstanceid$/i.test(key)) { continue; }',
  '      if (!/^\\d+$/.test(val)) { continue; }',
  '      return { key: key, val: val };',
  '    }',
  '    return null;',
  '  }',
  '  function findNumProcess(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      var href;',
  '      try { href = String(wins[i].location.href); } catch (e) { continue; }',
  '      var hit = numProcessFromUrl(href);',
  '      if (hit) { return { key: hit.key, val: hit.val, href: href, frame: (wins[i] === window ? "top" : "iframe") }; }',
  '    }',
  '    return null;',
  '  }',
  '  // documentId da solicitacao: workflowProcess -> cardDocumentId.',
  '  function resolveDocId(wins) {',
  '    var found = findNumProcess(wins);',
  '    if (!found) { return { ok: false, stage: "url", message: "Número da solicitação não encontrado na URL (nenhum parâmetro *processInstanceId). Abra a extensão sobre uma solicitação de workflow." }; }',
  '    var numProcess = found.val;',
  '    var dsWin = findDatasetWin(wins);',
  '    if (!dsWin) { return { ok: false, stage: "dataset", numProcess: numProcess, paramKey: found.key, pageUrl: found.href, message: "DatasetFactory não disponível no client-side (formulário ainda carregando?). Tente resolver de novo." }; }',
  '    try {',
  '      var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
  '      var c1 = DF.createConstraint("workflowProcessPK.processInstanceId", numProcess, numProcess, CT.MUST);',
  '      var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
  '      var dataset = DF.getDataset("workflowProcess", ["cardIndexDocumentId", "cardDocumentId"], [c1, c4], null);',
  '      var values = (dataset && dataset.values) ? dataset.values : [];',
  '      if (!values.length) { return { ok: false, stage: "empty", numProcess: numProcess, paramKey: found.key, pageUrl: found.href, message: "Consulta ao workflowProcess retornou vazio para a solicitação " + numProcess + "." }; }',
  '      var row = values[0];',
  '      return { ok: true, numProcess: numProcess, paramKey: found.key, pageUrl: found.href, documentId: (row.cardDocumentId != null ? String(row.cardDocumentId) : null), cardIndexDocumentId: (row.cardIndexDocumentId != null ? String(row.cardIndexDocumentId) : null), frame: (dsWin === window ? "top" : "iframe") };',
  '    } catch (e) { return { ok: false, stage: "query", numProcess: numProcess, paramKey: found.key, pageUrl: found.href, message: "Erro na consulta ao dataset: " + (e && e.message ? e.message : String(e)) }; }',
  '  }'
].join('\n');

function buildDocumentIdExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    DATASET_HELPERS,
    '  return resolveDocId(collectWindows(window, [], 0));',
    '})()'
  ].join('\n');
}

// Grava fieldValue no campo fieldName DIRETO NO BANCO (dataset dsSetCardValue),
// pelo documentId ja resolvido. Nao mexe no DOM. Espelha a funcao setValue do
// time (que resolve o documentId internamente); aqui o documentId ja vem pronto.
function buildDbSetExpr(documentId, fieldName, fieldValue) {
  return [
    '(function () {',
    PAGE_HELPERS,
    DATASET_HELPERS,
    '  var wins = collectWindows(window, [], 0);',
    '  var dsWin = findDatasetWin(wins);',
    '  if (!dsWin) { return { ok: false, message: "DatasetFactory não disponível no client-side." }; }',
    '  var documentId = ' + JSON.stringify(String(documentId)) + ';',
    '  var fieldName = ' + JSON.stringify(String(fieldName)) + ';',
    '  var fieldValue = ' + JSON.stringify(String(fieldValue)) + ';',
    '  try {',
    '    var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
    '    var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
    '    var c1 = DF.createConstraint("documentid", documentId, documentId, CT.MUST);',
    '    var c2 = DF.createConstraint("fieldName", fieldName, fieldName, CT.MUST);',
    '    var c3 = DF.createConstraint("fieldValue", fieldValue, fieldValue, CT.MUST);',
    '    var result = DF.getDataset("dsSetCardValue", null, [c1, c2, c3, c4], null);',
    '    var out = { ok: true, documentId: documentId, fieldName: fieldName, fieldValue: fieldValue };',
    '    try { out.columns = (result && result.columns) ? result.columns : null; } catch (e) {}',
    '    try { out.values = (result && result.values) ? result.values : null; } catch (e) {}',
    '    return out;',
    '  } catch (e) { return { ok: false, documentId: documentId, message: "Erro ao gravar no banco: " + (e && e.message ? e.message : String(e)) }; }',
    '})()'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// UI — utilitarios
// ---------------------------------------------------------------------------

function el(id) { return document.getElementById(id); }

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Aspas tambem, para o que vai dentro de atributo (title).
function escAttr(value) {
  return esc(value).replace(/"/g, '&quot;');
}

function renderValue(v) {
  return v === '' || v == null ? '<span class="q">vazio</span>' : esc(v);
}

// O valor dentro de uma celula do grid. A caixa `.cl` e quem corta em N linhas
// (ver o CSS): o corte precisa de uma caixa sem padding, senao sobra uma tira da
// linha seguinte dentro do padding da celula.
function cellValueHtml(v) {
  return '<span class="cl">' + renderValue(v) + '</span>';
}

function ellipsis(v, max) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/^ | $/g, '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function hhmmss(date) {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

// Copia um texto curto por textarea efemera. Em painel do DevTools o
// execCommand ainda e o caminho mais confiavel; navigator.clipboard entra como
// fallback (precisa de foco no painel).
function copyText(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function copyWithFeedback(text, what) {
  if (!text) {
    setStatus('warn', 'Nada para copiar — varra a página primeiro.');
    return;
  }
  if (copyText(text)) {
    setStatus('ok', what + ' copiado para a área de transferência.');
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(function () { setStatus('ok', what + ' copiado.'); })
      .catch(function () { setStatus('warn', 'Não consegui copiar — selecione o texto e use Ctrl+C.'); });
    return;
  }
  setStatus('warn', 'Não consegui copiar — selecione o texto e use Ctrl+C.');
}

// ---------------------------------------------------------------------------
// Modelo em memoria
// ---------------------------------------------------------------------------
//
// EFEMERO DE PROPOSITO: nada vai para storage. O painel do DevTools mantem seu
// contexto JS enquanto o F12 esta aberto (sobrevive a navegacao da pagina) e
// morre quando o DevTools fecha.

var model = {
  at: null,        // Date da varredura
  entries: [],     // entradas cruas, com .idx estavel (indice neste array)
  logs: [],
  json: '',        // JSON.stringify(structureDump(...)) — a aba Estado e o copiar
  meta: null,      // meta do structureDump
  scanning: false,
  error: null
};

var docInfo = null;      // ultimo resultado de resolveDocId
var docPending = null;   // promise em voo, para nao resolver duas vezes em paralelo

// Teto de render, para um formulario grande nao travar o painel na montagem.
//
// Era 300 e estava MUITO baixo: herdei o numero da lista plana da v1, mas uma
// planilha de 23 colunas consome 23 por linha, entao 300 celulas eram ~13 linhas
// para o formulario INTEIRO — as ultimas tabelas ficavam com zero linhas e a
// banda ainda anunciava a contagem cheia, dando a impressao de tabela que nao
// abre. Um formulario real desta base tem ~1.900 ocorrencias; 4.000 celulas
// simples de <div> montam em milissegundos no Chrome.
//
// O corte, quando acontece, e SEMPRE dito em voz alta: na banda da tabela
// ("mostrando 25 de 48 linha(s)") e no rodape do grid. Teto silencioso se le
// como "e tudo isso aqui".
var GRID_RENDER_MAX = 4000;
// Teto por tabela, para uma unica tabela gigante nao consumir o orcamento
// inteiro e deixar as seguintes sem nada.
var SHEET_ROW_MAX = 50;
var MAX_SUGGESTIONS = 50;
var VALUE_PREVIEW_MAX = 60;

// ---------------------------------------------------------------------------
// UI — status bar
// ---------------------------------------------------------------------------
//
// Um lugar so para "o que acabou de acontecer". Antes cada secao tinha o proprio
// bloco de saida, que empurrava o conteudo para baixo a cada acao.

function setStatus(kind, html) {
  el('sb-mark').className = 'mk' + (kind ? ' ' + kind : '');
  el('sb-msg').innerHTML = html;
  el('sb-time').textContent = hhmmss(new Date());
}

function setStatusInfo(text) {
  el('sb-info').textContent = text || '';
}

// ---------------------------------------------------------------------------
// UI — abas
// ---------------------------------------------------------------------------

function setTab(name) {
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].setAttribute('aria-selected', String(tabs[i].getAttribute('data-tab') === name));
  }
  var panes = document.querySelectorAll('.pane');
  for (var j = 0; j < panes.length; j++) {
    if (panes[j].getAttribute('data-pane') === name) { panes[j].setAttribute('data-on', ''); }
    else { panes[j].removeAttribute('data-on'); }
  }
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

function rescan(reason) {
  if (model.scanning) { return; }
  model.scanning = true;
  setStatus('busy', reason || 'Varrendo a página…');

  return evalInPage(buildDumpExpr())
    .then(function (result) {
      model.scanning = false;
      if (!result) {
        model.error = 'Sem retorno da página.';
        renderAllFromModel();
        setStatus('err', 'Sem retorno da página. A página ainda está carregando?');
        return;
      }

      model.error = null;
      model.at = new Date();
      model.entries = (result.entries || []).map(function (e, i) { e.idx = i; return e; });
      model.logs = result.logs || [];
      var structured = structureDump(result);
      model.meta = structured.meta;
      model.json = JSON.stringify(structured, null, 2);

      renderAllFromModel();
      setStatus('ok',
        '<b>' + model.entries.length + '</b> ocorrência(s) de campo · ' +
        model.meta.fieldCount + ' campo(s), ' + model.meta.tableCount + ' tabela(s), ' +
        model.meta.logCount + ' log(s)');
    })
    .catch(function (err) {
      model.scanning = false;
      model.error = describeFailure(err);
      renderAllFromModel();
      setStatus('err', 'Erro ao varrer: ' + esc(model.error));
    });
}

function renderAllFromModel() {
  renderGrid();
  renderJson();
  renderLogs();
  paintTabCounts();
}

function paintTabCounts() {
  el('tab-count-campos').textContent = model.entries.length ? String(model.entries.length) : '';
  el('tab-count-logs').textContent = model.logs.length ? String(model.logs.length) : '';
}

// ---------------------------------------------------------------------------
// Grid — ordem de exibicao
// ---------------------------------------------------------------------------
//
// Campos simples primeiro (ordem alfabetica), como linhas. Depois, uma PLANILHA
// por tabela pai-filho: colunas = campos, linhas = ___N.
//
// Por que planilha e nao "uma linha por campo": uma tabela pai-filho com 6
// campos e 5 linhas dava 30 linhas soltas no grid, e a relacao entre elas — que
// e o que se quer ver — ficava so no sufixo ___N. Como planilha, comparar a
// mesma coluna entre linhas volta a ser olhar para baixo.

// Tabela pai-filho nasce COLAPSADA; expandir e um ato do usuario (`expandedTables`
// guarda so o que ele abriu). Um formulario real desta base tem mais de 100
// tabelas: abertas por padrao, os campos simples — que sao o que se procura na
// maioria das vezes — ficavam soterrados sob milhares de linhas de planilha.
// Colapsado, a banda de cada tabela continua visivel com nome, contagem de linhas
// e de campos, entao nada fica escondido: fica fechado.
//
// Zerado na navegacao (a pagina nova tem outras tabelas), preservado na
// revarredura — o que voce abriu continua aberto depois de mexer no formulario.
// Filtro ativo ignora o colapso: quem filtrou quer ver o que casou, onde estiver.
var expandedTables = {};

// Sheets do ultimo render, para as acoes por linha acharem a tabela sem
// reconstruir a lista inteira.
var lastSheets = {};

// Larguras de coluna e alturas de linha ajustadas pelo usuario no arraste.
// Chaveadas por tabela + nome da coluna / id da linha (nunca por posicao), entao
// sobrevivem a re-render, a filtro e a revarredura — o que voce ajustou continua
// ajustado depois de mexer no formulario.
//   colWidths[tableKey][colName] = px
//   rowHeights[tableKey][rowId]  = px
var colWidths = {};
var rowHeights = {};

var COL_MIN_PX = 48;
var ROW_MIN_PX = 20;

function byNameAsc(a, b) { return String(a.name).localeCompare(String(b.name), 'pt-BR'); }

// Monta o modelo da planilha de uma tabela.
//   cols — ordem de PRIMEIRA APARICAO no DOM, nao alfabetica: e a ordem em que
//          as colunas aparecem no formulario, que e como o usuario as conhece.
//   rows — ordem numerica de ___N (a numeracao do Fluig tem buracos: 1, 3, 5…).
function buildSheet(key, label, how, entries, templates) {
  var cols = [];
  var colSeen = {};
  var colType = {};
  var rowsMap = {};
  var rowOrder = [];

  entries.forEach(function (e) {
    if (!colSeen[e.name]) {
      colSeen[e.name] = 1;
      cols.push(e.name);
      colType[e.name] = e.type;
    }
    if (!rowsMap[e.child]) { rowsMap[e.child] = {}; rowOrder.push(e.child); }
    var cur = rowsMap[e.child][e.name];
    // Campo espelhado dentro da mesma linha: prefere a ocorrencia COM valor, para
    // a celula nao mostrar vazio quando existe valor em algum lugar.
    if (!cur || (cur.value === '' && e.value !== '')) { rowsMap[e.child][e.name] = e; }
  });

  rowOrder.sort(function (a, b) { return Number(a) - Number(b); });

  var rows = rowOrder.map(function (n) {
    return { id: n, label: n, template: false, cells: rowsMap[n] };
  });
  var tplOmitted = 0;

  // Linha modelo primeiro: e o "molde" das outras, e vem antes da linha 1.
  if (templates && templates.length) {
    var tplCells = {};
    var tplHasValue = false;
    templates.forEach(function (e) {
      if (e.value !== '') { tplHasValue = true; }
      var cur = tplCells[e.name];
      if (!cur || (cur.value === '' && e.value !== '')) { tplCells[e.name] = e; }
    });

    // Molde vazio numa tabela QUE TEM linhas nao aparece: nao informa nada e
    // inflava a contagem da banda ("3 linha(s)" para uma tabela de 2).
    //
    // Mas numa tabela SEM registro nenhum o molde e a unica representacao
    // daqueles campos — some ele e os campos ficam invisiveis e ineditaveis no
    // grid. Ali ele fica, e a contagem de linhas continua 0 (ele nao e linha da
    // tabela, e a banda diz isso).
    if (tplHasValue || rowOrder.length === 0) {
      // Coluna que so existe no molde entra no fim — mas SO quando o molde vai
      // aparecer. Adicionar a coluna com a linha descartada deixaria uma coluna
      // de "—" em todas as linhas, com o campo ineditavel.
      Object.keys(tplCells).forEach(function (name) {
        if (colSeen[name]) { return; }
        colSeen[name] = 1;
        cols.push(name);
        colType[name] = tplCells[name].type;
      });
      rows.unshift({ id: 'tpl', label: 'mod', template: true, cells: tplCells });
    } else {
      tplOmitted = templates.length;
    }
  }

  return {
    kind: 'sheet',
    key: key,
    label: label,
    how: how,
    cols: cols,
    colType: colType,
    rows: rows,
    dataRows: rowOrder.length,
    // Quantos campos da linha modelo foram omitidos por serem todos vazios. Nao
    // vira ruido na banda (seriam 57 avisos num formulario real), mas fica no
    // title dela — omissao silenciosa se le como "nao existe".
    tplOmitted: tplOmitted
  };
}

function displayList() {
  var suffixless = [];
  var byKey = {};
  var keyOrder = [];
  var orphans = [];

  function group(key, label, how) {
    if (!byKey[key]) {
      byKey[key] = { label: label, how: how, entries: [], names: {}, templates: [] };
      keyOrder.push(key);
    }
    return byKey[key];
  }

  model.entries.forEach(function (e) {
    if (e.child == null) { suffixless.push(e); return; }
    if (!e.tableKey) { orphans.push(e); return; }
    var g = group(e.tableKey, e.table, e.tableHow);
    g.entries.push(e);
    g.names[e.name] = 1;
  });

  // A LINHA MODELO da tabela.
  //
  // No Fluig a tabela pai-filho carrega uma linha molde cujos campos vem SEM o
  // sufixo — `ENTRY_ID` ao lado de `ENTRY_ID___1`, `ENTRY_ID___2`. Decidir "e de
  // tabela?" so pela presenca do `___N` jogava esses campos na lista de campos
  // simples, longe da tabela a que pertencem (e em modo view eles sao `span`
  // vazio, o que fazia a lista de cima parecer cheia de lixo).
  //
  // Dois criterios para mover, conforme a FORCA do sinal de que ali e tabela:
  //
  //   [tablename] — prova definitiva. Esse atributo so existe em tabela pai-filho
  //     do Fluig, entao um campo dentro dele pertence a ela, ponto. Vale mesmo
  //     quando a tabela nao tem NENHUMA linha `___N`: e o caso da tabela sem
  //     registros (ex: timesDeleted), que antes nem existia como tabela e deixava
  //     os campos do molde soltos na lista geral.
  //
  //   qualquer outro container (id / posicao do <table> / div com id) — sinal
  //     fraco, entao exige tambem que o nome do campo seja uma das COLUNAS da
  //     tabela. Formulario Fluig usa <table> para diagramar, e sem essa segunda
  //     condicao um campo comum dentro de uma tabela de layout seria sequestrado.
  var plain = [];
  suffixless.forEach(function (e) {
    if (!e.tableKey) { plain.push(e); return; }
    var t = byKey[e.tableKey];
    if (t && t.names[e.name]) { t.templates.push(e); return; }
    if (e.tableHow === 'tablename') {
      group(e.tableKey, e.table, e.tableHow).templates.push(e);
      return;
    }
    plain.push(e);
  });

  plain.sort(byNameAsc);

  var out = plain.map(function (e) { return { kind: 'row', entry: e }; });

  // keyOrder segue a ordem de aparicao no DOM — as tabelas saem na ordem em que
  // estao no formulario, nao em ordem alfabetica de nome interno.
  keyOrder.forEach(function (k) {
    var t = byKey[k];
    out.push(buildSheet(k, t.label, t.how, t.entries, t.templates));
  });

  if (orphans.length) {
    out.push(buildSheet('', 'linhas sem tabela identificada', null, orphans, null));
  }

  return out;
}

function matchesFilter(e, q) {
  if (!q) { return true; }
  // Casa nome cru, nome logico e valor: procurar pelo valor que se ve na tela
  // para descobrir de que campo ele veio e um dos usos principais.
  return String(e.raw).toLowerCase().indexOf(q) >= 0 ||
    String(e.name).toLowerCase().indexOf(q) >= 0 ||
    String(e.value).toLowerCase().indexOf(q) >= 0;
}

// ---------------------------------------------------------------------------
// Grid — render
// ---------------------------------------------------------------------------

// Estado do campo vira faixa na borda esquerda + rotulo na coluna tipo. Sem
// pilula: da para varrer a coluna sem ler nenhuma palavra.
function stateClass(e) {
  if (e.disabled) { return 'st-off'; }
  if (e.type === 'span') { return 'st-ro'; }
  if (e.type === 'hidden') { return 'st-hid'; }
  return '';
}

function typeLabel(e) {
  if (e.disabled) { return 'off (_)'; }
  if (e.type === 'span') { return 'span ro'; }
  return e.type || '?';
}

// Destaca as partes que NAO fazem parte do nome logico (o "_" de desabilitado e
// o "___N" da linha), porque e exatamente onde mora a confusao do Fluig.
function nameHtml(e) {
  var raw = String(e.raw);
  var head = '';
  var tail = '';
  if (/^_/.test(raw)) { head = '<span class="pre">_</span>'; raw = raw.slice(1); }
  var m = raw.match(/___(\d+)$/);
  if (m) { tail = '<span class="pre">___' + esc(m[1]) + '</span>'; raw = raw.slice(0, -m[0].length); }
  return head + esc(raw) + tail;
}

function rowTitle(e) {
  var parts = ['name/id: ' + e.raw, 'nome lógico: ' + e.name, 'tipo: ' + typeLabel(e), 'frame: ' + e.frame];
  if (e.table) { parts.push('tabela: ' + e.table); }
  if (e.child != null) { parts.push('linha: ' + e.child); }
  return escAttr(parts.join(' · '));
}

function rowHtml(item, n) {
  var e = item.entry;
  var cls = ['gr'];
  var st = stateClass(e);
  if (st) { cls.push(st); }

  // Span nao e campo de formulario: setar no DOM troca so o texto exibido. O
  // aviso vai no title do botao, nao numa pilula na linha.
  var editTitle = e.type === 'span'
    ? 'Editar valor — no DOM altera só o texto exibido (span, não é campo de formulário)'
    : 'Editar valor (duplo clique na célula faz o mesmo)';

  return '<div class="' + cls.join(' ') + '" data-i="' + e.idx + '">' +
    '<div class="c-n">' + n + '</div>' +
    '<div class="c-name" title="' + rowTitle(e) + '">' + nameHtml(e) + '</div>' +
    '<div class="c-type">' + esc(typeLabel(e)) + '</div>' +
    '<div class="c-val" data-edit data-i="' + e.idx + '">' + cellValueHtml(e.value) + '</div>' +
    '<div class="c-acts">' +
    '<button class="abtn" type="button" data-act="edit" title="' + escAttr(editTitle) + '">setar</button>' +
    '<button class="abtn" type="button" data-act="copy" title="Copiar o name/id cru (com o _ e o ___N)">nome</button>' +
    '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Grid — planilha de tabela pai-filho
// ---------------------------------------------------------------------------

// Como o agrupamento foi decidido. Aparece na banda porque um agrupamento torto
// e quase sempre falta de `tablename` — e o usuario precisa poder ver isso.
var HOW_LABEL = {
  tablename: '',
  id: 'agrupada pelo id da tabela',
  posicao: 'sem tablename — agrupada pela posição da tabela',
  container: 'sem <table> — agrupada pelo container'
};

// A contagem e de linhas de DADOS. A linha modelo, quando existe, e anunciada
// separada — ela nao e uma linha da tabela, e somar as duas coisas fazia a banda
// dizer "3 linha(s)" para uma tabela de 2.
//
// `shownData` = linhas de dados desenhadas; `totalData` = as que passaram o
// filtro. Quando os dois diferem a banda DIZ isso — foi a divergencia silenciosa
// entre eles que fez tabela truncada parecer tabela que não abre.
function bandHtml(sheet, shownData, totalData, collapsed, tplShown) {
  var head = sheet.key
    ? 'tabela <b>' + esc(sheet.label) + '</b>'
    : '<b>' + esc(sheet.label) + '</b>';

  var counts;
  if (collapsed || shownData === totalData) {
    counts = totalData + ' linha(s)';
  } else {
    counts = 'mostrando ' + shownData + ' de ' + totalData + ' linha(s)';
  }
  counts += ' · ' + sheet.cols.length + ' campo(s)';

  var notes = '';
  if (sheet.dataRows === 0) {
    // Tabela identificada mas sem nenhum registro. Aparece na lista de tabelas
    // com o cabecalho das colunas — some-la faria seus campos parecerem campos
    // simples soltos, que era exatamente o problema.
    notes += ' <span class="note">sem registros' + (tplShown ? ' — só a linha modelo' : '') + '</span>';
  } else if (tplShown) {
    counts += ' · + modelo';
  }

  var how = HOW_LABEL[sheet.how];
  if (how) { notes += ' <span class="how">' + esc(how) + '</span>'; }
  if (!collapsed && shownData === 0 && totalData > 0) {
    notes += ' <span class="how">teto de render — refine o filtro</span>';
  } else if (!collapsed && shownData < totalData) {
    notes += ' <span class="how">teto de render</span>';
  }

  var title = sheet.tplOmitted
    ? 'linha modelo omitida: ' + sheet.tplOmitted + ' campo(s) sem ___N, todos vazios ' +
      '(continuam no JSON e no autocomplete)'
    : 'clique para colapsar/expandir';

  return '<button class="band" type="button" data-band="' + escAttr(sheet.key) +
    '" title="' + escAttr(title) + '" aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
    '<span class="tw" aria-hidden="true">' + (collapsed ? '▸' : '▾') + '</span> ' +
    head + ' · ' + counts + notes +
    '</button>';
}

// Template de colunas da planilha. Coluna que o usuario arrastou tem largura fixa
// em px; as intocadas seguem `minmax(104px, 1fr)` — encolhem ate o minimo e,
// passando disso, a planilha rola na horizontal dentro do proprio bloco, para o
// painel nunca rolar de lado.
function sheetColsTemplate(sheet) {
  var w = colWidths[sheet.key] || {};
  var parts = ['46px'];
  sheet.cols.forEach(function (c) {
    parts.push(w[c] ? w[c] + 'px' : 'minmax(104px, 1fr)');
  });
  return parts.join(' ');
}

function sheetHtml(sheet, rows) {
  var heights = rowHeights[sheet.key] || {};

  var head = '<div class="sh-row sh-h">' +
    '<div class="sh-rh" title="número da linha (___N)">___</div>' +
    sheet.cols.map(function (c) {
      var ty = sheet.colType[c] || '';
      return '<div class="sh-hc" title="' + escAttr(c + (ty ? ' · ' + ty : '') +
        ' — arraste a borda direita para mudar a largura, duplo clique volta ao automático') + '">' +
        esc(c) + (ty ? '<span class="ty">' + esc(ty) + '</span>' : '') +
        '<span class="sh-grip-x" data-grip-col="' + escAttr(c) + '"></span>' +
        '</div>';
    }).join('') +
    '</div>';

  var body = rows.map(function (r) {
    var cells = sheet.cols.map(function (c) {
      var e = r.cells[c];
      if (!e) {
        // Campo que existe em outras linhas mas nao nesta: buraco explicito, nao
        // celula vazia — vazio e um valor possivel e nao pode ser confundido.
        return '<div class="sh-c sh-null" title="campo ausente nesta linha">—</div>';
      }
      var st = stateClass(e);
      return '<div class="sh-c' + (st ? ' ' + st : '') + '" data-edit data-i="' + e.idx +
        '" title="' + rowTitle(e) + '">' + cellValueHtml(e.value) + '</div>';
    }).join('');

    var rhTitle = (r.template
      ? 'linha modelo da tabela — campos sem o sufixo ___N, que o Fluig usa de molde'
      : 'linha ___' + r.label) +
      ' — arraste a borda de baixo para mudar a altura, duplo clique volta ao automático';

    var h = heights[r.id];
    var cls = 'sh-row' + (r.template ? ' sh-tpl' : '') + (h ? ' sh-fixed' : '');

    return '<div class="' + cls + '"' + (h ? ' style="height: ' + h + 'px"' : '') + '>' +
      '<div class="sh-rh" title="' + escAttr(rhTitle) + '"><span>' + esc(r.label) + '</span>' +
      '<button class="sh-copy" type="button" data-sheet-row="' + escAttr(sheet.key) + '|' + escAttr(r.id) +
      '" title="Copiar esta linha como JSON" aria-label="copiar linha ' + escAttr(r.label) + '">⧉</button>' +
      '<span class="sh-grip-y" data-grip-row="' + escAttr(r.id) + '"></span>' +
      '</div>' + cells +
      '</div>';
  }).join('');

  return '<div class="sheet" data-key="' + escAttr(sheet.key) + '" style="--shcols: ' +
    sheetColsTemplate(sheet) + '">' + head + body + '</div>';
}

function countData(rows) {
  var n = 0;
  rows.forEach(function (r) { if (!r.template) { n++; } });
  return n;
}

// O filtro casa no "cabecalho" da planilha — nome da tabela ou nome de coluna.
// Nesses casos a tabela INTEIRA interessa (e o unico jeito de achar uma tabela
// sem registro nenhum, que nao tem celula para casar).
function sheetHeadMatches(sheet, q) {
  if (String(sheet.label).toLowerCase().indexOf(q) >= 0) { return true; }
  return sheet.cols.some(function (c) { return c.toLowerCase().indexOf(q) >= 0; });
}

// Filtro numa planilha: casa o cabecalho (tabela inteira) ou, por linha, qualquer
// celula.
function sheetVisibleRows(sheet, q) {
  if (!q) { return sheet.rows; }
  if (sheetHeadMatches(sheet, q)) { return sheet.rows; }
  return sheet.rows.filter(function (r) {
    return sheet.cols.some(function (c) {
      var e = r.cells[c];
      return e && matchesFilter(e, q);
    });
  });
}

// O cabecalho "campo | tipo | valor" descreve as linhas de campo simples. Com
// so planilhas na tela (filtro que casa apenas em tabela), ele descreveria
// nada — e uma planilha tem cabecalho proprio.
function showGridHead(on) {
  el('grid-head').style.display = on ? '' : 'none';
}

function renderGrid() {
  var body = el('grid-body');
  var q = el('grid-filter').value.trim().toLowerCase();

  if (model.scanning && !model.entries.length) {
    body.innerHTML = '<div class="gempty">Varrendo a página…</div>';
    showGridHead(false);
    return;
  }
  if (model.error && !model.entries.length) {
    body.innerHTML = '<div class="gempty"><b>Não consegui varrer a página.</b><br />' + esc(model.error) +
      '<br />Recarregue o formulário e clique em <b>↻ revarrer</b>.</div>';
    el('grid-count').textContent = '';
    el('grid-meta').textContent = '';
    showGridHead(false);
    return;
  }
  if (!model.entries.length) {
    body.innerHTML = '<div class="gempty">Nenhum campo encontrado nesta página. ' +
      'Abra a extensão sobre um formulário Fluig e clique em <b>↻ revarrer</b>.</div>';
    el('grid-count').textContent = '';
    el('grid-meta').textContent = '';
    showGridHead(false);
    return;
  }

  var items = displayList();
  lastSheets = {};

  var html = '';
  var flatN = 0;       // numeracao visivel dos campos simples
  var shown = 0;       // celulas desenhadas (campo simples + celula de planilha)
  var hidden = 0;      // campos simples cortados pelo teto
  var hiddenRows = 0;  // linhas de planilha cortadas pelo teto
  var tablesCut = 0;   // tabelas que nao couberam com nenhuma linha

  items.forEach(function (item) {
    if (item.kind === 'row') {
      if (!matchesFilter(item.entry, q)) { return; }
      if (shown >= GRID_RENDER_MAX) { hidden++; return; }
      flatN++;
      shown++;
      html += rowHtml(item, flatN);
      return;
    }

    // planilha
    //
    // Tabela sem registro nenhum nao precisa de caminho proprio: ela chega aqui
    // com a linha modelo como unica linha, entao `dataTotal` da 0 e a banda diz
    // "sem registros" — o cabecalho das colunas ja mostra a forma da tabela.
    lastSheets[item.key] = item;
    var rows = sheetVisibleRows(item, q);
    if (!rows.length) { return; }

    var dataTotal = countData(rows);

    // Colapsada (o padrao): mostra so a banda, que e o que permite abrir. Filtro
    // ativo ignora o colapso — quem filtrou quer ver o que casou, onde estiver.
    if (!expandedTables[item.key] && !q) {
      html += bandHtml(item, 0, dataTotal, true, false);
      return;
    }

    // Corta SEMPRE em linhas inteiras: meia linha de planilha nao ajuda ninguem.
    var slice = rows;
    if (slice.length > SHEET_ROW_MAX) { slice = slice.slice(0, SHEET_ROW_MAX); }

    var perRow = Math.max(1, item.cols.length);
    if (shown + slice.length * perRow > GRID_RENDER_MAX) {
      var fit = Math.max(0, Math.floor((GRID_RENDER_MAX - shown) / perRow));
      slice = slice.slice(0, fit);
    }

    hiddenRows += rows.length - slice.length;
    if (!slice.length) {
      tablesCut++;
      html += bandHtml(item, 0, dataTotal, false, false);
      return;
    }
    shown += slice.length * perRow;
    var tplShown = slice.some(function (r) { return r.template; });
    html += bandHtml(item, countData(slice), dataTotal, false, tplShown) + sheetHtml(item, slice);
  });

  if (!html) {
    body.innerHTML = '<div class="gempty">Nenhum campo casa com <b>' + esc(q) + '</b>.</div>';
    el('grid-count').textContent = '0 de ' + model.entries.length;
    showGridHead(false);
    return;
  }

  // Rodape so aparece quando ALGO foi cortado, e diz o que — na mesma unidade em
  // que o corte aconteceu (campo simples, linha de tabela, tabela inteira).
  if (hidden || hiddenRows || tablesCut) {
    var parts = [];
    if (hidden) { parts.push(hidden + ' campo(s) simples'); }
    if (hiddenRows) { parts.push(hiddenRows + ' linha(s) de tabela'); }
    if (tablesCut) { parts.push(tablesCut + ' tabela(s) sem nenhuma linha'); }
    html += '<div class="gfoot">Teto de render: ' + parts.join(', ') +
      ' fora da tela — refine o filtro ou colapse as tabelas que não interessam.</div>';
  }

  body.innerHTML = html;
  showGridHead(flatN > 0);

  var total = model.entries.length;
  el('grid-count').textContent = q ? shown + ' de ' + total : String(total) + ' ocorrência(s)';

  var tables = {};
  var offs = 0;
  var iframes = 0;
  model.entries.forEach(function (e) {
    if (e.tableKey) { tables[e.tableKey] = 1; }
    if (e.disabled) { offs++; }
    if (e.frame !== 'top') { iframes++; }
  });
  var metaParts = [Object.keys(tables).length + ' tabela(s)', offs + ' desabilitado(s)'];
  if (iframes) { metaParts.push(iframes + ' em iframe'); }
  el('grid-meta').textContent = metaParts.join(' · ');
  setStatusInfo(model.at ? 'varrido ' + hhmmss(model.at) : '');
}

// A celula editavel de uma ocorrencia, seja no grid plano (`.c-val`) ou numa
// planilha de tabela (`.sh-c`). Os dois caminhos carregam `data-edit` +
// `data-i`, entao tudo que edita/repinta/destaca fala com um contrato so.
function cellFor(idx) {
  return el('grid-body').querySelector('[data-edit][data-i="' + idx + '"]');
}

// Onde a faixa de estado e o destaque moram: a linha inteira no grid plano, a
// propria celula na planilha (uma linha de planilha tem varios campos, com
// estados diferentes).
function hostFor(cell) {
  if (!cell) { return null; }
  if (cell.classList.contains('sh-c')) { return cell; }
  return cell.closest ? cell.closest('.gr') : null;
}

// Repinta UMA celula (depois de um set / de uma leitura) sem reconstruir o grid:
// re-render perderia o scroll e o foco.
function repaintCell(idx) {
  var cell = cellFor(idx);
  if (!cell) { return; }
  var e = model.entries[idx];
  cell.innerHTML = cellValueHtml(e.value);
  var host = hostFor(cell);
  if (!host) { return; }
  host.className = host.className.replace(/\s*st-\w+/g, '');
  var st = stateClass(e);
  if (st) { host.classList.add(st); }
}

// ---------------------------------------------------------------------------
// Planilha — redimensionar coluna e linha no arraste
// ---------------------------------------------------------------------------
//
// Alca de 5px na borda direita do cabecalho da coluna (largura) e na borda de
// baixo do numero da linha (altura), do jeito que se faz numa planilha. Fica no
// cabecalho e no numero da linha em vez de na borda de qualquer celula porque uma
// faixa sensivel no meio da grade roubaria o duplo clique que abre o editor.
//
// Durante o arraste o ajuste vai DIRETO no elemento (variavel CSS / height), sem
// re-render: re-render a cada mousemove perderia o scroll e engasgaria.

var dragging = null;

// Ao arrastar a primeira coluna, congela TODAS as larguras atuais em px. Sem
// isso, encolher uma coluna faria as vizinhas em `1fr` se esticarem para ocupar o
// espaco, e a coluna arrastada pareceria nao mudar de tamanho.
function lockColumnWidths(sheetEl, key) {
  var sheet = lastSheets[key];
  if (!sheet) { return; }
  var current = colWidths[key] || {};
  var heads = sheetEl.querySelectorAll('.sh-hc');
  sheet.cols.forEach(function (c, i) {
    if (current[c]) { return; }
    var head = heads[i];
    current[c] = head ? Math.round(head.offsetWidth) : 104;
  });
  colWidths[key] = current;
}

function applyColumnWidths(sheetEl, key) {
  var sheet = lastSheets[key];
  if (!sheet) { return; }
  sheetEl.style.setProperty('--shcols', sheetColsTemplate(sheet));
}

function startGripDrag(e) {
  var gripCol = e.target.closest ? e.target.closest('[data-grip-col]') : null;
  var gripRow = e.target.closest ? e.target.closest('[data-grip-row]') : null;
  if (!gripCol && !gripRow) { return; }

  var grip = gripCol || gripRow;
  var sheetEl = grip.closest('.sheet');
  if (!sheetEl) { return; }
  var key = sheetEl.getAttribute('data-key');

  e.preventDefault();
  closeEditor(true);

  if (gripCol) {
    var col = gripCol.getAttribute('data-grip-col');
    lockColumnWidths(sheetEl, key);
    dragging = {
      kind: 'col', key: key, col: col, sheetEl: sheetEl,
      from: e.clientX, start: colWidths[key][col]
    };
  } else {
    var rowEl = gripRow.closest('.sh-row');
    dragging = {
      kind: 'row', key: key, id: gripRow.getAttribute('data-grip-row'), rowEl: rowEl,
      from: e.clientY, start: rowEl.offsetHeight
    };
  }
  document.body.setAttribute('data-dragging', dragging.kind);
}

function moveGripDrag(e) {
  if (!dragging) { return; }
  if (dragging.kind === 'col') {
    var w = Math.max(COL_MIN_PX, Math.round(dragging.start + (e.clientX - dragging.from)));
    colWidths[dragging.key][dragging.col] = w;
    applyColumnWidths(dragging.sheetEl, dragging.key);
    return;
  }
  var h = Math.max(ROW_MIN_PX, Math.round(dragging.start + (e.clientY - dragging.from)));
  rowHeights[dragging.key] = rowHeights[dragging.key] || {};
  rowHeights[dragging.key][dragging.id] = h;
  dragging.rowEl.style.height = h + 'px';
  // Altura explicita manda mais que o clamp global: o corte passa a ser a caixa
  // da linha, entao o texto revelado acompanha o arraste.
  dragging.rowEl.classList.add('sh-fixed');
}

function endGripDrag() {
  if (!dragging) { return; }
  var d = dragging;
  dragging = null;
  document.body.removeAttribute('data-dragging');
  if (d.kind === 'col') {
    setStatus('', 'coluna <b>' + esc(d.col) + '</b> com ' + colWidths[d.key][d.col] +
      'px — duplo clique na alça volta ao automático');
  } else {
    setStatus('', 'linha <b>' + esc(d.id === 'tpl' ? 'modelo' : d.id) + '</b> com ' +
      rowHeights[d.key][d.id] + 'px — duplo clique na alça volta ao automático');
  }
}

// Duplo clique na alca devolve o dimensionamento automatico.
function resetGrip(e) {
  var gripCol = e.target.closest ? e.target.closest('[data-grip-col]') : null;
  var gripRow = e.target.closest ? e.target.closest('[data-grip-row]') : null;
  if (!gripCol && !gripRow) { return false; }
  var sheetEl = (gripCol || gripRow).closest('.sheet');
  if (!sheetEl) { return false; }
  var key = sheetEl.getAttribute('data-key');

  if (gripCol) {
    var col = gripCol.getAttribute('data-grip-col');
    if (colWidths[key]) { delete colWidths[key][col]; }
    setStatus('', 'largura de <b>' + esc(col) + '</b> de volta ao automático.');
  } else {
    var id = gripRow.getAttribute('data-grip-row');
    if (rowHeights[key]) { delete rowHeights[key][id]; }
    setStatus('', 'altura da linha de volta ao automático.');
  }
  renderGrid();
  return true;
}

// Copia UMA linha da planilha como JSON `{campo: valor}`. Numa tabela pai-filho
// o que se quer levar para fora quase nunca e um campo isolado — e a linha, para
// comparar com outra ou colar como contexto.
function copySheetRow(token) {
  var at = String(token).lastIndexOf('|');
  if (at < 0) { return; }
  var key = token.slice(0, at);
  var child = token.slice(at + 1);
  var sheet = lastSheets[key];
  if (!sheet) { return; }

  var row = null;
  for (var i = 0; i < sheet.rows.length; i++) {
    if (String(sheet.rows[i].id) === child) { row = sheet.rows[i]; break; }
  }
  if (!row) { return; }

  var out = {};
  sheet.cols.forEach(function (c) {
    var e = row.cells[c];
    if (e) { out[c] = e.value; }
  });

  copyWithFeedback(JSON.stringify(out, null, 2),
    'Linha <code>' + esc(row.label) + '</code> de <code>' + esc(sheet.label) + '</code>');
}

// ---------------------------------------------------------------------------
// Grid — editor de valor (faixa no rodape)
// ---------------------------------------------------------------------------
//
// UM editor so, sempre no rodape do painel — nunca dentro da celula.
//
// Antes havia dois: um <input> in-place para valor curto e a faixa do rodape para
// valor longo. Editar in-place nao sobrevive a largura real de uso: acoplado na
// LATERAL do DevTools a celula tem ~120px, e ali nao cabem input + valor riscado
// + botoes DOM/banco. O editor mudava de lugar conforme o tamanho do valor, o que
// tambem tira a previsibilidade — duplo clique tem de abrir SEMPRE a mesma coisa,
// no mesmo lugar.
//
// A celula nao e esvaziada: continua mostrando o valor atual, destacada, enquanto
// se edita (igual planilha com barra de formulas). Por isso o "valor de antes"
// nao precisa ser repetido dentro do editor.
//
// O editor E a confirmacao do set no DOM: nada e aplicado sem clicar em DOM (ou
// Ctrl+Enter). Gravar no banco nao tem desfazer, entao esse caminho ganha um
// passo explicito proprio (faixa de confirmacao ambar).

var editing = null; // { idx, cell, host }

function closeEditor(silent) {
  if (!editing) { return; }
  var idx = editing.idx;
  var host = editing.host;
  editing = null;
  el('veditor').removeAttribute('data-on');
  repaintCell(idx);
  if (host) { host.classList.remove('on'); }
  if (!silent) { setStatus('', 'Edição cancelada.'); }
}

function openEditor(idx, prefill) {
  var e = model.entries[idx];
  if (!e) { return; }
  var cell = cellFor(idx);
  if (!cell) {
    setStatus('warn', 'A célula de <b>' + esc(e.raw) + '</b> não está visível — limpe o filtro.');
    return;
  }
  if (editing && editing.idx === idx) { el('ve-text').focus(); return; }
  closeEditor(true);
  // Um destaque por vez: o da celula em edicao substitui o de uma leitura
  // anterior, senao ficam dois destaques azuis sem relacao entre si.
  clearHighlight();

  var current = prefill != null ? prefill : e.value;
  var host = hostFor(cell);

  editing = { idx: idx, cell: cell, host: host };
  if (host) {
    host.classList.add('on');
    // A celula editada tem de estar VISIVEL: o valor atual dela e a referencia do
    // que se esta trocando, e o destaque e a unica pista de qual linha o editor
    // do rodape esta mexendo.
    if (host.scrollIntoView) { host.scrollIntoView({ block: 'nearest' }); }
  }

  el('ve-name').textContent = e.raw;
  el('ve-name').title = e.raw + ' · ' + typeLabel(e) + ' · frame ' + e.frame;
  el('ve-meta').textContent = typeLabel(e) + ' · ' + current.length +
    ' caractere(s) · Ctrl+Enter aplica no DOM · Esc cancela';

  var ta = el('ve-text');
  ta.value = current;
  ta.setAttribute('aria-label', 'novo valor de ' + e.raw);
  el('veditor').setAttribute('data-on', '');

  // Altura pelo conteudo, com teto: passando disso o proprio textarea rola, e o
  // usuario ainda pode esticar (resize vertical nativo).
  //
  // Zera antes de medir: com a altura em 0 o scrollHeight e exatamente a altura do
  // conteudo na largura atual. Com height:auto um textarea cai na altura de `rows`,
  // e a medida passa a depender disso.
  ta.style.height = '0px';
  var wanted = ta.scrollHeight + 2;
  var max = Math.round((window.innerHeight || 600) * 0.45);
  ta.style.height = Math.min(Math.max(wanted, 46), max) + 'px';

  ta.focus();
  // Valor de uma linha: seleciona tudo, porque trocar o valor inteiro e o caso
  // comum. Valor multilinha: caret no inicio, sem selecionar — ali se mexe num
  // trecho, e select-all faria a primeira tecla apagar mil caracteres.
  try {
    if (current.indexOf('\n') >= 0) { ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
    else { ta.select(); }
  } catch (err) {}

  el('btn-ve-dom').title = e.type === 'span'
    ? 'Altera só o texto exibido (span, não é campo de formulário)'
    : 'Aplica $(campo).val(valor) — sem disparar change/blur';

  setStatus('', 'Editando <b>' + esc(e.raw) + '</b> — Ctrl+Enter aplica no DOM, Esc cancela.');
}

function applyDomSet(idx, value) {
  var e = model.entries[idx];
  if (!e) { return; }
  var before = e.value;
  // Fecha o editor sem o repaint do closeEditor (o valor novo so chega depois do
  // eval). O destaque da celula FICA — e a pista de qual linha acabou de mudar.
  if (editing && editing.idx === idx) { el('veditor').removeAttribute('data-on'); }
  editing = null;
  setStatus('busy', 'Aplicando em <b>' + esc(e.raw) + '</b>…');

  evalInPage(buildSetExpr(e.raw, value))
    .then(function (result) {
      if (!result || result.setCount === 0) {
        repaintCell(idx);
        setStatus('err', 'Nada foi alterado — <code>' + esc(e.raw) +
          '</code> não estava mais na página. Clique em ↻ revarrer.');
        return;
      }
      // Valor novo = read-back (o que de fato ficou no campo), nao o pedido.
      e.value = result.readBack == null ? '' : String(result.readBack);
      repaintCell(idx);
      pushHistory({
        kind: 'set',
        label: e.raw,
        from: before,
        to: e.value,
        fieldName: e.raw,
        oldValue: before,
        canRestore: true
      });
      setStatus('ok', '<b>' + esc(e.raw) + '</b> setado no DOM (' + result.setCount +
        ' elemento(s), ' + esc(result.frame) + '): ' + renderValue(before) + ' → ' + renderValue(e.value));
    })
    .catch(function (err) {
      repaintCell(idx);
      setStatus('err', 'Erro ao aplicar em <b>' + esc(e.raw) + '</b>: ' + esc(describeFailure(err)));
    });
}

// ---------------------------------------------------------------------------
// Gravacao no banco — confirmacao explicita
// ---------------------------------------------------------------------------

var pendingDbSet = null;

// Nome que vai para o dsSetCardValue. Tira SO o "_" de desabilitado, que e
// artefato de DOM e nunca faz parte do nome do campo no banco. O "___N" fica: o
// dsSetCardValue nao tem conceito de linha, entao mandar o nome cru e o mesmo
// que o usuario digitaria — nao inventamos um mapeamento que a plataforma nao
// garante. A faixa de confirmacao avisa quando e linha de tabela.
function dbFieldName(raw) {
  return String(raw).replace(/^_/, '');
}

function ensureDocInfo() {
  if (docInfo && docInfo.ok) { return Promise.resolve(docInfo); }
  if (docPending) { return docPending; }
  docPending = evalInPage(buildDocumentIdExpr())
    .then(function (result) {
      docPending = null;
      docInfo = result || { ok: false, message: 'Sem retorno da página.' };
      paintDocInfo();
      return docInfo;
    })
    .catch(function (err) {
      docPending = null;
      docInfo = { ok: false, message: 'Erro ao resolver: ' + describeFailure(err) };
      paintDocInfo();
      return docInfo;
    });
  return docPending;
}

function askDbSet(idx, value) {
  var e = model.entries[idx];
  if (!e) { return; }
  closeEditor(true);
  setStatus('busy', 'Resolvendo o documentId…');

  ensureDocInfo().then(function (info) {
    if (!info || !info.ok || !info.documentId) {
      setStatus('err', 'Não consegui resolver o documentId: ' + esc((info && info.message) || 'sem retorno'));
      return;
    }
    pendingDbSet = {
      idx: idx,
      documentId: info.documentId,
      numProcess: info.numProcess,
      fieldName: dbFieldName(e.raw),
      value: value,
      previousDom: e.value,
      isChild: e.child != null
    };
    showDbConfirm(pendingDbSet);
  });
}

function showDbConfirm(p) {
  var rows = [
    ['solicitação', esc(p.numProcess)],
    ['documentId', esc(p.documentId)],
    ['campo', esc(p.fieldName)],
    ['atual (DOM)', renderValue(p.previousDom)],
    ['novo', renderValue(p.value)]
  ];
  var html = rows.map(function (r) {
    return '<span class="cf-i"><span>' + r[0] + '</span><code>' + r[1] + '</code></span>';
  }).join('');

  if (p.isChild) {
    html += '<span class="cf-i"><span>atenção</span>' +
      '<span class="warn">linha de tabela — o <code>dsSetCardValue</code> não tem conceito de linha, ' +
      'o nome vai com o <code>___N</code></span></span>';
  }

  el('confirm-title').textContent = 'Gravar no banco (dsSetCardValue) — sem desfazer';
  el('confirm-rows').innerHTML = html;
  el('confirm-bar').setAttribute('data-on', '');
  el('btn-confirm-yes').focus();
  setStatus('warn', 'Confirme a gravação no banco — ignora o DOM e as validações do formulário.');
}

function hideDbConfirm() {
  el('confirm-bar').removeAttribute('data-on');
  el('confirm-rows').innerHTML = '';
}

function applyDbSet() {
  if (!pendingDbSet) { hideDbConfirm(); return; }
  var p = pendingDbSet;
  pendingDbSet = null;
  hideDbConfirm();
  setStatus('busy', 'Gravando <b>' + esc(p.fieldName) + '</b> no banco…');

  evalInPage(buildDbSetExpr(p.documentId, p.fieldName, p.value))
    .then(function (result) {
      if (!result || !result.ok) {
        setStatus('err', 'Falha ao gravar: ' + esc((result && result.message) || 'sem retorno'));
        return;
      }
      pushHistory({
        kind: 'dbset',
        label: result.fieldName,
        from: p.previousDom,
        to: result.fieldValue,
        fieldName: result.fieldName,
        oldValue: p.previousDom,
        documentId: result.documentId,
        canRestore: true
      });
      setStatus('ok', '<b>' + esc(result.fieldName) + '</b> gravado no banco (doc ' +
        esc(result.documentId) + '): ' + renderValue(p.previousDom) + ' → ' + renderValue(result.fieldValue) +
        ' — recarregue o formulário para ver o valor atualizado.');
    })
    .catch(function (err) {
      setStatus('err', 'Erro ao gravar: ' + esc(describeFailure(err)));
    });
}

// ---------------------------------------------------------------------------
// Prompt — ler campo pelo nome
// ---------------------------------------------------------------------------
//
// Le da PAGINA (nao do grid): o ponto de "ler" e saber o valor de AGORA. O
// resultado atualiza o modelo, destaca a(s) linha(s) no grid e vai para a status
// bar. Assim "ler" tambem serve de "achar onde esse campo esta na lista".

function readByName(typed) {
  var name = String(typed || '').trim();
  if (!name) {
    setStatus('warn', 'Digite o nome de um campo no prompt.');
    el('cmd-input').focus();
    return;
  }

  setStatus('busy', 'Procurando <b>' + esc(name) + '</b> na página…');

  evalInPage(buildFindExpr(name))
    .then(function (result) {
      var matches = (result && result.matches) || [];
      if (!matches.length) {
        clearHighlight();
        setStatus('err', '<b>' + esc(name) + '</b> não encontrado em ' +
          esc((result && result.framesScanned) || 0) + ' frame(s). Confira o nome ou clique em ↻ revarrer.');
        return;
      }

      // A leitura e autoritativa: atualiza o valor no modelo e na linha.
      var touched = [];
      var missing = 0;
      matches.forEach(function (m) {
        var found = null;
        for (var i = 0; i < model.entries.length; i++) {
          if (model.entries[i].raw === m.name) { found = model.entries[i]; break; }
        }
        if (!found) { missing++; return; }
        found.value = m.value;
        touched.push(found.idx);
        repaintCell(found.idx);
      });

      var painted = highlight(touched);

      var head = matches.length === 1
        ? '<b>' + esc(matches[0].name) + '</b> = ' + renderValue(matches[0].value)
        : '<b>' + esc(name) + '</b> · ' + matches.length + ' ocorrência(s): ' +
          matches.slice(0, 4).map(function (m) {
            return esc(m.name) + '=' + renderValue(m.value);
          }).join(' · ') + (matches.length > 4 ? ' …' : '');

      var tail = '';
      if (missing) {
        tail = ' — ' + missing + ' ocorrência(s) fora da varredura, clique em ↻ revarrer';
      } else if (!painted && touched.length) {
        tail = ' — a linha está escondida pelo filtro';
      }

      setStatus('ok', head + tail);
      pushHistory({
        kind: 'read',
        label: name,
        to: matches.length === 1 ? matches[0].value : matches.length + ' ocorrência(s)',
        signature: matches.map(function (m) { return m.name + '=' + m.value; }).join('|'),
        canRestore: false
      });
    })
    .catch(function (err) {
      setStatus('err', 'Erro ao ler <b>' + esc(name) + '</b>: ' + esc(describeFailure(err)));
    });
}

function clearHighlight() {
  var on = el('grid-body').querySelectorAll('.on');
  for (var i = 0; i < on.length; i++) { on[i].classList.remove('on'); }
}

// Devolve quantas linhas de fato foram destacadas: pode ser menos que o pedido
// (filtro ativo, teto de render, tabela colapsada), e a status bar precisa dizer
// isso — senao a leitura "funciona" sem nada visivel acontecer no grid.
function highlight(idxs) {
  clearHighlight();
  var first = null;
  var painted = 0;
  idxs.forEach(function (idx) {
    var host = hostFor(cellFor(idx));
    if (!host) { return; }
    host.classList.add('on');
    painted++;
    if (!first) { first = host; }
  });
  if (first && first.scrollIntoView) { first.scrollIntoView({ block: 'center' }); }
  return painted;
}

// ---------------------------------------------------------------------------
// Autocomplete do prompt
// ---------------------------------------------------------------------------
//
// O indice e DERIVADO da varredura (model.entries), nao de uma segunda coleta:
//   fields — um item por NOME LOGICO, que e o que o usuario digita no dia a dia
//            (a extensao resolve o "_" e o "___N" sozinha).
//   rows   — um item por ocorrencia ___N (name cru). Usada so quando o usuario
//            digita "___" para mirar uma linha especifica de tabela pai-filho.

function deriveIndex() {
  var groups = {};
  var order = [];
  var rows = [];
  var rowSeen = {};

  model.entries.forEach(function (e) {
    var lg = e.name;
    if (!lg) { return; }
    var g = groups[lg];
    if (!g) {
      g = {
        logical: lg,
        occurrences: 0,
        rowCount: 0,
        disabled: false,
        type: e.type,
        table: e.table,
        value: ellipsis(e.value, VALUE_PREVIEW_MAX)
      };
      groups[lg] = g;
      order.push(lg);
    }
    g.occurrences++;
    if (e.child != null) { g.rowCount++; }
    if (e.disabled) { g.disabled = true; }
    if (!g.table && e.table) { g.table = e.table; }
    // Campo espelhado do Fluig costuma ter uma copia vazia: prefere o primeiro
    // valor NAO vazio para o preview nao mentir "vazio".
    if (!g.value && e.value) { g.value = ellipsis(e.value, VALUE_PREVIEW_MAX); }

    if (e.child != null && !rowSeen[e.raw]) {
      rowSeen[e.raw] = 1;
      rows.push({
        name: e.raw,
        logical: lg,
        child: e.child,
        table: e.table,
        disabled: e.disabled,
        type: e.type,
        value: ellipsis(e.value, VALUE_PREVIEW_MAX)
      });
    }
  });

  order.sort();
  rows.sort(function (a, b) {
    if (a.logical !== b.logical) { return a.logical < b.logical ? -1 : 1; }
    return Number(a.child) - Number(b.child);
  });

  return { fields: order.map(function (k) { return groups[k]; }), rows: rows };
}

// Filtra o indice pelo que foi digitado. Dois modos:
//   normal    — casa o NOME LOGICO; prefixo vem antes de substring no ranking.
//   por linha — disparado quando o texto contem "___": lista as ocorrencias
//               ___N. O que vem antes do "___" filtra o nome, o que vem depois
//               filtra o numero da linha (ex: "desc___1" -> linhas 1, 10, 11...).
function filterSuggestions(index, typed) {
  var q = String(typed || '').trim().toLowerCase();
  var sepAt = q.indexOf('___');

  if (sepAt >= 0) {
    var namePart = q.slice(0, sepAt);
    var childPart = q.slice(sepAt + 3);
    return (index.rows || []).filter(function (r) {
      if (namePart && String(r.logical).toLowerCase().indexOf(namePart) < 0) { return false; }
      if (childPart && String(r.child).indexOf(childPart) !== 0) { return false; }
      return true;
    }).map(function (r) { return { label: r.name, item: r, row: true }; });
  }

  var pool = index.fields || [];
  var picked;
  if (!q) {
    picked = pool;
  } else {
    var starts = [];
    var contains = [];
    pool.forEach(function (f) {
      var at = String(f.logical).toLowerCase().indexOf(q);
      if (at === 0) { starts.push(f); }
      else if (at > 0) { contains.push(f); }
    });
    picked = starts.concat(contains);
  }
  return picked.map(function (f) { return { label: f.logical, item: f, row: false }; });
}

// Uma instancia so (o prompt e o unico input de nome de campo agora). A lista
// NAO abre por foco: abre ao digitar ou com a seta para baixo, que serve de
// "me mostra tudo".
var ac = { shown: [], hidden: 0, active: -1, open: false };

function acClose() {
  ac.open = false;
  ac.active = -1;
  var box = el('cmd-ac');
  box.removeAttribute('data-on');
  box.innerHTML = '';
}

function acSuffix(s) {
  var item = s.item;
  var bits = [];
  if (s.row) { bits.push('linha ' + item.child); }
  else if (item.rowCount) { bits.push(item.rowCount + ' linha(s)'); }
  else if (item.occurrences > 1) { bits.push(item.occurrences + '×'); }
  if (item.table) { bits.push(item.table); }
  bits.push(item.type === 'span' ? 'span ro' : item.type);
  return bits.join(' · ');
}

function acDraw(typed) {
  var box = el('cmd-ac');
  var q = String(typed || '').trim().toLowerCase();
  var mark = q.indexOf('___') >= 0 ? '' : q;

  var head = '<div class="pop-h"><span>campos da página</span><span class="mono">' +
    ac.shown.length + (ac.hidden ? ' + ' + ac.hidden : '') + '</span></div>';

  if (!ac.shown.length) {
    box.innerHTML = head + '<div class="pop-f">nenhum campo casa com isso</div>';
    box.setAttribute('data-on', '');
    ac.open = true;
    return;
  }

  var body = ac.shown.map(function (s, i) {
    var label = esc(s.label);
    if (mark) {
      var at = s.label.toLowerCase().indexOf(mark);
      if (at >= 0) {
        label = esc(s.label.slice(0, at)) + '<em>' + esc(s.label.slice(at, at + mark.length)) +
          '</em>' + esc(s.label.slice(at + mark.length));
      }
    }
    return '<div class="ac-i' + (i === ac.active ? ' on' : '') + (s.item.disabled ? ' off' : '') +
      '" data-i="' + i + '">' +
      '<span class="nm">' + label + ' <span class="vl">' + esc(acSuffix(s)) + '</span></span>' +
      '<span class="vl">' + renderValue(s.item.value) + '</span>' +
      '</div>';
  }).join('');

  var foot = ['↑↓ navega', 'Enter lê', 'Tab completa', 'Esc fecha'];
  if (ac.hidden) { foot.push(ac.hidden + ' não exibido(s) — refine'); }
  if (ac.shown.some(function (s) { return !s.row && s.item.rowCount; })) {
    foot.push('___ mira uma linha');
  }

  box.innerHTML = head + body + '<div class="pop-f">' + foot.join(' · ') + '</div>';
  box.setAttribute('data-on', '');
  ac.open = true;
  acPaintActive();
}

function acPaintActive() {
  var items = el('cmd-ac').querySelectorAll('.ac-i');
  for (var i = 0; i < items.length; i++) {
    if (i === ac.active) { items[i].classList.add('on'); }
    else { items[i].classList.remove('on'); }
  }
  if (ac.active >= 0 && items[ac.active] && items[ac.active].scrollIntoView) {
    items[ac.active].scrollIntoView({ block: 'nearest' });
  }
}

function acRefresh() {
  // Sem varredura nao ha o que sugerir. Melhor nao abrir nada do que abrir um
  // "nenhum campo casa com isso" enganoso.
  if (!model.entries.length) { acClose(); return; }
  var input = el('cmd-input');
  var all = filterSuggestions(deriveIndex(), input.value);
  ac.hidden = Math.max(0, all.length - MAX_SUGGESTIONS);
  ac.shown = all.slice(0, MAX_SUGGESTIONS);
  if (ac.active >= ac.shown.length) { ac.active = ac.shown.length - 1; }
  acDraw(input.value);
}

function acPick(i) {
  if (i < 0 || i >= ac.shown.length) { return; }
  el('cmd-input').value = ac.shown[i].label;
  acClose();
}

// ---------------------------------------------------------------------------
// Historico
// ---------------------------------------------------------------------------
//
// Uma lista so, com o tipo da acao marcado (ler / DOM / banco). Efemero: vive em
// memoria do painel, some quando o DevTools fecha — mesmo principio da
// varredura. O valor de um historico de escrita e poder VOLTAR: cada entrada
// guarda o valor anterior, e "restaurar" devolve o anterior passando pelos
// mesmos passos de confirmacao.

// NAO chamar de `history`: panel.js roda em escopo global, e `window.history` (o
// History do navegador) e uma propriedade SEM setter. `var history = []` ali
// falha em silencio no modo sloppy — a variavel continua sendo o History, e o
// primeiro `history.unshift(...)` estoura "is not a function" DEPOIS de a leitura
// ou o set ja terem funcionado. O sintoma era o erro em cima de uma acao bem
// sucedida; o harness de teste nao pegava porque o sandbox nao tem window.
var HISTORY_MAX = 50;
var actionHistory = [];
var historySeq = 0;

var HISTORY_KIND = { read: 'ler', set: 'DOM', dbset: 'banco' };

function pushHistory(entry) {
  entry.id = ++historySeq;
  entry.at = new Date();
  entry.repeat = 1;

  // Leitura repetida do mesmo campo com o mesmo resultado colapsa em contador:
  // ler 5x para acompanhar um campo nao deve empurrar o resto do historico para
  // fora. Escrita nunca colapsa — cada gravacao e um evento proprio.
  if (entry.kind === 'read' && actionHistory.length) {
    var prev = actionHistory[0];
    if (prev.kind === 'read' && prev.label === entry.label && prev.signature === entry.signature) {
      prev.repeat++;
      prev.at = entry.at;
      paintHistoryButton();
      if (el('history-pop').hasAttribute('data-on')) { renderHistory(); }
      return;
    }
  }

  actionHistory.unshift(entry);
  if (actionHistory.length > HISTORY_MAX) { actionHistory.length = HISTORY_MAX; }
  paintHistoryButton();
  if (el('history-pop').hasAttribute('data-on')) { renderHistory(); }
}

function paintHistoryButton() {
  el('btn-history').textContent = actionHistory.length ? 'histórico (' + actionHistory.length + ')' : 'histórico';
}

function historyItemHtml(e) {
  var body;
  if (e.kind === 'read') {
    body = '<code>' + esc(e.label) + '</code> = ' + renderValue(e.to) +
      (e.repeat > 1 ? ' <span class="rep">' + e.repeat + '×</span>' : '');
  } else {
    body = '<code>' + esc(e.label) + '</code> ' + renderValue(e.from) +
      ' <span class="arrow">→</span> ' + renderValue(e.to);
  }

  var action = e.canRestore
    ? '<button class="abtn" type="button" data-hist-restore="' + e.id + '">restaurar</button>'
    : '<button class="abtn" type="button" data-hist-reread="' + e.id + '">ler</button>';

  return '<div class="hi k-' + e.kind + '">' +
    '<span class="ts">' + hhmmss(e.at) + '</span>' +
    '<span class="kd">' + HISTORY_KIND[e.kind] + '</span>' +
    '<span class="bd">' + body + '</span>' +
    action +
    '</div>';
}

function renderHistory() {
  var box = el('history-pop');
  var head = '<div class="pop-h"><span>histórico · só nesta sessão do DevTools</span>' +
    (actionHistory.length ? '<button class="abtn" type="button" data-hist-clear="1">limpar</button>' : '') +
    '</div>';

  if (!actionHistory.length) {
    box.innerHTML = head + '<div class="pop-f">nenhuma ação registrada ainda</div>';
    return;
  }
  box.innerHTML = head + actionHistory.map(historyItemHtml).join('');
}

function toggleHistory() {
  var box = el('history-pop');
  if (box.hasAttribute('data-on')) { box.removeAttribute('data-on'); return; }
  acClose();
  renderHistory();
  box.setAttribute('data-on', '');
}

function findHistoryEntry(id) {
  for (var i = 0; i < actionHistory.length; i++) {
    if (actionHistory[i].id === id) { return actionHistory[i]; }
  }
  return null;
}

// Restaurar: leva o valor ANTERIOR para o mesmo caminho de escrita da acao
// original — editor inline (DOM) ou faixa de confirmacao (banco). Um clique para
// chegar la; a alteracao em si continua exigindo o passo de confirmacao.
function restoreFromHistory(id) {
  var e = findHistoryEntry(id);
  if (!e || !e.canRestore) { return; }
  el('history-pop').removeAttribute('data-on');

  var idx = -1;
  for (var i = 0; i < model.entries.length; i++) {
    if (model.entries[i].raw === e.fieldName || dbFieldName(model.entries[i].raw) === e.fieldName) {
      idx = model.entries[i].idx;
      break;
    }
  }

  if (idx < 0) {
    el('cmd-input').value = e.fieldName;
    setStatus('warn', '<b>' + esc(e.fieldName) + '</b> não está mais no grid — clique em ↻ revarrer.');
    return;
  }

  if (e.kind === 'dbset') { askDbSet(idx, e.oldValue); return; }
  openEditor(idx, e.oldValue);
}

function rereadFromHistory(id) {
  var e = findHistoryEntry(id);
  if (!e) { return; }
  el('history-pop').removeAttribute('data-on');
  el('cmd-input').value = e.label || e.fieldName || '';
  readByName(el('cmd-input').value);
}

// ---------------------------------------------------------------------------
// Aba Estado (JSON)
// ---------------------------------------------------------------------------

// Colore o JSON DEPOIS de escapar: o realce nunca vira injecao. Chave e string
// se distinguem pelo ":" que vem depois.
var JSON_HIGHLIGHT_MAX = 400000;

function highlightJson(json) {
  var safe = esc(json);
  if (safe.length > JSON_HIGHLIGHT_MAX) { return safe; }
  return safe.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    function (whole, str, colon) {
      if (str) {
        return '<span class="' + (colon ? 'jk' : 'js') + '">' + str + '</span>' + (colon || '');
      }
      return '<span class="jn">' + whole + '</span>';
    }
  );
}

function renderJson() {
  var code = el('json-code');
  var gutter = el('json-gutter');

  if (!model.json) {
    code.textContent = model.error
      ? 'Não consegui varrer a página: ' + model.error
      : 'Nada varrido ainda. Clique em ↻ revarrer.';
    gutter.textContent = '';
    el('json-meta').textContent = model.error ? 'erro na varredura' : 'nada varrido ainda';
    return;
  }

  var lines = model.json.split('\n');
  var nums = [];
  for (var i = 1; i <= lines.length; i++) { nums.push(i); }
  gutter.textContent = nums.join('\n');
  code.innerHTML = highlightJson(model.json);

  var kb = (model.json.length / 1024).toFixed(1).replace('.', ',');
  el('json-meta').textContent = 'varrido ' + hhmmss(model.at) + ' · ' +
    model.meta.fieldCount + ' campo(s) · ' + model.meta.tableCount + ' tabela(s) · ' +
    model.meta.logCount + ' log(s) · ' + kb + ' kB';
}

function saveJson() {
  if (!model.json) {
    setStatus('warn', 'Nada para salvar — varra a página primeiro.');
    return;
  }
  var sol = docInfo && docInfo.ok ? docInfo.numProcess : 'estado';
  var name = 'fluig-debug-' + sol + '-' + hhmmss(model.at || new Date()).replace(/:/g, '') + '.json';
  var blob = new Blob([model.json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoga depois: revogar na hora cancelaria o download em alguns casos.
  setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  setStatus('ok', 'Salvo como <code>' + esc(name) + '</code>.');
}

// ---------------------------------------------------------------------------
// Aba Logs
// ---------------------------------------------------------------------------

var logLevel = 'all';

function logRowHtml(l) {
  var level = String(l.level || 'log');
  var cls = 'lg l-' + (level === 'error' || level === 'warn' ? level : 'log');
  var abbr = { error: 'err', warn: 'avi', info: 'inf', debug: 'dbg', log: 'log' }[level] || level;
  var ts = l.t ? hhmmss(new Date(l.t)) : '--:--:--';
  var frame = l.frame && l.frame !== 'top' ? ' <span class="frm">[iframe]</span>' : '';
  return '<div class="' + cls + '">' +
    '<span class="lv">' + esc(abbr) + '</span>' +
    '<span class="ts">' + ts + '</span>' +
    '<span class="tx">' + esc(l.msg == null ? '' : l.msg) + frame + '</span>' +
    '</div>';
}

function renderLogs() {
  var box = el('logs-body');
  var q = el('logs-filter').value.trim().toLowerCase();

  var counts = { error: 0, warn: 0 };
  model.logs.forEach(function (l) {
    if (l.level === 'error') { counts.error++; }
    else if (l.level === 'warn') { counts.warn++; }
  });
  el('log-n-error').textContent = String(counts.error);
  el('log-n-warn').textContent = String(counts.warn);

  var list = model.logs.filter(function (l) {
    if (logLevel !== 'all' && l.level !== logLevel) { return false; }
    if (q && String(l.msg || '').toLowerCase().indexOf(q) < 0) { return false; }
    return true;
  });

  if (!model.logs.length) {
    box.innerHTML = '<div class="gempty">Nenhum <code>console.log</code>/erro capturado desde que o DevTools foi ' +
      'aberto. O hook só pega o que acontece <b>depois</b> da abertura do F12.</div>';
    el('logs-meta').textContent = '';
    return;
  }
  if (!list.length) {
    box.innerHTML = '<div class="gempty">Nenhum log casa com esse filtro.</div>';
    el('logs-meta').textContent = '0 de ' + model.logs.length;
    return;
  }

  box.innerHTML = list.map(logRowHtml).join('');
  el('logs-meta').textContent = (list.length === model.logs.length ? list.length + ' linha(s)' :
    list.length + ' de ' + model.logs.length) + ' · vão junto no JSON';
}

// ---------------------------------------------------------------------------
// Altura da linha
// ---------------------------------------------------------------------------
//
// Quantas linhas de texto uma celula mostra antes de cortar. Vale para o grid
// plano e para as planilhas de uma vez, porque e uma variavel CSS no container —
// trocar a altura NAO re-renderiza nada, e por isso nao perde a edicao em curso
// nem a posicao do scroll.

function setRowClamp(n) {
  var grid = el('grid');
  grid.setAttribute('data-clamp', String(n));
  // 0 = "tudo": o corte sai por regra CSS, a variavel deixa de valer.
  grid.style.setProperty('--clamp', n > 0 ? String(n) : 'unset');
  var btns = document.querySelectorAll('[data-clamp]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-clamp') === String(n)));
  }
}

function setLogLevel(level) {
  logLevel = level;
  var btns = document.querySelectorAll('[data-log-level]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-log-level') === level));
  }
  renderLogs();
}

// ---------------------------------------------------------------------------
// Aba Processo + contexto na toolbar
// ---------------------------------------------------------------------------

function propHtml(label, valueHtml) {
  return '<dl class="pr"><dt>' + esc(label) + '</dt><dd>' + valueHtml + '</dd></dl>';
}

function paintDocInfo() {
  var ctx = el('tb-ctx');
  var props = el('props-body');

  if (!docInfo) {
    ctx.innerHTML = '<span class="faint">resolvendo a solicitação…</span>';
    props.innerHTML = '<div class="gempty">Resolvendo…</div>';
    return;
  }

  if (!docInfo.ok) {
    ctx.innerHTML = docInfo.numProcess
      ? 'solicitação <b>' + esc(docInfo.numProcess) + '</b><span class="sep">·</span><span class="err">documentId não resolvido</span>'
      : '<span class="err">solicitação não identificada na URL</span>';

    var html = '';
    if (docInfo.numProcess) { html += propHtml('solicitação', esc(docInfo.numProcess)); }
    if (docInfo.paramKey) { html += propHtml('parâmetro na URL', esc(docInfo.paramKey)); }
    html += propHtml('documentId', '<span class="err">' + esc(docInfo.message || 'não resolvido') + '</span>');
    if (docInfo.stage) { html += propHtml('etapa que falhou', esc(docInfo.stage)); }
    props.innerHTML = html + processoTodoHtml();
    return;
  }

  ctx.innerHTML = 'solicitação <b>' + esc(docInfo.numProcess) + '</b>' +
    '<span class="sep">·</span>doc <b>' + esc(docInfo.documentId) + '</b>' +
    '<span class="sep">·</span>' + esc(docInfo.frame);

  var out = '<div class="pgroup">identificação</div>' +
    propHtml('solicitação', esc(docInfo.numProcess)) +
    propHtml('parâmetro na URL', esc(docInfo.paramKey || '—')) +
    propHtml('documentId', '<span class="ok">' + esc(docInfo.documentId) + '</span>') +
    propHtml('cardIndexDocumentId', esc(docInfo.cardIndexDocumentId || '—')) +
    propHtml('DatasetFactory em', esc(docInfo.frame));

  if (model.meta && model.meta.capturedFrom) {
    out += propHtml('frame dos campos', esc(model.meta.capturedFrom));
  }

  props.innerHTML = out + processoTodoHtml();
}

// A aba nasce com o que a extensao REALMENTE resolve hoje, e diz em voz alta o
// que ainda nao existe. Placeholder honesto e melhor que dado inventado.
function processoTodoHtml() {
  return '<div class="pgroup">próximos passos desta aba</div>' +
    '<div class="todo"><b>mover solicitação</b> — disparar a próxima atividade sem sair do painel</div>' +
    '<div class="todo"><b>histórico de movimentações</b> — quem passou por onde e quando</div>';
}

function reloadDocInfo() {
  docInfo = null;
  docPending = null;
  paintDocInfo();
  setStatus('busy', 'Resolvendo o documentId…');
  ensureDocInfo().then(function (info) {
    if (info && info.ok) {
      setStatus('ok', 'documentId <b>' + esc(info.documentId) + '</b> resolvido para a solicitação ' +
        esc(info.numProcess) + '.');
    } else {
      setStatus('err', 'Não consegui resolver: ' + esc((info && info.message) || 'sem retorno'));
    }
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// abas
var tabButtons = document.querySelectorAll('.tab');
for (var t = 0; t < tabButtons.length; t++) {
  tabButtons[t].addEventListener('click', function () {
    setTab(this.getAttribute('data-tab'));
  });
}

el('btn-rescan').addEventListener('click', function () {
  closeEditor(true);
  hideDbConfirm();
  pendingDbSet = null;
  rescan('Revarrendo a página…');
});

// grid
el('grid-filter').addEventListener('input', function () {
  closeEditor(true);
  renderGrid();
});

// Delegacao escopada: as linhas sao recriadas a cada render/filtro, mas o
// #grid-body em si e estavel.
el('grid-body').addEventListener('click', function (e) {
  if (!e.target.closest) { return; }

  var copyRow = e.target.closest('[data-sheet-row]');
  if (copyRow) {
    copySheetRow(copyRow.getAttribute('data-sheet-row'));
    return;
  }

  var band = e.target.closest('.band');
  if (band) {
    var key = band.getAttribute('data-band');
    expandedTables[key] = !expandedTables[key];
    renderGrid();
    return;
  }

  var btn = e.target.closest('[data-act]');
  if (!btn) { return; }
  var row = btn.closest('.gr');
  if (!row) { return; }
  var idx = Number(row.getAttribute('data-i'));

  if (btn.getAttribute('data-act') === 'copy') {
    var entry = model.entries[idx];
    if (entry) { copyWithFeedback(entry.raw, 'Nome <code>' + esc(entry.raw) + '</code>'); }
    return;
  }
  openEditor(idx);
});

el('grid-body').addEventListener('dblclick', function (e) {
  if (!e.target.closest) { return; }
  // Alca antes de celula: o duplo clique nela e "voltar ao automatico", nao
  // "editar valor".
  if (resetGrip(e)) { return; }
  var cell = e.target.closest('[data-edit]');
  if (!cell) { return; }
  openEditor(Number(cell.getAttribute('data-i')));
});

// Arraste de coluna/linha na planilha. O mousedown fica no grid; o move e o up
// vao no document, senao o arraste morre ao sair do elemento.
el('grid-body').addEventListener('mousedown', startGripDrag);
document.addEventListener('mousemove', moveGripDrag);
document.addEventListener('mouseup', endGripDrag);

el('btn-grid-copy').addEventListener('click', function () {
  copyWithFeedback(model.json, 'JSON do estado');
});

var clampButtons = document.querySelectorAll('[data-clamp]');
for (var cb = 0; cb < clampButtons.length; cb++) {
  clampButtons[cb].addEventListener('click', function () {
    setRowClamp(Number(this.getAttribute('data-clamp')));
  });
}

// editor de valor longo
el('btn-ve-dom').addEventListener('click', function () {
  if (editing) { applyDomSet(editing.idx, el('ve-text').value); }
});
el('btn-ve-db').addEventListener('click', function () {
  if (editing) { askDbSet(editing.idx, el('ve-text').value); }
});
el('btn-ve-cancel').addEventListener('click', function () { closeEditor(false); });

el('ve-text').addEventListener('keydown', function (e) {
  // Enter tem de inserir quebra de linha: valor longo costuma ser multilinha.
  // Aplicar e Ctrl+Enter (ou Cmd+Enter).
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (editing) { applyDomSet(editing.idx, el('ve-text').value); }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeEditor(false);
  }
});

// confirmacao de gravacao no banco
el('btn-confirm-yes').addEventListener('click', applyDbSet);
el('btn-confirm-no').addEventListener('click', function () {
  pendingDbSet = null;
  hideDbConfirm();
  setStatus('', 'Gravação cancelada.');
});

// prompt + autocomplete
var cmdInput = el('cmd-input');

cmdInput.addEventListener('input', function () {
  ac.active = -1;
  acRefresh();
});

cmdInput.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!ac.open || !ac.shown.length) { acRefresh(); return; }
    if (ac.active < 0) {
      // Nada destacado ainda: ↓ vai para o primeiro, ↑ para o ULTIMO.
      ac.active = e.key === 'ArrowDown' ? 0 : ac.shown.length - 1;
    } else {
      ac.active = (ac.active + (e.key === 'ArrowDown' ? 1 : -1) + ac.shown.length) % ac.shown.length;
    }
    acPaintActive();
    return;
  }

  if (e.key === 'Enter') {
    // Com item destacado, Enter escolhe E le: o proximo passo obvio depois de
    // escolher um campo no prompt e ver o valor dele.
    if (ac.open && ac.active >= 0) {
      e.preventDefault();
      var label = ac.shown[ac.active].label;
      acPick(ac.active);
      readByName(label);
      return;
    }
    e.preventDefault();
    acClose();
    readByName(cmdInput.value);
    return;
  }

  if (e.key === 'Escape') {
    if (ac.open) {
      e.preventDefault();
      e.stopPropagation();
      acClose();
    }
    return;
  }

  if (e.key === 'Tab') {
    if (ac.open && ac.active >= 0) { e.preventDefault(); acPick(ac.active); }
    else { acClose(); }
  }
});

// mousedown (nao click) + preventDefault: o click chegaria depois do blur, que
// ja teria fechado a lista e removido o item de baixo do cursor.
el('cmd-ac').addEventListener('mousedown', function (e) {
  var item = e.target.closest ? e.target.closest('.ac-i') : null;
  if (!item) { return; }
  e.preventDefault();
  var i = Number(item.getAttribute('data-i'));
  var label = ac.shown[i] ? ac.shown[i].label : null;
  acPick(i);
  if (label) { readByName(label); }
});

el('cmd-ac').addEventListener('mouseover', function (e) {
  var item = e.target.closest ? e.target.closest('.ac-i') : null;
  if (!item) { return; }
  var i = Number(item.getAttribute('data-i'));
  if (i === ac.active) { return; }
  ac.active = i;
  acPaintActive();
});

cmdInput.addEventListener('blur', acClose);

el('btn-cmd-read').addEventListener('click', function () {
  readByName(cmdInput.value);
});

// historico
el('btn-history').addEventListener('click', toggleHistory);

el('history-pop').addEventListener('click', function (e) {
  if (!e.target.closest) { return; }
  var target = e.target.closest('[data-hist-restore], [data-hist-reread], [data-hist-clear]');
  if (!target) { return; }

  var restore = target.getAttribute('data-hist-restore');
  if (restore) { restoreFromHistory(Number(restore)); return; }

  var reread = target.getAttribute('data-hist-reread');
  if (reread) { rereadFromHistory(Number(reread)); return; }

  if (target.getAttribute('data-hist-clear')) {
    actionHistory = [];
    paintHistoryButton();
    renderHistory();
  }
});

// Clique fora fecha o popover de historico (o autocomplete fecha no blur do
// input, que nao serve aqui: o historico nao tem input).
document.addEventListener('mousedown', function (e) {
  var pop = el('history-pop');
  if (!pop.hasAttribute('data-on')) { return; }
  if (!e.target.closest) { return; }
  if (e.target.closest('#history-pop') || e.target.closest('#btn-history')) { return; }
  pop.removeAttribute('data-on');
});

// aba Estado
el('btn-json-copy').addEventListener('click', function () {
  copyWithFeedback(model.json, 'JSON do estado');
});
el('btn-json-save').addEventListener('click', saveJson);

// aba Logs
el('logs-filter').addEventListener('input', renderLogs);
var levelButtons = document.querySelectorAll('[data-log-level]');
for (var lb = 0; lb < levelButtons.length; lb++) {
  levelButtons[lb].addEventListener('click', function () {
    setLogLevel(this.getAttribute('data-log-level'));
  });
}

// aba Processo
el('btn-proc-reload').addEventListener('click', reloadDocInfo);

// Navegacao: a pagina nova tem outros campos — a varredura e o documentId
// morrem. O historico NAO e limpo: rever o que voce setou antes de recarregar a
// pagina e justamente um dos usos.
chrome.devtools.network.onNavigated.addListener(function () {
  closeEditor(true);
  hideDbConfirm();
  pendingDbSet = null;
  docInfo = null;
  docPending = null;
  expandedTables = {};
  paintDocInfo();
  rescan('Página navegou — varrendo de novo…');
  ensureDocInfo();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

setTab('campos');
setRowClamp(2);
paintHistoryButton();
paintDocInfo();
renderJson();
renderLogs();

// O grid e a tela principal: varre ao abrir, sem exigir clique em "gerar dump".
rescan('Varrendo a página…');

// documentId em paralelo — a toolbar e a aba Processo dependem dele, e o
// "gravar no banco" ja encontra o valor resolvido.
ensureDocInfo();

// Filtro em foco: digitar e a acao mais comum ao abrir o painel.
el('grid-filter').focus();
