// panel.js
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

function evalInPage(expression) {
  return new Promise(function (resolve, reject) {
    chrome.devtools.inspectedWindow.eval(expression, function (result, exceptionInfo) {
      if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
        reject(exceptionInfo);
        return;
      }
      resolve(result);
    });
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
  '    acc.push(win);',
  '    if (depth > 5) { return acc; }',
  '    var frames;',
  '    try { frames = win.frames; } catch (e) { return acc; }',
  '    for (var i = 0; i < frames.length; i++) {',
  '      try { var f = frames[i]; void f.document; collectWindows(f, acc, depth + 1); }',
  '      catch (e) { /* cross-origin: ignora */ }',
  '    }',
  '    return acc;',
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

// ---------------------------------------------------------------------------
// Localizar campo (usado por ler e por setar)
// ---------------------------------------------------------------------------

// Localiza um campo pelo nome digitado, tratando "_" e "___N", e retorna todas
// as ocorrencias reais no DOM. Cada match traz `exact` (name/id igual ao
// digitado) para o setar poder mirar uma ocorrencia especifica.
function buildFindExpr(typed) {
  var typedLit = JSON.stringify(typed);
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var typed = ' + typedLit + ';',
    '  var base = logical(typed);',
    '  // Se o usuario digitou um "___N" explicito (ex: nome___1), mira SO aquela',
    '  // linha da tabela pai-filho. Sem sufixo, traz todas as ocorrencias.',
    '  var typedChildMatch = String(typed).match(/___(\\d+)$/);',
    '  var typedChild = typedChildMatch ? typedChildMatch[1] : null;',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var matches = [];',
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
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      if (logical(raw) !== base) { continue; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var rawChild = childMatch ? childMatch[1] : null;',
    '      // Filtro por linha: se pediu ___N, so casa a mesma linha.',
    '      if (typedChild !== null && rawChild !== typedChild) { continue; }',
    '',
    '      var v = readValue(node, jq);',
    '      if (v == null) { v = ""; }',
    '',
    '      var table = null;',
    '      try { var t = node.closest ? node.closest("table[tablename]") : null; if (t) { table = t.getAttribute("tablename"); } } catch (e) {}',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      matches.push({',
    '        name: raw,',
    '        id: id,',
    '        value: String(v),',
    '        disabled: disabled,',
    '        child: rawChild,',
    '        table: table,',
    '        type: String(node.type || node.tagName || "").toLowerCase(),',
    '        frame: (w === window ? "top" : "iframe"),',
    '        exact: (String(raw) === typed)',
    '      });',
    '    }',
    '  }',
    '',
    '  return { typed: typed, base: base, matches: matches, framesScanned: wins.length };',
    '})()'
  ].join('\n');
}

// Coleta a LINHA inteira de uma tabela pai-filho: todos os campos que estao na
// MESMA tabela (tablename) e no MESMO indice de linha (___N). O escopo por
// tablename e essencial: duas tabelas pai-filho podem ter a linha ___0, e sem
// isso as linhas de tabelas diferentes se misturariam.
function buildRowExpr(tablename, child) {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var wantTable = ' + JSON.stringify(String(tablename)) + ';',
    '  var wantChild = ' + JSON.stringify(String(child)) + ';',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var fields = [];',
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
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var rawChild = childMatch ? childMatch[1] : null;',
    '      if (rawChild !== wantChild) { continue; }',
    '',
    '      var table = null;',
    '      try { var t = node.closest ? node.closest("table[tablename]") : null; if (t) { table = t.getAttribute("tablename"); } } catch (e) {}',
    '      if (table !== wantTable) { continue; }',
    '',
    '      var v = readValue(node, jq);',
    '      if (v == null) { v = ""; }',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      fields.push({',
    '        name: raw,',
    '        field: logical(raw),',
    '        value: String(v),',
    '        disabled: disabled,',
    '        type: String(node.type || node.tagName || "").toLowerCase()',
    '      });',
    '    }',
    '  }',
    '',
    '  return { table: wantTable, child: wantChild, fields: fields };',
    '})()'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Indice de campos (base do autocomplete)
// ---------------------------------------------------------------------------
//
// Varre os mesmos nos que o dump (input/select/textarea/span[name]) em todos os
// frames e devolve DUAS listas:
//   fields — um item por NOME LOGICO, que e o que o usuario digita no dia a dia
//            (a extensao resolve o "_" e o "___N" sozinha). Traz a contagem de
//            ocorrencias e quantas linhas ___N existem.
//   rows   — um item por ocorrencia ___N (name cru). Usada so quando o usuario
//            digita "___" para mirar uma linha especifica de tabela pai-filho.
//
// O valor vem TRUNCADO em VALUE_MAX: no dropdown ele e um preview de uma linha,
// e isso evita arrastar textarea inteira na serializacao do eval.
//
// Botoes (button/submit/reset/image) ficam fora: tem name mas nunca sao alvo de
// ler/setar, so poluiriam a lista. O indice e, portanto, um SUBCONJUNTO do que o
// "Ler" consegue achar — nunca o contrario.
function buildFieldIndexExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var VALUE_MAX = 60;',
    '  var MAX_FIELDS = 600;',
    '  var MAX_ROWS = 1200;',
    '  function preview(v) {',
    '    var s = String(v == null ? "" : v).replace(/\\s+/g, " ").replace(/^ | $/g, "");',
    '    return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX) + "\\u2026" : s;',
    '  }',
    '',
    '  var wins = collectWindows(window, [], 0);',
    '  var groups = {};',
    '  var order = [];',
    '  var rows = [];',
    '  var rowSeen = {};',
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
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      var lg = logical(raw);',
    '      if (!lg) { continue; }',
    '',
    '      var ntype = String(node.type || node.tagName || "").toLowerCase();',
    '      if (ntype === "button" || ntype === "submit" || ntype === "reset" || ntype === "image") { continue; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var child = childMatch ? childMatch[1] : null;',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '      var table = null;',
    '      try { var t = node.closest ? node.closest("table[tablename]") : null; if (t) { table = t.getAttribute("tablename"); } } catch (e) {}',
    '      var val = preview(readValue(node, jq));',
    '',
    '      var g = groups[lg];',
    '      if (!g) {',
    '        g = { logical: lg, occurrences: 0, rowCount: 0, disabled: false, type: ntype, table: table, value: val };',
    '        groups[lg] = g;',
    '        order.push(lg);',
    '      }',
    '      g.occurrences++;',
    '      if (child !== null) { g.rowCount++; }',
    '      if (disabled) { g.disabled = true; }',
    '      if (!g.table && table) { g.table = table; }',
    '      // Campo espelhado do Fluig costuma ter uma copia vazia: prefere o',
    '      // primeiro valor NAO vazio para o preview nao mentir "(vazio)".',
    '      if (!g.value && val) { g.value = val; }',
    '',
    '      if (child !== null && !rowSeen[raw]) {',
    '        rowSeen[raw] = 1;',
    '        rows.push({ name: raw, logical: lg, child: child, table: table, disabled: disabled, type: ntype, value: val });',
    '      }',
    '    }',
    '  }',
    '',
    '  order.sort();',
    '  var fields = [];',
    '  for (var k = 0; k < order.length; k++) { fields.push(groups[order[k]]); }',
    '  rows.sort(function (a, b) {',
    '    if (a.logical !== b.logical) { return a.logical < b.logical ? -1 : 1; }',
    '    return Number(a.child) - Number(b.child);',
    '  });',
    '',
    '  return {',
    '    fields: fields.slice(0, MAX_FIELDS),',
    '    rows: rows.slice(0, MAX_ROWS),',
    '    fieldsTotal: fields.length,',
    '    rowsTotal: rows.length,',
    '    framesScanned: wins.length',
    '  };',
    '})()'
  ].join('\n');
}

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

// ---------------------------------------------------------------------------
// UI — utilitarios
// ---------------------------------------------------------------------------

function render(id, html) {
  document.getElementById(id).innerHTML = html;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderValue(v) {
  return v === '' ? '<span class="muted">(vazio)</span>' : esc(v);
}

function matchTags(m) {
  var tags = [];
  if (m.disabled) { tags.push('<span class="tag warn">desabilitado (_)</span>'); }
  if (m.child) { tags.push('<span class="tag">linha ' + esc(m.child) + '</span>'); }
  if (m.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (m.type) { tags.push('<span class="tag">' + esc(m.type) + '</span>'); }
  return tags.join(' ');
}

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
  set: { box: 'set-history', button: 'btn-set-history' },
  dbset: { box: 'dbset-history', button: 'btn-dbset-history' }
};

function hhmmss(date) {
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function pushHistory(kind, entry) {
  var list = histories[kind];
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
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) { return list[i]; }
  }
  return null;
}

// Rotulo do botao com a contagem, para dar pista de que ha algo la dentro.
function paintHistoryButton(kind) {
  var btn = document.getElementById(HISTORY_UI[kind].button);
  var n = histories[kind].length;
  btn.textContent = n ? 'Histórico (' + n + ')' : 'Histórico';
}

function historyItemHtml(kind, e) {
  var head =
    '<div class="row"><span class="hist-time">' + hhmmss(e.at) + '</span>' +
    '<code>' + esc(e.label) + '</code>' + (e.tags ? ' ' + e.tags : '') +
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
  paintHistoryButton(kind);

  var box = document.getElementById(HISTORY_UI[kind].box);
  // Fechado: nao gasta render. Reabrir chama renderHistory de novo.
  if (box.style.display !== 'block') { return; }

  var list = histories[kind];
  var head =
    '<div class="hist-head"><strong>Histórico</strong> ' +
    '<span class="muted">só nesta sessão do DevTools</span>' +
    (list.length ? '<button type="button" data-hist-clear="' + kind + '">Limpar</button>' : '') +
    '</div>';

  if (!list.length) {
    box.innerHTML = head + '<p class="muted">Nenhum registro ainda nesta sessão.</p>';
    return;
  }

  box.innerHTML = head + list.map(function (e) { return historyItemHtml(kind, e); }).join('');
}

function toggleHistory(kind) {
  var box = document.getElementById(HISTORY_UI[kind].box);
  var open = box.style.display === 'block';
  box.style.display = open ? 'none' : 'block';
  if (!open) { renderHistory(kind); }
}

// ---------------------------------------------------------------------------
// UI — Autocomplete de nome de campo
// ---------------------------------------------------------------------------
//
// Plugado nos tres inputs de NOME de campo (Ler / Setar / Setar no banco). Os
// inputs de VALOR nao tem autocomplete.
//
// Indice em cache: uma varredura serve para os tres inputs e para varias teclas.
// O TTL e curto porque o formulario Fluig muda em runtime (linha nova em tabela
// pai-filho, campo habilitado/desabilitado), mas evita uma varredura por tecla.
var fieldIndex = null;
var fieldIndexAt = 0;
var fieldIndexPending = null;
var INDEX_TTL_MS = 3000;
var MAX_SUGGESTIONS = 50;
var EMPTY_INDEX = { fields: [], rows: [], fieldsTotal: 0, rowsTotal: 0 };

function ensureFieldIndex() {
  if (fieldIndex && (Date.now() - fieldIndexAt) < INDEX_TTL_MS) {
    return Promise.resolve(fieldIndex);
  }
  // Uma varredura em voo por vez: as 3 caixas compartilham a mesma promise.
  if (fieldIndexPending) { return fieldIndexPending; }

  fieldIndexPending = evalInPage(buildFieldIndexExpr())
    .then(function (result) {
      fieldIndex = result || EMPTY_INDEX;
      fieldIndexAt = Date.now();
      fieldIndexPending = null;
      return fieldIndex;
    })
    .catch(function () {
      fieldIndexPending = null;
      // Autocomplete e conveniencia: se a varredura falhar (pagina navegando,
      // formulario ainda carregando), o input segue funcionando na digitacao
      // manual. Nao poluimos a UI com erro por causa da sugestao.
      return fieldIndex || EMPTY_INDEX;
    });

  return fieldIndexPending;
}

function invalidateFieldIndex() {
  fieldIndex = null;
  fieldIndexAt = 0;
}

// Filtra o indice pelo que foi digitado. Dois modos:
//   normal    — casa o NOME LOGICO; prefixo vem antes de substring no ranking.
//   por linha — disparado quando o texto contem "___": lista as ocorrencias
//               ___N. O que vem antes do "___" filtra o nome, o que vem depois
//               filtra o numero da linha (ex: "desc___1" -> linhas 1, 10, 11...).
function filterSuggestions(index, typed) {
  var q = String(typed || '').trim().toLowerCase();
  var sepAt = q.indexOf('___');

  if (sepAt >= 0) {
    var namePart = q.slice(0, sepAt);
    var childPart = q.slice(sepAt + 3);
    return (index.rows || []).filter(function (r) {
      if (namePart && String(r.logical).toLowerCase().indexOf(namePart) < 0) { return false; }
      if (childPart && String(r.child).indexOf(childPart) !== 0) { return false; }
      return true;
    }).map(function (r) {
      return { label: r.name, item: r, row: true };
    });
  }

  var pool = index.fields || [];
  var picked;
  if (!q) {
    picked = pool;
  } else {
    var starts = [];
    var contains = [];
    pool.forEach(function (f) {
      var at = String(f.logical).toLowerCase().indexOf(q);
      if (at === 0) { starts.push(f); }
      else if (at > 0) { contains.push(f); }
    });
    picked = starts.concat(contains);
  }
  return picked.map(function (f) {
    return { label: f.logical, item: f, row: false };
  });
}

// Badges da sugestao. Reaproveita o vocabulario do matchTags (mesmas tags que o
// resultado do Ler usa) e acrescenta tabela / contagens.
function suggestionTags(s) {
  var item = s.item;
  var tags = [];
  if (item.disabled) { tags.push('<span class="tag warn">desabilitado (_)</span>'); }
  if (s.row) { tags.push('<span class="tag">linha ' + esc(item.child) + '</span>'); }
  else if (item.rowCount) { tags.push('<span class="tag">' + item.rowCount + ' linha(s)</span>'); }
  else if (item.occurrences > 1) { tags.push('<span class="tag">' + item.occurrences + ' ocorrência(s)</span>'); }
  if (item.table) { tags.push('<span class="tag">' + esc(item.table) + '</span>'); }
  if (item.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (item.type) { tags.push('<span class="tag">' + esc(item.type) + '</span>'); }
  return tags.join(' ');
}

// Liga um dropdown de sugestoes a um input. Uma instancia por input, com estado
// proprio (a lista visivel e o item ativo).
//
// A lista NAO abre so por foco: abre ao digitar (o pedido da feature) ou com a
// seta para baixo, que serve de "me mostra tudo". Assim o painel nao abre com um
// dropdown gigante na cara ao carregar.
function attachAutocomplete(inputId, boxId) {
  var input = document.getElementById(inputId);
  var box = document.getElementById(boxId);
  var shown = [];
  var hidden = 0;
  var active = -1;
  var open = false;

  function close() {
    open = false;
    active = -1;
    box.style.display = 'none';
    box.innerHTML = '';
  }

  function foot() {
    var parts = ['↑/↓ navega · Enter escolhe · Esc fecha'];
    if (hidden > 0) { parts.push('+' + hidden + ' não exibido(s) — refine a busca'); }
    // Dica so faz sentido quando ha linha para mirar e ainda nao estamos no
    // modo por linha.
    var hasRows = shown.some(function (s) { return !s.row && s.item.rowCount; });
    if (hasRows) { parts.push('digite <code>___</code> para mirar uma linha'); }
    if (fieldIndex && fieldIndex.fieldsTotal > (fieldIndex.fields || []).length) {
      parts.push('índice truncado em ' + fieldIndex.fields.length + ' de ' + fieldIndex.fieldsTotal + ' campos');
    }
    return parts.join(' · ');
  }

  function draw() {
    if (!shown.length) {
      box.innerHTML = '<div class="ac-empty muted">nenhum campo casa com isso</div>';
    } else {
      var html = '';
      shown.forEach(function (s, i) {
        html +=
          '<div class="ac-item" data-i="' + i + '">' +
          '<div class="ac-name"><code>' + esc(s.label) + '</code> ' + suggestionTags(s) + '</div>' +
          '<div class="ac-val">' + renderValue(s.item.value) + '</div>' +
          '</div>';
      });
      html += '<div class="ac-foot muted">' + foot() + '</div>';
      box.innerHTML = html;
    }
    box.style.display = 'block';
    open = true;
    paintActive();
  }

  // Move so o destaque, sem reconstruir a lista — o innerHTML inteiro a cada
  // seta/hover causaria flicker e mataria o elemento sob o cursor.
  function paintActive() {
    var items = box.querySelectorAll('.ac-item');
    for (var i = 0; i < items.length; i++) {
      if (i === active) { items[i].classList.add('active'); }
      else { items[i].classList.remove('active'); }
    }
    if (active >= 0 && items[active] && items[active].scrollIntoView) {
      items[active].scrollIntoView({ block: 'nearest' });
    }
  }

  function refresh() {
    ensureFieldIndex().then(function (index) {
      // A varredura e assincrona: se o usuario saiu do input nesse meio-tempo,
      // nao abrimos a lista por cima de outra coisa.
      if (document.activeElement !== input) { return; }
      // Indice vazio = varredura falhou ou pagina sem campos. Melhor nao abrir
      // nada do que abrir um "nenhum campo casa com isso" enganoso.
      if (!(index.fields || []).length && !(index.rows || []).length) {
        close();
        return;
      }
      var all = filterSuggestions(index, input.value);
      hidden = Math.max(0, all.length - MAX_SUGGESTIONS);
      shown = all.slice(0, MAX_SUGGESTIONS);
      if (active >= shown.length) { active = shown.length - 1; }
      draw();
    });
  }

  function pick(i) {
    if (i < 0 || i >= shown.length) { return; }
    input.value = shown[i].label;
    close();
  }

  input.addEventListener('input', function () {
    active = -1;
    refresh();
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open || !shown.length) { refresh(); return; }
      if (active < 0) {
        // Nada destacado ainda: ↓ vai para o primeiro, ↑ para o ULTIMO.
        active = e.key === 'ArrowDown' ? 0 : shown.length - 1;
      } else {
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      }
      paintActive();
      return;
    }

    if (e.key === 'Enter') {
      // Enter com item ativo SO escolhe a sugestao — nao dispara Ler/Setar. O
      // stopImmediatePropagation impede o handler de Enter que o Wiring registra
      // neste mesmo input (por isso o attach vem antes dele).
      if (open && active >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(active);
      }
      return;
    }

    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        close();
      }
      return;
    }

    if (e.key === 'Tab') {
      if (open && active >= 0) { pick(active); }
      else { close(); }
    }
  });

  // mousedown (nao click) + preventDefault: o click chegaria depois do blur, que
  // ja teria fechado a lista e removido o item de baixo do cursor.
  box.addEventListener('mousedown', function (e) {
    var el = e.target.closest ? e.target.closest('.ac-item') : null;
    if (!el) { return; }
    e.preventDefault();
    pick(Number(el.getAttribute('data-i')));
  });

  box.addEventListener('mouseover', function (e) {
    var el = e.target.closest ? e.target.closest('.ac-item') : null;
    if (!el) { return; }
    var i = Number(el.getAttribute('data-i'));
    if (i === active) { return; }
    active = i;
    paintActive();
  });

  input.addEventListener('blur', close);
}

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

  if (kind === 'set') {
    document.getElementById('set-field').value = e.fieldName;
    document.getElementById('set-value').value = e.oldValue;
    setFieldResolve();
    return;
  }

  if (kind === 'dbset') {
    document.getElementById('dbset-field').value = e.fieldName;
    document.getElementById('dbset-value').value = e.oldValue;
    dbSetResolve();
  }
}

// Reler: leitura nao altera nada, entao roda direto.
function rereadFromHistory(id) {
  var e = findHistoryEntry('read', id);
  if (!e) { return; }
  document.getElementById('read-field').value = e.typed;
  readField();
}

// ---------------------------------------------------------------------------
// UI — Ler campo
// ---------------------------------------------------------------------------

function readField() {
  var typed = document.getElementById('read-field').value.trim();
  if (!typed) {
    render('read-output', '<span class="muted">Digite o nome de um campo.</span>');
    return;
  }

  render('read-output', '<span class="muted">Procurando na página…</span>');

  evalInPage(buildFindExpr(typed))
    .then(function (result) {
      if (!result) {
        render('read-output', '<span class="err">Sem retorno da página.</span>');
        return;
      }

      if (!result.matches || result.matches.length === 0) {
        render('read-output',
          '<div class="row"><span class="k">Campo</span><code>' + esc(result.typed) + '</code></div>' +
          '<div class="row"><span class="k">Resultado</span><span class="err">não encontrado</span></div>' +
          '<p class="muted">Nenhum input/select/textarea com nome lógico ' +
          '<code>' + esc(result.base) + '</code> em ' + esc(result.framesScanned) +
          ' frame(s). Confira o nome do campo.</p>'
        );
        recordRead(typed, []);
        return;
      }

      var html =
        '<div class="row"><span class="k">Campo</span><code>' + esc(result.typed) + '</code>' +
        ' <span class="muted">(' + result.matches.length + ' ocorrência(s))</span></div>';

      result.matches.forEach(function (m) {
        html +=
          '<div class="match">' +
          '<div class="row"><span class="k">name</span><code>' + esc(m.name) + '</code> ' + matchTags(m) + '</div>' +
          '<div class="row"><span class="k">valor</span><code>' + renderValue(m.value) + '</code></div>' +
          '</div>';
      });

      // Linha completa: so quando o usuario mirou uma linha especifica (___N) e
      // o campo pertence a uma tabela pai-filho (tem tablename). Reserva o espaco
      // e preenche apos a 2a consulta (a linha).
      var typedChild = typed.match(/___(\d+)$/);
      var rowTarget = typedChild
        ? result.matches.filter(function (m) { return m.table && m.child; })[0]
        : null;
      if (rowTarget) {
        html += '<div id="read-row"><p class="muted">Carregando a linha completa…</p></div>';
      }

      render('read-output', html);
      recordRead(typed, result.matches);

      if (rowTarget) {
        evalInPage(buildRowExpr(rowTarget.table, rowTarget.child))
          .then(function (row) { renderRow(row, rowTarget.name); })
          .catch(function (exceptionInfo) {
            var el = document.getElementById('read-row');
            if (el) { el.innerHTML = '<span class="err">Erro ao ler a linha: ' + esc(JSON.stringify(exceptionInfo)) + '</span>'; }
          });
      }
    })
    .catch(function (exceptionInfo) {
      render('read-output', '<span class="err">Erro ao avaliar na página: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// Preenche o bloco "Linha completa" com os demais campos da mesma linha da
// tabela pai-filho. `queriedName` marca o campo que o usuario leu.
function renderRow(row, queriedName) {
  var el = document.getElementById('read-row');
  if (!el) { return; }

  if (!row || !row.fields || !row.fields.length) {
    el.innerHTML = '<p class="muted">Não encontrei os demais campos desta linha.</p>';
    return;
  }

  var html =
    '<p><strong>Linha completa</strong></p>' +
    '<div class="row"><span class="k">tabela</span><code>' + esc(row.table) + '</code> ' +
    '<span class="tag">linha ' + esc(row.child) + '</span> ' +
    '<span class="muted">(' + row.fields.length + ' campo(s))</span></div>' +
    '<div class="match">';

  row.fields.forEach(function (f) {
    var extra = '';
    if (f.name === queriedName) { extra += ' <span class="tag">lido</span>'; }
    if (f.disabled) { extra += ' <span class="tag warn">desabilitado (_)</span>'; }
    html +=
      '<div class="row"><span class="k">' + esc(f.field) + '</span>' +
      '<code>' + renderValue(f.value) + '</code>' + extra + '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// UI — Setar campo (resolver -> confirmar -> aplicar)
// ---------------------------------------------------------------------------

function setFieldResolve() {
  var typed = document.getElementById('set-field').value.trim();
  var value = document.getElementById('set-value').value; // valor vazio e permitido (limpar campo)

  if (!typed) {
    render('set-output', '<span class="muted">Digite o nome do campo a alterar.</span>');
    return;
  }

  render('set-output', '<span class="muted">Localizando o campo…</span>');

  evalInPage(buildFindExpr(typed))
    .then(function (result) {
      var matches = (result && result.matches) || [];
      var exact = matches.filter(function (m) { return m.exact; });

      var target = null;
      if (exact.length === 1) {
        target = exact[0];
      } else if (exact.length === 0 && matches.length === 1) {
        target = matches[0];
      }

      if (!target) {
        if (matches.length === 0) {
          render('set-output',
            '<div class="row"><span class="k">Campo</span><code>' + esc(typed) + '</code></div>' +
            '<div class="row"><span class="k">Resultado</span><span class="err">não encontrado</span></div>'
          );
          return;
        }
        // Ambiguo: varias ocorrencias. Nao seta; pede o nome exato.
        var list = matches.map(function (m) {
          return '<div class="match"><div class="row"><span class="k">name</span><code>' +
            esc(m.name) + '</code> ' + matchTags(m) + '</div>' +
            '<div class="row"><span class="k">valor</span><code>' + renderValue(m.value) + '</code></div></div>';
        }).join('');
        render('set-output',
          '<p class="err">Ambíguo: <code>' + esc(typed) + '</code> casa com ' + matches.length +
          ' ocorrências. Por segurança não alterei nada.</p>' +
          '<p class="muted">Digite o <strong>nome exato</strong> da ocorrência (copie de baixo, ex: com <code>___N</code>):</p>' +
          list
        );
        return;
      }

      showSetConfirmation(target, value);
    })
    .catch(function (exceptionInfo) {
      render('set-output', '<span class="err">Erro ao localizar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

function showSetConfirmation(target, value) {
  render('set-output',
    '<div class="confirm">' +
    '<p><strong>Confirmar alteração</strong></p>' +
    '<div class="row"><span class="k">name</span><code>' + esc(target.name) + '</code> ' + matchTags(target) + '</div>' +
    '<div class="row"><span class="k">frame</span><span class="muted">' + esc(target.frame) + '</span></div>' +
    '<div class="row"><span class="k">atual</span><code>' + renderValue(target.value) + '</code></div>' +
    '<div class="row"><span class="k">novo</span><code>' + renderValue(value) + '</code></div>' +
    '<p class="muted">Aplica <code>$(campo).val(novo)</code> sem disparar <code>change</code>/<code>blur</code> ' +
    '(igual ao console; lógicas dependentes podem não reexecutar).</p>' +
    '<div class="field-row">' +
    '<button id="btn-confirm-set" type="button" class="danger">Confirmar alteração</button>' +
    '<button id="btn-cancel-set" type="button">Cancelar</button>' +
    '</div>' +
    '</div>'
  );

  document.getElementById('btn-confirm-set').addEventListener('click', function () {
    // target inteiro (nao so o name): o historico precisa do valor ANTERIOR,
    // que e justamente o target.value lido na resolucao.
    applySet(target);
  });
  document.getElementById('btn-cancel-set').addEventListener('click', function () {
    render('set-output', '<span class="muted">Alteração cancelada.</span>');
  });
}

function applySet(target) {
  var rawName = target.name;
  var value = document.getElementById('set-value').value;
  render('set-output', '<span class="muted">Aplicando…</span>');

  evalInPage(buildSetExpr(rawName, value))
    .then(function (result) {
      if (!result || result.setCount === 0) {
        render('set-output', '<span class="err">Nada foi alterado (elemento <code>' +
          esc(rawName) + '</code> não encontrado ao aplicar).</span>');
        return;
      }
      // So registra o que de fato mudou, com o read-back como valor novo.
      recordSet(rawName, target.value, result.readBack, target);
      render('set-output',
        '<div class="row"><span class="k">Aplicado</span><span class="ok">' +
        esc(result.setCount) + ' elemento(s) em ' + esc(result.frame) + '</span></div>' +
        '<div class="row"><span class="k">name</span><code>' + esc(result.target) + '</code></div>' +
        '<div class="row"><span class="k">valor agora</span><code>' + renderValue(result.readBack) + '</code></div>'
      );
    })
    .catch(function (exceptionInfo) {
      render('set-output', '<span class="err">Erro ao aplicar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}

// ---------------------------------------------------------------------------
// Dump de todos os campos (CU-02)
// ---------------------------------------------------------------------------

// Varre todos os input/select/textarea de window + iframes e devolve uma lista
// crua de entradas. A estruturacao (fields/tables) e feita no painel, em JS
// normal, mais facil de manter que uma expressao gigante.
function buildDumpExpr() {
  return [
    '(function () {',
    PAGE_HELPERS,
    '  var wins = collectWindows(window, [], 0);',
    '  var entries = [];',
    '  var logs = [];',
    '  var perFrame = [];',
    '',
    '  for (var i = 0; i < wins.length; i++) {',
    '    var w = wins[i];',
    '    var doc;',
    '    try { doc = w.document; } catch (e) { continue; }',
    '    var jq = null;',
    '    try { jq = w.jQuery || w.$ || null; } catch (e) {}',
    '    var nodes;',
    '    try { nodes = doc.querySelectorAll("input, select, textarea, span[name]"); } catch (e) { continue; }',
    '    var url = null;',
    '    try { url = String(w.location.href); } catch (e) {}',
    '    var count = 0;',
    '',
    '    // Logs capturados pelo hook (devtools.js) neste frame.',
    '    try {',
    '      var flogs = w.__FLUIG_DEBUG_LOGS__ || null;',
    '      if (flogs) {',
    '        for (var m = 0; m < flogs.length; m++) {',
    '          logs.push({ frame: (w === window ? "top" : "iframe"), level: flogs[m].level, msg: flogs[m].msg });',
    '        }',
    '      }',
    '    } catch (e) {}',
    '',
    '    for (var j = 0; j < nodes.length; j++) {',
    '      var node = nodes[j];',
    '      var nm = node.getAttribute("name");',
    '      var id = node.id || null;',
    '      var raw = nm || id;',
    '      if (!raw) { continue; }',
    '      var type = String(node.type || node.tagName || "").toLowerCase();',
    '      if (type === "button" || type === "submit" || type === "reset" || type === "image") { continue; }',
    '      // radio: so a opcao marcada interessa.',
    '      if (type === "radio" && !node.checked) { continue; }',
    '',
    '      var value;',
    '      if (type === "checkbox") { value = node.checked ? "true" : "false"; }',
    '      else if (type === "radio") { value = node.value || "on"; }',
    '      else { value = readValue(node, jq); }',
    '      if (value == null) { value = ""; }',
    '',
    '      var childMatch = String(raw).match(/___(\\d+)$/);',
    '      var table = null;',
    '      try { var t = node.closest ? node.closest("table[tablename]") : null; if (t) { table = t.getAttribute("tablename"); } } catch (e) {}',
    '      var disabled = /^_/.test(String(nm || "")) || /^_/.test(String(id || ""));',
    '',
    '      entries.push({',
    '        raw: raw,',
    '        name: logical(raw),',
    '        value: String(value),',
    '        disabled: disabled,',
    '        child: childMatch ? childMatch[1] : null,',
    '        table: table,',
    '        type: type,',
    '        frame: (w === window ? "top" : "iframe")',
    '      });',
    '      count++;',
    '    }',
    '    perFrame.push({ url: url, count: count });',
    '  }',
    '',
    '  var best = null;',
    '  for (var k = 0; k < perFrame.length; k++) { if (!best || perFrame[k].count > best.count) { best = perFrame[k]; } }',
    '',
    '  return { entries: entries, logs: logs, capturedFrom: best ? best.url : null, framesScanned: wins.length };',
    '})()'
  ].join('\n');
}

function addField(fields, name, value) {
  if (!(name in fields)) { fields[name] = value; return; }
  var cur = fields[name];
  if (Array.isArray(cur)) {
    if (cur.indexOf(value) < 0) { cur.push(value); }
  } else if (cur !== value) {
    fields[name] = [cur, value];
  }
}

function structureDump(result) {
  var fields = {};
  var tablesTmp = {}; // tabela -> { N -> { campo: valor } }
  var ungrouped = {}; // campo filho sem tablename identificavel -> valor
  var disabled = {};

  (result.entries || []).forEach(function (e) {
    if (e.disabled) { disabled[e.name] = true; }

    if (e.child != null) {
      if (e.table) {
        tablesTmp[e.table] = tablesTmp[e.table] || {};
        tablesTmp[e.table][e.child] = tablesTmp[e.table][e.child] || {};
        tablesTmp[e.table][e.child][e.name] = e.value;
      } else {
        ungrouped[e.raw] = e.value;
      }
    } else {
      addField(fields, e.name, e.value);
    }
  });

  var tables = {};
  Object.keys(tablesTmp).forEach(function (t) {
    var rowsMap = tablesTmp[t];
    var ns = Object.keys(rowsMap).map(Number).sort(function (a, b) { return a - b; });
    tables[t] = ns.map(function (n) { return rowsMap[n]; });
  });

  var logs = result.logs || [];

  var out = {
    meta: {
      capturedFrom: result.capturedFrom || null,
      framesScanned: result.framesScanned,
      fieldCount: Object.keys(fields).length,
      tableCount: Object.keys(tables).length,
      logCount: logs.length,
      disabled: Object.keys(disabled)
    },
    fields: fields
  };
  if (Object.keys(tables).length) { out.tables = tables; }
  if (Object.keys(ungrouped).length) { out.childFieldsSemTabela = ungrouped; }
  if (logs.length) { out.logs = logs; }
  return out;
}

function dumpFields() {
  var status = document.getElementById('dump-status');
  status.textContent = 'Coletando…';
  document.getElementById('dump-json').value = '';
  dumpRows = [];
  renderDumpTable();

  evalInPage(buildDumpExpr())
    .then(function (result) {
      if (!result) {
        status.innerHTML = '<span class="err">Sem retorno da página.</span>';
        return;
      }
      var out = structureDump(result);
      dumpRows = buildDumpRows(result);
      document.getElementById('dump-json').value = JSON.stringify(out, null, 2);
      renderDumpTable();
      status.innerHTML = '<span class="ok">' + out.meta.fieldCount + ' campo(s), ' +
        out.meta.tableCount + ' tabela(s), ' + out.meta.logCount + ' log(s).</span>';
    })
    .catch(function (exceptionInfo) {
      status.innerHTML = '<span class="err">Erro ao coletar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>';
    });
}

function copyDump() {
  var ta = document.getElementById('dump-json');
  var status = document.getElementById('dump-status');
  if (!ta.value) {
    status.innerHTML = '<span class="muted">Gere o dump antes de copiar.</span>';
    return;
  }
  // Na aba Tabela a textarea esta com display:none e nao da para selecionar.
  // Na aba JSON seleciona a propria textarea, que ja serve de retorno visual.
  var ok = false;
  if (dumpView === 'json') {
    ta.focus();
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  } else {
    ok = copyText(ta.value);
  }
  if (ok) {
    status.innerHTML = '<span class="ok">Copiado para a área de transferência.</span>';
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value)
      .then(function () { status.innerHTML = '<span class="ok">Copiado.</span>'; })
      .catch(function () { status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>'; });
  } else {
    status.innerHTML = '<span class="muted">Selecione o texto e use Ctrl+C.</span>';
  }
}

// ---------------------------------------------------------------------------
// Dump — visao em tabela (CU-02)
// ---------------------------------------------------------------------------
//
// A tabela e outra FORMA DE MOSTRAR o mesmo resultado do buildDumpExpr, nunca
// uma segunda varredura: dois caminhos coletando o mesmo dado divergem na
// primeira mudanca de regra (o que conta como campo, como le valor, etc).
//
// Uma linha por entrada CRUA, nao por campo logico: o mesmo campo repetido em
// frames diferentes e cada linha de tabela pai-filho aparecem separados — que e
// justamente o que se quer enxergar depurando. O agrupamento continua no JSON.

var dumpRows = [];
var dumpView = 'table';
// Formulario Fluig grande passa facil de mil entradas, e montar tudo de uma vez
// trava o painel. Renderiza ate um teto e manda refinar o filtro — mesma
// preocupacao do MAX_SUGGESTIONS do autocomplete.
var DUMP_RENDER_MAX = 300;

function buildDumpRows(result) {
  var rows = (result.entries || []).slice();
  rows.sort(function (a, b) {
    // Por nome logico: agrupa as linhas de um mesmo campo pai-filho, que e como
    // se le uma tabela. Dentro do mesmo nome, ordem numerica da linha (___N).
    var byName = String(a.name).localeCompare(String(b.name), 'pt-BR');
    if (byName !== 0) { return byName; }
    return Number(a.child || 0) - Number(b.child || 0);
  });
  // Indice fixado DEPOIS da ordenacao: os botoes referenciam a linha por indice,
  // e filtrar nao pode remapear esse numero.
  rows.forEach(function (r, i) { r.idx = i; });
  return rows;
}

function filterDumpRows(term) {
  var q = String(term || '').trim().toLowerCase();
  if (!q) { return dumpRows; }
  // Casa nome cru, nome logico e valor: procurar pelo valor que se ve na tela
  // para descobrir de que campo ele veio e um dos usos principais.
  return dumpRows.filter(function (r) {
    return String(r.raw).toLowerCase().indexOf(q) >= 0 ||
      String(r.name).toLowerCase().indexOf(q) >= 0 ||
      String(r.value).toLowerCase().indexOf(q) >= 0;
  });
}

// Mesmo vocabulario de tags do matchTags/suggestionTags, mais frame e tabela.
function dumpRowTags(r) {
  var tags = [];
  if (r.disabled) { tags.push('<span class="tag warn">desabilitado (_)</span>'); }
  if (r.child != null) { tags.push('<span class="tag">linha ' + esc(r.child) + '</span>'); }
  if (r.table) { tags.push('<span class="tag">' + esc(r.table) + '</span>'); }
  if (r.frame !== 'top') { tags.push('<span class="tag">iframe</span>'); }
  if (r.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (r.type) { tags.push('<span class="tag">' + esc(r.type) + '</span>'); }
  return tags.join(' ');
}

// So o indice numerico vai para atributo HTML: esc() nao escapa aspas, e nome de
// campo vem da pagina. Quem precisa do nome busca em dumpRows[idx].
function dumpRowHtml(r) {
  return '<div class="dump-row">' +
    '<div class="dump-name"><code>' + esc(r.raw) + '</code>' +
    '<div class="dump-tags">' + dumpRowTags(r) + '</div></div>' +
    '<div class="dump-val">' + renderValue(r.value) + '</div>' +
    '<div class="dump-acts">' +
    '<button type="button" data-dump-set="' + r.idx + '">Setar</button>' +
    '<button type="button" data-dump-copy="' + r.idx + '">Copiar nome</button>' +
    '</div>' +
    '</div>';
}

function renderDumpTable() {
  var box = document.getElementById('dump-table');
  if (!dumpRows.length) {
    box.innerHTML = '<span class="muted">Clique em “Gerar dump” para listar todos os campos da página.</span>';
    return;
  }

  var filtered = filterDumpRows(document.getElementById('dump-filter').value);
  if (!filtered.length) {
    box.innerHTML = '<span class="muted">Nenhum campo casa com o filtro.</span>';
    return;
  }

  var shown = filtered.slice(0, DUMP_RENDER_MAX);
  var foot = shown.length < filtered.length
    ? 'Mostrando ' + shown.length + ' de ' + filtered.length + ' campo(s) — refine o filtro para ver o resto.'
    : filtered.length + ' campo(s).';

  box.innerHTML = shown.map(dumpRowHtml).join('') +
    '<div class="dump-foot muted">' + foot + '</div>';
}

function setDumpView(view) {
  dumpView = view === 'json' ? 'json' : 'table';
  var isTable = dumpView === 'table';
  document.getElementById('dump-table-view').style.display = isTable ? '' : 'none';
  document.getElementById('dump-json').style.display = isTable ? 'none' : '';
  document.getElementById('btn-dump-table').classList.toggle('active', isTable);
  document.getElementById('btn-dump-json').classList.toggle('active', !isTable);
  if (isTable) { renderDumpTable(); }
}

// Leva o nome CRU (com o "_" de desabilitado e o "___N" da linha) para a secao
// Setar campo: e a forma que o buildFindExpr resolve sem ambiguidade. NAO
// dispara a resolucao — falta o usuario digitar o valor novo, e a alteracao
// segue passando pela confirmacao obrigatoria.
function setFromDump(idx) {
  var r = dumpRows[idx];
  if (!r) { return; }
  var field = document.getElementById('set-field');
  var value = document.getElementById('set-value');
  field.value = r.raw;
  value.value = '';
  render('set-output', '<span class="muted">Campo <code>' + esc(r.raw) +
    '</code> carregado do dump (valor atual: <code>' + renderValue(r.value) +
    '</code>). Digite o novo valor e clique em Setar.</span>');
  field.scrollIntoView({ block: 'center' });
  value.focus();
}

// Copia um texto curto. O copyDump seleciona a propria textarea (o realce faz
// parte do retorno visual); aqui nao ha elemento visivel, entao usa um efemero.
function copyText(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function copyFieldName(idx) {
  var r = dumpRows[idx];
  if (!r) { return; }
  var status = document.getElementById('dump-status');
  if (copyText(r.raw)) {
    status.innerHTML = '<span class="ok">Nome copiado: <code>' + esc(r.raw) + '</code></span>';
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(r.raw)
      .then(function () { status.innerHTML = '<span class="ok">Nome copiado: <code>' + esc(r.raw) + '</code></span>'; })
      .catch(function () { status.innerHTML = '<span class="muted">Não consegui copiar o nome.</span>'; });
    return;
  }
  status.innerHTML = '<span class="muted">Não consegui copiar o nome.</span>';
}

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
  '  // documentId da solicitacao: workflowProcess -> cardDocumentId.',
  '  function resolveDocId(wins) {',
  '    var numProcess = findNumProcess(wins);',
  '    if (!numProcess) { return { ok: false, stage: "url", message: "Número da solicitação não encontrado na URL (nenhum parâmetro *processInstanceId). Abra a extensão sobre uma solicitação de workflow." }; }',
  '    var dsWin = findDatasetWin(wins);',
  '    if (!dsWin) { return { ok: false, stage: "dataset", numProcess: numProcess, message: "DatasetFactory não disponível no client-side (formulário ainda carregando?). Tente Recarregar." }; }',
  '    try {',
  '      var DF = dsWin.DatasetFactory, CT = dsWin.ConstraintType;',
  '      var c1 = DF.createConstraint("workflowProcessPK.processInstanceId", numProcess, numProcess, CT.MUST);',
  '      var c4 = DF.createConstraint("sqlLimit", "300", "300", CT.MUST);',
  '      var dataset = DF.getDataset("workflowProcess", ["cardIndexDocumentId", "cardDocumentId"], [c1, c4], null);',
  '      var values = (dataset && dataset.values) ? dataset.values : [];',
  '      if (!values.length) { return { ok: false, stage: "empty", numProcess: numProcess, message: "Consulta ao workflowProcess retornou vazio para a solicitação " + numProcess + "." }; }',
  '      var row = values[0];',
  '      return { ok: true, numProcess: numProcess, documentId: (row.cardDocumentId != null ? String(row.cardDocumentId) : null), cardIndexDocumentId: (row.cardIndexDocumentId != null ? String(row.cardIndexDocumentId) : null), frame: (dsWin === window ? "top" : "iframe") };',
  '    } catch (e) { return { ok: false, stage: "query", numProcess: numProcess, message: "Erro na consulta ao dataset: " + (e && e.message ? e.message : String(e)) }; }',
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
    '<div class="row"><span class="k">Solicitação</span><code>' + esc(result.numProcess) + '</code></div>' +
    '<div class="row"><span class="k">documentId</span><code class="ok">' + renderValue(result.documentId) + '</code></div>';
  if (result.cardIndexDocumentId && result.cardIndexDocumentId !== result.documentId) {
    html += '<div class="row"><span class="k">cardIndex</span><code>' + renderValue(result.cardIndexDocumentId) + '</code></div>';
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

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Autocomplete ANTES dos handlers de Enter: listener na mesma tecla e no mesmo
// elemento dispara na ordem de registro, e o dropdown precisa poder consumir o
// Enter (escolher a sugestao) sem que o Ler/Setar rode junto.
attachAutocomplete('read-field', 'read-field-ac');
attachAutocomplete('set-field', 'set-field-ac');
attachAutocomplete('dbset-field', 'dbset-field-ac');

document.getElementById('btn-read').addEventListener('click', readField);
document.getElementById('read-field').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { readField(); }
});

document.getElementById('btn-set').addEventListener('click', setFieldResolve);
document.getElementById('set-value').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { setFieldResolve(); }
});

document.getElementById('btn-dump').addEventListener('click', dumpFields);
document.getElementById('btn-copy-dump').addEventListener('click', copyDump);
document.getElementById('btn-dump-table').addEventListener('click', function () { setDumpView('table'); });
document.getElementById('btn-dump-json').addEventListener('click', function () { setDumpView('json'); });
document.getElementById('dump-filter').addEventListener('input', renderDumpTable);

// Delegacao escopada no container: as linhas sao recriadas a cada render/filtro,
// mas o #dump-table em si e estavel.
document.getElementById('dump-table').addEventListener('click', function (e) {
  if (!e.target.closest) { return; }
  var el = e.target.closest('[data-dump-set], [data-dump-copy]');
  if (!el) { return; }

  var toSet = el.getAttribute('data-dump-set');
  if (toSet !== null) { setFromDump(Number(toSet)); return; }

  var toCopy = el.getAttribute('data-dump-copy');
  if (toCopy !== null) { copyFieldName(Number(toCopy)); }
});

document.getElementById('btn-reload-solicitacao').addEventListener('click', loadSolicitacao);

document.getElementById('btn-dbset').addEventListener('click', dbSetResolve);
document.getElementById('dbset-value').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { dbSetResolve(); }
});

document.getElementById('btn-read-history').addEventListener('click', function () { toggleHistory('read'); });
document.getElementById('btn-set-history').addEventListener('click', function () { toggleHistory('set'); });
document.getElementById('btn-dbset-history').addEventListener('click', function () { toggleHistory('dbset'); });

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
chrome.devtools.network.onNavigated.addListener(invalidateFieldIndex);

// Estado inicial do dump: tabela (com o vazio explicando o "Gerar dump") e a
// textarea de JSON escondida.
setDumpView('table');

document.getElementById('read-field').focus();

// Resolve o documentId da solicitacao automaticamente ao abrir o painel.
loadSolicitacao();

// Aquece o indice para a primeira tecla ja vir com sugestao.
ensureFieldIndex();
