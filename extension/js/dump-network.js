// js/dump-network.js — Chamadas REST e de dataset capturadas pela rede do DevTools
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Chamadas de rede (REST e datasets)
// ---------------------------------------------------------------------------
//
// Sem hook na pagina: o DatasetFactory client-side do Fluig e so um wrapper de
// XHR, entao cada getDataset aparece na aba Network como qualquer chamada REST.
// Lemos o historico com chrome.devtools.network.getHAR NO MOMENTO DO DUMP, o que
// dispensa listener e cobre chamadas feitas antes de abrir o painel — desde que
// o DevTools ja estivesse aberto na hora (limite da propria API) e o log nao
// tenha sido limpo por navegacao (marque "Preserve log" para atravessar
// navegacoes).
//
// Dois niveis de detalhe:
//   - so as CHAMADAS (padrao): metodo, URL, status, tempo e, para datasets,
//     nome/fields/constraints/order enviados (e o payload da requisicao).
//   - com RETORNOS (checkbox): tambem colunas, total de linhas e amostra das
//     primeiras linhas do dataset; corpo truncado das chamadas REST.
// Headers nunca entram (carregam cookie/token).

var NET_LIMITS = {
  maxEntries: 150,   // chamadas mais recentes mantidas
  bodyChars: 1500,   // corpo (requisicao ou resposta) truncado neste tamanho
  sampleRows: 10     // linhas de amostra por dataset
};

