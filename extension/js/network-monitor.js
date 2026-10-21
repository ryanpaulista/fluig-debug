// js/network-monitor.js — Aba Rede Fluig: monitor ao vivo de chamadas REST e Dataset
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Monitor de Rede Fluig (aba Rede Fluig)
// ---------------------------------------------------------------------------
//
// Captura e exibe em tempo real as chamadas de dataset e REST do Fluig sem
// poluir com assets estaticos (.js, .css, imagens, fontes) nem chamadas do
// proprio painel. Combina:
//   1. Leitura inicial do HAR (chrome.devtools.network.getHAR) para mostrar
//      o que ja aconteceu desde que o DevTools foi aberto.
//   2. Listener em tempo real (chrome.devtools.network.onRequestFinished)
//      para adicionar cada nova requisicao assim que ela termina na pagina.

var netMonitorItems = [];
var netMonitorSeen = {};
var netMonitorSeq = 0;
var netMonitorSelectedId = null;
var netMonitorKindFilter = 'all'; // 'all' | 'dataset' | 'rest' | 'error'
var NET_MONITOR_MAX = 300;

function netEntryKey(entry) {
  var req = (entry && entry.request) || {};
  return String(entry.startedDateTime || '') + '|' + String(req.method || '') + '|' + String(req.url || '');
}

function createNetMonitorItem(entry) {
  if (!entry || !isApiEntry(entry)) { return null; }
  var st = entry.response ? entry.response.status : 0;
  var failed = st === 0 || st >= 400;
  var byPanel = isPanelCall(entry);
  // Ignora chamadas bem-sucedidas feitas pelo proprio painel
  if (byPanel && !failed) { return null; }

  var key = netEntryKey(entry);
  if (netMonitorSeen[key]) { return null; }
  netMonitorSeen[key] = true;

  var req = entry.request;
  var kind = isDatasetUrl(req.url) ? 'dataset' : 'rest';
  var cleanUrl = stripCacheBuster(req.url);
  var dsInfo = kind === 'dataset' ? parseDatasetCall(entry) : null;

  var item = {
    id: ++netMonitorSeq,
    entry: entry,
    kind: kind,
    method: req.method || 'GET',
    url: cleanUrl,
    path: netPathOf(cleanUrl),
    status: st,
    failed: failed,
    timeMs: Math.round(entry.time || 0),
    at: entry.startedDateTime || new Date().toISOString(),
    noise: kind === 'rest' && isPortalNoise(req.url),
    byPanel: byPanel,
    datasetInfo: dsInfo,
    requestBody: (req.postData && req.postData.text) || null,
    responseLoaded: false,
    responseText: null,
    responseJson: null,
    datasetSummary: null
  };

  netMonitorItems.push(item);
  if (netMonitorItems.length > NET_MONITOR_MAX) {
    netMonitorItems.shift();
  }
  return item;
}

function ensureNetItemResponse(item) {
  if (!item || item.responseLoaded) { return Promise.resolve(item); }
  return harGetContent(item.entry).then(function (res) {
    item.responseLoaded = true;
    var text = res && res.content;
    if (text == null || (res && res.encoding === 'base64')) {
      item.responseText = '';
      return item;
    }
    item.responseText = String(text);
    item.responseJson = parseJsonSafe(item.responseText);
    if (item.kind === 'dataset' && item.responseJson) {
      item.datasetSummary = summarizeDatasetResponse(item.responseJson);
    }
    return item;
  });
}

