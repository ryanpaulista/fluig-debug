// tests/dump.test.js
//
// Teste de fumaca da logica pura do dump (mascara, parsing de rede, montagem).
// Sem dependencias: node tests/dump.test.js
//
// Os modulos de extension/js sao scripts classicos (escopo global), entao sao
// carregados num mesmo contexto vm, na mesma ordem do panel.html.

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');

// Objetos criados dentro do vm tem outro prototipo: compara por JSON.
assert.deepStrictEqual = function (a, b) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b)); };

var ctx = vm.createContext({ console: console, URL: URL, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout });
['bridge', 'page-index', 'autocomplete', 'dump-sanitize', 'dump-network', 'network-monitor', 'dump', 'field-browser'].forEach(function (name) {
  var file = path.join(__dirname, '..', 'extension', 'js', name + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
});
function run(code) { return vm.runInContext(code, ctx); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test('mascara por nome de campo e por conteudo', function () {
  var out = run('maskDump({ meta: {}, fields: { senha: "abc123", cpf: "123.456.789-09", email: "joao@empresa.com", obs: "tudo certo", doc: "12345678909" }, logs: [{ msg: "Bearer abcdefghij1234" }] })');
  assert.strictEqual(out.fields.senha, '***');
  assert.strictEqual(out.fields.cpf, '***');
  assert.strictEqual(out.fields.email, 'j***@empresa.com');
  assert.strictEqual(out.fields.obs, 'tudo certo');
  assert.strictEqual(out.fields.doc, '***');
  assert.strictEqual(out.logs[0].msg, 'Bearer ***');
  assert.ok(out.meta.masked >= 5);
});

test('nao mascara id numerico dentro de texto nem campo vazio', function () {
  var out = run('maskDump({ meta: {}, fields: { token: "", msg: "solicitacao 12345678909 aberta" } })');
  assert.strictEqual(out.fields.token, '');
  assert.strictEqual(out.fields.msg, 'solicitacao 12345678909 aberta');
});

test('mascara parametro sensivel na query', function () {
  var s = run('maskString("http://x/api?access_token=abc&datasetId=colleague")');
  assert.strictEqual(s, 'http://x/api?access_token=***&datasetId=colleague');
});

function harEntry(url, body, status, respJson, type) {
  return {
    _resourceType: type || 'xhr',
    startedDateTime: '2026-01-01T00:00:00Z',
    time: 123.4,
    request: { method: body ? 'POST' : 'GET', url: url, postData: body ? { text: JSON.stringify(body) } : undefined },
    response: { status: status },
    getContent: function (cb) { cb(respJson == null ? null : JSON.stringify(respJson), 'utf-8'); }
  };
}

function withHar(entries, opts) {
  ctx.chrome = { devtools: { network: { getHAR: function (cb) { cb({ entries: entries }); } } } };
  return run('collectNetwork(' + JSON.stringify(opts) + ')');
}

var HAR = [
  harEntry('http://f/portal/resources/app.js', null, 200, 'x', 'script'),
  harEntry('http://f/api/public/ecm/dataset/datasets', {
    name: 'colleague', fields: ['colleagueName'],
    constraints: [{ _field: 'colleagueId', _initialValue: 'admin', _finalValue: 'admin', _type: 1, _likeSearch: false }],
    order: ['colleagueName']
  }, 200, { content: { columns: ['colleagueName'], values: [{ colleagueName: 'A' }, { colleagueName: 'B' }] } }),
  harEntry('http://f/api/public/2.0/users/getCurrent', null, 500, { message: 'boom' }),
  harEntry('http://f/api/public/ecm/dataset/search?datasetId=ds_x', null, 200, { values: [] })
];

test('classifica datasets x REST e ignora estaticos', function () {
  return withHar(HAR, { datasets: true, rest: true, responses: false }).then(function (net) {
    assert.strictEqual(net.datasets.length, 2);
    assert.strictEqual(net.rest.length, 1);
    var d = net.datasets[0];
    assert.strictEqual(d.dataset, 'colleague');
    assert.deepStrictEqual(d.fields, ['colleagueName']);
    assert.strictEqual(d.constraints[0].type, 'MUST');
    assert.strictEqual(d.constraints[0].field, 'colleagueId');
    assert.strictEqual(d.response, undefined, 'sem retornos por padrao');
    assert.strictEqual(net.datasets[1].dataset, 'ds_x');
    assert.strictEqual(net.rest[0].failed, true);
    assert.strictEqual(net.rest[0].response, undefined);
  });
});

test('com retornos inclui colunas, total e amostra', function () {
  return withHar(HAR, { datasets: true, rest: true, responses: true }).then(function (net) {
    assert.strictEqual(net.datasets[0].response.rowCount, 2);
    assert.deepStrictEqual(net.datasets[0].response.columns, ['colleagueName']);
    assert.deepStrictEqual(net.rest[0].response, { message: 'boom' });
  });
});

test('ignora chamadas feitas pelo proprio painel', function () {
  var t = Date.parse('2026-01-01T00:00:00Z');
  ctx.panelEvalWindows.length = 0;
  ctx.panelEvalWindows.push({ start: t - 10, end: t + 500 });
  return withHar(HAR, { datasets: true, rest: true, responses: false }).then(function (net) {
    ctx.panelEvalWindows.length = 0;
    // As 2 bem-sucedidas somem; a de status 500 permanece, marcada byPanel.
    assert.strictEqual(net.datasets.length, 0);
    assert.strictEqual(net.rest.length, 1);
    assert.strictEqual(net.rest[0].byPanel, true);
    assert.strictEqual(net.panelCallsIgnored, 2);
  });
});

test('filtra ruido do portal e remove cache-buster', function () {
  var har = [
    harEntry('http://f/portal/api/rest/wcm/core/security/isadmin?space=&_=1792096103164', null, 200, { content: true }),
    harEntry('http://f/page-management/api/v2/themes?page=1&_=1792096103169', null, 200, { items: [] }),
    harEntry('http://f/api/public/2.0/users/listData/admin?_=1792096103171', null, 200, { content: {} }),
    harEntry('http://f/ecm/api/rest/ecm/workflowView/getAttachments/968/admin/1?processId=x&_=1792096103177', null, 200, { content: { attachments: [] } }),
    harEntry('http://f/ecm/api/rest/ecm/workflowView/loadhistory?processInstanceId=968&_=1792096103179', null, 200, { a: 1 })
  ];
  return withHar(har, { datasets: true, rest: true, responses: false, noise: false }).then(function (net) {
    assert.strictEqual(net.rest.length, 2);
    assert.strictEqual(net.portalNoiseIgnored, 3);
    assert.strictEqual(net.rest[0].url, 'http://f/ecm/api/rest/ecm/workflowView/getAttachments/968/admin/1?processId=x');
    assert.strictEqual(net.rest[1].url, 'http://f/ecm/api/rest/ecm/workflowView/loadhistory?processInstanceId=968');
    return withHar(har, { datasets: true, rest: true, responses: false, noise: true }).then(function (all) {
      assert.strictEqual(all.rest.length, 5);
      assert.strictEqual(all.portalNoiseIgnored, 0);
    });
  });
});

test('chamada do painel que falhou continua no dump, marcada byPanel', function () {
  var t = Date.parse('2026-01-01T00:00:00Z');
  ctx.panelEvalWindows.length = 0;
  ctx.panelEvalWindows.push({ start: t - 10, end: t + 500 });
  var har = [
    harEntry('http://f/api/public/ecm/dataset/datasets/', { name: 'workflowProcess' }, 200, { values: [] }),
    harEntry('http://f/api/public/ecm/dataset/datasets/', { name: 'workflowProcess' }, 500, '<html>erro</html>')
  ];
  return withHar(har, { datasets: true, rest: true, responses: false }).then(function (net) {
    ctx.panelEvalWindows.length = 0;
    assert.strictEqual(net.datasets.length, 1);
    assert.strictEqual(net.datasets[0].byPanel, true);
    assert.strictEqual(net.datasets[0].failed, true);
    assert.strictEqual(net.panelCallsIgnored, 1);
  });
});

test('respeita filtro de secoes', function () {
  return withHar(HAR, { datasets: true, rest: false, responses: false }).then(function (net) {
    assert.strictEqual(net.datasets.length, 2);
    assert.strictEqual(net.rest.length, 0);
  });
});

test('buildDumpOutput: secoes, compacto, rede e mascara', function () {
  ctx.result = {
    entries: [
      { name: 'nome', raw: 'nome', value: 'Ana', child: null },
      { name: 'vazio', raw: 'vazio', value: '', child: null },
      { name: 'senha', raw: 'senha', value: 'x', child: null }
    ],
    logs: [{ level: 'log', msg: 'oi' }],
    capturedFrom: 'http://f/', framesScanned: 1
  };
  ctx.net = { datasets: [{ kind: 'dataset', failed: false }], rest: [{ kind: 'rest', failed: true }], truncated: 0 };
  var out = run('buildDumpOutput(result, { process: { numProcess: "1" } }, net, { fields: true, logs: false, context: true, datasets: true, rest: true, responses: false, compact: true, mask: true })');
  assert.deepStrictEqual(Object.keys(out.fields).sort(), ['nome', 'senha']);
  assert.strictEqual(out.fields.senha, '***');
  assert.strictEqual(out.logs, undefined);
  assert.strictEqual(out.context.process.numProcess, '1');
  assert.strictEqual(out.meta.network.failed, 1);
  assert.strictEqual(out.network.datasets.length, 1);

  var big = new Array(700).join('x');
  ctx.result2 = { entries: [
    { name: 'a', raw: 'a', value: '', child: null },
    { name: 'b', raw: 'b', value: big, child: null },
    { name: 'c', raw: 'c', value: 'ok', child: null }
  ], logs: [], capturedFrom: 'x', framesScanned: 1 };
  var compact = run('buildDumpOutput(result2, null, null, { fields: true, logs: true, context: false, datasets: false, rest: false, responses: false, compact: true, mask: false })');
  assert.strictEqual(compact.meta.fieldCount, 2, 'contagem reflete o compacto');
  assert.strictEqual(compact.meta.compact.omittedEmpty, 1);
  assert.strictEqual(compact.meta.compact.truncatedTexts, 1);
  assert.ok(compact.fields.b.length < big.length);

  var semCampos = run('buildDumpOutput(result, null, null, { fields: false, logs: true, context: false, datasets: false, rest: false, responses: false, compact: false, mask: false })');
  assert.strictEqual(semCampos.fields, undefined);
  assert.strictEqual(semCampos.network, undefined);
  assert.strictEqual(semCampos.logs.length, 1);
});

test('formatRowCopyJson: gera JSON completo das celulas da linha pai-filho', function () {
  ctx.rowMock = {
    table: 'times',
    child: '1',
    fields: [
      { name: 'ENTRY_ID___1', id: 'ENTRY_ID___1', field: 'ENTRY_ID', value: '530468', type: 'hidden', disabled: false, visible: false },
      { name: '_USERNAME___1', id: '_USERNAME___1', field: 'USERNAME', value: 'Rafael', type: 'text', disabled: true, visible: true }
    ]
  };
  var rowJson = run('formatRowCopyJson(rowMock)');
  assert.strictEqual(rowJson.table, 'times');
  assert.strictEqual(rowJson.row, '1');
  assert.strictEqual(rowJson.fieldCount, 2);
  assert.deepStrictEqual(rowJson.cells.ENTRY_ID, {
    name: 'ENTRY_ID___1',
    id: 'ENTRY_ID___1',
    field: 'ENTRY_ID',
    value: '530468',
    type: 'hidden',
    disabled: false,
    visible: false
  });
  assert.deepStrictEqual(rowJson.cells.USERNAME, {
    name: '_USERNAME___1',
    id: '_USERNAME___1',
    field: 'USERNAME',
    value: 'Rafael',
    type: 'text',
    disabled: true,
    visible: true
  });
});

test('network-monitor: captura, deduplica, carrega retorno e gera snippet DatasetFactory', function () {
  run('netMonitorItems = []; netMonitorSeen = {}; netMonitorSeq = 0;');
  ctx.harSample = HAR;
  var first = run('createNetMonitorItem(harSample[0])'); // script estatico -> null
  assert.strictEqual(first, null);
  var dsItem = run('createNetMonitorItem(harSample[1])');
  assert.strictEqual(dsItem.kind, 'dataset');
  assert.strictEqual(dsItem.datasetInfo.dataset, 'colleague');
  // Deduplicacao da mesma entrada HAR
  var dup = run('createNetMonitorItem(harSample[1])');
  assert.strictEqual(dup, null);

  var snippet = run('buildDatasetSnippet(createNetMonitorItem(harSample[3]).datasetInfo || netMonitorItems[0].datasetInfo)');
  assert.ok(snippet.indexOf('DatasetFactory.getDataset') >= 0);

  var fullSnippet = run('buildDatasetSnippet(netMonitorItems[0].datasetInfo)');
  assert.ok(fullSnippet.indexOf('DatasetFactory.createConstraint("colleagueId", "admin", "admin", ConstraintType.MUST)') >= 0);
  assert.ok(fullSnippet.indexOf('DatasetFactory.getDataset("colleague", ["colleagueName"], constraints, ["colleagueName"])') >= 0);

  return run('ensureNetItemResponse(netMonitorItems[0])').then(function (loaded) {
    assert.strictEqual(loaded.responseLoaded, true);
    assert.strictEqual(loaded.datasetSummary.rowCount, 2);
    var exported = run('formatNetCallExportJson(netMonitorItems[0])');
    assert.strictEqual(exported.dataset, 'colleague');
    assert.strictEqual(exported.response.content.values.length, 2);
  });
});

test('ensureFieldIndex nao faz cache de indice vazio e collectWindows descobre iframes via DOM', function () {
  var realEval = ctx.evalInPage;
  var realBuildIdx = ctx.buildFieldIndexExpr;
  var evalCalls = 0;
  ctx.buildFieldIndexExpr = function () { return 'mock'; };
  ctx.evalInPage = function () {
    evalCalls++;
    if (evalCalls === 1) {
      return Promise.resolve({ fields: [], rows: [], fieldsTotal: 0, rowsTotal: 0 });
    }
    return Promise.resolve({ fields: [{ logical: 'startDate', name: 'startDate', value: '12/10/2026' }], rows: [], fieldsTotal: 1, rowsTotal: 0 });
  };
  run('invalidateFieldIndex()');
  return run('ensureFieldIndex()').then(function (first) {
    assert.strictEqual(first.fields.length, 0);
    // Segunda chamada imediata deve consultar a pagina de novo porque a primeira veio vazia
    return run('ensureFieldIndex()');
  }).then(function (second) {
    ctx.evalInPage = realEval;
    ctx.buildFieldIndexExpr = realBuildIdx;
    assert.strictEqual(second.fields.length, 1);
    assert.strictEqual(second.fields[0].logical, 'startDate');
    assert.strictEqual(evalCalls, 2);

    // Testa collectWindows de PAGE_HELPERS quando win.frames esta vazio/sombreado mas ha iframe no DOM
    var helpersFn = new Function(ctx.PAGE_HELPERS + '\nreturn { collectWindows: collectWindows };')();
    var childWin = { document: { querySelectorAll: function () { return []; } }, frames: [] };
    var topWin = {
      frames: [], // sombreado ou vazio
      document: {
        querySelectorAll: function (sel) {
          return sel.indexOf('iframe') >= 0 ? [{ contentWindow: childWin }] : [];
        }
      }
    };
    var wins = helpersFn.collectWindows(topWin, [], 0);
    assert.strictEqual(wins.length, 2);
    assert.strictEqual(wins[1], childWin);
  });
});

test('evalInPage faz retry em "has no execution context" e page-index ignora shell do portal no pageworkflowview', function () {
  var rawEvalCalls = 0;
  ctx.chrome = {
    devtools: {
      inspectedWindow: {
        eval: function (expr, cb) {
          rawEvalCalls++;
          if (rawEvalCalls === 1) {
            cb(undefined, {
              code: 'E_FAILED',
              description: 'Operation failed: %s',
              details: ['https://fluig/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=3211 has no execution context'],
              isError: true
            });
            return;
          }
          cb({ ok: true, recovered: true }, undefined);
        }
      }
    }
  };

  // Testa a expressao real de buildFieldIndexExpr() quando so o portal shell carregou vs quando o iframe carregou
  var expr = run('buildFieldIndexExpr()');
  var portalNode = {
    getAttribute: function (k) { return k === 'name' ? 'wcm-edit-mode' : null; },
    id: 'wcm-edit-mode',
    type: 'hidden',
    tagName: 'INPUT',
    value: 'false'
  };
  var formNode = {
    getAttribute: function (k) { return k === 'name' ? 'startDate' : null; },
    id: 'startDate',
    type: 'text',
    tagName: 'INPUT',
    value: '12/10/2026'
  };

  // 1) So o portal shell (wins[0]) carregou em pageworkflowview -> deve ignorar wcm-edit-mode e sinalizar formLoading: true
  var winBeforeIframe = {
    location: { href: 'https://fluig/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=3211' },
    frames: [],
    document: {
      readyState: 'complete',
      querySelectorAll: function (sel) {
        if (sel.indexOf('iframe') >= 0) { return []; }
        return [portalNode];
      }
    }
  };
  var resBefore = (new Function('window', 'return ' + expr))(winBeforeIframe);
  assert.strictEqual(resBefore.fields.length, 0);
  assert.strictEqual(resBefore.formLoading, true);

  // 2) Iframe (#workflowView-cardViewer / streamcontrol) carregou -> retorna startDate (sem wcm-edit-mode) e formLoading: false
  var iframeWin = {
    location: { href: 'https://fluig/webdesk/streamcontrol/0/1010/89000/' },
    frames: [],
    document: {
      readyState: 'complete',
      querySelectorAll: function (sel) {
        if (sel.indexOf('iframe') >= 0) { return []; }
        return [formNode];
      }
    }
  };
  var winAfterIframe = {
    location: { href: 'https://fluig/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=3211' },
    frames: [iframeWin],
    document: {
      readyState: 'complete',
      querySelectorAll: function (sel) {
        if (sel.indexOf('iframe') >= 0) { return [{ contentWindow: iframeWin }]; }
        return [portalNode];
      }
    }
  };
  var resAfter = (new Function('window', 'return ' + expr))(winAfterIframe);
  assert.strictEqual(resAfter.fields.length, 1);
  assert.strictEqual(resAfter.fields[0].logical, 'startDate');
  assert.strictEqual(resAfter.formLoading, false);

  return run('evalInPage("1+1")').then(function (res) {
    assert.strictEqual(res.recovered, true);
    assert.strictEqual(rawEvalCalls, 2);
  });
});

// Executa em sequencia, aguardando os testes que devolvem Promise.
tests.reduce(function (chain, t) {
  return chain.then(function () { return t.fn(); }).then(function () { console.log('ok - ' + t.name); });
}, Promise.resolve()).then(function () {
  console.log('\n' + tests.length + ' teste(s) passaram.');
}).catch(function (e) {
  console.error('FALHOU:', e && e.stack || e);
  process.exit(1);
});
