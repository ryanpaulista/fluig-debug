// js/autocomplete.js — Autocomplete de nome de campo
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

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
var fieldIndexGen = 0;
var INDEX_TTL_MS = 3000;
var MAX_SUGGESTIONS = 50;
var EMPTY_INDEX = { fields: [], rows: [], fieldsTotal: 0, rowsTotal: 0 };

function ensureFieldIndex() {
  if (fieldIndex && fieldIndex.fields && fieldIndex.fields.length > 0 && !fieldIndex.formLoading && (Date.now() - fieldIndexAt) < INDEX_TTL_MS) {
    return Promise.resolve(fieldIndex);
  }
  // Uma varredura em voo por vez: as 3 caixas compartilham a mesma promise.
  if (fieldIndexPending) { return fieldIndexPending; }

  var myGen = fieldIndexGen;
  fieldIndexPending = evalInPage(buildFieldIndexExpr())
    .then(function (result) {
      var idx = result || EMPTY_INDEX;
      if (myGen === fieldIndexGen) {
        if (idx.fields && idx.fields.length > 0 && !idx.formLoading) {
          fieldIndex = idx;
          fieldIndexAt = Date.now();
        } else {
          fieldIndex = null;
          fieldIndexAt = 0;
        }
        fieldIndexPending = null;
      }
      return idx;
    })
    .catch(function () {
      if (myGen === fieldIndexGen) {
        fieldIndexPending = null;
      }
      // Autocomplete e conveniencia: se a varredura falhar (pagina navegando,
      // formulario ainda carregando), o input segue funcionando na digitacao
      // manual. Nao poluimos a UI com erro por causa da sugestao.
      return fieldIndex || EMPTY_INDEX;
    });

  return fieldIndexPending;
}

function invalidateFieldIndex() {
  fieldIndexGen++;
  fieldIndex = null;
  fieldIndexAt = 0;
  fieldIndexPending = null;
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
