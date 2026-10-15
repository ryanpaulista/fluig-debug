// js/solicitacao.js — Solicitacao: documentId e helpers de dataset
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Solicitação: documentId a partir do nº da solicitação (CU-03)
// ---------------------------------------------------------------------------
//
// Fluxo (roda automatico ao abrir o painel, sem clique):
//   1. Le o numero da solicitacao na URL, em qualquer parametro do workflowview
//      terminado em processInstanceId (o nome muda conforme a origem da
//      abertura: _detailsProcessInstanceID na consulta, _processInstanceId na
//      tarefa). Ver numProcessFromUrl.
//   2. Consulta o dataset workflowProcess (via DatasetFactory CLIENT-SIDE, que
//      existe no contexto do formulario Fluig) filtrando por
//      workflowProcessPK.processInstanceId e pedindo cardDocumentId.
//   3. cardDocumentId e o documentId da solicitacao.
//
// Nao garimpamos o DOM: o valor vem do proprio dataset do Fluig (autoritativo).
// O DatasetFactory client-side devolve { columns, values }, onde values e um
// array de objetos indexados por nome de coluna (diferente do server-side).
// Helpers de dataset (client-side) injetados no IIFE. Reaproveitados pela
// resolucao do documentId e pelo "setar no banco".
var DATASET_HELPERS = [
  '  // Frame que expoe o DatasetFactory client-side do Fluig.',
  '  function findDatasetWin(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      try { if (wins[i].DatasetFactory && typeof wins[i].DatasetFactory.getDataset === "function") { return wins[i]; } } catch (e) {}',
  '    }',
  '    return null;',
  '  }',
  '  // Numero da solicitacao a partir da URL (param do workflowview). O nome do',
  '  // parametro MUDA conforme por onde a solicitacao foi aberta:',
  '  //   ...?app_ecm_workflowview_detailsProcessInstanceID=717  (consulta/detalhes)',
  '  //   ...?app_ecm_workflowview_processInstanceId=698707      (tarefa/movimentacao)',
  '  // Por isso nao fixamos um nome: varremos os parametros da query e aceitamos',
  '  // qualquer chave que termine em "processinstanceid" (case-insensitive) com',
  '  // valor numerico. O sufixo e especifico o bastante para nao pegar os vizinhos',
  '  // (currentMovto, taskUserId, managerMode).',
  '  function numProcessFromUrl(href) {',
  '    var qs = String(href).split("#")[0].split("?").slice(1).join("?");',
  '    if (!qs) { return null; }',
  '    var parts = qs.split("&");',
  '    for (var i = 0; i < parts.length; i++) {',
  '      var eq = parts[i].indexOf("=");',
  '      if (eq < 0) { continue; }',
  '      var key, val;',
  '      try { key = decodeURIComponent(parts[i].slice(0, eq)); val = decodeURIComponent(parts[i].slice(eq + 1)); } catch (e) { continue; }',
  '      if (!/processinstanceid$/i.test(key)) { continue; }',
  '      if (!/^\\d+$/.test(val)) { continue; }',
  '      return val;',
  '    }',
  '    return null;',
  '  }',
  '  function findNumProcess(wins) {',
  '    for (var i = 0; i < wins.length; i++) {',
  '      var href;',
  '      try { href = String(wins[i].location.href); } catch (e) { continue; }',
  '      var n = numProcessFromUrl(href);',
  '      if (n) { return n; }',
  '    }',
  '    return null;',
  '  }',
  '  // documentId da solicitacao: workflowProcess -> cardDocumentId + metadados workflowView.',
  '  function resolveDocId(wins) {',
  '    var numProcess = findNumProcess(wins);',
  '    if (!numProcess) { return { ok: false, stage: "url", message: "Número da solicitação não encontrado na URL (nenhum parâmetro *processInstanceId). Abra a extensão sobre uma solicitação de workflow." }; }',
  '',
  '    // Tenta obter metadados do ECM.workflowView através dos frames',
  '    var wfInfo = { formDescription: null, formVersion: null, sequence: null, currentStateDescription: null };',
  '    for (var wIdx = 0; wIdx < wins.length; wIdx++) {',
  '      var wObj = wins[wIdx];',
  '      var wv = null;',
  '      try {',
  '        if (wObj.ECM && wObj.ECM.workflowView) { wv = wObj.ECM.workflowView; }',
  '        else if (wObj.parent && wObj.parent.ECM && wObj.parent.ECM.workflowView) { wv = wObj.parent.ECM.workflowView; }',
  '        else if (wObj.top && wObj.top.ECM && wObj.top.ECM.workflowView) { wv = wObj.top.ECM.workflowView; }',
  '      } catch (e) {}',
  '',
  '      if (wv) {',
  '        if (wv.formDescription != null && wfInfo.formDescription == null) { wfInfo.formDescription = String(wv.formDescription).trim(); }',
  '        if (wv.formVersion != null && wfInfo.formVersion == null) { wfInfo.formVersion = String(wv.formVersion).trim(); }',
  '        if (wv.sequence != null && wfInfo.sequence == null) { wfInfo.sequence = String(wv.sequence).trim(); }',
  '        if (wv.currentStateDescription != null && wfInfo.currentStateDescription == null) { wfInfo.currentStateDescription = String(wv.currentStateDescription).trim(); }',
  '        if (wfInfo.formDescription || wfInfo.sequence) { break; }',
  '      }',
  '    }',
  '',
  '    var dsWin = findDatasetWin(wins);',
  '    if (!dsWin) {',
  '      return {',
  '        ok: false,',
  '        stage: "dataset",',
  '        numProcess: numProcess,',
  '        workflowView: wfInfo,',
  '        message: "DatasetFactory não disponível no client-side (formulário ainda carregando?). Tente Recarregar."',
  '      };',
  '    }',
  '    try {',
  '      var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
  '      var c1 = DF.createConstraint("workflowProcessPK.processInstanceId", numProcess, numProcess, CT.MUST);',
  '      var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
  '      var dataset = DF.getDataset("workflowProcess", ["cardIndexDocumentId", "cardDocumentId"], [c1, c4], null);',
  '      var values = (dataset && dataset.values) ? dataset.values : [];',
  '      if (!values.length) {',
  '        return {',
  '          ok: false,',
  '          stage: "empty",',
  '          numProcess: numProcess,',
  '          workflowView: wfInfo,',
  '          message: "Consulta ao workflowProcess retornou vazio para a solicitação " + numProcess + "."',
  '        };',
  '      }',
  '      var row = values[0];',
  '      return {',
  '        ok: true,',
  '        numProcess: numProcess,',
  '        documentId: (row.cardDocumentId != null ? String(row.cardDocumentId) : null),',
  '        cardIndexDocumentId: (row.cardIndexDocumentId != null ? String(row.cardIndexDocumentId) : null),',
  '        workflowView: wfInfo,',
  '        frame: (dsWin === window ? "top" : "iframe")',
  '      };',
  '    } catch (e) {',
  '      return {',
  '        ok: false,',
  '        stage: "query",',
  '        numProcess: numProcess,',
  '        workflowView: wfInfo,',
  '        message: "Erro na consulta ao dataset: " + (e && e.message ? e.message : String(e))',
  '      };',
  '    }',
  '  }'
].join('\n');

function buildDocumentIdExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    DATASET_HELPERS,
    '  return resolveDocId(collectWindows(window, [], 0));',
    '})()'
  ].join('\n');
}

// Grava fieldValue no campo fieldName DIRETO NO BANCO (dataset dsSetCardValue),
// pelo documentId ja resolvido. Nao mexe no DOM. Espelha a funcao setValue do
// time (que resolve o documentId internamente); aqui o documentId ja vem pronto.
function buildDbSetExpr(documentId, fieldName, fieldValue) {
  return [
    '(function () {',
    PAGE_HELPERS,
    DATASET_HELPERS,
    '  var wins = collectWindows(window, [], 0);',
    '  var dsWin = findDatasetWin(wins);',
    '  if (!dsWin) { return { ok: false, message: "DatasetFactory não disponível no client-side." }; }',
    '  var documentId = ' + JSON.stringify(String(documentId)) + ';',
    '  var fieldName = ' + JSON.stringify(String(fieldName)) + ';',
    '  var fieldValue = ' + JSON.stringify(String(fieldValue)) + ';',
    '  try {',
    '    var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
    '    var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
    '    var c1 = DF.createConstraint("documentid", documentId, documentId, CT.MUST);',
    '    var c2 = DF.createConstraint("fieldName", fieldName, fieldName, CT.MUST);',
    '    var c3 = DF.createConstraint("fieldValue", fieldValue, fieldValue, CT.MUST);',
    '    var result = DF.getDataset("dsSetCardValue", null, [c1, c2, c3, c4], null);',
    '    var out = { ok: true, documentId: documentId, fieldName: fieldName, fieldValue: fieldValue };',
    '    try { out.columns = (result && result.columns) ? result.columns : null; } catch (e) {}',
    '    try { out.values = (result && result.values) ? result.values : null; } catch (e) {}',
    '    return out;',
    '  } catch (e) { return { ok: false, documentId: documentId, message: "Erro ao gravar no banco: " + (e && e.message ? e.message : String(e)) }; }',
    '})()'
  ].join('\n');
}

