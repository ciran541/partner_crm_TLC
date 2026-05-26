// ============================================================
// Property CRM — Google Apps Script Backup
// Deploy as: Web App | Execute as: Me | Access: Anyone
// ============================================================

var SECRET = 'REPLACE_WITH_YOUR_APPS_SCRIPT_SECRET';
var SHEET_NAME = 'Property Cases';
var PROFILES_SHEET_NAME = 'Agent Profiles';
var ROOT_FOLDER_NAME = 'Property CRM Backup';
var CASES_FOLDER_NAME = 'Cases';

// ── Case columns ─────────────────────────────────────────────
var COLUMNS = [
  'Case ID', 'Agent ID', 'Agent Name', 'Case Type', 'Status',
  'Client Name', 'Client Mobile', 'Client Email', 'Property Address',
  'Bank Name', 'Interest Rate (%)', 'Balance Tenure (Months)',
  'Outstanding Loan Amount', 'Subsidy Amount',
  'Lock-in Estimated Date', 'Lock-in Confirmed Date',
  'Gross Commission', 'Agent Commission', 'TLC Commission', 'Commission Status',
  'Projected Remaining Balance', 'Projected Gross Commission',
  'Projected Agent Income', 'Projected TLC Income',
  'Actual Recurring Gross', 'Actual Recurring Agent Income', 'Actual Recurring TLC Income',
  'Recurring Converted', 'Is Duplicate', 'Duplicate Reason',
  'Notes', 'Created At', 'Updated At', 'Last Synced At'
];

var FIELD_MAP = {
  'Case ID': 'id',
  'Agent ID': 'agent_id',
  'Agent Name': 'agent_name',
  'Case Type': 'case_type',
  'Status': 'status',
  'Client Name': 'client_name',
  'Client Mobile': 'client_mobile',
  'Client Email': 'client_email',
  'Property Address': 'property_address',
  'Bank Name': 'bank_name',
  'Interest Rate (%)': 'interest_rate',
  'Balance Tenure (Months)': 'balance_tenure_months',
  'Outstanding Loan Amount': 'outstanding_loan_amount',
  'Subsidy Amount': 'subsidy_amount',
  'Lock-in Estimated Date': 'lockin_estimated_date',
  'Lock-in Confirmed Date': 'lockin_confirmed_date',
  'Gross Commission': 'gross_commission_amount',
  'Agent Commission': 'agent_commission_amount',
  'TLC Commission': 'tlc_commission_amount',
  'Commission Status': 'commission_status',
  'Projected Remaining Balance': 'projected_remaining_balance',
  'Projected Gross Commission': 'projected_gross_commission',
  'Projected Agent Income': 'projected_agent_income',
  'Projected TLC Income': 'projected_tlc_income',
  'Actual Recurring Gross': 'actual_recurring_gross',
  'Actual Recurring Agent Income': 'actual_recurring_agent_income',
  'Actual Recurring TLC Income': 'actual_recurring_tlc_income',
  'Recurring Converted': 'recurring_converted',
  'Is Duplicate': 'is_duplicate',
  'Duplicate Reason': 'duplicate_reason',
  'Notes': 'notes',
  'Created At': 'created_at',
  'Updated At': 'updated_at',
  'Last Synced At': null
};

// ── Profile columns ──────────────────────────────────────────
var PROFILE_COLUMNS = [
  'Agent ID', 'Email', 'Full Name', 'Display Name', 'Role',
  'Mobile', 'CEA Registration No', 'Agency Name',
  'App Type', 'Status', 'Joined At', 'Created At', 'Last Synced At'
];

var PROFILE_FIELD_MAP = {
  'Agent ID': 'id',
  'Email': 'email',
  'Full Name': 'full_name',
  'Display Name': 'name',
  'Role': 'role',
  'Mobile': 'mobile',
  'CEA Registration No': 'cea_registration_no',
  'Agency Name': 'agency_name',
  'App Type': 'app_type',
  'Status': 'status',
  'Joined At': 'joined_at',
  'Created At': 'created_at',
  'Last Synced At': null
};

// ============================================================
// Entry point
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body._secret !== SECRET) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    if (body.type === 'case') return handleCase(body);
    if (body.type === 'document') return handleDocument(body);
    if (body.type === 'profile') return handleProfile(body);

    return json({ ok: false, error: 'Unknown type: ' + body.type });
  } catch (err) {
    console.error('doPost error:', err);
    return json({ ok: false, error: String(err) });
  }
}

// ============================================================
// Case → Google Sheet upsert
// ============================================================
function handleCase(body) {
  var sheet = getOrCreateSheet(SHEET_NAME, COLUMNS);
  var caseId = String(body.id || '');
  if (!caseId) return json({ ok: false, error: 'Missing case id' });
  return upsertRow(sheet, COLUMNS, FIELD_MAP, caseId, body);
}