var NET_STATIC_RE = /\.(js|css|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|map|html?)(\?|#|$)/i;
var NET_API_RE = /\/(api\/|dataset\/|ecm\/|process-management\/|webdesk\/|portal\/api|content-management\/|social\/api)/i;
// Chamadas internas do portal Fluig (menu, alertas, temas, analytics, partials
// HTML de widgets...). Disparam em toda pagina e escondem as chamadas que
// interessam, entao ficam FORA por padrao (checkbox "chamadas internas do
// portal"). Datasets nunca sao ruido. Cada item e testado contra path+query.
var NET_NOISE_RES = [
  /\/portal\/api\/rest\/wcm\//i,
  /\/page-management\/api\//i,
  /\/admin\/api\/v1\/tenants\//i,
  /\/intelligence\/api\//i,
  /\/globalalertapi\//i,
  /\/tenants\/getTenantData\//i,
  /\/users\/listData\//i
];
var NET_CONSTRAINT_TYPES = { 1: 'MUST', 2: 'SHOULD', 3: 'MUST_NOT' };

function netPathOf(url) {
  try { return new URL(url, 'http://x').pathname; } catch (e) { return String(url).split('?')[0]; }
}

function netQueryParam(url, name) {
  try { return new URL(url, 'http://x').searchParams.get(name); } catch (e) { return null; }
}

function isApiEntry(entry) {
  var url = entry.request && entry.request.url;
  if (!url) { return false; }
  var type = entry._resourceType; // Chrome: 'xhr' | 'fetch' | 'document' | ...
  if (type && type !== 'xhr' && type !== 'fetch') { return false; }
  if (NET_STATIC_RE.test(url)) { return false; }
  return NET_API_RE.test(netPathOf(url));
}

// True se a chamada comecou durante um eval do proprio painel (margem de 100ms
// para o relogio do HAR). Ver panelEvalWindows em bridge.js.
function isPanelCall(entry) {
  var t = Date.parse(entry.startedDateTime);
  if (isNaN(t)) { return false; }
  for (var i = 0; i < panelEvalWindows.length; i++) {
    var w = panelEvalWindows[i];
    var end = w.end || Date.now();
    if (t >= w.start - 100 && t <= end + 100) { return true; }
  }
  return false;
}

function isPortalNoise(url) {
  var p = netPathOf(url);
  for (var i = 0; i < NET_NOISE_RES.length; i++) {
    if (NET_NOISE_RES[i].test(p)) { return true; }
  }
  return false;
}

// Remove o parametro de cache-buster do jQuery (_=<timestamp>), que so adiciona
// ruido e impede ver que duas chamadas sao a mesma.
function stripCacheBuster(url) {
  return String(url).replace(/([?&])_=\d+(&|$)/, function (m, a, b) { return b ? a : ''; });
}

function isDatasetUrl(url) {
  return /\/dataset/i.test(netPathOf(url)) || netQueryParam(url, 'datasetId') != null;
}

function truncateText(text) {
  if (text == null) { return text; }
  var s = String(text);
  if (s.length <= NET_LIMITS.bodyChars) { return s; }
  return s.slice(0, NET_LIMITS.bodyChars) + '… [+' + (s.length - NET_LIMITS.bodyChars) + ' chars]';
}

function parseJsonSafe(text) {
  if (!text) { return null; }
  try { return JSON.parse(text); } catch (e) { return null; }
}

function mapConstraint(c) {
  if (!c) { return c; }
  var type = c._type != null ? c._type : c.type;
  return {
    field: c._field != null ? c._field : c.fieldName,
    initial: c._initialValue != null ? c._initialValue : c.initialValue,
    final: c._finalValue != null ? c._finalValue : c.finalValue,
    type: NET_CONSTRAINT_TYPES[type] || type,
    like: (c._likeSearch != null ? c._likeSearch : c.likeSearch) || undefined
  };
}

// Extrai nome/fields/constraints/order do dataset a partir do corpo (POST
// /datasets) ou da query (?datasetId=). Tolerante: campos ausentes ficam de fora.
function parseDatasetCall(entry) {
  var url = entry.request.url;
  var body = parseJsonSafe(entry.request.postData && entry.request.postData.text);
  var info = {};
  var name = (body && (body.name || body.datasetId)) || netQueryParam(url, 'datasetId');
  if (!name) {
    var m = netPathOf(url).match(/\/datasets?\/([^\/]+)$/i);
    if (m && !/^(datasets?|search|handle)$/i.test(m[1])) { name = decodeURIComponent(m[1]); }
  }
  if (name) { info.dataset = name; }
  if (body) {
    if (body.fields && body.fields.length) { info.fields = body.fields; }
    if (body.constraints && body.constraints.length) { info.constraints = body.constraints.map(mapConstraint); }
    if (body.order && body.order.length) { info.order = body.order; }
  }
  var qFields = netQueryParam(url, 'fields');
  if (qFields && !info.fields) { info.fields = qFields.split(','); }
  return info;
}

// Linhas/colunas do retorno de um dataset. Aceita { content: { values, columns } },
// { values, columns } ou um array simples.
function summarizeDatasetResponse(data) {
  if (!data) { return null; }
  var content = data.content && typeof data.content === 'object' ? data.content : data;
  var values = Array.isArray(content) ? content : content.values;
  if (!Array.isArray(values)) { return null; }
  var summary = { rowCount: values.length };
  if (content.columns) { summary.columns = content.columns; }
  else if (values.length && typeof values[0] === 'object') { summary.columns = Object.keys(values[0]); }
  summary.sample = values.slice(0, NET_LIMITS.sampleRows);
  if (values.length > NET_LIMITS.sampleRows) { summary.sampleTruncated = true; }
  return summary;
}

function harGetContent(entry) {
  return new Promise(function (resolve) {
    try {
      entry.getContent(function (content, encoding) { resolve({ content: content, encoding: encoding }); });
    } catch (e) { resolve({ content: null, encoding: null }); }
  });
}

function buildNetEntry(entry, kind, withResponses, byPanel) {
  var req = entry.request;
  var item = {
    kind: kind,
    method: req.method,
    url: stripCacheBuster(req.url),
    status: entry.response ? entry.response.status : 0,
    timeMs: Math.round(entry.time || 0),
    at: entry.startedDateTime
  };
  if (kind === 'dataset') {
    var info = parseDatasetCall(entry);
    Object.keys(info).forEach(function (k) { item[k] = info[k]; });
  } else if (req.postData && req.postData.text) {
    item.requestBody = truncateText(req.postData.text);
  }
  if (item.status === 0 || item.status >= 400) { item.failed = true; }
  if (byPanel) { item.byPanel = true; }
  if (!withResponses) { return Promise.resolve(item); }

  return harGetContent(entry).then(function (res) {
    var text = res.content;
    if (text == null || res.encoding === 'base64') { return item; }
    var data = parseJsonSafe(text);
    if (kind === 'dataset') {
      var summary = summarizeDatasetResponse(data);
      if (summary) { item.response = summary; return item; }
    }
    item.response = data != null && text.length <= NET_LIMITS.bodyChars ? data : truncateText(text);
    return item;
  });
}

// Le o HAR e devolve { datasets: [...], rest: [...], truncated } conforme as
// opcoes ({ datasets, rest, responses }). Resolve null se a API nao existir.
function collectNetwork(opts) {
  return new Promise(function (resolve) {
    var net = chrome.devtools && chrome.devtools.network;
    if (!net || typeof net.getHAR !== 'function') { resolve(null); return; }
    net.getHAR(function (har) {
      var apiEntries = ((har && har.entries) || []).filter(isApiEntry);
      // Chamadas do painel bem-sucedidas ficam de fora; as que FALHARAM
      // permanecem (marcadas byPanel) porque explicam dados ausentes no dump.
      function entryFailed(e) { var st = e.response ? e.response.status : 0; return st === 0 || st >= 400; }
      var ownCalls = apiEntries.filter(function (e) { return isPanelCall(e) && !entryFailed(e); }).length;
      var noiseIgnored = 0;
      var entries = apiEntries.filter(function (e) { return !isPanelCall(e) || entryFailed(e); }).map(function (e) {
        return { entry: e, kind: isDatasetUrl(e.request.url) ? 'dataset' : 'rest', byPanel: isPanelCall(e) };
      }).filter(function (x) {
        return x.kind === 'dataset' ? opts.datasets : opts.rest;
      }).filter(function (x) {
        if (x.kind === 'dataset' || opts.noise || !isPortalNoise(x.entry.request.url)) { return true; }
        noiseIgnored++;
        return false;
      });
      var truncated = Math.max(0, entries.length - NET_LIMITS.maxEntries);
      entries = entries.slice(-NET_LIMITS.maxEntries);
      Promise.all(entries.map(function (x) { return buildNetEntry(x.entry, x.kind, opts.responses, x.byPanel); }))
        .then(function (items) {
          resolve({
            datasets: items.filter(function (i) { return i.kind === 'dataset'; }),
            rest: items.filter(function (i) { return i.kind === 'rest'; }),
            truncated: truncated,
            panelCallsIgnored: ownCalls,
            portalNoiseIgnored: noiseIgnored
          });
        });
    });
  });
}
