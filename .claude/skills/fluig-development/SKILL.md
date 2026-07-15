---
name: fluig-development
description: >
  Use this skill for ANY development task on the TOTVS Fluig platform — server-side or client-side.
  Trigger on: datasets (createDataset, DatasetFactory, DatasetBuilder), workflow events (beforeStateEntry,
  afterTaskCreate, beforeTaskSave, etc.), form events (displayFields, validateForm, enableFields,
  inputFields, afterSaveNew), hAPI usage, FormController (form.getValue, form.setValue),
  workflow scripts, conditional scripts (gateways), global events (beforeLogin, afterCreateUser),
  widgets/WCM (SuperWidget, WCMAPI, FLUIGC, FTL templates), ServiceManager (SOAP WebServices),
  oauthUtil (REST), docAPI, notifier, JNDI/JDBC access, or anything mentioning "Fluig", "TOTVS Fluig",
  "Rhino engine", "hAPI", "WKUser", "WKNumProces", "fluigAPI", "DatasetFactory", or "Fluig Studio".
---

# Fluig Development — Complete Reference

## CRITICAL: Rhino Engine Rules (ECMAScript 5 ONLY)

The Fluig server-side engine is **Mozilla Rhino — ECMAScript 5 only**. These rules are absolute and non-negotiable for ALL server-side code (datasets, events, workflow scripts):

| ❌ NEVER use | ✅ ALWAYS use instead |
|---|---|
| `let`, `const` | `var` |
| Arrow functions `=>` | `function() {}` |
| Template literals `` ` `` | String concatenation `+` |
| Destructuring `var {a} = obj` | `var a = obj.a` |
| `class` | Functions + prototypes |
| `for...of` | `for (var i = 0; i < arr.length; i++)` |
| `Promise`, `async/await` | Synchronous code only |
| `Symbol`, `Map`, `Set`, `WeakMap`, `WeakSet` | Java equivalents |
| Default parameters `f(x = 1)` | Manual check: `if (x == null) x = 1` |
| Spread `...`, rest params | Manual iteration |
| `Object.assign()`, `Array.from()`, `Object.values()`, `Object.entries()` | Java equivalents |

### Java Interop — Required Patterns

```javascript
// Lists — use for all APIs that expect a List
var lista = new java.util.ArrayList();
lista.add("item1");
// Iterate: use .size() and .get(i), NOT .length and [i]
for (var i = 0; i < lista.size(); i++) { var item = lista.get(i); }

// Maps — use for form data passed to APIs
var mapa = new java.util.HashMap();
mapa.put("chave", "valor");
var valor = mapa.get("chave");

// Integer — required in stateList.add() and similar
stateList.add(new java.lang.Integer(4));

// Date formatting
var sdf = new java.text.SimpleDateFormat("dd/MM/yyyy");
var dataStr = sdf.format(new java.util.Date());

// Calendar
var cal = java.util.Calendar.getInstance();
cal.add(java.util.Calendar.DAY_OF_MONTH, 5);
var dataFutura = cal.getTime();
```

---

## Datasets

### Mandatory Structure

```javascript
function createDataset(fields, constraints, sortFields) {
    var dataset = DatasetBuilder.newDataset();
    dataset.addColumn("campo1");
    dataset.addColumn("campo2");
    dataset.addRow(new Array("valor1", "valor2"));
    return dataset; // ALWAYS return
}
function defineStructure() {}
function onSync(lastSyncDate) {}
function onMobileSync(user) {}
```

### Constraint Parsing (MUST be manual — not automatic)

```javascript
function getConstraint(name, constraints) {
    for (var i = 0; i < constraints.length; i++) {
        if (constraints[i].fieldName.toLowerCase() == name.toLowerCase())
            return constraints[i].initialValue;
    }
    return null;
}
```

### Querying Datasets

```javascript
// Basic query
var ds = DatasetFactory.getDataset("nomeDataset", null, null, null);

// With constraints
var c1 = DatasetFactory.createConstraint("campo", "valor", "valor", ConstraintType.MUST);
var ds = DatasetFactory.getDataset("nomeDataset", null, new Array(c1), null);