// ============================================================
// Profile → Agent Profiles tab upsert
// ============================================================
function handleProfile(body) {
  var sheet = getOrCreateSheet(PROFILES_SHEET_NAME, PROFILE_COLUMNS);
  var agentId = String(body.id || '');
  if (!agentId) return json({ ok: false, error: 'Missing agent id' });
  return upsertRow(sheet, PROFILE_COLUMNS, PROFILE_FIELD_MAP, agentId, body);
}

// ============================================================
// Document → Google Drive
// ============================================================
function handleDocument(body) {
  var signedUrl = body.signedUrl;
  var fileName = body.file_name;
  var mimeType = body.file_type || 'application/octet-stream';
  var caseId = body.case_id;
  var clientName = body.client_name || 'Unknown';

  if (!signedUrl || !fileName || !caseId) {
    return json({ ok: false, error: 'Missing signedUrl, file_name, or case_id' });
  }

  var rootFolder = getOrCreateFolder(null, ROOT_FOLDER_NAME);
  var casesFolder = getOrCreateFolder(rootFolder, CASES_FOLDER_NAME);
  var subFolderName = clientName + ' — ' + caseId;
  var caseFolder = getOrCreateFolder(casesFolder, subFolderName);

  var response = UrlFetchApp.fetch(signedUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    return json({ ok: false, error: 'Failed to download file: HTTP ' + response.getResponseCode() });
  }

  var blob = response.getBlob().setName(fileName).setContentType(mimeType);
  caseFolder.createFile(blob);

  return json({ ok: true, action: 'uploaded', folder: subFolderName });
}

// ============================================================
// Restore agents: read Agent Profiles tab → POST to app
// App matches each agent by email → finds new UUID → remaps all cases
// Run AFTER restoreToApp() and AFTER agents have re-registered
// ============================================================
function restoreAgents() {
  var APP_URL = 'https://YOUR_APP_URL/api/admin/property/restore-agents';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PROFILES_SHEET_NAME);
  if (!sheet) { Logger.log('Sheet not found: ' + PROFILES_SHEET_NAME); return; }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('No agent rows found'); return; }

  var headers = data[0];
  var agents = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = PROFILE_FIELD_MAP[headers[j]];
      if (key) obj[key] = row[j] === '' ? null : row[j];
    }
    // Rename 'id' → 'old_id' so endpoint knows it's the backup UUID
    obj['old_id'] = obj['id'];
    delete obj['id'];
    agents.push(obj);
  }

  var res = UrlFetchApp.fetch(APP_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ agents: agents, _secret: SECRET }),
    muteHttpExceptions: true,
  });

  var result = JSON.parse(res.getContentText());
  Logger.log('=== Agent Restore Summary ===');
  Logger.log('Remapped:        ' + result.summary.remapped);
  Logger.log('Already matched: ' + result.summary.already_matched);
  Logger.log('Not registered:  ' + result.summary.not_registered + ' (run again after they sign up)');
  Logger.log('Errors:          ' + result.summary.errors);
  Logger.log('Full results: ' + JSON.stringify(result.results, null, 2));
}

// ============================================================
// Restore cases: read all rows from Property Cases tab → POST to app
// Run manually from Apps Script editor when restoring
// ============================================================
function restoreToApp() {
  var APP_URL = 'https://YOUR_APP_URL/api/admin/property/restore-from-sheets';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Sheet not found: ' + SHEET_NAME); return; }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('No data rows found'); return; }

  var headers = data[0];
  var cases = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = FIELD_MAP[headers[j]];
      if (key) obj[key] = row[j] === '' ? null : row[j];
    }
    cases.push(obj);
  }

  var BATCH = 50;
  for (var b = 0; b < cases.length; b += BATCH) {
    var res = UrlFetchApp.fetch(APP_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ cases: cases.slice(b, b + BATCH), _secret: SECRET }),
      muteHttpExceptions: true,
    });
    Logger.log('Batch ' + (b / BATCH + 1) + ': ' + res.getContentText());
  }
  Logger.log('Restore complete. Total cases: ' + cases.length);
}

// ============================================================
// Run once to initialise both sheet tabs with headers
// ============================================================
function setupSheet() {
  getOrCreateSheet(SHEET_NAME, COLUMNS);
  getOrCreateSheet(PROFILES_SHEET_NAME, PROFILE_COLUMNS);
  Logger.log('Sheets ready: "' + SHEET_NAME + '" and "' + PROFILES_SHEET_NAME + '"');
}

// ============================================================
// Shared helpers
// ============================================================
function getOrCreateSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function upsertRow(sheet, columns, fieldMap, keyValue, body) {
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === keyValue) { rowIndex = i + 1; break; }
  }

  var now = new Date().toISOString();
  var rowValues = columns.map(function (col) {
    var key = fieldMap[col];
    if (key === null) return now;
    var val = body[key];
    return (val === null || val === undefined) ? '' : val;
  });

  if (rowIndex === -1) {
    sheet.appendRow(rowValues);
    return json({ ok: true, action: 'inserted' });
  } else {
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    return json({ ok: true, action: 'updated' });
  }
}

function getOrCreateFolder(parent, name) {
  var iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