function getFilteredNetMonitorItems() {
  var hideNoiseEl = document.getElementById('net-opt-hide-noise');
  var hideNoise = hideNoiseEl ? hideNoiseEl.checked : true;
  var q = ((document.getElementById('net-filter') || {}).value || '').trim().toLowerCase();

  return netMonitorItems.filter(function (it) {
    if (hideNoise && it.noise) { return false; }
    if (netMonitorKindFilter === 'dataset' && it.kind !== 'dataset') { return false; }
    if (netMonitorKindFilter === 'rest' && it.kind !== 'rest') { return false; }
    if (netMonitorKindFilter === 'error' && !it.failed) { return false; }
    if (!q) { return true; }

    var dsName = (it.datasetInfo && it.datasetInfo.dataset) || '';
    var hay = (
      it.method + ' ' +
      it.url + ' ' +
      dsName + ' ' +
      String(it.status) + ' ' +
      (it.requestBody || '')
    ).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

function updateNetTabBadge() {
  var btn = document.getElementById('tab-btn-rede');
  if (!btn) { return; }
  var hideNoiseEl = document.getElementById('net-opt-hide-noise');
  var hideNoise = hideNoiseEl ? hideNoiseEl.checked : true;
  var count = netMonitorItems.filter(function (it) { return !hideNoise || !it.noise; }).length;
  btn.textContent = count > 0 ? 'Rede Fluig (' + count + ')' : 'Rede Fluig';
}

function buildDatasetSnippet(dsInfo) {
  if (!dsInfo || !dsInfo.dataset) { return ''; }
  var lines = [];
  var constraints = dsInfo.constraints || [];
  if (constraints.length > 0) {
    lines.push('var constraints = [');
    constraints.forEach(function (c, idx) {
      var cType = 'ConstraintType.' + (c.type || 'MUST');
      var comma = idx < constraints.length - 1 ? ',' : '';
      lines.push(
        '  DatasetFactory.createConstraint(' +
          JSON.stringify(c.field || '') + ', ' +
          JSON.stringify(c.initial != null ? c.initial : '') + ', ' +
          JSON.stringify(c.final != null ? c.final : '') + ', ' +
          cType +
          (c.like ? ', true' : '') +
        ')' + comma
      );
    });
    lines.push('];');
  } else {
    lines.push('var constraints = null;');
  }
  var fieldsLit = (dsInfo.fields && dsInfo.fields.length) ? JSON.stringify(dsInfo.fields) : 'null';
  var orderLit = (dsInfo.order && dsInfo.order.length) ? JSON.stringify(dsInfo.order) : 'null';
  lines.push(
    'var dataset = DatasetFactory.getDataset(' +
      JSON.stringify(dsInfo.dataset) + ', ' +
      fieldsLit + ', constraints, ' + orderLit +
    ');'
  );
  return lines.join('\n');
}

function formatNetCallExportJson(item) {
  var out = {
    kind: item.kind,
    method: item.method,
    url: item.url,
    status: item.status,
    timeMs: item.timeMs,
    at: item.at
  };
  if (item.datasetInfo) {
    if (item.datasetInfo.dataset) { out.dataset = item.datasetInfo.dataset; }
    if (item.datasetInfo.fields) { out.fields = item.datasetInfo.fields; }
    if (item.datasetInfo.constraints) { out.constraints = item.datasetInfo.constraints; }
    if (item.datasetInfo.order) { out.order = item.datasetInfo.order; }
  } else if (item.requestBody) {
    out.requestBody = parseJsonSafe(item.requestBody) || item.requestBody;
  }
  if (item.responseLoaded) {
    out.response = item.responseJson != null ? item.responseJson : item.responseText;
  }
  return out;
}

function renderNetInspector(item) {
  if (!item) {
    return '<div class="dg-inspector-empty">Clique em uma requisição acima para inspecionar os parâmetros, constraints e o retorno completo.</div>';
  }

  var urlEsc = esc(item.url).replace(/"/g, '&quot;');
  var statusClass = item.failed ? 'err' : 'ok';
  var statusLabel = item.status === 0 ? 'FALHA / 0' : String(item.status);
  var dsName = item.datasetInfo && item.datasetInfo.dataset;

  var html = '<div class="dg-inspector-head">' +
    '<span class="dg-inspector-title" style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">' +
    '<span class="tag">' + esc(item.method) + '</span>' +
    '<span class="' + statusClass + '">' + esc(statusLabel) + '</span>' +
    '<span class="muted">' + esc(item.timeMs + ' ms') + '</span>' +
    '<code>' + esc(dsName ? ('dataset: ' + dsName) : item.path) + '</code>' +
    '<button type="button" class="btn-icon" data-copy="' + urlEsc + '" title="Copiar URL completa">' + COPY_SVG + '</button>' +
    '</span>' +
    '<div class="dg-inspector-acts">' +
    '<button type="button" class="primary" data-net-copy-call="' + item.id + '" title="Copiar JSON completo da chamada (envio + retorno)">Copiar Chamada JSON</button>' +
    '<button type="button" data-net-copy-resp="' + item.id + '" title="Copiar apenas o retorno da chamada">Copiar Retorno</button>';

  if (dsName) {
    html += '<button type="button" data-net-copy-ds-code="' + item.id + '" title="Copiar código JS DatasetFactory.getDataset">Copiar JS</button>';
  }
  html += '</div></div>';

  html += '<div class="net-detail-meta">' +
    '<div class="row"><span class="k">URL</span><code style="word-break:break-all;">' + esc(item.url) + '</code></div>';

  if (item.datasetInfo) {
    var dsi = item.datasetInfo;
    if (dsi.fields && dsi.fields.length) {
      html += '<div class="row"><span class="k">Campos</span><code>' + esc(dsi.fields.join(', ')) + '</code></div>';
    }
    if (dsi.order && dsi.order.length) {
      html += '<div class="row"><span class="k">Ordenação</span><code>' + esc(dsi.order.join(', ')) + '</code></div>';
    }
    if (dsi.constraints && dsi.constraints.length) {
      html += '<div class="row"><span class="k">Constraints</span><span>' + dsi.constraints.length + ' filtro(s)</span></div>';
      html += '<div class="net-constraints-wrap"><table class="dg-table net-constraints-table">' +
        '<thead><tr><th>Campo</th><th>Valor Inicial</th><th>Valor Final</th><th>Tipo</th></tr></thead><tbody>';
      dsi.constraints.forEach(function (c) {
        html += '<tr>' +
          '<td><code>' + esc(c.field || '') + '</code></td>' +
          '<td>' + renderValue(c.initial != null ? String(c.initial) : '') + '</td>' +
          '<td>' + renderValue(c.final != null ? String(c.final) : '') + '</td>' +
          '<td><span class="tag">' + esc(c.type || 'MUST') + (c.like ? ' (LIKE)' : '') + '</span></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
  } else if (item.requestBody && item.requestBody !== 'null') {
    var prettyReq = item.requestBody;
    var parsedReq = parseJsonSafe(item.requestBody);
    if (parsedReq != null) { prettyReq = JSON.stringify(parsedReq, null, 2); }
    html += '<div class="net-section-label">Payload enviado</div>' +
      '<textarea class="dg-inspector-textarea net-req-textarea" readonly>' + esc(prettyReq) + '</textarea>';
  }
  html += '</div>';

  html += '<div class="net-section-label">Retorno ';
  if (item.datasetSummary) {
    html += '<span class="tag">' + item.datasetSummary.rowCount + ' linha(s)</span> ';
    if (item.datasetSummary.columns && item.datasetSummary.columns.length) {
      html += '<span class="muted">(' + item.datasetSummary.columns.length + ' coluna(s))</span>';
    }
  }
  html += '</div>';

  if (!item.responseLoaded) {
    html += '<div class="muted" style="padding:6px 0;">Carregando corpo da resposta…</div>';
  } else {
    var displayResp = item.responseText || '';
    if (item.responseJson != null) {
      displayResp = JSON.stringify(item.responseJson, null, 2);
    }
    html += '<textarea class="dg-inspector-textarea net-resp-textarea" readonly placeholder="(resposta vazia)">' + esc(displayResp) + '</textarea>';
  }

  return html;
}

function renderNetworkMonitor() {
  updateNetTabBadge();
  var listEl = document.getElementById('net-monitor-list');
  var inspEl = document.getElementById('net-monitor-inspector');
  var statusEl = document.getElementById('net-monitor-status');
  if (!listEl || !inspEl) { return; }

  var items = getFilteredNetMonitorItems();
  if (statusEl) {
    var dsCount = items.filter(function (i) { return i.kind === 'dataset'; }).length;
    var restCount = items.filter(function (i) { return i.kind === 'rest'; }).length;
    var errCount = items.filter(function (i) { return i.failed; }).length;
    statusEl.textContent = items.length + ' chamada(s) (' + dsCount + ' dataset, ' + restCount + ' REST' +
      (errCount ? ', ' + errCount + ' erro' : '') + ')';
  }

  if (!items.length) {
    listEl.innerHTML = '<div class="dg-inspector-empty">Nenhuma chamada capturada com os filtros atuais. Interaja com o formulário ou recarregue a página com o DevTools aberto.</div>';
    inspEl.innerHTML = renderNetInspector(null);
    return;
  }

  // Mostra as mais recentes no topo ou na ordem cronologica (cronologica com scroll ou inversa)
  var html = '';
  for (var i = items.length - 1; i >= 0; i--) {
    var it = items[i];
    var isSel = it.id === netMonitorSelectedId;
    var dsName = it.datasetInfo && it.datasetInfo.dataset;
    var cCount = (it.datasetInfo && it.datasetInfo.constraints && it.datasetInfo.constraints.length) || 0;
    var titleText = dsName ? dsName : it.path;
    var stBadge = it.failed
      ? '<span class="tag danger">' + esc(it.status === 0 ? 'ERR' : it.status) + '</span>'
      : '<span class="tag">' + esc(it.status) + '</span>';
    var kindBadge = it.kind === 'dataset'
      ? '<span class="tag net-tag-ds">Dataset</span>'
      : '<span class="tag">REST</span>';
    var extraMeta = dsName && cCount ? '<span class="muted" style="font-size:11px;">· ' + cCount + ' filtro(s)</span>' : '';

    html += '<div class="net-row' + (isSel ? ' selected' : '') + (it.failed ? ' failed' : '') + '" data-net-select="' + it.id + '">' +
      '<div class="net-row-main">' +
      kindBadge +
      '<span class="net-method">' + esc(it.method) + '</span>' +
      '<code class="net-title" title="' + esc(it.url) + '">' + esc(titleText) + '</code>' +
      extraMeta +
      '</div>' +
      '<div class="net-row-meta">' +
      stBadge +
      '<span class="muted">' + esc(it.timeMs + ' ms') + '</span>' +
      '</div>' +
      '</div>';
  }
  listEl.innerHTML = html;

  var selectedItem = null;
  for (var j = 0; j < netMonitorItems.length; j++) {
    if (netMonitorItems[j].id === netMonitorSelectedId) {
      selectedItem = netMonitorItems[j];
      break;
    }
  }
  inspEl.innerHTML = renderNetInspector(selectedItem);
}

function selectNetMonitorItem(id) {
  netMonitorSelectedId = Number(id);
  var selectedItem = null;
  for (var i = 0; i < netMonitorItems.length; i++) {
    if (netMonitorItems[i].id === netMonitorSelectedId) {
      selectedItem = netMonitorItems[i];
      break;
    }
  }
  renderNetworkMonitor();
  if (selectedItem && !selectedItem.responseLoaded) {
    ensureNetItemResponse(selectedItem).then(function () {
      renderNetworkMonitor();
    });
  }
}

function loadNetworkMonitorFromHar() {
  var net = chrome.devtools && chrome.devtools.network;
  if (!net || typeof net.getHAR !== 'function') {
    renderNetworkMonitor();
    return;
  }
  net.getHAR(function (har) {
    var entries = (har && har.entries) || [];
    entries.forEach(function (entry) {
      createNetMonitorItem(entry);
    });
    renderNetworkMonitor();
  });
}

function clearNetworkMonitor() {
  netMonitorItems = [];
  netMonitorSeen = {};
  netMonitorSelectedId = null;
  renderNetworkMonitor();
}

var netFormRefreshTimer = null;

function initNetworkMonitor() {
  loadNetworkMonitorFromHar();
  var net = chrome.devtools && chrome.devtools.network;
  if (net && net.onRequestFinished && typeof net.onRequestFinished.addListener === 'function') {
    net.onRequestFinished.addListener(function (entry) {
      var added = createNetMonitorItem(entry);
      if (added) {
        renderNetworkMonitor();
      }
      // Quando o iframe do formulario (streamcontrol) ou os endpoints do
      // workflowView terminam de carregar, agenda uma atualizacao do browser
      // de campos e do cabecalho da solicitacao.
      var reqUrl = (entry && entry.request && entry.request.url) || '';
      var isStreamControl = /\/streamcontrol\//i.test(reqUrl);
      var isWorkflowAjax = /mistWorkflowviewcard|findDetailsMyRequests|workflowView/i.test(reqUrl);
      if (isStreamControl || (isWorkflowAjax && (!browserFields || !browserFields.length))) {
        if (netFormRefreshTimer) { clearTimeout(netFormRefreshTimer); }
        netFormRefreshTimer = setTimeout(function () {
          netFormRefreshTimer = null;
          invalidateFieldIndex();
          loadFieldBrowser();
          if (typeof loadSolicitacao === 'function') {
            loadSolicitacao();
          }
        }, 450);
      }
    });
  }
}
