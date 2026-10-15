// js/set.js — Aba Campos: setar campo no DOM
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

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
        '<div class="row"><span class="k">name</span>' + renderCopyable(result.target) + '</div>' +
        '<div class="row"><span class="k">valor agora</span>' + renderCopyable(result.readBack) + '</div>'
      );
    })
    .catch(function (exceptionInfo) {
      render('set-output', '<span class="err">Erro ao aplicar: ' + esc(JSON.stringify(exceptionInfo)) + '</span>');
    });
}
