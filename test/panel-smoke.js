// Harness de fumaca para o panel.js do Fluig Debug.
//
// Carrega o panel.js com um DOM falso cujos IDs vem do panel.html REAL, entao
// qualquer getElementById que o JS faca para um id inexistente estoura aqui.
// Depois exercita o caminho de render com um resultado de varredura fabricado e
// valida por node --check todas as expressoes injetadas na pagina.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'extension');
const html = fs.readFileSync(path.join(EXT, 'panel.html'), 'utf8');
const js = fs.readFileSync(path.join(EXT, 'panel.js'), 'utf8');

// --- ids e atributos declarados no HTML -------------------------------------
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const dataTabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
const logLevels = [...html.matchAll(/data-log-level="([^"]+)"/g)].map((m) => m[1]);
const panes = [...html.matchAll(/data-pane="([^"]+)"/g)].map((m) => m[1]);
const clamps = [...html.matchAll(/data-clamp="([^"]+)"/g)].map((m) => m[1]);

const problems = [];

// --- colisao com globais do window ------------------------------------------
// panel.js roda em escopo global DE VERDADE no navegador, e ali `var X = ...` nao
// cria variavel nenhuma quando window.X ja existe sem setter: a atribuicao falha
// em silencio e X continua sendo o objeto do navegador. Foi exatamente o que
// aconteceu com `var history = []` — o primeiro history.unshift(...) estourava
// DEPOIS de a acao ter funcionado, e o painel reportava "Erro ao aplicar: {}" em
// cima de um set bem sucedido. O sandbox do vm nao tem window, entao esta
// checagem e estatica: nome declarado no topo do arquivo x lista de globais.
const WINDOW_GLOBALS = [
  'history', 'location', 'name', 'status', 'length', 'top', 'self', 'parent', 'frames',
  'closed', 'origin', 'external', 'event', 'screen', 'navigator', 'document', 'window',
  'opener', 'frameElement', 'crypto', 'performance', 'localStorage', 'sessionStorage',
  'customElements', 'caches', 'indexedDB', 'isSecureContext', 'visualViewport',
  'devicePixelRatio', 'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
  'scrollX', 'scrollY', 'pageXOffset', 'pageYOffset', 'screenX', 'screenY',
  'close', 'focus', 'blur', 'open', 'alert', 'confirm', 'prompt', 'print', 'stop',
  'scroll', 'scrollTo', 'scrollBy', 'postMessage', 'getSelection', 'matchMedia',
];
[...js.matchAll(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)|^function\s+([A-Za-z_$][\w$]*)/gm)]
  .map((m) => m[1] || m[2])
  .filter((n) => WINDOW_GLOBALS.includes(n))
  .forEach((n) => {
    problems.push(`"${n}" no escopo global colide com window.${n} — renomeie (no navegador a atribuicao falha em silencio)`);
  });

const writes = {};        // id -> ultimo innerHTML escrito
const copyBuffer = [];    // textos que passaram pelo execCommand("copy")
let lastSelected = null;  // ultimo elemento que recebeu .select()

function makeEl(id, attrs) {
  const el = {
    __id: id,
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    title: '',
    type: '',
    style: {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      getPropertyValue(k) { return this._props[k] || ''; },
      removeProperty(k) { delete this._props[k]; },
    },
    _attrs: Object.assign({}, attrs),
    children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) { this._s.add(c); } else { this._s.delete(c); } },
    },
    addEventListener(type, fn) { (this._ev = this._ev || {})[type] = fn; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    hasAttribute(k) { return k in this._attrs; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    select() { lastSelected = this; },
    click() {},
    scrollIntoView() {},
  };
  // Registra o que a UI escreve, para dar para inspecionar o HTML gerado.
  Object.defineProperty(el, 'innerHTML', {
    get() { return this.__html || ''; },
    // Escrever innerHTML descarta os filhos, como no DOM real — sem isso os
    // appendChild de renders anteriores ficam acumulados e a checagem mente.
    set(v) { this.__html = v; this.children = []; if (this.__id) { writes[this.__id] = v; } },
  });
  return el;
}

