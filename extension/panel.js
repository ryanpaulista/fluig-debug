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
  '  }'
].join('\n');

// ---------------------------------------------------------------------------
// Localizar campo (usado por ler e por setar)
// ---------------------------------------------------------------------------

// Localiza um campo pelo nome digitado, tratando "_" e "___N", e retorna todas
// as ocorrencias reais no DOM. Cada match traz `exact` (name/id igual ao
// digitado) para o setar poder mirar uma ocorrencia especifica.
function buildFindExpr(typed) {
  var typedLit = JSON.stringify(typed);
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var typed = ' + typedLit + ';',
    '  var base = logical(typed);',
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
    '      var v = readValue(node, jq);',
    '      if (v == null) { v = ""; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      matches.push({',
    '        name: raw,',
    '        id: id,',
    '        value: String(v),',
    '        disabled: disabled,',
    '        child: childMatch ? childMatch[1] : null,',
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
// Setar campo
// ---------------------------------------------------------------------------

// Aplica um valor no campo cujo name/id seja EXATAMENTE `rawName`, via jQuery
// .val() (sem trigger de eventos — fora de escopo do MVP). Faz read-back.
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
// UI — utilitarios
// ---------------------------------------------------------------------------

function render(id, html) {
  document.getElementById(id).innerHTML = html;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderValue(v) {
  return v === '' ? '<span class="muted">(vazio)</span>' : esc(v);
}

function matchTags(m) {
  var tags = [];
  if (m.disabled) { tags.push('<span class="tag warn">desabilitado (_)</span>'); }
  if (m.child) { tags.push('<span class="tag">linha ' + esc(m.child) + '</span>'); }
  if (m.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (m.type) { tags.push('<span class="tag">' + esc(m.type) + '</span>'); }
  return tags.join(' ');
}

// ---------------------------------------------------------------------------
// UI — Ler campo
// ---------------------------------------------------------------------------

function readField() {
  var typed = document.getElementById('read-field').value.trim();
  if (!typed) {
    render('read-output', '<span class="muted">Digite o nome de um campo.</span>');
    return;
  }

  render('read-output', '<span class="muted">Procurando na página…</span>');

  evalInPage(buildFindExpr(typed))
    .then(function (result) {
      if (!result) {
        render('read-output', '<span class="err">Sem retorno da página.</span>');
        return;
      }

      if (!result.matches || result.matches.length === 0) {
        render('read-output',
          '<div class="row"><span class="k">Campo</span><code>' + esc(result.typed) + '</code></div>' +
          '<div class="row"><span class="k">Resultado</span><span class="err">não encontrado</span></div>' +
          '<p class="muted">Nenhum input/select/textarea com nome lógico ' +
          '<code>' + esc(result.base) + '</code> em ' + esc(result.framesScanned) +
          ' frame(s). Confira o nome do campo.</p>'
        );
        return;
      }

      var html =
        '<div class="row"><span class="k">Campo</span><code>' + esc(result.typed) + '</code>' +
        ' <span class="muted">(' + result.matches.length + ' ocorrência(s))</span></div>';

      result.matches.forEach(function (m) {
        html +=
          '<div class="match">' +
          '<div class="row"><span class="k">name</span><code>' + esc(m.name) + '</code> ' + matchTags(m) + '</div>' +
          '<div class="row"><span class="k">valor</span><code>' + renderValue(m.value) + '</code></div>' +
          '</div>';
      });

      render('read-output', html);
    })
    .catch(function (exceptionInfo) {
      render('read-output', '<span class="err">Erro ao avaliar na página: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// ---------------------------------------------------------------------------
// UI — Setar campo (resolver -> confirmar -> aplicar)
// ---------------------------------------------------------------------------

function setFieldResolve() {
  var typed = document.getElementById('set-field').value.trim();
  var value = document.getElementById('set-value').value; // valor vazio e permitido (limpar campo)

  if (!typed) {
    render('set-output', '<span class="muted">Digite o nome do campo a alterar.</span>');
    return;
  }

  render('set-output', '<span class="muted">Localizando o campo…</span>');

  evalInPage(buildFindExpr(typed))
    .then(function (result) {
      var matches = (result && result.matches) || [];
      var exact = matches.filter(function (m) { return m.exact; });

      var target = null;
      if (exact.length === 1) {
        target = exact[0];
      } else if (exact.length === 0 && matches.length === 1) {
        target = matches[0];
      }

      if (!target) {
        if (matches.length === 0) {
          render('set-output',
            '<div class="row"><span class="k">Campo</span><code>' + esc(typed) + '</code></div>' +
            '<div class="row"><span class="k">Resultado</span><span class="err">não encontrado</span></div>'
          );
          return;
        }
        // Ambiguo: varias ocorrencias. Nao seta; pede o nome exato.
        var list = matches.map(function (m) {
          return '<div class="match"><div class="row"><span class="k">name</span><code>' +
            esc(m.name) + '</code> ' + matchTags(m) + '</div>' +
            '<div class="row"><span class="k">valor</span><code>' + renderValue(m.value) + '</code></div></div>';
        }).join('');
        render('set-output',
          '<p class="err">Ambíguo: <code>' + esc(typed) + '</code> casa com ' + matches.length +
          ' ocorrências. Por segurança não alterei nada.</p>' +
          '<p class="muted">Digite o <strong>nome exato</strong> da ocorrência (copie de baixo, ex: com <code>___N</code>):</p>' +
          list
        );
        return;
      }

      showSetConfirmation(target, value);
    })
    .catch(function (exceptionInfo) {
      render('set-output', '<span class="err">Erro ao localizar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

function showSetConfirmation(target, value) {
  render('set-output',
    '<div class="confirm">' +
    '<p><strong>Confirmar alteração</strong></p>' +
    '<div class="row"><span class="k">name</span><code>' + esc(target.name) + '</code> ' + matchTags(target) + '</div>' +
    '<div class="row"><span class="k">frame</span><span class="muted">' + esc(target.frame) + '</span></div>' +
    '<div class="row"><span class="k">atual</span><code>' + renderValue(target.value) + '</code></div>' +
    '<div class="row"><span class="k">novo</span><code>' + renderValue(value) + '</code></div>' +
    '<p class="muted">Aplica <code>$(campo).val(novo)</code> sem disparar <code>change</code>/<code>blur</code> ' +
    '(igual ao console; lógicas dependentes podem não reexecutar).</p>' +
    '<div class="field-row">' +
    '<button id="btn-confirm-set" type="button" class="danger">Confirmar alteração</button>' +
    '<button id="btn-cancel-set" type="button">Cancelar</button>' +
    '</div>' +
    '</div>'
  );

  document.getElementById('btn-confirm-set').addEventListener('click', function () {
    applySet(target.name);
  });
  document.getElementById('btn-cancel-set').addEventListener('click', function () {
    render('set-output', '<span class="muted">Alteração cancelada.</span>');
  });
}

function applySet(rawName) {
  var value = document.getElementById('set-value').value;
  render('set-output', '<span class="muted">Aplicando…</span>');

  evalInPage(buildSetExpr(rawName, value))
    .then(function (result) {
      if (!result || result.setCount === 0) {
        render('set-output', '<span class="err">Nada foi alterado (elemento <code>' +
          esc(rawName) + '</code> não encontrado ao aplicar).</span>');
        return;
      }
      render('set-output',
        '<div class="row"><span class="k">Aplicado</span><span class="ok">' +
        esc(result.setCount) + ' elemento(s) em ' + esc(result.frame) + '</span></div>' +
        '<div class="row"><span class="k">name</span><code>' + esc(result.target) + '</code></div>' +
        '<div class="row"><span class="k">valor agora</span><code>' + renderValue(result.readBack) + '</code></div>'
      );
    })
    .catch(function (exceptionInfo) {
      render('set-output', '<span class="err">Erro ao aplicar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// ---------------------------------------------------------------------------
// Dump de todos os campos (CU-02)
// ---------------------------------------------------------------------------

// Varre todos os input/select/textarea de window + iframes e devolve uma lista
// crua de entradas. A estruturacao (fields/tables) e feita no painel, em JS
// normal, mais facil de manter que uma expressao gigante.
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
    '          logs.push({ frame: (w === window ? "top" : "iframe"), level: flogs[m].level, msg: flogs[m].msg });',
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
    '      var table = null;',
    '      try { var t = node.closest ? node.closest("table[tablename]") : null; if (t) { table = t.getAttribute("tablename"); } } catch (e) {}',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '',
    '      entries.push({',
    '        raw: raw,',
    '        name: logical(raw),',
    '        value: String(value),',
    '        disabled: disabled,',
    '        child: childMatch ? childMatch[1] : null,',
    '        table: table,',
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

  var logs = result.logs || [];

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

function dumpFields() {
  var status = document.getElementById('dump-status');
  status.textContent = 'Coletando…';
  document.getElementById('dump-json').value = '';

  evalInPage(buildDumpExpr())
    .then(function (result) {
      if (!result) {
        status.innerHTML = '<span class="err">Sem retorno da página.</span>';
        return;
      }
      var out = structureDump(result);
      document.getElementById('dump-json').value = JSON.stringify(out, null, 2);
      status.innerHTML = '<span class="ok">' + out.meta.fieldCount + ' campo(s), ' +
        out.meta.tableCount + ' tabela(s), ' + out.meta.logCount + ' log(s).</span>';
    })
    .catch(function (exceptionInfo) {
      status.innerHTML = '<span class="err">Erro ao coletar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>';
    });
}

function copyDump() {
  var ta = document.getElementById('dump-json');
  var status = document.getElementById('dump-status');
  if (!ta.value) {
    status.innerHTML = '<span class="muted">Gere o dump antes de copiar.</span>';
    return;
  }
  ta.focus();
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  if (ok) {
    status.innerHTML = '<span class="ok">Copiado para a área de transferência.</span>';
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value)
      .then(function () { status.innerHTML = '<span class="ok">Copiado.</span>'; })
      .catch(function () { status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>'; });
  } else {
    status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>';
  }
}

// ---------------------------------------------------------------------------
// Solicitação: documentId a partir do nº da solicitação (CU-03)
// ---------------------------------------------------------------------------
//
// Fluxo (roda automatico ao abrir o painel, sem clique):
//   1. Le o numero da solicitacao na URL, no parametro do workflowview
//      (app_ecm_workflowview_detailsProcessInstanceID). Ex: ...?..._detailsProcessInstanceID=717
//   2. Consulta o dataset workflowProcess (via DatasetFactory CLIENT-SIDE, que
//      existe no contexto do formulario Fluig) filtrando por
//      workflowProcessPK.processInstanceId e pedindo cardDocumentId.
//   3. cardDocumentId e o documentId da solicitacao.
//
// Nao garimpamos o DOM: o valor vem do proprio dataset do Fluig (autoritativo).
// O DatasetFactory client-side devolve { columns, values }, onde values e um
// array de objetos indexados por nome de coluna (diferente do server-side).
// Helpers de dataset (client-side) injetados no IIFE. Reaproveitados pela
// resolucao do documentId e pelo "setar no banco".
var DATASET_HELPERS = [
  '  // Frame que expoe o DatasetFactory client-side do Fluig.',
  '  function findDatasetWin(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      try { if (wins[i].DatasetFactory && typeof wins[i].DatasetFactory.getDataset === "function") { return wins[i]; } } catch (e) {}',
  '    }',
  '    return null;',
  '  }',
  '  // Numero da solicitacao a partir da URL (param do workflowview).',
  '  function findNumProcess(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      var href;',
  '      try { href = String(wins[i].location.href); } catch (e) { continue; }',
  '      var m = href.match(/[?&]app_ecm_workflowview_detailsProcessInstanceID=(\\d+)/i);',
  '      if (m) { return m[1]; }',
  '    }',
  '    return null;',
  '  }',
  '  // documentId da solicitacao: workflowProcess -> cardDocumentId.',
  '  function resolveDocId(wins) {',
  '    var numProcess = findNumProcess(wins);',
  '    if (!numProcess) { return { ok: false, stage: "url", message: "Número da solicitação não encontrado na URL (parâmetro app_ecm_workflowview_detailsProcessInstanceID). Abra a extensão sobre uma solicitação de workflow." }; }',
  '    var dsWin = findDatasetWin(wins);',
  '    if (!dsWin) { return { ok: false, stage: "dataset", numProcess: numProcess, message: "DatasetFactory não disponível no client-side (formulário ainda carregando?). Tente Recarregar." }; }',
  '    try {',
  '      var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
  '      var c1 = DF.createConstraint("workflowProcessPK.processInstanceId", numProcess, numProcess, CT.MUST);',
  '      var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
  '      var dataset = DF.getDataset("workflowProcess", ["cardIndexDocumentId", "cardDocumentId"], [c1, c4], null);',
  '      var values = (dataset && dataset.values) ? dataset.values : [];',
  '      if (!values.length) { return { ok: false, stage: "empty", numProcess: numProcess, message: "Consulta ao workflowProcess retornou vazio para a solicitação " + numProcess + "." }; }',
  '      var row = values[0];',
  '      return { ok: true, numProcess: numProcess, documentId: (row.cardDocumentId != null ? String(row.cardDocumentId) : null), cardIndexDocumentId: (row.cardIndexDocumentId != null ? String(row.cardIndexDocumentId) : null), frame: (dsWin === window ? "top" : "iframe") };',
  '    } catch (e) { return { ok: false, stage: "query", numProcess: numProcess, message: "Erro na consulta ao dataset: " + (e && e.message ? e.message : String(e)) }; }',
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

function renderSolicitacao(result) {
  var status = document.getElementById('solicitacao-status');

  if (!result) {
    status.innerHTML = '<span class="err">Sem retorno.</span>';
    render('solicitacao-output', '<span class="err">Sem retorno da página.</span>');
    return;
  }

  if (!result.ok) {
    status.innerHTML = '<span class="err">não resolvido</span>';
    var head = result.numProcess
      ? '<div class="row"><span class="k">Solicitação</span><code>' + esc(result.numProcess) + '</code></div>'
      : '';
    render('solicitacao-output', head +
      '<div class="row"><span class="k">documentId</span><span class="err">' + esc(result.message) + '</span></div>');
    return;
  }

  status.innerHTML = '<span class="ok">documentId resolvido</span>';
  var html =
    '<div class="row"><span class="k">Solicitação</span><code>' + esc(result.numProcess) + '</code></div>' +
    '<div class="row"><span class="k">documentId</span><code class="ok">' + renderValue(result.documentId) + '</code></div>';
  if (result.cardIndexDocumentId && result.cardIndexDocumentId !== result.documentId) {
    html += '<div class="row"><span class="k">cardIndex</span><code>' + renderValue(result.cardIndexDocumentId) + '</code></div>';
  }
  render('solicitacao-output', html);
}

function loadSolicitacao() {
  var status = document.getElementById('solicitacao-status');
  status.textContent = 'Resolvendo…';
  render('solicitacao-output', '<span class="muted">Lendo a solicitação e consultando o documentId…</span>');

  evalInPage(buildDocumentIdExpr())
    .then(renderSolicitacao)
    .catch(function (exceptionInfo) {
      status.innerHTML = '<span class="err">erro</span>';
      render('solicitacao-output', '<span class="err">Erro ao resolver: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// ---------------------------------------------------------------------------
// Setar campo no banco (resolver documentId -> confirmar -> gravar)
// ---------------------------------------------------------------------------
//
// Grava direto no banco via dsSetCardValue, usando o documentId da solicitacao.
// Diferente do "Setar campo" (que faz $(campo).val() no DOM): funciona mesmo com
// a solicitacao finalizada, onde o DOM nao aceita a alteracao. Mesmo cuidado do
// outro: confirmacao obrigatoria antes de aplicar (ainda mais critico, pois
// grava no banco ignorando validacoes/logicas do formulario).

var pendingDbSet = null;

function dbSetResolve() {
  var fieldName = document.getElementById('dbset-field').value.trim();
  var value = document.getElementById('dbset-value').value; // valor vazio permitido (limpar)

  if (!fieldName) {
    render('dbset-output', '<span class="muted">Digite o nome do campo a gravar.</span>');
    return;
  }

  render('dbset-output', '<span class="muted">Resolvendo o documentId da solicitação…</span>');

  evalInPage(buildDocumentIdExpr())
    .then(function (result) {
      if (!result || !result.ok || !result.documentId) {
        render('dbset-output', '<span class="err">Não consegui resolver o documentId: ' +
          esc((result && result.message) || 'sem retorno') + '</span>');
        return;
      }
      pendingDbSet = { documentId: result.documentId, numProcess: result.numProcess, fieldName: fieldName, value: value };
      showDbSetConfirmation(pendingDbSet);
    })
    .catch(function (exceptionInfo) {
      render('dbset-output', '<span class="err">Erro ao resolver: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

function showDbSetConfirmation(p) {
  render('dbset-output',
    '<div class="confirm">' +
    '<p><strong>Confirmar gravação no banco</strong></p>' +
    '<div class="row"><span class="k">Solicitação</span><code>' + esc(p.numProcess) + '</code></div>' +
    '<div class="row"><span class="k">documentId</span><code>' + esc(p.documentId) + '</code></div>' +
    '<div class="row"><span class="k">campo</span><code>' + esc(p.fieldName) + '</code></div>' +
    '<div class="row"><span class="k">novo</span><code>' + renderValue(p.value) + '</code></div>' +
    '<p class="muted">Grava via <code>dsSetCardValue</code> <strong>direto no banco</strong>, ' +
    'ignorando o DOM e as validações/lógicas do formulário. Ação sensível.</p>' +
    '<div class="field-row">' +
    '<button id="btn-confirm-dbset" type="button" class="danger">Confirmar gravação</button>' +
    '<button id="btn-cancel-dbset" type="button">Cancelar</button>' +
    '</div>' +
    '</div>'
  );

  document.getElementById('btn-confirm-dbset').addEventListener('click', function () {
    applyDbSet();
  });
  document.getElementById('btn-cancel-dbset').addEventListener('click', function () {
    pendingDbSet = null;
    render('dbset-output', '<span class="muted">Gravação cancelada.</span>');
  });
}

function applyDbSet() {
  if (!pendingDbSet) {
    render('dbset-output', '<span class="muted">Nada pendente. Preencha e clique em Setar no banco.</span>');
    return;
  }
  var p = pendingDbSet;
  render('dbset-output', '<span class="muted">Gravando no banco…</span>');

  evalInPage(buildDbSetExpr(p.documentId, p.fieldName, p.value))
    .then(function (result) {
      pendingDbSet = null;
      if (!result || !result.ok) {
        render('dbset-output', '<span class="err">Falha ao gravar: ' +
          esc((result && result.message) || 'sem retorno') + '</span>');
        return;
      }
      var html =
        '<div class="row"><span class="k">Gravado</span><span class="ok">no banco via dsSetCardValue</span></div>' +
        '<div class="row"><span class="k">documentId</span><code>' + esc(result.documentId) + '</code></div>' +
        '<div class="row"><span class="k">campo</span><code>' + esc(result.fieldName) + '</code></div>' +
        '<div class="row"><span class="k">valor</span><code>' + renderValue(result.fieldValue) + '</code></div>';
      if (result.values) {
        html += '<div class="row"><span class="k">retorno</span><code>' + esc(JSON.stringify(result.values)) + '</code></div>';
      }
      html += '<p class="muted">A gravação foi no banco (não no DOM aberto). Recarregue o formulário para ver o valor atualizado.</p>';
      render('dbset-output', html);
    })
    .catch(function (exceptionInfo) {
      pendingDbSet = null;
      render('dbset-output', '<span class="err">Erro ao gravar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.getElementById('btn-read').addEventListener('click', readField);
document.getElementById('read-field').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { readField(); }
});

document.getElementById('btn-set').addEventListener('click', setFieldResolve);
document.getElementById('set-value').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { setFieldResolve(); }
});

document.getElementById('btn-dump').addEventListener('click', dumpFields);
document.getElementById('btn-copy-dump').addEventListener('click', copyDump);

document.getElementById('btn-reload-solicitacao').addEventListener('click', loadSolicitacao);

document.getElementById('btn-dbset').addEventListener('click', dbSetResolve);
document.getElementById('dbset-value').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { dbSetResolve(); }
});

document.getElementById('read-field').focus();

// Resolve o documentId da solicitacao automaticamente ao abrir o painel.
loadSolicitacao();