// LIKE search
var c1 = DatasetFactory.createConstraint("mail", "%@empresa%", "%@empresa%", ConstraintType.SHOULD);
c1.setLikeSearch(true);

// Read values
for (var i = 0; i < ds.rowsCount; i++) {
    var val = ds.getValue(i, "nomeCampo");
}
```

### Special Constraints

| Constraint | Description |
|---|---|
| `metadata#active` | Active forms only (`true`) |
| `metadata#id` | Filter by form document ID |
| `metadata#version` | Filter by form version |
| `tablename` | Access child table rows |
| `userSecurityId` | User permission validation |
| `sqlLimit` | Limit result count |
| `offset` | Pagination offset |

### Form Data (Main + Child Tables)

```javascript
// Main form record
var c1 = DatasetFactory.createConstraint("documentid", docId, docId, ConstraintType.MUST);
var c2 = DatasetFactory.createConstraint("metadata#active", "true", "true", ConstraintType.MUST);
var ds = DatasetFactory.getDataset("dsFormNome", null, new Array(c1, c2), null);

// Child table rows
var c1 = DatasetFactory.createConstraint("documentid", docId, docId, ConstraintType.MUST);
var c2 = DatasetFactory.createConstraint("tablename", "tbNomeTabela", "tbNomeTabela", ConstraintType.MUST);
var c3 = DatasetFactory.createConstraint("metadata#active", "true", "true", ConstraintType.MUST);
var dsFilhos = DatasetFactory.getDataset("dsFormNome", null, new Array(c1, c2, c3), null);
```

### Dataset API Reference

| Method | Description |
|---|---|
| `dataset.addColumn("name")` | Add column |
| `dataset.addRow(new Array(v1, v2))` | Add row |
| `ds.getValue(row, "colName")` | Read value by row index and column name |
| `ds.rowsCount` | Number of rows |
| `ds.getColumnsName()` | Array of column names |
| `ds.getMap()` | Values as `ArrayList<HashMap>` |

---

## Workflow Events

### Event Execution Order

**Creating request:** `beforeStateEntry` → `beforeTaskCreate` → `afterTaskCreate` → `afterStateEntry` → `afterProcessCreate`

**Moving request:** `beforeTaskSave` → `beforeTaskComplete` → `beforeStateLeave` → `afterStateLeave` → `afterTaskComplete` → `beforeStateEntry`(dest) → `beforeTaskCreate`(dest) → `afterTaskCreate`(dest) → `afterStateEntry`(dest) → `afterTaskSave`

**Finishing:** `beforeTaskSave` → `beforeTaskComplete` → `beforeStateLeave` → `afterStateLeave` → `afterTaskComplete` → `afterProcessFinish` → `afterTaskSave`

**Canceling:** `beforeCancelProcess` → `afterCancelProcess`

### Key Rules

- `before*` events can **block** the action with `throw "message"`.
- `after*` events **cannot** block with `throw`.
- Use `getValue("WKParam")` to access process context variables.
- Use `globalVars.put/get` to pass data between events in the same movement.

### Process Context Variables (getValue)

| Variable | Description |
|---|---|
| `WKUser` | Current user code |
| `WKCompany` | Company number |
| `WKNumProces` | Request/process number |
| `WKNumState` / `WKCurrentState` | Current activity number |
| `WKNextState` | Destination activity number |
| `WKCompletTask` | Whether task was completed (`"true"`/`"false"`) |
| `WKCardId` | Form record code |
| `WKFormId` | Form code |
| `WKUserComment` | User observation text |
| `WKIsTransfer` | Whether task is being transferred |
| `WKManagerMode` | Whether moved from manager view |
| `WKDef` | Process definition code |

### Common Event Patterns