// Os botoes de altura de linha precisam ser os MESMOS nos entre chamadas: o
// setRowClamp marca aria-pressed neles e a checagem le esse estado depois.
const clampNodes = clamps.map((c) => makeEl(null, { 'data-clamp': c }));

const registry = new Map();
function get(id) {
  if (!registry.has(id)) {
    const e = makeEl(id);
    if (id === 'grid-body') {
      e.querySelector = (sel) => {
        const m = /^\[data-edit\]\[data-i="(\d+)"\]$/.exec(sel);
        if (!m) { return null; }
        return cellNode(Number(m[1]));
      };
      e.querySelectorAll = () => [];
    }
    if (id === 'cmd-ac') { e.querySelectorAll = () => []; }
    registry.set(id, e);
  }
  return registry.get(id);
}

const fakeDocument = {
  getElementById(id) {
    if (!ids.has(id)) {
      problems.push(`getElementById("${id}") — id NAO existe no panel.html`);
      return null;
    }
    return get(id);
  },
  querySelectorAll(sel) {
    if (sel === '.tab') { return dataTabs.map((t) => makeEl(null, { 'data-tab': t })); }
    if (sel === '.pane') { return panes.map((p) => makeEl(null, { 'data-pane': p })); }
    if (sel === '[data-log-level]') { return logLevels.map((l) => makeEl(null, { 'data-log-level': l })); }
    if (sel === '[data-clamp]') { return clampNodes; }
    problems.push(`querySelectorAll("${sel}") — seletor nao previsto no harness`);
    return [];
  },
  createElement(tag) { return makeEl(null, {}); },
  addEventListener() {},
  // copyText() cria uma textarea efemera, seta .value, chama .select() e
  // execCommand("copy"). Capturar aqui e o que deixa a copia observavel no teste.
  execCommand(cmd) {
    if (cmd !== 'copy') { return false; }
    copyBuffer.push(lastSelected ? lastSelected.value : '');
    return true;
  },
  body: makeEl(null, {}),
};

// --- ponte falsa ------------------------------------------------------------
const evals = [];
let dumpResult = null;
let docResult = null;
let setResult = { target: 'empresa', setCount: 1, readBack: 'NOVO VALOR', frame: 'iframe' };
let dbSetResult = { ok: true, documentId: '152847', fieldName: 'aprovador', fieldValue: 'joao', values: null };
let findResult = null;

// Celulas sinteticas para o grid: cellFor() procura `[data-edit][data-i="N"]`
// dentro de #grid-body, e hostFor() decide pela classe se o alvo e celula de
// planilha (.sh-c) ou celula do grid plano (.c-val, dentro de um .gr). O harness
// só materializa a celula que o ULTIMO render de fato emitiu — sem isso o
// filtro/colapso ficariam invisiveis para o codigo.
const cellCache = new Map();
function cellNode(idx) {
  const html = writes['grid-body'] || '';
  const isFlat = new RegExp('class="c-val" data-edit data-i="' + idx + '"').test(html);
  const isSheet = new RegExp('class="sh-c[^"]*" data-edit data-i="' + idx + '"').test(html);
  if (!isFlat && !isSheet) { return null; }

  const cacheKey = idx + (isSheet ? ':sheet' : ':flat');
  if (!cellCache.has(cacheKey)) {
    const cell = makeEl(null, { 'data-edit': '', 'data-i': String(idx) });
    cell.className = isSheet ? 'sh-c' : 'c-val';
    cell.classList.add(isSheet ? 'sh-c' : 'c-val');
    if (isSheet) {
      cell.closest = () => null;
      cell.__host = cell;
    } else {
      const row = makeEl(null, { 'data-i': String(idx) });
      row.className = 'gr';
      cell.closest = (sel) => (sel === '.gr' ? row : null);
      cell.__host = row;
    }
    cellCache.set(cacheKey, cell);
  }
  return cellCache.get(cacheKey);
}
// Atalho para as checagens: a celula editavel de um indice, materializada.
function cellOf(idx) { return cellNode(idx); }

