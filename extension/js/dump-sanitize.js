// js/dump-sanitize.js — Mascara de dados sensiveis do dump
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Mascara de dados sensiveis
// ---------------------------------------------------------------------------
//
// Aplicada sobre o dump FINAL (campos, tabelas, logs, contexto e rede) quando a
// opcao "Mascarar dados sensiveis" esta marcada (padrao: ligada). Dois eixos:
//   1. Pelo NOME da chave/campo: senha, token, secret, authorization... o valor
//      inteiro vira "***", seja qual for o conteudo.
//   2. Pelo CONTEUDO da string: CPF/CNPJ formatados, e-mail, "Bearer xxx" e
//      parametros sensiveis de query string.
// CPF/CNPJ SEM pontuacao so sao mascarados quando o valor inteiro e so digitos
// (11 ou 14), para nao mascarar ids numericos dentro de textos maiores.

var MASK_TEXT = '***';
var MASK_NAME_RE = /(senha|password|passwd|pwd|token|secret|authorization|cookie|api[-_]?key|consumer[-_]?(key|secret)|csrf|credential)/i;
var MASK_QUERY_RE = /([?&](?:[^=&#]*(?:senha|password|passwd|pwd|token|secret|api[-_]?key|csrf|credential)[^=&#]*)=)[^&#]*/gi;
var MASK_CPF_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
var MASK_CNPJ_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
var MASK_EMAIL_RE = /\b([A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]*@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/g;
var MASK_BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=\-]{8,}/g;

// Contador de itens mascarados na execucao corrente (zerado por maskDump).
var maskCount = 0;

function maskString(s) {
  if (typeof s !== 'string' || !s) { return s; }
  var out = s;
  var before = out;
  out = out.replace(MASK_QUERY_RE, '$1' + MASK_TEXT);
  out = out.replace(MASK_BEARER_RE, '$1 ' + MASK_TEXT);
  out = out.replace(MASK_CNPJ_RE, MASK_TEXT);
  out = out.replace(MASK_CPF_RE, MASK_TEXT);
  out = out.replace(MASK_EMAIL_RE, '$1' + MASK_TEXT + '@$2');
  if (/^\d{11}$/.test(out) || /^\d{14}$/.test(out)) { out = MASK_TEXT; }
  if (out !== before) { maskCount++; }
  return out;
}

// Percorre qualquer estrutura JSON. `key` e o nome da chave pai (nome do campo,
// no caso de fields/tables): se for sensivel, o valor inteiro e mascarado.
function maskDeep(value, key) {
  if (value == null) { return value; }
  if (key && MASK_NAME_RE.test(key) && (typeof value !== 'object')) {
    if (value === '' ) { return value; }
    maskCount++;
    return MASK_TEXT;
  }
  if (typeof value === 'string') { return maskString(value); }
  if (Array.isArray(value)) {
    return value.map(function (v) { return maskDeep(v, key); });
  }
  if (typeof value === 'object') {
    var res = {};
    Object.keys(value).forEach(function (k) { res[k] = maskDeep(value[k], k); });
    return res;
  }
  return value;
}

// Devolve uma copia mascarada do dump e registra a quantidade em meta.masked.
function maskDump(out) {
  maskCount = 0;
  var masked = maskDeep(out, null);
  if (masked && masked.meta) { masked.meta.masked = maskCount; }
  return masked;
}
