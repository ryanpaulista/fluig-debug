// js/main.js — Wiring final e inicializacao
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

document.getElementById('btn-dump').addEventListener('click', dumpFields);
document.getElementById('btn-copy-dump').addEventListener('click', copyDump);

document.getElementById('btn-reload-solicitacao').addEventListener('click', loadSolicitacao);

document.getElementById('btn-read-history').addEventListener('click', function () { toggleHistory('read'); });

// Delegacao: botoes de copiar inline, localizar e reverter sao criados dinamicamente
document.addEventListener('click', function (e) {
  if (!e.target.closest) { return; }

  // Copiar valor textual estatico (data-copy ou data-browse-copy)
  var copyBtn = e.target.closest('[data-copy], [data-browse-copy]');
  if (copyBtn) {
    e.preventDefault();
    var valToCopy = copyBtn.getAttribute('data-copy');
    if (valToCopy == null) {
      valToCopy = copyBtn.getAttribute('data-browse-copy');
    }
    copyWithFeedback(valToCopy, copyBtn);
    return;
  }

  // Copiar conteudo do textarea do card de busca
  var matchCopyVal = e.target.closest('[data-match-copy-val]');
  if (matchCopyVal) {
    e.preventDefault();
    var cardId = matchCopyVal.getAttribute('data-match-copy-val');
    var ta = document.getElementById('match-val-' + cardId);
    copyWithFeedback(ta ? ta.value : '', matchCopyVal);
    return;
  }

  // Copiar conteudo do textarea do inspector DataGrip
  var dgCopyVal = e.target.closest('[data-dg-copy-val]');
  if (dgCopyVal) {
    e.preventDefault();
    var tName = dgCopyVal.getAttribute('data-dg-copy-val');
    var ta = document.getElementById('dg-val-' + tName);
    copyWithFeedback(ta ? ta.value : '', dgCopyVal);
    return;
  }

  // Reverter textarea para o valor original
  var revertBtn = e.target.closest('[data-revert-ta]');
  if (revertBtn) {
    e.preventDefault();
    var targetTaId = revertBtn.getAttribute('data-revert-ta');
    var targetTa = document.getElementById(targetTaId);
    if (targetTa) {
      performRevert(targetTa);
      flashCopied(revertBtn);
    }
    return;
  }

  // Copiar linha inteira de tabela pai-filho como JSON estruturado
  var copyRowBtn = e.target.closest('[data-copy-row]');
  if (copyRowBtn) {
    e.preventDefault();
    e.stopPropagation();
    var rawPair = copyRowBtn.getAttribute('data-copy-row') || '';
    var sepIdx = rawPair.lastIndexOf(':');
    var tblName = sepIdx >= 0 ? rawPair.slice(0, sepIdx) : '';
    var rIdx = sepIdx >= 0 ? rawPair.slice(sepIdx + 1) : rawPair;
    copyTableRowJson(tblName, rIdx, copyRowBtn);
    return;
  }

  var focusBtn = e.target.closest('[data-focus-elem]');
  if (focusBtn) {
    e.preventDefault();
    focusElementInPage(focusBtn.getAttribute('data-focus-elem'), focusBtn);
    return;
  }
});

// Captura de alteracoes com debounce para salvar snapshots de Undo nos textareas
var taDebounceTimer = null;
document.addEventListener('input', function (e) {
  var target = e.target;
  if (!target || (!target.classList.contains('match-textarea') && !target.classList.contains('dg-inspector-textarea'))) {
    return;
  }
  clearTimeout(taDebounceTimer);
  taDebounceTimer = setTimeout(function () {
    recordTextareaSnapshot(target);
  }, 250);
});

// Atalhos de teclado para Undo (Ctrl+Z / Cmd+Z) e Redo (Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z)
document.addEventListener('keydown', function (e) {
  var target = e.target;
  if (!target || (!target.classList.contains('match-textarea') && !target.classList.contains('dg-inspector-textarea'))) {
    return;
  }

  var isCtrlOrCmd = e.ctrlKey || e.metaKey;
  if (!isCtrlOrCmd) { return; }

  var key = (e.key || '').toLowerCase();

  // Redo: Ctrl+Shift+Z ou Ctrl+Y
  if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    performRedo(target);
    return;
  }

  // Undo: Ctrl+Z (sem shift)
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    performUndo(target);
    return;
  }
});

// Delegacao: os botoes de dentro do historico sao recriados a cada render, entao
// nao da para prender listener neles um a um.
document.addEventListener('click', function (e) {
  if (!e.target.closest) { return; }
  var el = e.target.closest('[data-hist-restore], [data-hist-reread], [data-hist-clear]');
  if (!el) { return; }

  var restore = el.getAttribute('data-hist-restore');
  if (restore) {
    var parts = restore.split(':');
    restoreFromHistory(parts[0], Number(parts[1]));
    return;
  }

  var reread = el.getAttribute('data-hist-reread');
  if (reread) {
    rereadFromHistory(Number(reread));
    return;
  }

  var clear = el.getAttribute('data-hist-clear');
  if (clear) {
    histories[clear] = [];
    renderHistory(clear);
  }
});