const chrome = {
  devtools: {
    inspectedWindow: {
      eval(expr, cb) {
        evals.push(expr);
        // Discriminadores especificos: DATASET_HELPERS DEFINE resolveDocId, entao
        // um includes("resolveDocId(") casaria com o dbset tambem.
        if (expr.includes('dsSetCardValue')) { setTimeout(() => cb(dbSetResult, null), 0); return; }
        if (expr.includes('return resolveDocId(collectWindows')) { setTimeout(() => cb(docResult, null), 0); return; }
        if (expr.includes('var entries = [];')) { setTimeout(() => cb(dumpResult, null), 0); return; }
        if (expr.includes('var setCount = 0;')) { setTimeout(() => cb(setResult, null), 0); return; }
        if (expr.includes('var matches = [];')) { setTimeout(() => cb(findResult, null), 0); return; }
        problems.push('eval nao reconhecido pelo harness: ' + expr.slice(0, 60));
        setTimeout(() => cb(null, null), 0);
      },
    },
    network: { onNavigated: { addListener() {} } },
  },
};

// --- dados de varredura fabricados -----------------------------------------
dumpResult = {
  framesScanned: 3,
  capturedFrom: 'https://fluig.exemplo/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=40812',
  logs: [
    { frame: 'top', level: 'log', msg: 'form carregado', t: 1770000000000 },
    { frame: 'iframe', level: 'error', msg: '$(...).val is not a function', t: 1770000005000 },
    { frame: 'iframe', level: 'warn', msg: 'dataset vazio', t: null },
  ],
  entries: [
    // --- campos simples (índices 0..4) ---
    { raw: 'empresa', name: 'empresa', value: '1 - STRATEGI', disabled: false, child: null, table: null, tableKey: null, tableHow: null, type: 'select-one', frame: 'iframe' },
    { raw: '_aprovador', name: 'aprovador', value: 'maria', disabled: true, child: null, table: null, tableKey: null, tableHow: null, type: 'text', frame: 'iframe' },
    { raw: 'parecer', name: 'parecer', value: 'ok <b>com</b> "aspas" & cia', disabled: false, child: null, table: null, tableKey: null, tableHow: null, type: 'span', frame: 'iframe' },
    { raw: 'statusInterno', name: 'statusInterno', value: '{"etapa":"x"}', disabled: false, child: null, table: null, tableKey: null, tableHow: null, type: 'hidden', frame: 'iframe' },
    { raw: 'observacao', name: 'observacao', value: '', disabled: false, child: null, table: null, tableKey: null, tableHow: null, type: 'textarea', frame: 'iframe' },

    // --- tabela COM tablename (índices 5..9). A numeração tem buraco (1, 3) e
    //     valorUnit só existe na linha 3, para exercitar a célula ausente. ---
    { raw: 'codProduto___1', name: 'codProduto', value: '000114', disabled: false, child: '1', table: 'itens', tableKey: 'name:itens', tableHow: 'tablename', type: 'text', frame: 'iframe' },
    { raw: 'qtd___1', name: 'qtd', value: '5', disabled: false, child: '1', table: 'itens', tableKey: 'name:itens', tableHow: 'tablename', type: 'text', frame: 'iframe' },
    { raw: 'codProduto___3', name: 'codProduto', value: '000237', disabled: false, child: '3', table: 'itens', tableKey: 'name:itens', tableHow: 'tablename', type: 'text', frame: 'iframe' },
    { raw: 'qtd___3', name: 'qtd', value: '2', disabled: false, child: '3', table: 'itens', tableKey: 'name:itens', tableHow: 'tablename', type: 'text', frame: 'iframe' },
    { raw: '_valorUnit___3', name: 'valorUnit', value: '890.00', disabled: true, child: '3', table: 'itens', tableKey: 'name:itens', tableHow: 'tablename', type: 'text', frame: 'iframe' },

    // --- tabela SEM tablename (índices 10..13): agrupada pela posição do
    //     <table>. É o caso que na v1 misturava tudo num balaio só. ---
    { raw: 'parcela___1', name: 'parcela', value: '1/2', disabled: false, child: '1', table: 'tabela 3', tableKey: 'pos:2', tableHow: 'posicao', type: 'text', frame: 'iframe' },
    { raw: 'vencimento___1', name: 'vencimento', value: '10/09/2026', disabled: false, child: '1', table: 'tabela 3', tableKey: 'pos:2', tableHow: 'posicao', type: 'text', frame: 'iframe' },
    { raw: 'parcela___2', name: 'parcela', value: '2/2', disabled: false, child: '2', table: 'tabela 3', tableKey: 'pos:2', tableHow: 'posicao', type: 'text', frame: 'iframe' },
    { raw: 'vencimento___2', name: 'vencimento', value: '10/10/2026', disabled: false, child: '2', table: 'tabela 3', tableKey: 'pos:2', tableHow: 'posicao', type: 'text', frame: 'iframe' },

    // --- campo ___N sem tabela nenhuma (índice 14) ---
    { raw: 'anexo___1', name: 'anexo', value: 'nf.pdf', disabled: false, child: '1', table: null, tableKey: null, tableHow: null, type: 'text', frame: 'iframe' },
  ],
};
docResult = {
  ok: true, numProcess: '40812', paramKey: 'app_ecm_workflowview_detailsProcessInstanceID',
  pageUrl: 'https://fluig.exemplo/x?app_ecm_workflowview_detailsProcessInstanceID=40812',
  documentId: '152847', cardIndexDocumentId: '152848', frame: 'iframe',
};

