// js/tabs.js — Abas
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// UI — Abas
// ---------------------------------------------------------------------------

var TAB_NAMES = ['campos', 'rede', 'dump'];

function switchTab(name) {
  TAB_NAMES.forEach(function (t) {
    var panel = document.getElementById('tab-' + t);
    var btn = document.getElementById('tab-btn-' + t);
    if (!panel || !btn) { return; }
    if (t === name) {
      panel.hidden = false;
      btn.classList.add('active');
    } else {
      panel.hidden = true;
      btn.classList.remove('active');
    }
  });
}