```javascript
// Block movement when field is empty
function beforeTaskSave(colleagueId, nextSequenceId, userList) {
    var completTask = getValue("WKCompletTask");
    if (completTask == "true" && !hAPI.getCardValue("campo").trim()) {
        throw "Campo obrigatório não preenchido!";
    }
}

// Block transfer
function beforeTaskCreate(colleagueId) {
    var isTransfer = getValue("WKIsTransfer");
    if (isTransfer !== null && JSON.parse(isTransfer)) {
        throw "Transferência não permitida nesta atividade!";
    }
}

// Filter available destination activities
function validateAvailableStates(iCurrentState, stateList) {
    if (iCurrentState == 1) {
        stateList.clear();
        var atividades = [4, 3, 2];
        for (var i = 0; i < atividades.length; i++) {
            stateList.add(new java.lang.Integer(atividades[i]));
        }
    }
    return stateList;
}

// Conditional gateway script
var aprovado = hAPI.getCardValue("aprovado");
if (aprovado == "sim") { true; } else { false; }
```

---

## hAPI (Workflow Helper API)

### Critical Rule

**NEVER** call `hAPI.getCardValue()` or `hAPI.setCardValue()` at activity sequence 0 (initial activity). Only works from activity 2 onwards.

```javascript
function beforeStateEntry(sequenceId) {
    if (sequenceId != 0) { // Guard against initial activity
        var campo = hAPI.getCardValue("meuCampo");
    }
}
```

### hAPI Method Reference

| Method | Description |
|---|---|
| `hAPI.getCardValue("campo")` | Read form field value |
| `hAPI.setCardValue("campo", "valor")` | Write form field value |
| `hAPI.getCardData(numProcesso)` | HashMap of all form fields. Child fields: `campo___1`, `campo___2` |
| `hAPI.setAutomaticDecision(numAtiv, listaColab, "obs")` | Auto-route to activity. `listaColab` is `java.util.ArrayList`. |
| `hAPI.getActiveStates()` | List of active activities |
| `hAPI.setDueDate(numProcesso, numThread, "userId", data, tempoSeg)` | Set task deadline |
| `hAPI.startProcess(processId, ativDest, listaColab, "obs", completarTarefa, valoresForm, modoGestor)` | Start new workflow request |
| `hAPI.calculateDeadLineHours(data, segundos, prazo, periodId)` | Calculate deadline in hours. Returns `[data, hora]`. |
| `hAPI.getUserTaskLink(numAtiv)` | Get task movement link |
| `hAPI.listAttachments()` | List of process attachments (DocumentDto list) |
| `hAPI.publishWorkflowAttachment(documento)` | Publish attachment to ECM |
| `hAPI.attachDocument(documentId)` | Attach ECM document to request |
| `hAPI.addCardChild(tableName, cardData)` | Add child row. `cardData` is `java.util.HashMap`. |
| `hAPI.removeCardChild(tableName, lineIndex)` | Remove child row |
| `hAPI.getChildrenIndexes(tableName)` | Array of existing child row indexes |
| `hAPI.getParentInstance(processInstanceId)` | Parent request number |
| `hAPI.getChildrenInstances(processInstanceId)` | List of child request numbers |
| `hAPI.setTaskComments("userId", numProcesso, numThread, "obs")` | Set task observation |

### Key hAPI Patterns

```javascript
// Automatic decision
function beforeStateEntry(sequenceId) {
    if (sequenceId == 4) {
        var users = new java.util.ArrayList();
        users.add("admin");
        // For group: users.add("Pool:Group:groupCode");
        // For role:  users.add("Pool:Role:roleCode");
        hAPI.setAutomaticDecision(7, users, "Decisão automática");
    }
}

// Start sub-process with form data
function beforeStateEntry(sequenceId) {
    if (sequenceId == 5) {
        var users = new java.util.ArrayList();
        users.add("Pool:Role:analista");
        var formData = new java.util.HashMap();
        formData.put("campo1", "Valor");
        hAPI.startProcess("processoCode", 4, users, "Obs", true, formData, false);
    }
}

// Set deadline with business hours
function afterTaskCreate(colleagueId) {
    var data = new Date();
    var prazo = hAPI.calculateDeadLineHours(data, 0, 48, "Default");
    hAPI.setDueDate(getValue("WKNumProces"), 0, colleagueId, prazo[0], prazo[1]);
}

// Child table manipulation
function beforeStateEntry(sequenceId) {
    // Add child row
    var childData = new java.util.HashMap();
    childData.put("descricao", hAPI.getCardValue("descricao_item"));
    hAPI.addCardChild("itens", childData);

    // Iterate child rows
    var indexes = hAPI.getChildrenIndexes("itens");
    for (var i = 0; i < indexes.length; i++) {
        var val = hAPI.getCardValue("descricao___" + indexes[i]);
    }

    // Remove all child rows (iterate reverse)
    var indexes = hAPI.getChildrenIndexes("itens");
    for (var i = indexes.length - 1; i >= 0; i--) {
        hAPI.removeCardChild("itens", indexes[i]);
    }
}

// Send notification
function afterTaskCreate(colleagueId) {
    var destinatarios = new java.util.ArrayList();
    destinatarios.add(colleagueId);
    var params = new java.util.HashMap();
    params.put("WDK_CompanyId", getValue("WKCompany"));
    params.put("WDK_TaskLink", hAPI.getUserTaskLink(getValue("WKCurrentState")));
    notifier.notify(getValue("WKUser"), "templateId", params, destinatarios, "text/html");
}
```

