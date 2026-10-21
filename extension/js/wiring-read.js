// js/wiring-read.js — Wiring: eventos de leitura/historico
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Autocomplete ANTES dos handlers de Enter: listener na mesma tecla e no mesmo
// elemento dispara na ordem de registro, e o dropdown precisa poder consumir o
// Enter (escolher a sugestao) sem que o Ler/Setar rode junto.
attachAutocomplete('read-field', 'read-field-ac');

var tabBtnCampos = document.getElementById('tab-btn-campos');
if (tabBtnCampos) { tabBtnCampos.addEventListener('click', function () { switchTab('campos'); }); }

var tabBtnRede = document.getElementById('tab-btn-rede');
if (tabBtnRede) { tabBtnRede.addEventListener('click', function () { switchTab('rede'); }); }

var tabBtnDump = document.getElementById('tab-btn-dump');
if (tabBtnDump) { tabBtnDump.addEventListener('click', function () { switchTab('dump'); }); }

document.getElementById('btn-read').addEventListener('click', readField);
document.getElementById('read-field').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { readField(); }
});

// Delegacao em read-output para acoes de aplicar DOM e Banco nos cards de busca
document.getElementById('read-output').addEventListener('click', function (e) {
  if (!e.target.closest) { return; }

  // Setar DOM no card de busca
  var matchApplyDom = e.target.closest('[data-match-apply-dom]');
  if (matchApplyDom) {
    var rawName = matchApplyDom.getAttribute('data-match-apply-dom');
    var cardId = matchApplyDom.getAttribute('data-card-id');
    var ta = document.getElementById('match-val-' + cardId);
    var statusEl = document.getElementById('match-status-' + cardId);
    var newVal = ta ? ta.value : '';

    if (statusEl) { statusEl.innerHTML = '<span class="muted">Aplicando no DOM…</span>'; }

    evalInPage(buildSetExpr(rawName, newVal))
      .then(function (res) {
        if (!res || res.setCount === 0) {
          if (statusEl) { statusEl.innerHTML = '<span class="err">Elemento ' + esc(rawName) + ' não encontrado no DOM.</span>'; }
          return;
        }
        var readBackVal = res.readBack != null ? res.readBack : newVal;
        recordSet(rawName, '', readBackVal, { name: rawName });
        if (statusEl) { statusEl.innerHTML = '<span class="ok">✓ Valor aplicado no DOM (' + esc(res.setCount) + ' elemento(s))!</span>'; }
      })
      .catch(function (err) {
        if (statusEl) { statusEl.innerHTML = '<span class="err">Erro: ' + esc(formatErr(err)) + '</span>'; }
      });
    return;
  }

  // Setar Banco no card de busca
  var matchApplyDb = e.target.closest('[data-match-apply-db]');
  if (matchApplyDb) {
    var rawName = matchApplyDb.getAttribute('data-match-apply-db');
    var cardId = matchApplyDb.getAttribute('data-card-id');
    var ta = document.getElementById('match-val-' + cardId);
    var statusEl = document.getElementById('match-status-' + cardId);
    var newVal = ta ? ta.value : '';

    if (statusEl) { statusEl.innerHTML = '<span class="muted">Resolvendo documentId e gravando no banco…</span>'; }

    evalInPage(buildDocumentIdExpr())
      .then(function (docRes) {
        if (!docRes || !docRes.ok || !docRes.documentId) {
          if (statusEl) { statusEl.innerHTML = '<span class="err">Não foi possível resolver o documentId da solicitação.</span>'; }
          return;
        }
        return evalInPage(buildDbSetExpr(docRes.documentId, rawName, newVal))
          .then(function (dbRes) {
            if (!dbRes || !dbRes.ok) {
              if (statusEl) { statusEl.innerHTML = '<span class="err">Falha ao gravar no banco: ' + esc((dbRes && dbRes.message) || 'sem retorno') + '</span>'; }
              return;
            }
            recordDbSet(rawName, docRes.documentId, '', newVal);
            if (statusEl) { statusEl.innerHTML = '<span class="ok">✓ Gravado no banco (dsSetCardValue)! Recarregue o formulário para ver no DOM.</span>'; }
          });
      })
      .catch(function (err) {
        if (statusEl) { statusEl.innerHTML = '<span class="err">Erro: ' + esc(formatErr(err)) + '</span>'; }
      });
    return;
  }
});
