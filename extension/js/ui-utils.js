// js/ui-utils.js — Utilitarios de UI: render, copiar, escape, tags
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// UI — utilitarios
// ---------------------------------------------------------------------------

function render(id, html) {
  document.getElementById(id).innerHTML = html;
}

// Inline SVG string for the copy icon (reused across all copy buttons).
var COPY_SVG = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>' +
  '<path d="M5 10.5H3.5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 3.5 1.5h6A1.5 1.5 0 0 1 11 3v1.5"/>' +
  '</svg>';

// Inline SVG string for the target / focus icon
var TARGET_SVG = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="8" cy="8" r="6"/>' +
  '<circle cx="8" cy="8" r="2"/>' +
  '<path d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3"/>' +
  '</svg>';

// Copia um texto usando textarea efemera (compativel com DevTools panel)
// e com fallback para navigator.clipboard se disponivel.
function copyText(text) {
  var str = String(text != null ? text : '');
  var ok = false;
  try {
    var ta = document.createElement('textarea');
    ta.value = str;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '2em';
    ta.style.height = '2em';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.boxShadow = 'none';
    ta.style.background = 'transparent';
    ta.style.opacity = '0.01';
    ta.style.zIndex = '-1';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, str.length);
    ok = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) {
    ok = false;
  }
  return ok;
}

// Copia texto e dá feedback visual no botão (troca o ícone ou texto por Copiado por 1.2s).
function copyWithFeedback(text, btn) {
  var str = String(text != null ? text : '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str)
      .then(function () { flashCopied(btn); })
      .catch(function () {
        var ok = copyText(str);
        if (ok) { flashCopied(btn); }
      });
  } else {
    var ok = copyText(str);
    if (ok) { flashCopied(btn); }
  }
}

function flashCopied(btn) {
  if (!btn) { return; }
  var prevText = null;
  var isTextBtn = btn.classList.contains('btn-icon-text') || (!btn.classList.contains('btn-icon') && btn.tagName === 'BUTTON');
  if (isTextBtn) {
    prevText = btn.textContent;
    btn.textContent = 'Copiado!';
  }
  btn.classList.add('copied');
  setTimeout(function () {
    btn.classList.remove('copied');
    if (isTextBtn && prevText !== null) {
      btn.textContent = prevText;
    }
  }, 1200);
}

// Gera o HTML de um valor copiável: code + botão de copiar inline.
function renderCopyable(value, escValue) {
  if (value === '' || value == null) {
    return '<span class="muted">(vazio)</span>';
  }
  var display = escValue || esc(value);
  return '<span class="copyable"><code>' + display + '</code>' +
    '<button type="button" class="btn-icon" data-copy="' + esc(value).replace(/"/g, '&quot;') + '" title="Copiar">' + COPY_SVG + '</button></span>';
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
  if (m.visible === false) { tags.push('<span class="tag">oculto / hidden</span>'); }
  if (m.child) { tags.push('<span class="tag">linha ' + esc(m.child) + '</span>'); }
  if (m.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (m.type) { tags.push('<span class="tag">' + esc(m.type) + '</span>'); }
  return tags.join(' ');
}