---

## Form Events (Server-Side)

### Event Table

| Event | Signature | Description |
|---|---|---|
| `beforeProcessing` | `beforeProcessing(form)` | First event. Runs before all processing. |
| `displayFields` | `displayFields(form, customHTML)` | Controls visibility/values before render. |
| `enableFields` | `enableFields(form)` | Controls enabled/disabled state. |
| `inputFields` | `inputFields(form)` | Transforms field values before saving. |
| `validateForm` | `validateForm(form)` | Validates data. Use `throw` to block. |
| `afterSaveNew` | `afterSaveNew(form)` | After saving a new record. |
| `afterProcessing` | `afterProcessing(form)` | Last event, after all processing. |

### FormController (form) API

| Method | Description |
|---|---|
| `form.getValue("campo")` | Read field value |
| `form.setValue("campo", valor)` | Set field value |
| `form.getFormMode()` | `"ADD"`, `"MOD"`, or `"VIEW"` |
| `form.getDocumentId()` | Document/card ID |
| `form.setVisible("campo", bool)` | Show/hide by field name |
| `form.setVisibleById("id", bool)` | Show/hide by element ID |
| `form.setEnabled("campo", bool)` | Enable/disable field |
| `form.setEnabled("campo", bool, true)` | Enable/disable with tamper protection |
| `form.setHideDeleteButton(bool)` | Hide delete button |
| `form.setHidePrintLink(bool)` | Hide print button |

> **Note:** `setEnabled("campo", false)` adds `_` to the field's `name` and `id` in HTML. Use the third param `true` for tamper protection.

### Common Form Event Patterns

```javascript
function displayFields(form, customHTML) {
    var atividadeAtual = getValue("WKNumState");
    var modo = form.getFormMode();
    var usuario = getValue("WKUser");

    if (modo != "VIEW" && (atividadeAtual == 0 || atividadeAtual == 1)) {
        form.setValue("solicitante", usuario);
        form.setValue("dataSolicitacao", (new java.text.SimpleDateFormat("dd/MM/yyyy")).format(new java.util.Date()));
    }

    // Hide elements by ID
    form.setVisibleById("areaAprovacao", false);

    // Inject JS variables for client-side use
    customHTML.append("<script type='text/javascript'>");
    customHTML.append("var modoFormulario = '" + modo + "';");
    customHTML.append("var atividadeAtual = " + atividadeAtual + ";");
    customHTML.append("</script>");
}

function validateForm(form) {
    if (!form.getValue("campo") || form.getValue("campo") == "") {
        throw "O campo é obrigatório!";
    }
}

function enableFields(form) {
    if (form.getFormMode() != "ADD") {
        form.setEnabled("codigo", false, true); // true = tamper protection
    }
}

// Lookup user name from dataset
function buscaNomeUsuario(codigoUsuario) {
    var c = DatasetFactory.createConstraint("colleaguePK.colleagueId", codigoUsuario, codigoUsuario, ConstraintType.MUST);
    var ds = DatasetFactory.getDataset("colleague", null, [c], null);
    if (ds.rowsCount > 0) return ds.getValue(0, "colleagueName");
    return "";
}
```

