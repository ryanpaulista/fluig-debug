// js/read.js — Aba Campos: ler campo
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

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

      result.matches.forEach(function (m, idx) {
        var focusBtn = m.visible !== false
          ? '<button type="button" class="btn-icon-text" data-focus-elem="' + esc(m.name).replace(/"/g, '&quot;') + '" title="Rolar e destacar no formulário">' +
              TARGET_SVG + '<span>Localizar</span>' +
            '</button>'
          : '<span class="muted" style="font-size:11px;">(oculto)</span>';

        var mEscName = esc(m.name).replace(/"/g, '&quot;');
        var cardId = 'match-card-' + idx;

        html +=
          '<div class="match" id="' + cardId + '">' +
          '<div class="match-editor-head">' +
          '<div style="display:inline-flex; align-items:center; gap:4px; flex-wrap:wrap;">' +
          '<span class="k" style="min-width:auto; margin-right:2px;">name</span><code>' + esc(m.name) + '</code>' +
          '<button type="button" class="btn-icon" data-copy="' + mEscName + '" title="Copiar nome do campo">' + COPY_SVG + '</button> ' + matchTags(m) +
          '</div>' +
          '<div class="match-editor-acts">' +
          '<button type="button" class="primary" data-match-apply-dom="' + mEscName + '" data-card-id="' + cardId + '" title="Aplica o valor no DOM">Setar DOM</button>' +
          '<button type="button" class="primary" data-match-apply-db="' + mEscName + '" data-card-id="' + cardId + '" title="Grava direto no banco (dsSetCardValue)">Setar Banco</button>' +
          focusBtn +
          '<button type="button" data-match-copy-val="' + cardId + '" title="Copiar conteúdo do campo">Copiar Conteúdo</button>' +
          '<button type="button" data-revert-ta="match-val-' + cardId + '" title="Reverter para o valor original do formulário (Ctrl+Z)">Reverter</button>' +
          '</div></div>' +
          '<textarea class="match-textarea" id="match-val-' + cardId + '" placeholder="(vazio)">' + esc(m.value || '') + '</textarea>' +
          '<div class="match-feedback" id="match-status-' + cardId + '"></div>' +
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

      result.matches.forEach(function (m, idx) {
        var cardId = 'match-card-' + idx;
        var ta = document.getElementById('match-val-' + cardId);
        if (ta) { initTextareaHistory(ta, m.value || ''); }
      });

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