// --- roda o panel.js --------------------------------------------------------
const sandbox = {
  document: fakeDocument,
  chrome,
  // O editor de valor dimensiona o textarea por window.innerHeight. Sem window
  // aqui a referencia estouraria em ReferenceError, nao em fallback.
  window: { innerHeight: 700 },
  navigator: {},
  console,
  Promise,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Boolean,
  RegExp,
  Error,
  isNaN,
  setTimeout,
  clearTimeout,
  Blob: class { constructor(p) { this.parts = p; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
};
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(js, ctx, { filename: 'panel.js' });
} catch (e) {
  problems.push('EXCECAO ao carregar panel.js: ' + e.stack.split('\n').slice(0, 4).join(' | '));
}

setTimeout(() => {
  // --- valida as expressoes injetadas na pagina -----------------------------
  const names = ['buildFindExpr', 'buildSetExpr', 'buildDumpExpr', 'buildDocumentIdExpr', 'buildDbSetExpr'];
  const args = {
    buildFindExpr: ['campo___1'],
    buildSetExpr: ['campo___1', 'valor "com" aspas\n e \\ barra'],
    buildDumpExpr: [],
    buildDocumentIdExpr: [],
    buildDbSetExpr: ['152847', 'campo', 'valor'],
  };
  names.forEach((n) => {
    const fn = ctx[n];
    if (typeof fn !== 'function') { problems.push(`${n} nao esta definida`); return; }
    let expr;
    try { expr = fn.apply(null, args[n]); } catch (e) { problems.push(`${n} estourou: ${e.message}`); return; }
    try { new vm.Script(expr, { filename: n + '.expr' }); } catch (e) { problems.push(`${n} gerou JS INVALIDO: ${e.message}`); }
  });

  // --- checa o HTML que o grid gerou ---------------------------------------
  // O PRIMEIRO render e o do carregamento: tabelas colapsadas, so as bandas.
  const firstRender = writes['grid-body'] || '';

  // Daqui para baixo as checagens de planilha precisam das tabelas abertas — que
  // e o que o usuario faz clicando na banda.
  ctx.expandedTables['name:itens'] = true;
  ctx.expandedTables['pos:2'] = true;
  ctx.expandedTables[''] = true;
  ctx.renderGrid();

  const grid = writes['grid-body'] || '';
  const firstShcols = (grid.match(/--shcols: ([^"]+)"/) || [])[1] || '';
  const checks = [
    // --- estado de carregamento ---
    ['tabela nasce colapsada', /data-band="name:itens"[^>]*aria-expanded="false"/.test(firstRender)],
    ['colapsada no carregamento nao emite planilha', !/class="sh-c/.test(firstRender)],
    ['campo simples aparece no carregamento', /class="gr[^"]*" data-i="0"/.test(firstRender)],
    ['banda colapsada anuncia a contagem de linhas', /data-band="name:itens"[^>]*>[\s\S]{0,120}?2 linha\(s\)/.test(firstRender)],

    ['grid renderizou linhas dos campos simples', /class="gr[^"]*" data-i="0"/.test(grid)],
    ['campo ___N NAO vira linha do grid plano', !/class="gr[^"]*" data-i="5"/.test(grid)],
    ['faixa de desabilitado', /st-off/.test(grid)],
    ['faixa de span read-only', /st-ro/.test(grid)],
    ['faixa de hidden', /st-hid/.test(grid)],
    ['prefixo _ destacado', /<span class="pre">_<\/span>/.test(grid)],
    ['valor vazio marcado', /class="q">vazio</.test(grid)],
    ['HTML do valor escapado', grid.includes('&lt;b&gt;com&lt;/b&gt;') && !grid.includes('ok <b>com</b>')],
    ['acao copiar nome', /data-act="copy"/.test(grid)],
    ['acao editar', /data-act="edit"/.test(grid)],

    // --- planilha de tabela pai-filho ---
    ['banda da tabela com tablename', /data-band="name:itens"/.test(grid)],
    ['banda da tabela sem tablename', /data-band="pos:2"/.test(grid)],
    ['banda dos orfaos', /data-band=""/.test(grid)],
    ['as duas tabelas viraram planilhas separadas', (grid.match(/class="sheet"/g) || []).length === 3],
    // Uma entrada de largura POR COLUNA (nao um repeat()): e o que permite fixar
    // em px so a coluna que o usuario arrastou, deixando as outras em 1fr.
    ['planilha declara uma largura por campo',
      firstShcols.indexOf('46px ') === 0 &&
      firstShcols.split('minmax(104px, 1fr)').length - 1 === 3],
    ['cabecalho da planilha traz o nome do campo', /class="sh-hc"[^>]*>codProduto/.test(grid)],
    ['cabecalho da planilha traz o tipo', /class="ty">text</.test(grid)],
    ['linha da planilha usa o numero ___N', /class="sh-rh"[^>]*><span>1<\/span>/.test(grid) && /class="sh-rh"[^>]*><span>3<\/span>/.test(grid)],
    ['numeracao com buraco preservada (1 e 3, sem 2)', !/class="sh-rh"[^>]*><span>2<\/span>[\s\S]*name:itens/.test(grid)],
    ['celula da planilha e editavel', /class="sh-c[^"]*" data-edit data-i="5"/.test(grid)],
    ['campo ausente na linha vira buraco explicito', /class="sh-c sh-null"/.test(grid)],
    ['celula de campo desabilitado marcada', /class="sh-c st-off"/.test(grid)],
    ['acao de copiar a linha', /data-sheet-row="name:itens\|1"/.test(grid)],
    ['banda avisa quando faltou tablename', /class="how">sem tablename/.test(grid)],
    ['banda NAO avisa quando o tablename existe',
      !/data-band="name:itens"[^>]*>[\s\S]{0,200}?class="how"/.test(grid.split('data-band="pos:2"')[0])],
  ];

  const logs = writes['logs-body'] || '';
  checks.push(['logs renderizados', /class="lg l-error"/.test(logs)]);
  checks.push(['log sem timestamp cai em --:--:--', logs.includes('--:--:--')]);
  checks.push(['log de iframe marcado', /\[iframe\]/.test(logs)]);

  const props = writes['props-body'] || '';
  checks.push(['aba processo com documentId', props.includes('152847')]);
  checks.push(['aba processo com o parametro da URL', props.includes('detailsProcessInstanceID')]);

  const jsonCode = registry.has('json-code') ? registry.get('json-code').__html || '' : '';
  checks.push(['JSON colorido', /class="jk"/.test(jsonCode) && /class="js"/.test(jsonCode)]);
  checks.push(['JSON sem HTML cru', !jsonCode.includes('<b>com</b>')]);
  const gutter = registry.has('json-gutter') ? registry.get('json-gutter').textContent : '';
  checks.push(['gutter numerado', /^1\n2\n3/.test(gutter)]);

  const ctxBar = writes['tb-ctx'] || '';
  checks.push(['toolbar com solicitacao e doc', ctxBar.includes('40812') && ctxBar.includes('152847')]);

  // ==========================================================================
  // Fase 2 — caminhos interativos
  // ==========================================================================
  const F = (n) => ctx[n];
  const totalRows = (h) => (h.match(/class="gr[^"]*" data-i=/g) || []).length;

  const sheetCells = (h) => (h.match(/class="sh-c[^"]*" data-edit/g) || []).length;

  // filtro incremental
  checks.push(['grid completo tem 5 campos simples', totalRows(grid) === 5]);

  get('grid-filter').value = 'codproduto';
  F('renderGrid')();
  let filtered = writes['grid-body'];
  checks.push(['filtro por nome de coluna mantem a tabela inteira',
    /data-band="name:itens"/.test(filtered) && sheetCells(filtered) === 5]);
  checks.push(['filtro derruba as outras tabelas', !/data-band="pos:2"/.test(filtered)]);
  checks.push(['filtro derruba os campos simples', totalRows(filtered) === 0]);
  checks.push(['sem campo simples na tela, o cabecalho do grid plano se esconde',
    get('grid-head').style.display === 'none']);

  get('grid-filter').value = '10/10/2026';
  F('renderGrid')();
  filtered = writes['grid-body'];
  checks.push(['filtro por valor de celula isola a linha da planilha',
    /data-band="pos:2"/.test(filtered) && /class="sh-rh"[^>]*><span>2<\/span>/.test(filtered) &&
    !/class="sh-rh"[^>]*><span>1<\/span>/.test(filtered)]);

  get('grid-filter').value = 'aspas';
  F('renderGrid')();
  checks.push(['filtro casa pelo VALOR de campo simples', totalRows(writes['grid-body']) === 1]);
  checks.push(['filtro sem casar em tabela nenhuma nao emite planilha', sheetCells(writes['grid-body']) === 0]);

  get('grid-filter').value = 'zzz-nao-existe';
  F('renderGrid')();
  checks.push(['filtro sem resultado tem estado vazio', /Nenhum campo casa/.test(writes['grid-body'])]);

  get('grid-filter').value = '';
  F('renderGrid')();
  checks.push(['limpar o filtro devolve tudo',
    totalRows(writes['grid-body']) === 5 && sheetCells(writes['grid-body']) === 10]);

  // clicar na banda: fecha de novo aquela tabela, e SO aquela
  ctx.expandedTables['name:itens'] = false;
  F('renderGrid')();
  checks.push(['colapsar esconde as celulas daquela tabela', sheetCells(writes['grid-body']) === 5]);
  checks.push(['banda colapsada continua visivel',
    /data-band="name:itens"[^>]*aria-expanded="false"/.test(writes['grid-body'])]);
  checks.push(['colapsar uma tabela nao afeta a outra', /data-band="pos:2"[^>]*aria-expanded="true"/.test(writes['grid-body'])]);

  // filtro passa por cima do colapso: quem filtrou quer ver o que casou
  get('grid-filter').value = 'codproduto';
  F('renderGrid')();
  checks.push(['filtro reabre a tabela colapsada', sheetCells(writes['grid-body']) === 5 &&
    /data-band="name:itens"/.test(writes['grid-body'])]);
  get('grid-filter').value = '';

  ctx.expandedTables['name:itens'] = true;
  F('renderGrid')();

  // editor de valor: SEMPRE a faixa do rodape, para qualquer campo. Editar dentro
  // da celula nao sobrevive a largura de uso real (painel acoplado na lateral).
  F('openEditor')(0);
  const cell0 = cellOf(0);
  checks.push(['editar abre a faixa do rodape', get('veditor').hasAttribute('data-on')]);
  checks.push(['editor carrega o valor atual', get('ve-text').value === '1 - STRATEGI']);
  checks.push(['editor identifica o campo', get('ve-name').textContent === 'empresa']);
  checks.push(['celula NAO e substituida pelo editor', cell0.children.length === 0]);
  checks.push(['celula editada fica destacada', cell0.__host.classList.contains('on')]);
  F('closeEditor')(true);
  checks.push(['fechar o editor esconde a faixa', !get('veditor').hasAttribute('data-on')]);

  // valor longo e valor curto na MESMA superficie: era o editor mudar de lugar
  // conforme o tamanho do valor que tirava a previsibilidade do duplo clique.
  F('openEditor')(3);
  checks.push(['valor longo abre no mesmo editor', get('ve-text').value === '{"etapa":"x"}']);
  F('closeEditor')(true);

  // celula de planilha
  F('openEditor')(6);
  const cell6 = cellOf(6);
  checks.push(['celula de planilha tambem abre o editor',
    get('veditor').hasAttribute('data-on') && get('ve-text').value === '5']);
  checks.push(['celula de planilha e o proprio host do destaque',
    cell6.classList.contains('sh-c') && cell6.classList.contains('on')]);
  F('closeEditor')(true);
  checks.push(['fechar o editor tira o destaque da celula', !cellOf(6).classList.contains('on')]);

  // copiar a linha da planilha como JSON
  F('copySheetRow')('name:itens|3');
  const copied = copyBuffer[copyBuffer.length - 1] || '';
  checks.push(['copiar linha traz os campos daquela linha',
    copied.includes('"codProduto": "000237"') && copied.includes('"valorUnit": "890.00"')]);
  checks.push(['copiar linha NAO traz campo de outra linha', !copied.includes('000114')]);

  F('openEditor')(0);

  // set no DOM
  const histLenBefore = ctx.actionHistory.length;
  F('applyDomSet')(0, 'NOVO VALOR');
  setTimeout(() => {
    checks.push(['set no DOM grava o read-back no modelo', ctx.model.entries[0].value === 'NOVO VALOR']);
    checks.push(['set no DOM entra no historico', ctx.actionHistory.length === histLenBefore + 1 && ctx.actionHistory[0].kind === 'set']);
    checks.push(['historico guarda o valor anterior', ctx.actionHistory[0].from === '1 - STRATEGI']);
    checks.push(['status bar reporta o set', /setado no DOM/.test(writes['sb-msg'] || get('sb-msg').__html || '')]);

    // gravacao no banco: pede confirmacao antes de aplicar
    F('askDbSet')(1, 'joao');
    setTimeout(() => {
      const cbar = get('confirm-bar');
      checks.push(['banco abre a faixa de confirmacao', cbar.hasAttribute('data-on')]);
      const cRows = writes['confirm-rows'] || '';
      checks.push(['confirmacao mostra documentId', cRows.includes('152847')]);
      checks.push(['confirmacao usa o nome sem o _ de desabilitado', cRows.includes('>aprovador<')]);
      checks.push(['confirmacao mostra atual e novo', cRows.includes('maria') && cRows.includes('joao')]);
      checks.push(['nada gravado antes de confirmar', !evals.some((e) => e.includes('dsSetCardValue') && e.includes('"joao"'))]);

      const histBeforeDb = ctx.actionHistory.length;
      F('applyDbSet')();
      setTimeout(() => {
        checks.push(['confirmar grava e fecha a faixa', !get('confirm-bar').hasAttribute('data-on')]);
        checks.push(['gravacao no banco entra no historico', ctx.actionHistory.length === histBeforeDb + 1 && ctx.actionHistory[0].kind === 'dbset']);
        checks.push(['dsSetCardValue foi chamado com o valor', evals.some((e) => e.includes('dsSetCardValue') && e.includes('"joao"'))]);

        // linha de tabela avisa sobre a ausencia de conceito de linha
        F('askDbSet')(5, 'x');
        setTimeout(() => {
          checks.push(['linha de tabela avisa sobre o ___N', /não tem conceito de linha/.test(writes['confirm-rows'] || '')]);
          F('hideDbConfirm')();

          // autocomplete
          get('cmd-input').value = 'cod';
          F('acRefresh')();
          const acHtml = writes['cmd-ac'] || '';
          // O nome vem partido pelo <em> do destaque, entao a checagem casa a
          // marcacao, nao a string crua.
          checks.push(['autocomplete sugere pelo nome logico', /class="ac-i/.test(acHtml) && /<em>cod<\/em>Produto/.test(acHtml)]);
          checks.push(['autocomplete destaca o trecho digitado', /<em>cod<\/em>/.test(acHtml)]);
          checks.push(['autocomplete conta as linhas da tabela', /2 linha\(s\)/.test(acHtml)]);

          get('cmd-input').value = 'codproduto___3';
          F('acRefresh')();
          checks.push(['modo ___N lista a ocorrencia crua', (writes['cmd-ac'] || '').includes('codProduto___3')]);

          get('cmd-input').value = 'aprov';
          F('acRefresh')();
          checks.push(['campo desabilitado marcado no autocomplete', /class="ac-i off/.test(writes['cmd-ac'] || '')]);

          // ler pelo prompt
          findResult = {
            typed: 'qtd', base: 'qtd', framesScanned: 3,
            matches: [{ name: 'qtd___1', value: '9', disabled: false, child: '1', table: 'itens', type: 'text', frame: 'iframe', exact: false }],
          };
          F('readByName')('qtd');
          setTimeout(() => {
            checks.push(['ler atualiza o valor no modelo', ctx.model.entries[6].value === '9']);
            checks.push(['ler entra no historico', ctx.actionHistory[0].kind === 'read']);
            F('readByName')('qtd');
            setTimeout(() => {
              checks.push(['leitura repetida identica colapsa em contador', ctx.actionHistory[0].repeat === 2]);

              // linha existe mas o filtro a esconde: a status bar tem de dizer
              get('grid-filter').value = 'empresa';
              F('renderGrid')();
              F('readByName')('qtd');
              setTimeout(() => {
                checks.push(['ler avisa quando a linha esta escondida pelo filtro',
                  /escondida pelo filtro/.test(get('sb-msg').__html || '')]);
                get('grid-filter').value = '';
                F('renderGrid')();

              findResult = { typed: 'nada', base: 'nada', framesScanned: 3, matches: [] };
              F('readByName')('nada');
              setTimeout(() => {
                checks.push(['campo inexistente reporta erro', /não encontrado/.test(get('sb-msg').__html || '')]);

                // editor recusa linha fora de vista, em vez de falhar em silencio
                get('grid-filter').value = 'empresa';
                F('renderGrid')();
                F('openEditor')(6);
                checks.push(['editor avisa quando a linha nao esta visivel',
                  /não está visível/.test(get('sb-msg').__html || '')]);
                get('grid-filter').value = '';
                F('renderGrid')();

                // historico: render e restaurar
                F('renderHistory')();
                const hHtml = writes['history-pop'] || '';
                checks.push(['historico renderiza os tres tipos', /k-read/.test(hHtml) && /k-set/.test(hHtml) && /k-dbset/.test(hHtml)]);
                checks.push(['historico oferece restaurar na escrita', /data-hist-restore=/.test(hHtml)]);

                const setEntry = ctx.actionHistory.filter((h) => h.kind === 'set')[0];
                F('restoreFromHistory')(setEntry.id);
                checks.push(['restaurar abre o editor com o valor anterior',
                  get('veditor').hasAttribute('data-on') &&
                  get('ve-text').value === '1 - STRATEGI' &&
                  get('ve-name').textContent === 'empresa']);

                report();
              }, 20);
              }, 20);
            }, 20);
          }, 20);
        }, 20);
      }, 20);
    }, 20);
  }, 20);

  function report() {
    console.log('\n=== expressoes avaliadas na pagina: ' + evals.length + ' ===');
    console.log('=== checagens ===');
    let failed = 0;
    checks.forEach(([label, ok]) => {
      if (!ok) { failed++; }
      console.log((ok ? '  ok   ' : '  FALHA') + '  ' + label);
    });

    if (problems.length) {
      console.log('\n=== PROBLEMAS ===');
      problems.forEach((p) => console.log('  - ' + p));
    }
    console.log('\n' + (failed || problems.length
      ? 'RESULTADO: ' + failed + ' checagem(ns) falhando, ' + problems.length + ' problema(s)'
      : 'RESULTADO: tudo verde (' + checks.length + ' checagens)'));
    process.exitCode = failed || problems.length ? 1 : 0;
  }
}, 60);
