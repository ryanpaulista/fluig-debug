// js/bridge.js
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

// Janelas de tempo (ms) em que o PROPRIO painel avaliou algo na pagina. Chamadas
// de rede que comecam dentro de uma janela sao do painel (ex.: resolucao do
// documentId via workflowProcess) e ficam fora do dump de rede.
var panelEvalWindows = [];
var PANEL_EVAL_WINDOWS_MAX = 300;

function isTransientContextError(err) {
  if (!err || !err.isError) { return false; }
  var raw = '';
  try { raw = JSON.stringify(err); } catch (e) { raw = String(err); }
  return /no execution context|Execution context was destroyed|Inspected target navigated|Cannot find context/i.test(raw);
}

function evalInPage(expression) {
  return new Promise(function (resolve, reject) {
    var attempts = 0;
    var maxAttempts = 20;

    function attempt() {
      attempts++;
      var win = { start: Date.now(), end: 0 };
      panelEvalWindows.push(win);
      if (panelEvalWindows.length > PANEL_EVAL_WINDOWS_MAX) { panelEvalWindows.shift(); }
      chrome.devtools.inspectedWindow.eval(expression, function (result, exceptionInfo) {
        win.end = Date.now();
        if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
          if (isTransientContextError(exceptionInfo) && attempts < maxAttempts && typeof setTimeout === 'function') {
            setTimeout(attempt, 350);
            return;
          }
          reject(exceptionInfo);
          return;
        }
        resolve(result);
      });
    }

    attempt();
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
  '    if (!win || acc.indexOf(win) >= 0) { return acc; }',
  '    acc.push(win);',
  '    if (depth > 5) { return acc; }',
  '    try {',
  '      var frames = win.frames;',
  '      if (frames && typeof frames.length === "number") {',
  '        for (var i = 0; i < frames.length; i++) {',
  '          try { var f = frames[i]; if (f) { void f.document; collectWindows(f, acc, depth + 1); } }',
  '          catch (e) { /* cross-origin: ignora */ }',
  '        }',
  '      }',
  '    } catch (e) {}',
  '    try {',
  '      var doc = win.document;',
  '      if (doc && doc.querySelectorAll) {',
  '        var iframes = doc.querySelectorAll("iframe, frame");',
  '        for (var j = 0; j < iframes.length; j++) {',
  '          try { var cw = iframes[j].contentWindow; if (cw) { void cw.document; collectWindows(cw, acc, depth + 1); } }',
  '          catch (e) { /* cross-origin: ignora */ }',
  '        }',
  '      }',
  '    } catch (e) {}',
  '    return acc;',
  '  }',
  '  function uncollapseAncestors(node, jq, win) {',
  '    if (!node) { return; }',
  '    try {',
  '      var curr = node.parentElement;',
  '      while (curr && curr !== win.document.body) {',
  '        // 1. Bootstrap Collapse / Fluig Panel Collapse (ex: #divCollapseIntegratedTimes)',
  '        if (curr.classList && curr.classList.contains("collapse")) {',
  '          var isCollapsed = !curr.classList.contains("in") && !curr.classList.contains("show") ||',
  '                            curr.getAttribute("aria-expanded") === "false" ||',
  '                            curr.style.height === "0px";',
  '          if (isCollapsed) {',
  '            // Forca abertura imediata sem esperar 350ms da transicao CSS do Bootstrap',
  '            curr.classList.add("in", "show");',
  '            curr.classList.remove("collapse", "collapsing");',
  '            curr.setAttribute("aria-expanded", "true");',
  '            curr.style.display = "block";',
  '            curr.style.height = "auto";',
  '            curr.style.visibility = "visible";',
  '            curr.style.overflow = "visible";',
  '',
  '            if (curr.id) {',
  '              var toggles = win.document.querySelectorAll(\'[data-target="#\' + curr.id + \'"], [href="#\' + curr.id + \'"]\');',
  '              for (var t = 0; t < toggles.length; t++) {',
  '                var toggle = toggles[t];',
  '                toggle.setAttribute("aria-expanded", "true");',
  '                toggle.classList.remove("collapsed");',
  '                toggle.classList.add("up");',
  '              }',
  '            }',
  '          }',
  '        }',
  '        // 2. Bootstrap Tab (aba fechada)',
  '        if (curr.classList && curr.classList.contains("tab-pane")) {',
  '          if (!curr.classList.contains("active")) {',
  '            curr.classList.add("active", "in", "show");',
  '            curr.style.display = "block";',
  '            if (curr.id) {',
  '              var tabLinks = win.document.querySelectorAll(\'a[href="#\' + curr.id + \'"], [data-target="#\' + curr.id + \'"]\');',
  '              for (var tl = 0; tl < tabLinks.length; tl++) {',
  '                tabLinks[tl].parentElement && tabLinks[tl].parentElement.classList.add("active");',
  '              }',
  '            }',
  '          }',
  '        }',
  '        // 3. HTML5 <details>',
  '        if (String(curr.tagName || "").toLowerCase() === "details") {',
  '          curr.open = true;',
  '        }',
  '        curr = curr.parentElement;',
  '      }',
  '    } catch (e) {}',
  '  }',
  '  function isNodeVisible(node, win) {',
  '    if (!node) { return false; }',
  '    if (String(node.type || "").toLowerCase() === "hidden") { return false; }',
  '    try {',
  '      var w = win || window;',
  '      var style = w.getComputedStyle ? w.getComputedStyle(node) : null;',
  '      if (style && (style.visibility === "hidden" || style.opacity === "0")) {',
  '        return false;',
  '      }',
  '      // Se estiver dentro da linha modelo oculta de pai-filho (tr detail="true" style="display:none")',
  '      var tr = node.closest ? node.closest("tr") : null;',
  '      if (tr && (tr.getAttribute("detail") === "true" || tr.style.display === "none")) {',
  '        return false;',
  '      }',
  '      // Se o proprio no tiver display:none explicito',
  '      if (node.style && node.style.display === "none") {',
  '        return false;',
  '      }',
  '      var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;',
  '      if (rect && (rect.width > 0 || rect.height > 0)) {',
  '        return true;',
  '      }',
  '      if (node.offsetParent) {',
  '        return true;',
  '      }',
  '      // Se esta sem dimensao, checa se esta dentro de um .collapse, .tab-pane ou <details> ancestral',
  '      var p = node.parentElement;',
  '      while (p && p !== w.document.body) {',
  '        if (p.classList && (p.classList.contains("collapse") || p.classList.contains("tab-pane") || p.tagName === "DETAILS")) {',
  '          return true; // e localizavel abrindo o painel/aba',
  '        }',
  '        p = p.parentElement;',
  '      }',
  '      return false;',
  '    } catch (e) {',
  '      return true;',
  '    }',
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
