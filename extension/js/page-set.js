// js/page-set.js — Expressao de pagina: setar campo no DOM
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

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