---

## Forms HTML

### Key Rules

- Always use `name` attribute on inputs — Fluig uses `name` to save values.
- `name` is what `hAPI.getCardValue("name")` accesses in workflow events.
- Child table fields get suffix `___N` (e.g., `descricao___1`, `descricao___2`).
- Use `tablename` attribute on `<table>` to define child table name.
- Wrap everything in `<div class="fluig-style-guide">`.

### Structure

```html
<html>
<head>
    <link rel="stylesheet" href="/portal/resources/style-guide/css/fluig-style-guide.min.css" />
    <script src="/portal/resources/js/jquery/jquery.js"></script>
    <script src="/portal/resources/style-guide/js/fluig-style-guide.min.js"></script>
</head>
<body>
<div class="fluig-style-guide">
    <form name="form" role="form">
        <!-- Fields here -->
    </form>
</div>
</body>
</html>
```

### Linking Select to Dataset

```html
<select name="estado" dataset="dsEstados" datasetkey="sigla" datasetvalue="nome"></select>
```

### Child Table (Pai-Filho)

```html
<table class="table table-bordered" tablename="itens" addbuttonlabel="Adicionar Item">
    <thead><tr><td>Descrição</td><td>Quantidade</td></tr></thead>
    <tbody>
        <tr>
            <td><input class="form-control" name="descricao" type="text" /></td>
            <td><input class="form-control" name="quantidade" type="text" /></td>
        </tr>
    </tbody>
</table>
```

### Zoom Field

```html
<input type="zoom" name="cliente" data-zoom="{
    'displayKey': 'nome',
    'datasetId': 'dsClientes',
    'limit': '10',
    'fields': [{'field': 'codigo', 'label': 'Código', 'standard': 'false'}, {'field': 'nome', 'label': 'Nome', 'standard': 'true'}]
}" />
```

### Client-Side Events

```javascript
// beforeSendValidate — runs before workflow movement
var beforeSendValidate = function(numState, nextState) {
    if (numState == 1 && nextState == 2 && document.form.codigo.value == "") {
        throw "Preencha o código antes de movimentar!";
    }
    return true;
}

// beforeMovementOptions — runs before showing movement options
var beforeMovementOptions = function(numState) {
    if (document.form.campo.value == "") throw "Campo obrigatório!";
    return true;
}
```

---

## Integrations

### ServiceManager (SOAP WebServices)

```javascript
// Pattern: getServiceInstance → instantiate locator → get port → call methods
var provider = ServiceManager.getServiceInstance("NomeServico");
var locator = provider.instantiate("com.totvs.technology.ecm.xxx.ws.ECMXxxServiceService");
var service = locator.getXxxServicePort();
service.metodoDesejado("admin", "admin", 1, parametros);
```

### Common Services

**Update form field via ECMCardService:**
```javascript
var provider = ServiceManager.getServiceInstance("ECMCardService");
var locator = provider.instantiate("com.totvs.technology.ecm.dm.ws.ECMCardServiceService");
var service = locator.getCardServicePort();
var fieldArray = provider.instantiate("com.totvs.technology.ecm.dm.ws.CardFieldDtoArray");
var field = provider.instantiate("com.totvs.technology.ecm.dm.ws.CardFieldDto");
field.setField("nomeCampo");
field.setValue("novoValor");
var fields = new Array();
fields.push(field);
fieldArray.getItem().addAll(fields);
service.updateCardData(1, "admin", "admin", documentId, fieldArray);
```

**Start process via WorkflowEngineService:**
```javascript
var wsProvider = ServiceManager.getServiceInstance("WorkflowEngineService");
var wsLocator = wsProvider.instantiate("com.totvs.technology.ecm.workflow.ws.ECMWorkflowEngineServiceService");
var wsService = wsLocator.getWorkflowEngineServicePort();
var attachArray = wsProvider.instantiate("com.totvs.technology.ecm.workflow.ws.ProcessAttachmentDtoArray");
var objectFactory = wsProvider.instantiate("net.java.dev.jaxb.array.ObjectFactory");
var cardData = objectFactory.createStringArrayArray();
wsService.simpleStartProcess("admin", "admin", 1, "processoCode", "Obs", attachArray, cardData);
```

