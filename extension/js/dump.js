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

// Contexto da sessao lido da pagina (usuario/tenant do WCMAPI). Tudo defensivo:
// propriedade ausente simplesmente nao aparece no JSON.
function buildContextExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var wins = collectWindows(window, [], 0);',
    '  var ctx = { pageUrl: null, userAgent: null, user: null, tenant: null, locale: null };',
    '  try { ctx.pageUrl = String(window.location.href); } catch (e) {}',
    '  try { ctx.userAgent = String(navigator.userAgent); } catch (e) {}',
    '  for (var i = 0; i < wins.length; i++) {',
    '    var w = wins[i];',
    '    var api = null;',
    '    try { api = w.WCMAPI || null; } catch (e) {}',
    '    if (!api) { continue; }',
    '    try {',
    '      ctx.user = { code: api.userCode || null, login: api.userLogin || null };',
    '      ctx.tenant = api.tenantCode || api.organizationId || null;',
    '      ctx.locale = api.locale || null;',
    '    } catch (e) {}',
    '    break;',
    '  }',
    '  return ctx;',
    '})()'
  ].join('\n');
}

// Opcoes escolhidas nos checkboxes da aba Dump.
function readDumpOptions() {
  function on(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  return {
    fields: on('dump-opt-fields'),
    logs: on('dump-opt-logs'),
    context: on('dump-opt-context'),
    datasets: on('dump-opt-datasets'),
    rest: on('dump-opt-rest'),
    responses: on('dump-opt-responses'),
    compact: on('dump-opt-compact'),
    mask: on('dump-opt-mask')
  };
}

// Numero da solicitacao/documentId + usuario. Falhas nao derrubam o dump.
function loadDumpContext() {
  return Promise.all([
    evalInPage(buildContextExpr()).catch(function () { return null; }),
    evalInPage(buildDocumentIdExpr()).catch(function () { return null; })
  ]).then(function (r) {
    var ctx = r[0] || {};
    var d = r[1];
    if (d && d.numProcess) {
      ctx.process = { numProcess: d.numProcess };
      if (d.ok) {
        ctx.process.documentId = d.documentId;
        ctx.process.cardIndexDocumentId = d.cardIndexDocumentId;
      }
    }
    return ctx;
  });
}

// Modo compacto: tira campos vazios e linhas de tabela sem nenhum valor e
// trunca textos muito longos (RAT, JSON de payload/response...), que dominam o
// tamanho do dump e quase nunca ajudam o diagnostico. Atualiza as contagens do
// meta para refletirem o que de fato ficou no JSON.
var COMPACT_TEXT_MAX = 600;

function compactDump(out) {
  var omittedEmpty = 0, truncatedTexts = 0;
  function isEmpty(v) { return v === '' || v == null || (Array.isArray(v) && v.every(isEmpty)); }
  function cut(v) {
    if (typeof v === 'string' && v.length > COMPACT_TEXT_MAX) {
      truncatedTexts++;
      return v.slice(0, COMPACT_TEXT_MAX) + '… [+' + (v.length - COMPACT_TEXT_MAX) + ' chars]';
    }
    return Array.isArray(v) ? v.map(cut) : v;
  }
  Object.keys(out.fields || {}).forEach(function (k) {
    if (isEmpty(out.fields[k])) { delete out.fields[k]; omittedEmpty++; }
    else { out.fields[k] = cut(out.fields[k]); }
  });
  Object.keys(out.tables || {}).forEach(function (t) {
    out.tables[t] = out.tables[t].map(function (row) {
      var r = {};
      Object.keys(row).forEach(function (k) {
        if (isEmpty(row[k])) { omittedEmpty++; } else { r[k] = cut(row[k]); }
      });
      return r;
    }).filter(function (row) { return Object.keys(row).length > 0; });
  });
  out.meta.fieldCount = Object.keys(out.fields || {}).length;
  out.meta.compact = { omittedEmpty: omittedEmpty, truncatedTexts: truncatedTexts, textMaxChars: COMPACT_TEXT_MAX };
}

// Monta o JSON final conforme as secoes escolhidas.
function buildDumpOutput(result, ctx, net, opts) {
  var out = structureDump(result);
  if (!opts.fields) {
    delete out.fields; delete out.tables; delete out.childFieldsSemTabela;
  } else if (opts.compact) {
    compactDump(out);
  }
  if (!opts.logs) { delete out.logs; }
  if (opts.context && ctx) { out.context = ctx; }
  if (net) {
    var network = {};
    if (opts.datasets) { network.datasets = net.datasets; }
    if (opts.rest) { network.rest = net.rest; }
    if (net.truncated) { network.omittedOlderCalls = net.truncated; }
    out.network = network;
    var all = (net.datasets || []).concat(net.rest || []);
    out.meta.network = {
      datasets: (net.datasets || []).length,
      rest: (net.rest || []).length,
      failed: all.filter(function (c) { return c.failed; }).length,
      includesResponses: !!opts.responses,
      panelCallsIgnored: net.panelCallsIgnored || 0
    };
  }
  return opts.mask ? maskDump(out) : out;
}

function dumpFields() {
  var status = document.getElementById('dump-status');
  var opts = readDumpOptions();
  status.textContent = 'Coletando…';
  document.getElementById('dump-json').value = '';

  // A rede e lida ANTES das chamadas do proprio painel (contexto/documentId),
  // para que elas nao poluam o dump.
  var netP = (opts.datasets || opts.rest) ? collectNetwork(opts) : Promise.resolve(null);

  netP.then(function (net) {
    var ctxP = opts.context ? loadDumpContext() : Promise.resolve(null);
    return Promise.all([evalInPage(buildDumpExpr()), ctxP]).then(function (r) {
      var result = r[0];
      if (!result) {
        status.innerHTML = '<span class="err">Sem retorno da página.</span>';
        return;
      }
      var out = buildDumpOutput(result, r[1], net, opts);
      var json = JSON.stringify(out, null, 2);
      document.getElementById('dump-json').value = json;
      var parts = [];
      if (opts.fields) { parts.push(out.meta.fieldCount + ' campo(s), ' + out.meta.tableCount + ' tabela(s)'); }
      if (out.meta.network) {
        parts.push(out.meta.network.datasets + ' dataset(s), ' + out.meta.network.rest + ' REST' +
          (out.meta.network.failed ? ' (' + out.meta.network.failed + ' com erro)' : ''));
      }
      if (opts.logs) { parts.push(out.meta.logCount + ' log(s)'); }
      if (opts.mask) { parts.push(out.meta.masked + ' mascarado(s)'); }
      parts.push((json.length / 1024).toFixed(1) + ' KB (~' + Math.ceil(json.length / 4) + ' tokens)');
      status.innerHTML = '<span class="ok">' + esc(parts.join(' · ')) + '</span>';
    });
  }).catch(function (exceptionInfo) {
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
