// js/field-browser.js — Browser de campos e tabelas pai-filho
// Script classico (escopo global compartilhado); ordem de carga definida em panel.html.

// ---------------------------------------------------------------------------
// Browser de campos (aba Ler)
// ---------------------------------------------------------------------------
//
// Mostra os campos da pagina separados em:
//   1. Campos simples (ordem alfabetica)
//   2. Tabelas pai-filho (agrupadas e COLAPSADAS por padrao para nao poluir)
//
// Ao digitar no filtro, busca tanto nos campos normais quanto dentro das
// tabelas (expandindo automaticamente o que casar).

var browserFields = [];
var browserRows = [];
var browserExpandedTables = {};
var browserTableModes = {}; // tableName -> 'grid' | 'columns'
var browserSelectedCells = {}; // tableName -> { rowIdx, colName, rawName, value, type, disabled }

function loadFieldBrowser() {
  var body = document.getElementById('field-browser-body');
  if (!body) { return; }
  if (!browserFields.length) {
    body.innerHTML = '<span class="muted">Carregando campos…</span>';
  }

  ensureFieldIndex().then(function (index) {
    browserFields = (index && index.fields) || [];
    browserRows = (index && index.rows) || [];
    renderFieldBrowser();
  });
}

function browserFieldTags(f, insideTable) {
  var tags = [];
  if (f.disabled) { tags.push('<span class="tag warn">desabilitado</span>'); }
  if (!insideTable) {
    if (f.rowCount) { tags.push('<span class="tag">' + f.rowCount + ' linha(s)</span>'); }
    else if (f.occurrences > 1) { tags.push('<span class="tag">' + f.occurrences + '×</span>'); }
    if (f.table) { tags.push('<span class="tag">' + esc(f.table) + '</span>'); }
  } else {
    if (f.occurrences > 1 && !f.child) { tags.push('<span class="tag">' + f.occurrences + '×</span>'); }
  }
  if (f.type === 'span') { tags.push('<span class="tag">somente leitura</span>'); }
  else if (f.type) { tags.push('<span class="tag">' + esc(f.type) + '</span>'); }
  return tags.join(' ');
}

