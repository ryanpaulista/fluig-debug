// js/dump.js — Aba Dump: dump de todos os campos
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

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
    '  var wfInfo = null;',
    '  for (var wIdx = 0; wIdx < wins.length; wIdx++) {',
    '    var wv = null;',
    '    try {',
    '      if (wins[wIdx].ECM && wins[wIdx].ECM.workflowView) { wv = wins[wIdx].ECM.workflowView; }',
    '      else if (wins[wIdx].parent && wins[wIdx].parent.ECM && wins[wIdx].parent.ECM.workflowView) { wv = wins[wIdx].parent.ECM.workflowView; }',
    '      else if (wins[wIdx].top && wins[wIdx].top.ECM && wins[wIdx].top.ECM.workflowView) { wv = wins[wIdx].top.ECM.workflowView; }',
    '    } catch (e) {}',
    '    if (wv) {',
    '      wfInfo = {',
    '        formDescription: wv.formDescription ? String(wv.formDescription).trim() : null,',
    '        formVersion: wv.formVersion ? String(wv.formVersion).trim() : null,',
    '        sequence: wv.sequence ? String(wv.sequence).trim() : null,',
    '        currentStateDescription: wv.currentStateDescription ? String(wv.currentStateDescription).trim() : null',
    '      };',
    '      break;',
    '    }',
    '  }',
    '',
    '  return { entries: entries, logs: logs, capturedFrom: best ? best.url : null, framesScanned: wins.length, workflowView: wfInfo };',
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
      workflow: result.workflowView || undefined,
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
    status.innerHTML = '<span class="ok">JSON copiado para a área de transferência.</span>';
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value)
      .then(function () { status.innerHTML = '<span class="ok">JSON copiado.</span>'; })
      .catch(function () { status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>'; });
  } else {
    status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>';
  }
}