### oauthUtil (REST API)

```javascript
// Explicit credentials
var consumer = oauthUtil.getNewAPIConsumer("consumer_key", "consumer_secret", "access_token", "token_secret");
var response = consumer.get("/api/public/2.0/users/getCurrent");
var dados = JSON.parse(response.getResult());

// As current user
var consumer = oauthUtil.getNewAPIConsumerAsCurrentUser();
var postResponse = consumer.post("/api/public/...", JSON.stringify({campo: "valor"}));
```

### docAPI (ECM Documents)

| Method | Description |
|---|---|
| `docAPI.newDocumentDto()` | New DocumentDto instance |
| `docAPI.createDocument(doc, attachments, security, approvers, related)` | Create document in ECM |
| `docAPI.createFolder(doc, security, approvers)` | Create folder in ECM |
| `docAPI.copyDocumentToUploadArea(docId, version)` | Copy file to upload area |
| `docAPI.isUserInGroup(group)` | Check if current user is in group |

```javascript
// Create folder
var dto = docAPI.newDocumentDto();
dto.setDocumentDescription("Nome da Pasta");
dto.setDocumentType("1");
dto.setParentDocumentId(100);
dto.setDocumentTypeId("");
var pasta = docAPI.createFolder(dto, null, null);
```

---

## Widgets/WCM

### JavaScript is CLIENT-SIDE in widgets (browser, can use jQuery, ES5+)

```javascript
var MinhaWidget = SuperWidget.extend({
    instanceId: null,
    init: function() {
        this.instanceId = this.options.instanceId;
    },
    bindings: {
        local: { 'click #btnAcao': ['minhaAcao'] }
    },
    minhaAcao: function() {
        FLUIGC.ajax({
            type: 'GET',
            url: '/api/public/ecm/dataset/search',
            data: { datasetId: 'colleague' },
            success: function(result) { /* handle */ },
            error: function(args) { WCMAPI.failHandler(args, true); }
        });
    }
});
```

### WCMAPI Reference

| Method | Description |
|---|---|
| `WCMAPI.getServerURL()` | Server URL |
| `WCMAPI.fireEvent(event, data)` | Fire event to other widgets |
| `WCMAPI.addListener(widget, event, cb)` | Listen to widget events |
| `WCMAPI.failHandler(args, showAlert)` | Show request error alert |
| `WCMAPI.convertFtlAsync(widget, ftl, data, cb)` | Render FTL template |
| `WCMAPI.setSessionAttribute(key, value)` | Save to session (backend) |
| `WCMAPI.getSessionAttribute(key)` | Read from session (backend) |

### FLUIGC Components

```javascript
FLUIGC.toast({ title: 'Título', message: 'Mensagem', type: 'success' }); // success|warning|danger|info
FLUIGC.modal('#meuModal', { title: 'Título', content: '<p>HTML</p>', size: 'small' });
```

---

## Logging

```javascript
log.info("Mensagem informativa");
log.warn("Aviso");
log.error("Erro: " + e.message);
log.debug("Debug (desabilitar em produção)");
log.dir(objeto); // Prints object as JSON

// Good practice: include context
log.info("[Processo " + getValue("WKNumProces") + "] Entrando atividade " + sequenceId);
```

---

## Internal Datasets (Most Used)

| Dataset | Description |
|---|---|
| `colleague` | Platform users |
| `colleagueGroup` | User-group relationships |
| `workflowColleagueRole` | User-role relationships |
| `workflowProcess` | Requests/processes |
| `document` | ECM documents |
| `group` | Platform groups |
| `role` | Platform roles |

---

## Environment Detection (in datasets)

```javascript
function isDev() {
    var url = String(getValue("WKServer") || "");
    return url.indexOf("strategiconsultoria176588") >= 0;
}
// Dev server URL contains 'strategiconsultoria176588'
// Prod server URL contains 'strategiconsultoria176585'
```