function browserRowHtml(f, insideTable) {
  var displayName = f.name || f.logical;
  var sendName = f.name || f.logical;
  var escapedName = esc(sendName).replace(/"/g, '&quot;');
  var valEsc = esc(f.value || '').replace(/"/g, '&quot;');
  return '<div class="dump-row">' +
    '<div class="dump-name"><div style="display:inline-flex; align-items:center; gap:4px;"><code>' + esc(displayName) + '</code>' +
    '<button type="button" class="btn-icon" data-copy="' + escapedName + '" title="Copiar nome do campo">' + COPY_SVG + '</button></div>' +
    '<div class="dump-tags">' + browserFieldTags(f, insideTable) + '</div></div>' +
    '<div class="dump-val">' + renderValue(f.value || '') + '</div>' +
    '<div class="dump-acts">' +
    '<button type="button" class="primary" data-browse-read="' + escapedName + '" title="Inspecionar e editar campo">Ler / Editar</button>' +
    '<button type="button" data-copy="' + valEsc + '" title="Copiar conteúdo/valor do campo">Copiar Conteúdo</button>' +
    '</div>' +
    '</div>';
}

function renderDataGripGrid(tbl, matchedRowsMap, shownRowKeys) {
  var tName = tbl.name;
  var cols = tbl.fields.map(function (f) { return f.logical; });
  // Remove duplicados de colunas preservando a ordem
  var uniqueCols = [];
  cols.forEach(function (c) { if (uniqueCols.indexOf(c) < 0) { uniqueCols.push(c); } });

  var selected = browserSelectedCells[tName] || null;

  var html = '<div class="dg-grid-wrap">';
  html += '<div class="dg-scroll-pane">';
  html += '<table class="dg-table">';
  
  // Cabeçalho da tabela
  html += '<thead><tr>';
  html += '<th class="dg-th-idx">#</th>';
  uniqueCols.forEach(function (colName) {
    var fMeta = tbl.fields.filter(function (f) { return f.logical === colName; })[0];
    var badge = (fMeta && fMeta.type) ? '<span class="dg-col-badge">' + esc(fMeta.type) + '</span>' : '';
    html += '<th><div class="dg-col-header" title="' + esc(colName) + '">' +
      '<span class="dg-col-title">' + esc(colName) + '</span>' + badge +
      '</div></th>';
  });
  html += '</tr></thead>';

  // Linhas de dados
  html += '<tbody>';
  shownRowKeys.forEach(function (lk) {
    var rList = matchedRowsMap[lk] || [];
    var rowData = {};
    rList.forEach(function (item) {
      rowData[item.logical] = item;
    });

    html += '<tr>';
    html += '<td class="dg-td-idx" title="Linha ' + esc(lk) + '">' + esc(lk) + '</td>';

    uniqueCols.forEach(function (colName) {
      var cellItem = rowData[colName];
      var cellVal = cellItem ? cellItem.value : '';
      var rawName = cellItem ? cellItem.name : (colName + '___' + lk);
      var isEmpty = cellVal === '' || cellVal == null;
      var isSelected = selected && selected.rowIdx === lk && selected.colName === colName;

      html += '<td class="dg-cell' + (isSelected ? ' selected' : '') + (isEmpty ? ' empty' : '') + '" ' +
        'data-dg-cell="' + esc(tName) + '" ' +
        'data-dg-row="' + esc(lk) + '" ' +
        'data-dg-col="' + esc(colName) + '" ' +
        'data-dg-raw="' + esc(rawName) + '" ' +
        'data-dg-type="' + esc(cellItem ? (cellItem.type || '') : '') + '" ' +
        'data-dg-disabled="' + (cellItem && cellItem.disabled ? 'true' : 'false') + '" ' +
        'title="Clique para inspecionar">';
      html += isEmpty ? '(vazio)' : esc(cellVal);
      html += '</td>';
    });

    html += '</tr>';
  });
  html += '</tbody>';
  html += '</table>';
  html += '</div>'; // .dg-scroll-pane

  // Inspector inferior estilo DataGrip
  html += '<div class="dg-inspector">';
  if (selected) {
    var rawEsc = esc(selected.rawName).replace(/"/g, '&quot;');
    var tNameEsc = esc(tName).replace(/"/g, '&quot;');
    html += '<div class="dg-inspector-head">' +
      '<span class="dg-inspector-title" style="display:inline-flex; align-items:center; gap:4px;">Linha ' + esc(selected.rowIdx) + ' · <code>' + esc(selected.rawName) + '</code>' +
      '<button type="button" class="btn-icon" data-copy="' + rawEsc + '" title="Copiar nome do campo">' + COPY_SVG + '</button></span>' +
      '<div class="dg-inspector-acts">' +
      '<button type="button" class="primary" data-dg-apply-dom="' + tNameEsc + '" title="Aplica o valor editado no DOM da página">Setar DOM</button>' +
      '<button type="button" class="primary" data-dg-apply-db="' + tNameEsc + '" title="Grava o valor editado direto no banco (dsSetCardValue)">Setar Banco</button>' +
      '<button type="button" data-dg-reload-cell="' + tNameEsc + '" title="Reler valor atual do campo">Ler</button>' +
      '<button type="button" data-dg-copy-val="' + tNameEsc + '" title="Copiar conteúdo do campo">Copiar Conteúdo</button>' +
      '<button type="button" data-revert-ta="dg-val-' + esc(tName) + '" title="Reverter para o valor original do formulário (Ctrl+Z)">Reverter</button>' +
      '</div></div>';
    html += '<textarea class="dg-inspector-textarea" id="dg-val-' + esc(tName) + '" placeholder="(vazio)">' + esc(selected.value || '') + '</textarea>';
    html += '<div class="dg-inspector-feedback" id="dg-status-' + esc(tName) + '"></div>';
  } else {
    html += '<div class="dg-inspector-empty">Clique em uma célula acima para visualizar ou editar o valor diretamente aqui.</div>';
  }
  html += '</div>'; // .dg-inspector

  html += '</div>'; // .dg-grid-wrap
  return html;
}

function renderFieldBrowser() {
  var body = document.getElementById('field-browser-body');
  if (!body) { return; }

  if (!browserFields.length) {
    body.innerHTML = '<span class="muted">Nenhum campo na página.</span>';
    return;
  }

  var term = (document.getElementById('field-browser-filter') || {}).value || '';
  var q = term.trim().toLowerCase();

  // Separa campos simples e agrupa tabelas pai-filho
  var simpleFields = [];
  var tablesMap = {}; // tableName -> { name: string, maxRows: 0, fields: [], rowsMap: {} }

  browserFields.forEach(function (f) {
    if (f.table || f.rowCount > 0) {
      var tName = f.table || 'Tabela pai-filho';
      if (!tablesMap[tName]) {
        tablesMap[tName] = { name: tName, maxRows: 0, fields: [], rowsMap: {} };
      }
      if (f.rowCount > tablesMap[tName].maxRows) {
        tablesMap[tName].maxRows = f.rowCount;
      }
      tablesMap[tName].fields.push(f);
    } else {
      simpleFields.push(f);
    }
  });

  // Agrupa as ocorrencias ___N por tabela e por linha
  browserRows.forEach(function (r) {
    var tName = r.table;
    if (!tName) {
      // Tenta achar pelo grupo de campos logicos
      for (var tk in tablesMap) {
        var hasCol = tablesMap[tk].fields.some(function (cf) { return cf.logical === r.logical; });
        if (hasCol) { tName = tk; break; }
      }
    }
    tName = tName || 'Tabela pai-filho';
    if (!tablesMap[tName]) {
      tablesMap[tName] = { name: tName, maxRows: 0, fields: [], rowsMap: {} };
    }
    var lineNum = r.child || '0';
    if (!tablesMap[tName].rowsMap[lineNum]) {
      tablesMap[tName].rowsMap[lineNum] = [];
    }
    tablesMap[tName].rowsMap[lineNum].push(r);
  });

  // Filtra
  var filteredSimple = q
    ? simpleFields.filter(function (f) {
        return f.logical.toLowerCase().indexOf(q) >= 0 ||
          (f.value || '').toLowerCase().indexOf(q) >= 0;
      })
    : simpleFields;

  var tableKeys = Object.keys(tablesMap);
  var tablesRenderData = [];
  var totalTableFields = 0;

  tableKeys.forEach(function (tName) {
    var tbl = tablesMap[tName];
    var matchedFields = q
      ? tbl.fields.filter(function (f) {
          return tName.toLowerCase().indexOf(q) >= 0 ||
            f.logical.toLowerCase().indexOf(q) >= 0 ||
            (f.value || '').toLowerCase().indexOf(q) >= 0;
        })
      : tbl.fields;

    // Filtro por linhas
    var matchedRowsMap = {};
    var hasMatchingRows = false;
    var rowKeys = Object.keys(tbl.rowsMap).sort(function (a, b) { return Number(a) - Number(b); });
    rowKeys.forEach(function (lk) {
      var rItems = tbl.rowsMap[lk];
      var filteredR = q
        ? rItems.filter(function (r) {
            return tName.toLowerCase().indexOf(q) >= 0 ||
              r.name.toLowerCase().indexOf(q) >= 0 ||
              r.logical.toLowerCase().indexOf(q) >= 0 ||
              (r.value || '').toLowerCase().indexOf(q) >= 0;
          })
        : rItems;
      if (filteredR.length > 0) {
        matchedRowsMap[lk] = filteredR;
        hasMatchingRows = true;
      }
    });

    if (matchedFields.length > 0 || hasMatchingRows) {
      var currentMode = browserTableModes[tName] || (tbl.maxRows > 0 ? 'grid' : 'columns');
      tablesRenderData.push({
        name: tName,
        maxRows: tbl.maxRows,
        fields: matchedFields,
        rowsMap: matchedRowsMap,
        rowKeys: rowKeys,
        mode: currentMode,
        totalInTable: tbl.fields.length,
        // Se houver busca ativa, abre a tabela automaticamente para mostrar o resultado
        expanded: q ? true : !!browserExpandedTables[tName]
      });
      totalTableFields += matchedFields.length;
    }
  });

  if (filteredSimple.length === 0 && tablesRenderData.length === 0) {
    body.innerHTML = '<span class="muted">Nenhum campo casa com o filtro.</span>';
    return;
  }

  var html = '';

  // 1. Tabelas pai-filho NO TOPO (melhor usabilidade e destaque)
  if (tablesRenderData.length > 0) {
    html += '<div class="browser-group-title">Tabelas pai-filho (' + tablesRenderData.length + ')</div>';

    tablesRenderData.forEach(function (tbl) {
      var isExp = tbl.expanded;
      var countLabel = (tbl.maxRows > 0 ? tbl.maxRows + ' linha(s) · ' : '') + tbl.fields.length + ' campo(s)';

      html += '<div class="browser-table-band' + (isExp ? ' expanded' : '') + '" data-toggle-table="' + esc(tbl.name) + '">';
      html += '<span class="caret">▶</span>';
      html += '<span class="tbl-name">' + esc(tbl.name) + '</span>';
      html += '<span class="tbl-meta">' + countLabel + '</span>';
      html += '</div>';

      if (isExp) {
        html += '<div class="browser-table-content">';
        
        // Toolbar de alternancia: Grid (DataGrip) vs Colunas (resumo)
        if (tbl.maxRows > 0) {
          html += '<div class="browser-table-toolbar">' +
            '<span class="muted" style="font-size:11px; margin-right:4px;">Exibir como:</span>' +
            '<button type="button" class="chip' + (tbl.mode === 'grid' ? ' active' : '') + '" data-tbl-mode="' + esc(tbl.name) + ':grid">Tabela / Grid</button>' +
            '<button type="button" class="chip' + (tbl.mode === 'columns' ? ' active' : '') + '" data-tbl-mode="' + esc(tbl.name) + ':columns">Colunas (resumo)</button>' +
            '</div>';
        }

        if (tbl.mode === 'grid' && tbl.maxRows > 0) {
          var shownRowKeys = Object.keys(tbl.rowsMap).sort(function (a, b) { return Number(a) - Number(b); });
          if (!shownRowKeys.length) {
            html += '<span class="muted" style="padding:6px;">Nenhuma linha encontrada.</span>';
          } else {
            html += renderDataGripGrid(tbl, tbl.rowsMap, shownRowKeys);
          }
        } else {
          // Renderiza resumo por coluna logica
          html += tbl.fields.map(function (f) { return browserRowHtml(f, true); }).join('');
        }

        html += '</div>';
      }
    });
  }

  // 2. Campos simples abaixo
  if (filteredSimple.length > 0) {
    html += '<div class="browser-group-title">Campos simples (' + filteredSimple.length + ')</div>';
    html += filteredSimple.map(function (f) { return browserRowHtml(f, false); }).join('');
  }

  var totalShown = filteredSimple.length + totalTableFields;
  html += '<div class="dump-foot muted">' + totalShown + ' campo(s) exibido(s).</div>';

  body.innerHTML = html;
}

function toggleBrowserTable(tableName) {
  browserExpandedTables[tableName] = !browserExpandedTables[tableName];
  renderFieldBrowser();
}

function setBrowserTableMode(tableName, mode) {
  browserTableModes[tableName] = mode;
  renderFieldBrowser();
}

function readFromBrowser(fieldLogical) {
  if (!fieldLogical) { return; }
  document.getElementById('read-field').value = fieldLogical;
  readField();
}

function setFromBrowser(fieldLogical, curVal) {
  if (!fieldLogical) { return; }
  var rf = document.getElementById('read-field');
  if (rf) {
    rf.value = fieldLogical;
    readField();
    rf.scrollIntoView({ block: 'center' });
  }
}

function reloadFieldBrowser() {
  invalidateFieldIndex();
  browserFields = [];
  loadFieldBrowser();
}

function focusElementInPage(rawName, btn) {
  if (!rawName) { return; }
  var prevHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.innerHTML = '<span>Localizando…</span>'; }

  evalInPage(buildFocusElementExpr(rawName))
    .then(function (res) {
      if (btn) { btn.innerHTML = prevHtml; }
      if (!res || !res.ok) {
        if (res && res.visible === false) {
          if (btn) {
            btn.classList.add('danger');
            btn.innerHTML = '<span>Campo oculto no formulário</span>';
            setTimeout(function () {
              btn.classList.remove('danger');
              btn.innerHTML = prevHtml;
            }, 2500);
          }
          return;
        }
        alert((res && res.reason) || 'Não foi possível localizar o elemento na página.');
        return;
      }
      if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '<span>✓ Localizado no formulário</span>';
        setTimeout(function () {
          btn.classList.remove('active');
          btn.innerHTML = prevHtml;
        }, 1800);
      }
    })
    .catch(function (err) {
      if (btn) { btn.innerHTML = prevHtml; }
      alert('Erro ao localizar elemento: ' + JSON.stringify(err));
    });
}