// Navegacao: a pagina nova tem outros campos — o indice do autocomplete morre.
// O historico NAO e limpo: rever o que voce setou antes de recarregar a pagina e
// justamente um dos usos.
chrome.devtools.network.onNavigated.addListener(function () {
  invalidateFieldIndex();
  browserFields = [];
  browserRows = [];
  browserExpandedTables = {};
  loadSolicitacao();
  loadFieldBrowser();
  var preserveEl = document.getElementById('net-opt-preserve');
  if (preserveEl && !preserveEl.checked) {
    clearNetworkMonitor();
  }
});

// Aba Rede Fluig: filtros, recarga, limpeza e acoes do inspector
var netFilterEl = document.getElementById('net-filter');
if (netFilterEl) { netFilterEl.addEventListener('input', renderNetworkMonitor); }

var netHideNoiseEl = document.getElementById('net-opt-hide-noise');
if (netHideNoiseEl) { netHideNoiseEl.addEventListener('change', renderNetworkMonitor); }

var btnNetReload = document.getElementById('btn-net-reload');
if (btnNetReload) { btnNetReload.addEventListener('click', loadNetworkMonitorFromHar); }

var btnNetClear = document.getElementById('btn-net-clear');
if (btnNetClear) { btnNetClear.addEventListener('click', clearNetworkMonitor); }

var tabRedePanel = document.getElementById('tab-rede');
if (tabRedePanel) {
  tabRedePanel.addEventListener('click', function (e) {
    if (!e.target.closest) { return; }

    var kindBtn = e.target.closest('[data-net-kind]');
    if (kindBtn) {
      netMonitorKindFilter = kindBtn.getAttribute('data-net-kind') || 'all';
      var allKindBtns = tabRedePanel.querySelectorAll('[data-net-kind]');
      for (var i = 0; i < allKindBtns.length; i++) {
        allKindBtns[i].classList.toggle('active', allKindBtns[i] === kindBtn);
      }
      renderNetworkMonitor();
      return;
    }

    var rowEl = e.target.closest('[data-net-select]');
    if (rowEl) {
      selectNetMonitorItem(rowEl.getAttribute('data-net-select'));
      return;
    }

    var copyCallBtn = e.target.closest('[data-net-copy-call]');
    if (copyCallBtn) {
      var callId = Number(copyCallBtn.getAttribute('data-net-copy-call'));
      var item = netMonitorItems.filter(function (x) { return x.id === callId; })[0];
      if (!item) { return; }
      ensureNetItemResponse(item).then(function () {
        copyWithFeedback(JSON.stringify(formatNetCallExportJson(item), null, 2), copyCallBtn);
      });
      return;
    }

    var copyRespBtn = e.target.closest('[data-net-copy-resp]');
    if (copyRespBtn) {
      var respId = Number(copyRespBtn.getAttribute('data-net-copy-resp'));
      var rItem = netMonitorItems.filter(function (x) { return x.id === respId; })[0];
      if (!rItem) { return; }
      ensureNetItemResponse(rItem).then(function () {
        var text = rItem.responseJson != null ? JSON.stringify(rItem.responseJson, null, 2) : (rItem.responseText || '');
        copyWithFeedback(text, copyRespBtn);
      });
      return;
    }

    var copyDsCodeBtn = e.target.closest('[data-net-copy-ds-code]');
    if (copyDsCodeBtn) {
      var dsId = Number(copyDsCodeBtn.getAttribute('data-net-copy-ds-code'));
      var dsItem = netMonitorItems.filter(function (x) { return x.id === dsId; })[0];
      if (!dsItem || !dsItem.datasetInfo) { return; }
      copyWithFeedback(buildDatasetSnippet(dsItem.datasetInfo), copyDsCodeBtn);
    }
  });
}

document.getElementById('read-field').focus();

// Resolve o documentId da solicitacao automaticamente ao abrir o painel.
loadSolicitacao();

// Carrega o browser de campos (que tambem aquece o indice para o autocomplete).
loadFieldBrowser();

// Inicializa o monitor de rede Fluig (HAR atual + listener em tempo real).
initNetworkMonitor();

// Aba Dump: "Incluir retornos" so faz sentido com datasets ou REST marcados.
function syncDumpOptions() {
  var anyCalls = document.getElementById('dump-opt-datasets').checked ||
    document.getElementById('dump-opt-rest').checked;
  ['dump-opt-responses'].forEach(function (id) {
    var el = document.getElementById(id);
    el.disabled = !anyCalls;
    el.parentNode.style.opacity = anyCalls ? '' : '0.5';
  });
  // O ruido do portal so existe em chamadas REST.
  var noise = document.getElementById('dump-opt-noise');
  var restOn = document.getElementById('dump-opt-rest').checked;
  noise.disabled = !restOn;
  noise.parentNode.style.opacity = restOn ? '' : '0.5';
}
document.getElementById('dump-opt-datasets').addEventListener('change', syncDumpOptions);
document.getElementById('dump-opt-rest').addEventListener('change', syncDumpOptions);
syncDumpOptions();
