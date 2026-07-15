// devtools.js
//
// Roda quando o DevTools (F12) e aberto sobre uma aba. Responsabilidades:
//   1. Decidir SE a aba "Fluig Debug" deve existir (fingerprint de Fluig).
//   2. Instalar o hook de captura de console na pagina (para o dump).
//
// Regra de ativacao (decidida com a equipe): NAO usamos allowlist de URL, porque
// os hostnames dos servidores Fluig nao sao padronizados. Em vez disso, fazemos
// "fingerprint" da pagina: so agimos se ela for comprovadamente Fluig, detectando
// os globais que so existem na plataforma (WCMAPI / FLUIGC).
//
// Limitacao da API: um painel do DevTools so pode ser criado uma vez e nao pode
// ser removido. Por isso checamos antes de criar. Como WCMAPI/FLUIGC carregam de
// forma assincrona, re-checamos por um tempo e a cada navegacao.

var panelCreated = false;
var hookInstalledForThisPage = false;

// --- Fingerprint: avaliado NO CONTEXTO DA PAGINA. Retorna so dados serializaveis.
var FINGERPRINT_EXPR = [
  '(function () {',
  '  var hasWCMAPI = typeof WCMAPI !== "undefined";',
  '  var hasFLUIGC = typeof FLUIGC !== "undefined";',
  '  return { isFluig: hasWCMAPI || hasFLUIGC };',
  '})()'
].join('\n');

// --- Hook de console: envolve console.* num ring buffer por frame, sem perder o
// comportamento original. Idempotente (guarda __FLUIG_DEBUG_HOOK__). Instalado em
// window + iframes de mesma origem. O dump (panel.js) le __FLUIG_DEBUG_LOGS__.
var LOG_HOOK_EXPR = [
  '(function () {',
  '  function collectWindows(win, acc, depth) {',
  '    acc.push(win);',
  '    if (depth > 5) { return acc; }',
  '    var frames; try { frames = win.frames; } catch (e) { return acc; }',
  '    for (var i = 0; i < frames.length; i++) {',
  '      try { var f = frames[i]; void f.document; collectWindows(f, acc, depth + 1); } catch (e) {}',
  '    }',
  '    return acc;',
  '  }',
  '  var wins = collectWindows(window, [], 0);',
  '  var MAX = 300;',
  '  var installed = 0;',
  '  for (var i = 0; i < wins.length; i++) {',
  '    var w = wins[i];',
  '    try {',
  '      if (w.__FLUIG_DEBUG_HOOK__) { continue; }',
  '      var buf = w.__FLUIG_DEBUG_LOGS__ = (w.__FLUIG_DEBUG_LOGS__ || []);',
  '      var push = function (level, msg) { try { buf.push({ level: level, msg: msg }); if (buf.length > MAX) { buf.shift(); } } catch (e) {} };',
  '      var serialize = function (args) {',
  '        var parts = [];',
  '        for (var k = 0; k < args.length; k++) {',
  '          var a = args[k];',
  '          try { parts.push(typeof a === "string" ? a : JSON.stringify(a)); }',
  '          catch (e) { try { parts.push(String(a)); } catch (e2) { parts.push("[unserializable]"); } }',
  '        }',
  '        return parts.join(" ");',
  '      };',
  '      var levels = ["log", "info", "warn", "error", "debug"];',
  '      for (var j = 0; j < levels.length; j++) {',
  '        (function (level) {',
  '          try {',
  '            var orig = w.console && w.console[level];',
  '            if (typeof orig !== "function") { return; }',
  '            w.console[level] = function () { push(level, serialize(arguments)); try { return orig.apply(this, arguments); } catch (e) {} };',
  '          } catch (e) {}',
  '        })(levels[j]);',
  '      }',
  '      try { w.addEventListener("error", function (ev) { push("error", "[onerror] " + (ev && ev.message ? ev.message : "")); }); } catch (e) {}',
  '      try { w.addEventListener("unhandledrejection", function (ev) { push("error", "[unhandledrejection] " + (ev ? String(ev.reason) : "")); }); } catch (e) {}',
  '      w.__FLUIG_DEBUG_HOOK__ = true;',
  '      installed++;',
  '    } catch (e) {}',
  '  }',
  '  return { installed: installed, frames: wins.length };',
  '})()'
].join('\n');

function detectFluig(callback) {
  chrome.devtools.inspectedWindow.eval(FINGERPRINT_EXPR, function (result, exceptionInfo) {
    if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
      callback(null);
      return;
    }
    callback(result);
  });
}

function installLogHook() {
  chrome.devtools.inspectedWindow.eval(LOG_HOOK_EXPR, function () {});
}

function check() {
  detectFluig(function (info) {
    if (!(info && info.isFluig)) {
      return;
    }
    if (!hookInstalledForThisPage) {
      installLogHook();
      hookInstalledForThisPage = true;
    }
    if (!panelCreated) {
      panelCreated = true;
      chrome.devtools.panels.create('Fluig Debug', null, 'panel.html', function () {});
    }
  });
}

// Poll limitado: cobre o caso de o Fluig ainda estar carregando quando o F12
// abre. Para quando ja instalamos o hook desta pagina e criamos o painel.
var attempts = 0;
var MAX_ATTEMPTS = 12; // ~10s
var POLL_INTERVAL_MS = 800;

function poll() {
  check();
  attempts += 1;
  if ((!hookInstalledForThisPage || !panelCreated) && attempts < MAX_ATTEMPTS) {
    setTimeout(poll, POLL_INTERVAL_MS);
  }
}

poll();

// Navegacao: a pagina nova zera o hook -> reinstalar. Reinicia o poll.
chrome.devtools.network.onNavigated.addListener(function () {
  hookInstalledForThisPage = false;
  attempts = 0;
  poll();
});