function renderSolicitacao(result) {
  var status = document.getElementById('solicitacao-status');

  if (!result) {
    status.innerHTML = '<span class="err">Sem retorno.</span>';
    render('solicitacao-output', '<span class="err">Sem retorno da página.</span>');
    return;
  }

  if (!result.ok) {
    status.innerHTML = '<span class="err">não resolvido</span>';
    var head = result.numProcess
      ? '<div class="row"><span class="k">Solicitação</span><code>' + esc(result.numProcess) + '</code></div>'
      : '';
    render('solicitacao-output', head +
      '<div class="row"><span class="k">documentId</span><span class="err">' + esc(result.message) + '</span></div>');
    return;
  }

  status.innerHTML = '<span class="ok">documentId resolvido</span>';
  var html =
    '<div class="row"><span class="k">Solicitação</span>' + renderCopyable(result.numProcess) + '</div>' +
    '<div class="row"><span class="k">documentId</span>' + renderCopyable(result.documentId, '<span class="ok">' + esc(result.documentId) + '</span>') + '</div>';
  if (result.cardIndexDocumentId && result.cardIndexDocumentId !== result.documentId) {
    html += '<div class="row"><span class="k">cardIndex</span>' + renderCopyable(result.cardIndexDocumentId) + '</div>';
  }

  // Metadados do workflowView (Formulário e Atividade Atual)
  var wv = result.workflowView || {};
  if (wv.formDescription) {
    var formLabel = esc(wv.formDescription);
    var formEsc = '<code>' + formLabel + '</code>';
    if (wv.formVersion) {
      formEsc += ' <span class="tag">v. ' + esc(wv.formVersion) + '</span>';
    }
    html += '<div class="row"><span class="k">Formulário</span>' + renderCopyable(wv.formDescription, formEsc) + '</div>';
  } else if (wv.formVersion) {
    html += '<div class="row"><span class="k">Versão form</span>' + renderCopyable(wv.formVersion) + '</div>';
  }

  if (wv.sequence || wv.currentStateDescription) {
    var ativText = '';
    if (wv.sequence && wv.currentStateDescription) {
      ativText = wv.sequence + ' - ' + wv.currentStateDescription;
    } else if (wv.sequence) {
      ativText = wv.sequence;
    } else {
      ativText = wv.currentStateDescription;
    }
    html += '<div class="row"><span class="k">Atividade</span>' + renderCopyable(ativText) + '</div>';
  }

  render('solicitacao-output', html);
}

function loadSolicitacao() {
  var status = document.getElementById('solicitacao-status');
  status.textContent = 'Resolvendo…';
  render('solicitacao-output', '<span class="muted">Lendo a solicitação e consultando o documentId…</span>');

  evalInPage(buildDocumentIdExpr())
    .then(renderSolicitacao)
    .catch(function (exceptionInfo) {
      status.innerHTML = '<span class="err">erro</span>';
      render('solicitacao-output', '<span class="err">Erro ao resolver: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}
