// js/history.js — Historico por secao (ler / setar / setar no banco)
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// UI — Historico por secao
// ---------------------------------------------------------------------------
//
// Um historico independente por secao de interacao (ler / setar / setar no
// banco), com botao "Histórico (N)" que abre e fecha o bloco.
//
// EFEMERO DE PROPOSITO: vive so em memoria do painel. O painel do DevTools
// mantem seu contexto JS enquanto o F12 esta aberto (sobrevive a navegacao da
// pagina), e some quando o DevTools fecha. Nada vai para storage — o mesmo
// principio do dump, que tambem nao persiste.
//
// O valor de um histerico de setar e poder VOLTAR: cada entrada guarda o valor
// anterior e o novo, e o "Restaurar" devolve o anterior.
var HISTORY_MAX = 50;
var histories = { read: [], set: [], dbset: [] };
// Id proprio por entrada: o "Restaurar" busca por id, nao por indice. Indice
// mudaria embaixo de um bloco ja renderizado quando uma entrada nova entra.
var historySeq = 0;

var HISTORY_UI = {
  read: { box: 'read-history', button: 'btn-read-history' },
  set: { box: 'read-history', button: 'btn-read-history' },
  dbset: { box: 'read-history', button: 'btn-read-history' }
};

function formatErr(err) {
  if (!err) { return 'erro desconhecido'; }
  if (typeof err === 'string') { return err; }
  if (err.message) { return err.message; }
  if (err.description) { return err.description; }
  try {
    var s = JSON.stringify(err);
    if (s && s !== '{}') { return s; }
  } catch (e) {}
  return String(err);
}

function hhmmss(date) {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function pushHistory(kind, entry) {
  var list = histories[kind];
  if (!list) { list = histories[kind] = []; }
  entry.id = ++historySeq;
  entry.at = new Date();
  entry.repeat = 1;

  // Leitura repetida do mesmo campo com o mesmo valor colapsa em contador: ler
  // 5x para acompanhar um campo nao deve empurrar o resto do historico para
  // fora. Acao de escrita nunca colapsa — cada gravacao e um evento proprio.
  if (kind === 'read' && list.length) {
    var prev = list[0];
    if (prev.typed === entry.typed && prev.signature === entry.signature) {
      prev.repeat++;
      prev.at = entry.at;
      renderHistory(kind);
      return;
    }
  }

  list.unshift(entry);
  if (list.length > HISTORY_MAX) { list.length = HISTORY_MAX; }
  renderHistory(kind);
}

function findHistoryEntry(kind, id) {
  var list = histories[kind];
  if (!list) { return null; }
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { return list[i]; }
  }
  return null;
}

// Rotulo do botao com a contagem unificada das acoes na sessao.
function paintHistoryButton(kind) {
  var ui = HISTORY_UI[kind] || HISTORY_UI.read;
  var btn = document.getElementById(ui.button);
  if (!btn) { return; }
  var total = (histories.read ? histories.read.length : 0) +
              (histories.set ? histories.set.length : 0) +
              (histories.dbset ? histories.dbset.length : 0);
  btn.textContent = total ? 'Histórico (' + total + ')' : 'Histórico';
}

function historyItemHtml(kind, e) {
  var kindTag = '';
  if (kind === 'set') {
    kindTag = ' <span class="tag warn">DOM</span>';
  } else if (kind === 'dbset') {
    kindTag = ' <span class="tag danger">Banco</span>';
  } else if (kind === 'read') {
    kindTag = ' <span class="tag">Leitura</span>';
  }

  var head =
    '<div class="row"><span class="hist-time">' + hhmmss(e.at) + '</span>' +
    '<code>' + esc(e.label) + '</code>' + kindTag + (e.tags ? ' ' + e.tags : '') +
    (e.repeat > 1 ? ' <span class="tag">' + e.repeat + '×</span>' : '') + '</div>';

  var body = e.rows.map(function (r) {
    return '<div class="row"><span class="k">' + esc(r.k) + '</span>' + r.v + '</div>';
  }).join('');

  var actions = '';
  if (e.canRestore) {
    actions = '<div class="field-row"><button type="button" data-hist-restore="' + kind + ':' + e.id + '">' +
      'Restaurar valor anterior</button></div>';
  } else if (kind === 'read') {
    actions = '<div class="field-row"><button type="button" data-hist-reread="' + e.id + '">' +
      'Ler de novo</button></div>';
  }

  return '<div class="hist-item">' + head + body + actions + '</div>';
}

function renderHistory(kind) {
  paintHistoryButton('read');

  var ui = HISTORY_UI[kind] || HISTORY_UI.read;
  var box = document.getElementById(ui.box);
  if (!box || box.style.display !== 'block') { return; }

  var allEntries = [];
  ['read', 'set', 'dbset'].forEach(function (k) {
    (histories[k] || []).forEach(function (e) {
      allEntries.push({ kind: k, entry: e });
    });
  });
  allEntries.sort(function (a, b) { return b.entry.at - a.entry.at; });

  var head =
    '<div class="hist-head"><strong>Histórico de Ações</strong> ' +
    '<span class="muted">só nesta sessão do DevTools</span>' +
    (allEntries.length ? '<button type="button" data-hist-clear="all">Limpar</button>' : '') +
    '</div>';

  if (!allEntries.length) {
    box.innerHTML = head + '<p class="muted">Nenhum registro ainda nesta sessão.</p>';
    return;
  }

  box.innerHTML = head + allEntries.map(function (item) {
    return historyItemHtml(item.kind, item.entry);
  }).join('');
}

function toggleHistory(kind) {
  var ui = HISTORY_UI[kind] || HISTORY_UI.read;
  var box = document.getElementById(ui.box);
  if (!box) { return; }
  var open = box.style.display === 'block';
  box.style.display = open ? 'none' : 'block';
  if (!open) { renderHistory(kind); }
}
