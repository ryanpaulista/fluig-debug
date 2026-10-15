// js/page-index.js — Expressao de pagina: indice de campos (base do autocomplete)
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Indice de campos (base do autocomplete)
// ---------------------------------------------------------------------------
//
// Varre os mesmos nos que o dump (input/select/textarea/span[name]) em todos os
// frames e devolve DUAS listas:
//   fields — um item por NOME LOGICO, que e o que o usuario digita no dia a dia
//            (a extensao resolve o "_" e o "___N" sozinha). Traz a contagem de
//            ocorrencias e quantas linhas ___N existem.
//   rows   — um item por ocorrencia ___N (name cru). Usada so quando o usuario
//            digita "___" para mirar uma linha especifica de tabela pai-filho.
//
// O valor vem TRUNCADO em VALUE_MAX: no dropdown ele e um preview de uma linha,
// e isso evita arrastar textarea inteira na serializacao do eval.
//
// Botoes (button/submit/reset/image) ficam fora: tem name mas nunca sao alvo de
// ler/setar, so poluiriam a lista. O indice e, portanto, um SUBCONJUNTO do que o
// "Ler" consegue achar — nunca o contrario.
function buildFieldIndexExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var VALUE_MAX = 60;',
    '  var MAX_FIELDS = 600;',
    '  var MAX_ROWS = 1200;',
    '  function preview(v) {',
    '    var s = String(v == null ? "" : v).replace(/\\s+/g, " ").replace(/^ | $/g, "");',
    '    return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX) + "\\u2026" : s;',
    '  }',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var groups = {};',
    '  var order = [];',
    '  var rows = [];',
    '  var rowSeen = {};',
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
    '      var lg = logical(raw);',
    '      if (!lg) { continue; }',
    '',
    '      var ntype = String(node.type || node.tagName || "").toLowerCase();',
    '      if (ntype === "button" || ntype === "submit" || ntype === "reset" || ntype === "image") { continue; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var child = childMatch ? childMatch[1] : null;',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      var table = null;',
    '      try {',
    '        var t = node.closest ? (node.closest("table[tablename]") || node.closest("table")) : null;',
    '        if (t) { table = t.getAttribute("tablename") || t.id || null; }',
    '      } catch (e) {}',
    '      var val = preview(readValue(node, jq));',
    '',
    '      var g = groups[lg];',
    '      if (!g) {',
    '        g = { logical: lg, occurrences: 0, rowCount: 0, disabled: false, type: ntype, table: table, value: val };',
    '        groups[lg] = g;',
    '        order.push(lg);',
    '      }',
    '      g.occurrences++;',
    '      if (child !== null) { g.rowCount++; }',
    '      if (disabled) { g.disabled = true; }',
    '      if (!g.table && table) { g.table = table; }',
    '      // Campo espelhado do Fluig costuma ter uma copia vazia: prefere o',
    '      // primeiro valor NAO vazio para o preview nao mentir "(vazio)".',
    '      if (!g.value && val) { g.value = val; }',
    '',
    '      if (child !== null && !rowSeen[raw]) {',
    '        rowSeen[raw] = 1;',
    '        rows.push({ name: raw, logical: lg, child: child, table: table, disabled: disabled, type: ntype, value: val });',
    '      }',
    '    }',
    '  }',
    '',
    '  // Preenche a tabela nas rows caso a tabela tenha sido descoberta posteriormente no grupo logico',
    '  for (var rIdx = 0; rIdx < rows.length; rIdx++) {',
    '    var item = rows[rIdx];',
    '    if (!item.table && groups[item.logical] && groups[item.logical].table) {',
    '      item.table = groups[item.logical].table;',
    '    }',
    '  }',
    '',
    '  order.sort();',
    '  var fields = [];',
    '  for (var k = 0; k < order.length; k++) { fields.push(groups[order[k]]); }',
    '  rows.sort(function (a, b) {',
    '    if (a.logical !== b.logical) { return a.logical < b.logical ? -1 : 1; }',
    '    return Number(a.child) - Number(b.child);',
    '  });',
    '',
    '  return {',
    '    fields: fields.slice(0, MAX_FIELDS),',
    '    rows: rows,',
    '    fieldsTotal: fields.length,',
    '    rowsTotal: rows.length,',
    '    framesScanned: wins.length',
    '  };',
    '})()'
  ].join('\n');
}
