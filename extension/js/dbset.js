// js/dbset.js — Setar campo direto no banco
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Setar campo no banco (resolver documentId -> confirmar -> gravar)
// ---------------------------------------------------------------------------
//
// Grava direto no banco via dsSetCardValue, usando o documentId da solicitacao.
// Diferente do "Setar campo" (que faz $(campo).val() no DOM): funciona mesmo com
// a solicitacao finalizada, onde o DOM nao aceita a alteracao. Mesmo cuidado do
// outro: confirmacao obrigatoria antes de aplicar (ainda mais critico, pois
// grava no banco ignorando validacoes/logicas do formulario).

var pendingDbSet = null;

function dbSetResolve() {
  var fieldName = document.getElementById('dbset-field').value.trim();
  var value = document.getElementById('dbset-value').value; // valor vazio permitido (limpar)

  if (!fieldName) {
    render('dbset-output', '<span class="muted">Digite o nome do campo a gravar.</span>');
    return;
  }

  render('dbset-output', '<span class="muted">Resolvendo o documentId e lendo o valor atual…</span>');

  // O dsSetCardValue nao tem leitura correspondente, entao o valor anterior sai
  // do DOM. No caso principal desta secao — solicitacao finalizada — o <span>
  // carrega justamente o valor persistido, mas isso NAO e garantido (o DOM pode
  // estar defasado). Por isso o rotulo na UI e sempre "anterior (DOM)".
  // A leitura e best-effort: se falhar, segue sem valor anterior.
  Promise.all([
    evalInPage(buildDocumentIdExpr()),
    evalInPage(buildFindExpr(fieldName)).catch(function () { return null; })
  ])
    .then(function (pair) {
      var result = pair[0];
      var found = pair[1];
      if (!result || !result.ok || !result.documentId) {
        render('dbset-output', '<span class="err">Não consegui resolver o documentId: ' +
          esc((result && result.message) || 'sem retorno') + '</span>');
        return;
      }
      pendingDbSet = {
        documentId: result.documentId,
        numProcess: result.numProcess,
        fieldName: fieldName,
        value: value,
        previousDom: pickDomValue(found && found.matches)
      };
      showDbSetConfirmation(pendingDbSet);
    })
    .catch(function (exceptionInfo) {
      render('dbset-output', '<span class="err">Erro ao resolver: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

function showDbSetConfirmation(p) {
  render('dbset-output',
    '<div class="confirm">' +
    '<p><strong>Confirmar gravação no banco</strong></p>' +
    '<div class="row"><span class="k">Solicitação</span><code>' + esc(p.numProcess) + '</code></div>' +
    '<div class="row"><span class="k">documentId</span><code>' + esc(p.documentId) + '</code></div>' +
    '<div class="row"><span class="k">campo</span><code>' + esc(p.fieldName) + '</code></div>' +
    '<div class="row"><span class="k">anterior (DOM)</span>' +
    (p.previousDom === null
      ? '<span class="muted">não disponível</span>'
      : '<code>' + renderValue(p.previousDom) + '</code>') + '</div>' +
    '<div class="row"><span class="k">novo</span><code>' + renderValue(p.value) + '</code></div>' +
    '<p class="muted">Grava via <code>dsSetCardValue</code> <strong>direto no banco</strong>, ' +
    'ignorando o DOM e as validações/lógicas do formulário. Ação sensível.</p>' +
    '<div class="field-row">' +
    '<button id="btn-confirm-dbset" type="button" class="danger">Confirmar gravação</button>' +
    '<button id="btn-cancel-dbset" type="button">Cancelar</button>' +
    '</div>' +
    '</div>'
  );

  document.getElementById('btn-confirm-dbset').addEventListener('click', function () {
    applyDbSet();
  });
  document.getElementById('btn-cancel-dbset').addEventListener('click', function () {
    pendingDbSet = null;
    render('dbset-output', '<span class="muted">Gravação cancelada.</span>');
  });
}

function applyDbSet() {
  if (!pendingDbSet) {
    render('dbset-output', '<span class="muted">Nada pendente. Preencha e clique em Setar no banco.</span>');
    return;
  }
  var p = pendingDbSet;
  render('dbset-output', '<span class="muted">Gravando no banco…</span>');

  evalInPage(buildDbSetExpr(p.documentId, p.fieldName, p.value))
    .then(function (result) {
      pendingDbSet = null;
      if (!result || !result.ok) {
        render('dbset-output', '<span class="err">Falha ao gravar: ' +
          esc((result && result.message) || 'sem retorno') + '</span>');
        return;
      }
      recordDbSet(result.fieldName, result.documentId, p.previousDom, result.fieldValue);
      var html =
        '<div class="row"><span class="k">Gravado</span><span class="ok">no banco via dsSetCardValue</span></div>' +
        '<div class="row"><span class="k">documentId</span><code>' + esc(result.documentId) + '</code></div>' +
        '<div class="row"><span class="k">campo</span><code>' + esc(result.fieldName) + '</code></div>' +
        '<div class="row"><span class="k">valor</span><code>' + renderValue(result.fieldValue) + '</code></div>';
      if (result.values) {
        html += '<div class="row"><span class="k">retorno</span><code>' + esc(JSON.stringify(result.values)) + '</code></div>';
      }
      html += '<p class="muted">A gravação foi no banco (não no DOM aberto). Recarregue o formulário para ver o valor atualizado.</p>';
      render('dbset-output', html);
    })
    .catch(function (exceptionInfo) {
      pendingDbSet = null;
      render('dbset-output', '<span class="err">Erro ao gravar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}
