// js/textarea-history.js — Undo / Redo para textareas
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Gerenciador de Undo / Redo para Textareas (.match-textarea, .dg-inspector-textarea)
// ---------------------------------------------------------------------------

var textareaHistory = {}; // elementId -> { stack: string[], index: number, initialValue: string, timer: null }

function initTextareaHistory(el, initialValue) {
  if (!el || !el.id) { return; }
  var val = initialValue != null ? String(initialValue) : (el.value || '');
  textareaHistory[el.id] = {
    stack: [val],
    index: 0,
    initialValue: val,
    timer: null
  };
}

function recordTextareaSnapshot(el) {
  if (!el || !el.id) { return; }
  var state = textareaHistory[el.id];
  if (!state) {
    initTextareaHistory(el, el.value);
    state = textareaHistory[el.id];
  }
  var curVal = el.value;
  if (state.stack[state.index] === curVal) { return; }

  // Descarta o histórico posterior caso esteja navegando no meio do stack
  state.stack = state.stack.slice(0, state.index + 1);
  state.stack.push(curVal);
  if (state.stack.length > 50) {
    state.stack.shift();
  }
  state.index = state.stack.length - 1;
}

function performUndo(el) {
  if (!el || !el.id) { return false; }
  var state = textareaHistory[el.id];
  if (!state) {
    initTextareaHistory(el, el.value);
    return false;
  }
  if (state.stack[state.index] !== el.value) {
    recordTextareaSnapshot(el);
  }
  if (state.index > 0) {
    state.index--;
    el.value = state.stack[state.index];
    flashCopied(el);
    return true;
  }
  return false;
}

function performRedo(el) {
  if (!el || !el.id) { return false; }
  var state = textareaHistory[el.id];
  if (!state) { return false; }
  if (state.index < state.stack.length - 1) {
    state.index++;
    el.value = state.stack[state.index];
    flashCopied(el);
    return true;
  }
  return false;
}

function performRevert(el) {
  if (!el || !el.id) { return; }
  var state = textareaHistory[el.id];
  if (!state) { return; }
  if (el.value !== state.initialValue) {
    el.value = state.initialValue;
    recordTextareaSnapshot(el);
  }
}
