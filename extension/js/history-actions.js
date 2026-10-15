// js/history-actions.js — Registro e acoes das entradas do historico
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Historico — registro de cada acao
// ---------------------------------------------------------------------------

// Uma leitura. `matches` vazio = nao encontrado (fica no historico tambem: saber
// que o campo NAO existia naquele momento e informacao de debug).
function recordRead(typed, matches) {
  var rows;
  if (!matches.length) {
    rows = [{ k: 'resultado', v: '<span class="err">não encontrado</span>' }];
  } else {
    rows = matches.map(function (m) {
      return { k: m.name === typed ? 'valor' : m.name, v: '<code>' + renderValue(m.value) + '</code>' };
    });
  }

  pushHistory('read', {
    label: typed,
    tags: matches.length === 1 ? matchTags(matches[0]) : '',
    rows: rows,
    typed: typed,
    // Assinatura para colapsar leituras repetidas identicas em "N×".
    signature: matches.map(function (m) { return m.name + '=' + m.value; }).join('|'),
    canRestore: false
  });
}

// Uma alteracao no DOM. `newValue` e o read-back (o que de fato ficou no campo),
// nao o que foi pedido.
function recordSet(rawName, oldValue, newValue, target) {
  pushHistory('set', {
    label: rawName,
    tags: target ? matchTags(target) : '',
    rows: [
      { k: 'anterior', v: '<code>' + renderValue(oldValue) + '</code>' },
      { k: 'novo', v: '<code>' + renderValue(newValue) + '</code>' }
    ],
    fieldName: rawName,
    oldValue: oldValue,
    canRestore: true
  });
}

// Uma gravacao no banco. `oldValue` null = nao foi possivel determinar o valor
// anterior no DOM (campo ausente ou ocorrencias com valores divergentes).
function recordDbSet(fieldName, documentId, oldValue, newValue) {
  var rows = [
    { k: 'documentId', v: '<code>' + esc(documentId) + '</code>' },
    {
      k: 'anterior (DOM)',
      v: oldValue === null
        ? '<span class="muted">não disponível</span>'
        : '<code>' + renderValue(oldValue) + '</code>'
    },
    { k: 'gravado', v: '<code>' + renderValue(newValue) + '</code>' }
  ];

  pushHistory('dbset', {
    label: fieldName,
    tags: '',
    rows: rows,
    fieldName: fieldName,
    oldValue: oldValue,
    // Sem valor anterior confiavel nao ha o que restaurar.
    canRestore: oldValue !== null
  });
}

// Valor atual de um campo no DOM a partir dos matches do buildFindExpr. Devolve
// null quando nao da para afirmar UM valor: campo ausente, ou ocorrencias
// espelhadas com valores divergentes. Preferimos "não disponível" a chutar.
function pickDomValue(matches) {
  if (!matches || !matches.length) { return null; }
  var exact = matches.filter(function (m) { return m.exact; });
  var pool = exact.length ? exact : matches;
  var distinct = [];
  pool.forEach(function (m) {
    if (distinct.indexOf(m.value) < 0) { distinct.push(m.value); }
  });
  return distinct.length === 1 ? distinct[0] : null;
}

// ---------------------------------------------------------------------------
// Historico — acoes das entradas
// ---------------------------------------------------------------------------

// Restaurar: preenche os inputs da secao com o valor ANTERIOR e ja dispara o
// passo de resolucao, caindo direto na confirmacao. Um clique para chegar la,
// mas a alteracao em si continua passando pela confirmacao obrigatoria.
function restoreFromHistory(kind, id) {
  var e = findHistoryEntry(kind, id);
  if (!e || !e.canRestore) { return; }
  var rf = document.getElementById('read-field');
  if (rf && e.fieldName) {
    rf.value = e.fieldName;
    readField();
  }
}

// Reler: leitura nao altera nada, entao roda direto.
function rereadFromHistory(id) {
  var e = findHistoryEntry('read', id);
  if (!e) { return; }
  document.getElementById('read-field').value = e.typed;
  readField();
}
