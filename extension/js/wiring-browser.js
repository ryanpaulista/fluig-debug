// js/wiring-browser.js — Wiring: eventos do browser de campos
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// Browser de campos: filtro e cliques delegados nos containers estaveis.
var browserFilterInput = document.getElementById('field-browser-filter');
browserFilterInput.addEventListener('input', function () {
  if (!browserFields.length) {
    loadFieldBrowser();
    return;
  }
  renderFieldBrowser();
});
browserFilterInput.addEventListener('focus', function () {
  if (!browserFields.length) {
    loadFieldBrowser();
  }
});
document.getElementById('btn-browser-reload').addEventListener('click', reloadFieldBrowser);
document.getElementById('field-browser-body').addEventListener('click', function (e) {
  if (!e.target.closest) { return; }

  // Toggle de tabela pai-filho
  var band = e.target.closest('[data-toggle-table]');
  if (band) {
    toggleBrowserTable(band.getAttribute('data-toggle-table'));
    return;
  }

  // Alternancia de modo da tabela (linhas vs colunas)
  var modeBtn = e.target.closest('[data-tbl-mode]');
  if (modeBtn) {
    var parts = modeBtn.getAttribute('data-tbl-mode').split(':');
    setBrowserTableMode(parts[0], parts[1]);
    return;
  }

  // Selecao de celula no DataGrid (estilo DataGrip)
  var elCell = e.target.closest('[data-dg-cell]');
  if (elCell) {
    var tName = elCell.getAttribute('data-dg-cell');
    var rowIdx = elCell.getAttribute('data-dg-row');
    var colName = elCell.getAttribute('data-dg-col');
    var rawName = elCell.getAttribute('data-dg-raw');
    var cellType = elCell.getAttribute('data-dg-type');
    var cellDisabled = elCell.getAttribute('data-dg-disabled') === 'true';

    // Encontra o valor real indexado
    var foundVal = '';
    for (var bi = 0; bi < browserRows.length; bi++) {
      var br = browserRows[bi];
      if (br.name === rawName || (br.child === rowIdx && br.logical === colName)) {
        foundVal = br.value;
        break;
      }
    }

    browserSelectedCells[tName] = {
      rowIdx: rowIdx,
      colName: colName,
      rawName: rawName,
      value: foundVal,
      type: cellType,
      disabled: cellDisabled
    };
    renderFieldBrowser();
    var ta = document.getElementById('dg-val-' + tName);
    if (ta) { initTextareaHistory(ta, foundVal); }
    return;
  }

  // Acao: Setar DOM direto do Inspector da celula
  var elApplyDom = e.target.closest('[data-dg-apply-dom]');
  if (elApplyDom) {
    var tName = elApplyDom.getAttribute('data-dg-apply-dom');
    var selected = browserSelectedCells[tName];
    if (!selected) { return; }
    var ta = document.getElementById('dg-val-' + tName);
    var newVal = ta ? ta.value : '';
    var statusEl = document.getElementById('dg-status-' + tName);
    if (statusEl) { statusEl.innerHTML = '<span class="muted">Aplicando no DOM…</span>'; }

    evalInPage(buildSetExpr(selected.rawName, newVal))
      .then(function (res) {
        if (!res || res.setCount === 0) {
          if (statusEl) { statusEl.innerHTML = '<span class="err">Elemento ' + esc(selected.rawName) + ' não encontrado no DOM.</span>'; }
          return;
        }
        var readBackVal = res.readBack != null ? res.readBack : newVal;
        selected.value = readBackVal;
        recordSet(selected.rawName, selected.value, readBackVal, { name: selected.rawName, type: selected.type, disabled: selected.disabled });
        // Atualiza o valor no index em memoria
        for (var bi = 0; bi < browserRows.length; bi++) {
          if (browserRows[bi].name === selected.rawName || (browserRows[bi].child === selected.rowIdx && browserRows[bi].logical === selected.colName)) {
            browserRows[bi].value = readBackVal;
            break;
          }
        }
        renderFieldBrowser();
        var newStatus = document.getElementById('dg-status-' + tName);
        if (newStatus) { newStatus.innerHTML = '<span class="ok">✓ Valor aplicado no DOM com sucesso!</span>'; }
      })
      .catch(function (err) {
        if (statusEl) { statusEl.innerHTML = '<span class="err">Erro: ' + esc(formatErr(err)) + '</span>'; }
      });
    return;
  }

  // Acao: Setar Banco direto do Inspector da celula
  var elApplyDb = e.target.closest('[data-dg-apply-db]');
  if (elApplyDb) {
    var tName = elApplyDb.getAttribute('data-dg-apply-db');
    var selected = browserSelectedCells[tName];
    if (!selected) { return; }
    var ta = document.getElementById('dg-val-' + tName);
    var newVal = ta ? ta.value : '';
    var statusEl = document.getElementById('dg-status-' + tName);
    if (statusEl) { statusEl.innerHTML = '<span class="muted">Resolvendo documentId e gravando no banco…</span>'; }

    evalInPage(buildDocumentIdExpr())
      .then(function (docRes) {
        if (!docRes || !docRes.ok || !docRes.documentId) {
          if (statusEl) { statusEl.innerHTML = '<span class="err">Não foi possível resolver o documentId da solicitação.</span>'; }
          return;
        }
        return evalInPage(buildDbSetExpr(docRes.documentId, selected.rawName, newVal))
          .then(function (dbRes) {
            if (!dbRes || !dbRes.ok) {
              if (statusEl) { statusEl.innerHTML = '<span class="err">Falha ao gravar no banco: ' + esc((dbRes && dbRes.message) || 'sem retorno') + '</span>'; }
              return;
            }
            recordDbSet(selected.rawName, docRes.documentId, selected.value, newVal);
            selected.value = newVal;
            for (var bi = 0; bi < browserRows.length; bi++) {
              if (browserRows[bi].name === selected.rawName || (browserRows[bi].child === selected.rowIdx && browserRows[bi].logical === selected.colName)) {
                browserRows[bi].value = newVal;
                break;
              }
            }
            renderFieldBrowser();
            var newStatus = document.getElementById('dg-status-' + tName);
            if (newStatus) { newStatus.innerHTML = '<span class="ok">✓ Gravado no banco (dsSetCardValue)! Recarregue o form para ver no DOM.</span>'; }
          });
      })
      .catch(function (err) {
        if (statusEl) { statusEl.innerHTML = '<span class="err">Erro: ' + esc(formatErr(err)) + '</span>'; }
      });
    return;
  }

  // Acao: Reler celula
  var elReloadCell = e.target.closest('[data-dg-reload-cell]');
  if (elReloadCell) {
    var tName = elReloadCell.getAttribute('data-dg-reload-cell');
    var selected = browserSelectedCells[tName];
    if (!selected) { return; }
    var statusEl = document.getElementById('dg-status-' + tName);
    if (statusEl) { statusEl.innerHTML = '<span class="muted">Lendo valor atual…</span>'; }

    evalInPage(buildFindExpr(selected.rawName))
      .then(function (findRes) {
        var matches = (findRes && findRes.matches) || [];
        if (matches.length > 0) {
          selected.value = matches[0].value;
          for (var bi = 0; bi < browserRows.length; bi++) {
            if (browserRows[bi].name === selected.rawName || (browserRows[bi].child === selected.rowIdx && browserRows[bi].logical === selected.colName)) {
              browserRows[bi].value = matches[0].value;
              break;
            }
          }
          renderFieldBrowser();
          var newStatus = document.getElementById('dg-status-' + tName);
          if (newStatus) { newStatus.innerHTML = '<span class="ok">✓ Valor atualizado do DOM.</span>'; }
        } else {
          if (statusEl) { statusEl.innerHTML = '<span class="err">Campo não encontrado na página.</span>'; }
        }
      })
      .catch(function (err) {
        if (statusEl) { statusEl.innerHTML = '<span class="err">Erro ao ler: ' + esc(formatErr(err)) + '</span>'; }
      });
    return;
  }

  // Acao de ler campo (fora do grid)
  var elRead = e.target.closest('[data-browse-read]');
  if (elRead) {
    readFromBrowser(elRead.getAttribute('data-browse-read'));
    return;
  }

  // Acao de setar campo (fora do grid)
  var elSet = e.target.closest('[data-browse-set]');
  if (elSet) {
    setFromBrowser(elSet.getAttribute('data-browse-set'), elSet.getAttribute('data-val'));
    return;
  }

  // Acao de copiar nome do campo ou valor
  var elCopy = e.target.closest('[data-browse-copy]');
  if (elCopy) {
    copyWithFeedback(elCopy.getAttribute('data-browse-copy'), elCopy);
  }
});
