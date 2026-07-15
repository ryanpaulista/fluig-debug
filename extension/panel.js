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
    '    try { nodes = doc.querySelectorAll("input, select, textarea"); } catch (e) { continue; }',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      if (logical(raw) !== base) { continue; }',
    '',
    '      var v;',
    '      try { v = jq ? jq(node).val() : node.value; } catch (e) { v = node.value; }',
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
    '    try { nodes = doc.querySelectorAll("input, select, textarea"); } catch (e) { continue; }',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      if (nm !== target && id !== target) { continue; }',
    '',
    '      try { if (jq) { jq(node).val(value); } else { node.value = value; } }',
    '      catch (e) { node.value = value; }',
    '      setCount++;',
    '      try { readBack = String(jq ? jq(node).val() : node.value); }',
    '      catch (e) { readBack = String(node.value); }',
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
  if (m.type) { tags.push('<span class="tag">' + esc(m.type) + '</span>'); }
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
    '    try { nodes = doc.querySelectorAll("input, select, textarea"); } catch (e) { continue; }',
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
    '      else { try { value = jq ? jq(node).val() : node.value; } catch (e) { value = node.value; } }',
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

document.getElementById('read-field').focus();
