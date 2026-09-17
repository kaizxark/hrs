/****************************************************************************
 * HRS BLOOD GROUP DIRECTORY API
 * Google Apps Script Backend
 *
 * REQUIRED SHEETS:
 * Profiles          — donor data (columns listed below)
 * Audit Log         — created automatically on first audit write
 *
 * PROFILES SHEET REQUIRED COLUMNS:
 * HRS ID, Full Name, Date of Birth, Gender, Phone Number, Email,
 * City, Area, Registration Time, Blood Group, Blood Group Status,
 * Data Storage Consent, Donor Consent, Verification Status,
 * Verification Time, Blood Donation Count, Last Donation Time,
 * Next Eligible Time, Availability Status, Public Directory Visibility,
 * Donation 1 Date, Donation 1 Eligible Time, ... (through Donation 5 Eligible Time)
 *
 * AUDIT LOG SHEET COLUMNS (auto-created):
 * Timestamp, Action Type, Action, Target ID, Details
 ****************************************************************************/


/* ==========================================================
   CONFIGURATION
========================================================== */

// If this script is bound directly to your Google Sheet,
// leave this as null.
const SPREADSHEET_ID = null;

const PROFILES_SHEET = 'Profiles';
const AUDIT_SHEET = 'Audit Log';

// Change this to a long random secret before deploying.
// IMPORTANT: must match GOOGLE_APPS_SCRIPT_SECRET in the server `.env`.
const API_SECRET = 'hrs_9Kx72pLm_YourVeryLongSecret_2026';

// Stable public URL of the portal, used in verification confirmation emails.
// Pinned Vercel alias — stays stable across `vercel --prod` deploys.
const PORTAL_URL = 'https://hrs-camp.vercel.app';

// Password required to execute the destructive "Reset All Profiles" action.
// Change this to your own strong secret before going live.
const RESET_PASSWORD = 'you-will-regret-it';

// Minimum days between blood donations — the interval depends on the donor's
// gender (Indian national blood-transfusion guidelines):
//   men → 90 days (3 months), women → 120 days (4 months).
// recordDonation() picks the interval from the donor's Gender column; anything
// that doesn't resolve to female (blank/legacy/Other) keeps the male interval,
// i.e. the previous behaviour.
const ELIGIBILITY_DAYS_MALE = 90;
const ELIGIBILITY_DAYS_FEMALE = 120;

function getEligibilityDays(gender) {
  var normalized = normalizeUpper(gender);

  if (
    normalized === 'FEMALE' ||
    normalized === 'F' ||
    normalized === 'WOMAN' ||
    normalized === 'W'
  ) {
    return ELIGIBILITY_DAYS_FEMALE;
  }

  return ELIGIBILITY_DAYS_MALE;
}

const VALID_BLOOD_GROUPS = [
  'A+', 'A-', 'B+', 'B-',
  'AB+', 'AB-', 'O+', 'O-'
];


/* ==========================================================
   RESPONSE HELPERS
========================================================== */

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function success(data) {
  return jsonResponse({
    success: true,
    ...data
  });
}

function failure(message) {
  return jsonResponse({
    success: false,
    error: message
  });
}


/* ==========================================================
   SPREADSHEET HELPERS
========================================================== */

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function getProfilesSheet() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(PROFILES_SHEET);

  if (!sheet) {
    throw new Error(`Sheet "${PROFILES_SHEET}" not found`);
  }

  return sheet;
}

function getHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    throw new Error('Profiles sheet has no columns');
  }

  return sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0];
}

function getColumnMap(headers) {
  const map = {};

  headers.forEach((header, index) => {
    map[String(header).trim()] = index + 1;
  });

  return map;
}

function requireColumn(columnMap, name) {
  if (!columnMap[name]) {
    throw new Error(`Required column "${name}" not found`);
  }

  return columnMap[name];
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}


/* ==========================================================
   DATE HELPERS
========================================================== */

function toDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const stringValue = String(value).trim();

  // Naive "YYYY-MM-DD HH:MM:SS" strings (with a space or a T separator) are
  // IST wall-clock times: the sheet is rendered in IST so its CSV export
  // carries IST wall clocks. Parse them explicitly as IST (+05:30) so the
  // absolute instant is correct regardless of the Apps Script runtime
  // timezone.
  const naiveMatch = stringValue.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/
  );
  const date = naiveMatch
    ? new Date(`${naiveMatch[1]}T${naiveMatch[2]}+05:30`)
    : new Date(stringValue);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function serializeValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function formatDateTime(date) {
  if (!date) {
    return '';
  }

  // Always render IST (Asia/Kolkata) wall-clock times. This is deterministic
  // and independent of the Apps Script runtime / spreadsheet timezone.
  return Utilities.formatDate(
    date,
    "Asia/Kolkata",
    "yyyy-MM-dd HH:mm:ss"
  );
}

// Ensure the spreadsheet's timezone is IST so every date-formatted cell —
// including legacy Date objects written before the string-based fix — exports
// the correct IST wall clock in the CSV read by the server. Idempotent.
function ensureSpreadsheetTimeZone() {
  try {
    const ss = getSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== 'Asia/Kolkata') {
      ss.setSpreadsheetTimeZone('Asia/Kolkata');
    }
  } catch (err) {
    console.warn('[timezone] could not set spreadsheet timezone: ' + err);
  }
}


/* ==========================================================
   SECURITY
========================================================== */

function checkApiSecret(payload) {
  if (!payload) {
    throw new Error('Missing request data');
  }

  if (payload.api_secret !== API_SECRET) {
    throw new Error('Unauthorized request');
  }
}


/* ==========================================================
   API ROUTING - GET
========================================================== */

function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';

    switch (action) {

      case 'ping':
        return success({ message: 'HRS API is running' });

      case 'profiles':
        return success({ data: getProfiles() });

      case 'audit_logs':
        var aOffset = parseInt(e.parameter.offset || '0', 10);
        var aLimit  = parseInt(e.parameter.limit  || '100', 10);
        return success({ data: getAuditLogs(aOffset, aLimit) });

      case 'clear_audit':
        return success({ data: clearAuditLog() });

      case 'public_profiles':
        return success({ data: getPublicProfiles() });

      case 'statistics':
        return success({ data: getStatistics() });

      case 'listAdmins':
        try {
          var adminSheet = getSpreadsheet().getSheetByName('Admin') || getSpreadsheet().getSheetByName('Staff');
          if (!adminSheet) {
            adminSheet = getSpreadsheet().getSheetByName('Profiles');
          }
          if (!adminSheet) return failure('Admin sheet not found');
          var ah = adminSheet.getRange(1, 1, 1, adminSheet.getLastColumn()).getValues()[0];
          var aData = adminSheet.getDataRange().getValues();
          var resultList = [];
          for (var i = 1; i < aData.length; i++) {
            var row = aData[i];
            var obj = {};
            for (var j = 0; j < ah.length; j++) {
              obj[String(ah[j]).trim()] = row[j];
            }
            resultList.push(obj);
          }
          return success({ data: resultList });
        } catch (e) {
          return failure('listAdmins error: ' + e.message);
        }

      case 'listVolunteers':
        try {
          var volSheet = getSpreadsheet().getSheetByName('Volunteer');
          if (!volSheet) volSheet = getSpreadsheet().getSheetByName('Volunteers');
          if (!volSheet) {
            volSheet = getSpreadsheet().getSheetByName('Profiles');
          }
          if (!volSheet) return failure('Volunteer sheet not found');
          var vh = volSheet.getRange(1, 1, 1, volSheet.getLastColumn()).getValues()[0];
          var vData = volSheet.getDataRange().getValues();
          var vList = [];
          for (var k = 1; k < vData.length; k++) {
            var vRow = vData[k];
            var vObj = {};
            for (var m = 0; m < vh.length; m++) {
              vObj[String(vh[m]).trim()] = vRow[m];
            }
            vList.push(vObj);
          }
          return success({ data: vList });
        } catch (e) {
          return failure('listVolunteers error: ' + e.message);
        }

      default:
    }

  } catch (error) {
    return failure(error.message);
  }
}


/* ==========================================================
   AUDIT LOG HELPERS
========================================================== */

function getAuditSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(AUDIT_SHEET);

  if (!sheet) {
    // Fallback: check the old tab name
    sheet = ss.getSheetByName('Audit Logs');
  }

  if (!sheet) {
    // Create the tab with the correct header
    sheet = ss.insertSheet(AUDIT_SHEET);
    sheet.appendRow([
      "Timestamp", "Action Type", "Action", "Target ID", "Details"
    ]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 5);
  } else {
    // Tab exists but might be empty — seed the header row if so
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) {
      sheet.appendRow([
        "Timestamp", "Action Type", "Action", "Target ID", "Details"
      ]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, 5);
    }
  }

  return sheet;
}

/**
 * Append a single audit entry to the "Audit Log" sheet.
 * Never throws; returns { success: true } or { success: false, error }.
 *
 * Fields: actionType, action, targetId, details
 */
function appendAuditLog(log) {
  try {
    var sheet = getAuditSheet();

    var details = log && log.details;
    if (details && typeof details === "object") {
      details = JSON.stringify(details);
    }
    if (typeof details === "string") {
      details = details.replace(/\r?\n/g, " \\n ");
    }

    var now = new Date();
    var timestamp = Utilities.formatDate(now, "Asia/Kolkata", "dd-MM-yyyy HH:mm:ss");

    sheet.appendRow([
      timestamp,
      (log && log.actionType) || "",
      (log && log.action) || "",
      (log && log.targetId) || "",
      details || ""
    ]);

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Read back recent audit entries (newest first) for the admin viewer.
 * Returns an array of objects keyed by header name.
 */
function getAuditLogs(offset, limit) {
  var sheet = getAuditSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var startRow = Math.max(2, lastRow - (offset || 0) - (limit || 100) + 1);
  var endRow   = lastRow - (offset || 0);

  if (startRow > endRow) return [];

  var values = sheet.getRange(startRow, 1, endRow - startRow + 1, lastCol).getValues();

  return values.reverse().map(function (row) {
    var obj = {};
    headers.forEach(function (header, i) {
      obj[String(header).trim()] = serializeValue(row[i]);
    });
    return obj;
  });
}

/**
 * Clear all audit log entries from the sheet (keep header row).
 */
function clearAuditLog() {
  try {
    var sheet = getAuditSheet();
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    return { success: true, removed: Math.max(0, lastRow - 1) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}


/* ==========================================================
   API ROUTING - POST
========================================================== */

function doPost(e) {
  try {
    var payload = e.parameter;
    var action  = payload.action;

    // Keep the spreadsheet timezone on IST so legacy Date-object cells render
    // IST wall clocks in the CSV export (idempotent, cheap).
    ensureSpreadsheetTimeZone();

    var result;
    var meta = {};

    switch (action) {

      case 'verify_profile':
        result = verifyProfile(payload);
        meta = {
          actionType: 'PROFILE_VERIFY',
          action: 'Verified profile',
          targetId: payload.hrs_id,
          details: { blood_group: payload.blood_group, donor_consent: payload.donor_consent }
        };
        break;

      case 'record_donation':
        result = recordDonation(payload);
        meta = {
          actionType: 'PROFILE_DONATION',
          action: 'Recorded blood donation',
          targetId: payload.hrs_id,
          details: { donation_time: payload.donation_time }
        };
        break;

      case 'delete_profiles':
        result = deleteProfiles(payload.hrs_ids);
        meta = {
          actionType: 'PROFILE_DELETE',
          action: 'Deleted profile(s)',
          targetId: payload.hrs_ids,
          details: { hrs_ids: payload.hrs_ids, deleted: result && typeof result.deleted === 'number' ? result.deleted : 0 }
        };
        break;

      case 'update_profile':
        result = updateProfile(payload);
        meta = {
          actionType: 'PROFILE_UPDATE',
          action: 'Updated profile',
          targetId: payload.hrs_id,
          details: { message: result.message, updated: result.updated }
        };
        break;

      case 'send_verification_email':
        result = sendVerificationEmail(payload);
        meta = {
          actionType: 'PROFILE_EMAIL',
          action: 'Sent verification email',
          targetId: payload.hrs_id,
          details: {
            sent: !!result.sent,
            skipped: !!result.skipped,
            to: result.to || '',
            reason: result.reason || ''
          }
        };
        break;

      case 'reset_profiles':
        result = resetProfiles(payload);
        meta = {
          actionType: 'PROFILE_RESET',
          action: 'Reset all profiles (erased)',
          targetId: 'ALL',
          details: { count: result && typeof result.count === 'number' ? result.count : 0 }
        };
        break;

      case 'listAdmins':
        try {
          var adminSheet = getSpreadsheet().getSheetByName('Admin') || getSpreadsheet().getSheetByName('Staff');
          if (!adminSheet) {
            adminSheet = getSpreadsheet().getSheetByName('Profiles');
          }
          if (!adminSheet) return failure('Admin sheet not found');
          var ah = adminSheet.getRange(1, 1, 1, adminSheet.getLastColumn()).getValues()[0];
          var aData = adminSheet.getDataRange().getValues();
          var resultList = [];
          for (var i = 1; i < aData.length; i++) {
            var row = aData[i];
            var obj = {};
            for (var j = 0; j < ah.length; j++) {
              obj[String(ah[j]).trim()] = row[j];
            }
            resultList.push(obj);
          }
          return success({ data: resultList });
        } catch (e) {
          return failure('listAdmins error: ' + e.message);
        }

      case 'listVolunteers':
        try {
          var volSheet = getSpreadsheet().getSheetByName('Volunteer');
          if (!volSheet) volSheet = getSpreadsheet().getSheetByName('Volunteers');
          if (!volSheet) {
            volSheet = getSpreadsheet().getSheetByName('Profiles');
          }
          if (!volSheet) return failure('Volunteer sheet not found');
          var vh = volSheet.getRange(1, 1, 1, volSheet.getLastColumn()).getValues()[0];
          var vData = volSheet.getDataRange().getValues();
          var vList = [];
          for (var k = 1; k < vData.length; k++) {
            var vRow = vData[k];
            var vObj = {};
            for (var m = 0; m < vh.length; m++) {
              vObj[String(vh[m]).trim()] = vRow[m];
            }
            vList.push(vObj);
          }
          return success({ data: vList });
        } catch (e) {
          return failure('listVolunteers error: ' + e.message);
        }

      case 'create_volunteer':
        result = createVolunteer(payload);
        meta = {
          actionType: 'VOLUNTEER_CREATE',
          action: 'Created volunteer account',
          targetId: payload.username,
          details: { username: payload.username, full_name: payload.full_name }
        };
        break;

      case 'delete_volunteer':
        result = deleteVolunteer(payload);
        meta = {
          actionType: 'VOLUNTEER_DELETE',
          action: 'Deleted volunteer account',
          targetId: payload.username,
          details: { username: payload.username }
        };
        break;

      case 'assign_hrs_id':
        result = assignHrsId(payload);
        meta = {
          actionType: 'HRS_ID_ASSIGN',
          action: 'Auto-assigned HRS ID',
          targetId: payload.hrs_id,
          details: { hrs_id: payload.hrs_id, phone_number: payload.phone_number }
        };
        break;

      case 'add_person':
        result = addPerson(payload);
        meta = {
          actionType: 'PROFILE_ADD',
          action: 'Added and verified new profile',
          targetId: result && result.hrs_id ? result.hrs_id : payload.full_name,
          details: {
            full_name: payload.full_name,
            blood_group: payload.blood_group,
            donor_consent: payload.donor_consent
          }
        };
        break;

      default:
    }

    // Record the successful action in the audit log
    appendAuditLog({
      actionType: meta.actionType,
      action: meta.action,
      targetId: meta.targetId,
      details: meta.details
    });

    return success(result);

  } catch (err) {
    // Log failures too so admins can see what errored
    appendAuditLog({
      actionType: 'ACTION_ERROR',
      action: 'Action failed: ' + (err && err.message ? err.message : String(err)),
      details: { action: action || 'unknown' }
    });
    return failure(err.message);
  }
}


/* ==========================================================
   UPDATE PROFILE (for editing existing verified records)
========================================================== */

function updateProfile(params) {
  checkApiSecret(params);

  var hrsId = normalizeText(params.hrs_id);
  if (!hrsId) {
    throw new Error('hrs_id is required');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var row = findProfileRow(sheet, columnMap, hrsId);
  if (!row) {
    throw new Error('Profile not found: ' + hrsId);
  }

  // Map client param names -> spreadsheet column names
  var fieldMap = {
    full_name:     'Full Name',
    date_of_birth: 'Date of Birth',
    gender:        'Gender',
    phone_number:  'Phone Number',
    email:         'Email',
    city:          'City',
    area:          'Area',
    blood_group:   'Blood Group',
    donor_consent: 'Donor Consent'
  };

  var updates = [];
  for (var paramKey in fieldMap) {
    var colName = fieldMap[paramKey];
    var colNum  = columnMap[colName];
    if (!colNum) continue;

    var rawValue = normalizeText(params[paramKey]);
    if (rawValue === '') continue;

    sheet.getRange(row, colNum).setValue(rawValue);
    updates.push(colName + ' = ' + rawValue);
  }

  // If donor_consent changed, also refresh availability
  if (params.donor_consent !== undefined && params.donor_consent !== '') {
    updateAvailability({ hrs_id: hrsId });
  }

  SpreadsheetApp.flush();

  var count = updates.length;
  var msg = count > 0
    ? 'Updated ' + count + ' field(s): ' + updates.join(', ')
    : 'No fields to update';
  console.log('[update_profile] ' + hrsId + ' — ' + msg);

  return { message: msg, updated: count };
}


/* ==========================================================
   CREATE VOLUNTEER (volunteer accounts written to the sheet)
   Volunteer sheet columns: Full Name, Username, Password, Mobile
========================================================== */

function createVolunteer(params) {
  checkApiSecret(params);

  var username = normalizeText(params.username);
  var fullName = normalizeText(params.full_name);
  var passwordHash = normalizeText(params.password_hash);
  var mobile = normalizeText(params.mobile || '');

  if (!username) {
    throw new Error('username is required');
  }
  if (!fullName) {
    throw new Error('full_name is required');
  }
  if (!passwordHash) {
    throw new Error('password_hash is required');
  }

  var ss = getSpreadsheet();

  // Resolve the Volunteer tab (create it if it doesn't exist yet).
  var sheet = ss.getSheetByName('Volunteer');
  if (!sheet) sheet = ss.getSheetByName('Volunteers');
  if (!sheet) {
    sheet = ss.insertSheet('Volunteer');
    sheet.appendRow(['Full Name', 'Username', 'Password', 'Mobile']);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else {
    // If the sheet already exists but lacks the Mobile column, add it.
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var hasMobile = false;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim().toLowerCase() === 'mobile') { hasMobile = true; break; }
    }
    if (!hasMobile) {
      var nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue('Mobile').setFontWeight('bold');
    }
  }

  // Duplicate-username guard (case-insensitive) before appending.
  var existing = sheet.getDataRange().getValues();
  for (var r = 1; r < existing.length; r++) {
    var existingName = normalizeText(String(existing[r][1]));
    if (existingName !== '' && existingName.toLowerCase() === username.toLowerCase()) {
      throw new Error('Username already exists: ' + username);
    }
  }

  sheet.appendRow([fullName, username, passwordHash, mobile]);
  SpreadsheetApp.flush();

  console.log('[create_volunteer] ' + username + ' (' + fullName + ') added');
  return { success: true, username: username, full_name: fullName, mobile: mobile };
}


/* ==========================================================
   DELETE VOLUNTEER (remove a row from the Volunteer tab by username)
   Volunteer sheet columns: Full Name, Username, Password, Mobile
========================================================== */

function deleteVolunteer(params) {
  checkApiSecret(params);

  var username = normalizeText(params.username);
  if (!username) {
    throw new Error('username is required');
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Volunteer');
  if (!sheet) sheet = ss.getSheetByName('Volunteers');
  if (!sheet) {
    throw new Error('Volunteer sheet not found');
  }

  var data = sheet.getDataRange().getValues();
  // Row 0 is headers; scan data rows (1..N) for a matching username (column B = index 1).
  for (var r = 1; r < data.length; r++) {
    var cell = normalizeText(String(data[r][1]));
    if (cell.toLowerCase() === username.toLowerCase()) {
      sheet.deleteRow(r + 1); // Sheet rows are 1-indexed; deleteRow removes the entire row.
      SpreadsheetApp.flush();
      console.log('[delete_volunteer] ' + username + ' removed from row ' + (r + 1));
      return { success: true, username: username, deleted: true };
    }
  }

  // No matching row — not an error (idempotent), but report the miss.
  console.log('[delete_volunteer] ' + username + ' not found in sheet');
  return { success: true, username: username, deleted: false, message: 'Username not found in Volunteer sheet' };
}


/* ==========================================================
   PROFILE READING
========================================================== */

function getProfiles() {
  var sheet = getProfilesSheet();
  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return [];
  }

  var headers = data[0];

  return data.slice(1).map(function (row, index) {
    return rowToProfile(headers, row, index + 2);
  });
}

function rowToProfile(headers, row, sheetRow) {
  var profile = {};

  headers.forEach(function (header, index) {
    profile[header] = serializeValue(row[index]);
  });

  profile.sheet_row = sheetRow;

  return profile;
}

function getProfileById(hrsId) {
  if (!hrsId) {
    throw new Error('hrs_id is required');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var idCol = requireColumn(columnMap, 'HRS ID');

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error('No profiles found');
  }

  var ids = sheet
    .getRange(2, idCol, lastRow - 1, 1)
    .getValues();

  var target = normalizeText(hrsId);

  for (var i = 0; i < ids.length; i++) {
    if (normalizeText(ids[i][0]) === target) {

      var rowNumber = i + 2;

      var row = sheet
        .getRange(rowNumber, 1, 1, headers.length)
        .getValues()[0];

      return rowToProfile(headers, row, rowNumber);
    }
  }

  throw new Error('Profile not found');
}


/* ==========================================================
   FIND PROFILE ROW
========================================================== */

function findProfileRow(sheet, columnMap, hrsId) {
  var idCol = requireColumn(columnMap, 'HRS ID');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return null;
  }

  var ids = sheet
    .getRange(2, idCol, lastRow - 1, 1)
    .getValues();

  var target = normalizeText(hrsId);

  for (var i = 0; i < ids.length; i++) {
    if (normalizeText(ids[i][0]) === target) {
      return i + 2;
    }
  }

  return null;
}


/* ==========================================================
   VERIFY PROFILE
========================================================== */

function verifyProfile(payload) {

  if (!payload.hrs_id) {
    throw new Error('hrs_id is required');
  }

  var bloodGroup = normalizeUpper(payload.blood_group);
  var donorConsent = normalizeUpper(payload.donor_consent);

  if (!VALID_BLOOD_GROUPS.includes(bloodGroup)) {
    throw new Error(
      'Invalid blood group. Use A+, A-, B+, B-, AB+, AB-, O+, or O-'
    );
  }

  if (donorConsent !== 'YES' && donorConsent !== 'NO') {
    throw new Error('Donor consent must be YES or NO');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var row = findProfileRow(sheet, columnMap, payload.hrs_id);

  if (!row) {
    throw new Error('Profile not found');
  }

  var bloodGroupCol      = requireColumn(columnMap, 'Blood Group');
  var bloodGroupStatusCol = requireColumn(columnMap, 'Blood Group Status');
  var donorConsentCol    = requireColumn(columnMap, 'Donor Consent');
  var verificationStatusCol = requireColumn(columnMap, 'Verification Status');
  var verificationTimeCol = requireColumn(columnMap, 'Verification Time');
  var donationCountCol   = requireColumn(columnMap, 'Blood Donation Count');
  var lastDonationCol    = requireColumn(columnMap, 'Last Donation Time');
  var nextEligibleCol    = requireColumn(columnMap, 'Next Eligible Time');
  var availabilityCol    = requireColumn(columnMap, 'Availability Status');
  var publicVisibilityCol = requireColumn(columnMap, 'Public Directory Visibility');

  // Read current status
  var currentStatus = normalizeUpper(
    sheet.getRange(row, verificationStatusCol).getValue()
  );

  if (currentStatus === 'VERIFIED') {
    throw new Error('This profile is already verified');
  }

  var now = new Date();

  // Blood group verification
  sheet.getRange(row, bloodGroupCol).setValue(bloodGroup);
  sheet.getRange(row, bloodGroupStatusCol).setValue('Recorded');

  // Donor consent
  sheet.getRange(row, donorConsentCol).setValue(donorConsent);

  // Verification — write the timestamp as an IST wall-clock STRING (not a Date
  // object) so the CSV export carries the correct wall clock regardless of the
  // spreadsheet's own timezone.
  sheet.getRange(row, verificationStatusCol).setValue('VERIFIED');
  sheet.getRange(row, verificationTimeCol).setValue(formatDateTime(now));

  // Every newly verified profile starts with zero donations
  var currentDonationCount = sheet
    .getRange(row, donationCountCol)
    .getValue();

  if (
    currentDonationCount === '' ||
    currentDonationCount === null ||
    Number(currentDonationCount) < 0
  ) {
    sheet.getRange(row, donationCountCol).setValue(0);
  }

  if (donorConsent === 'YES') {

    sheet.getRange(row, availabilityCol).setValue('AVAILABLE');
    sheet.getRange(row, publicVisibilityCol).setValue('YES');

  } else {

    // Verified but does not consent to donate
    sheet.getRange(row, donationCountCol).setValue(0);
    sheet.getRange(row, lastDonationCol).clearContent();
    sheet.getRange(row, nextEligibleCol).clearContent();
    sheet.getRange(row, availabilityCol).setValue('NOT PARTICIPATING');
    sheet.getRange(row, publicVisibilityCol).setValue('NO');

    clearDonationHistory(sheet, row, columnMap);
  }

  SpreadsheetApp.flush();

  return {
    message: 'Profile verified successfully',
    hrs_id: payload.hrs_id,
    blood_group: bloodGroup,
    donor_consent: donorConsent,
    verification_status: 'VERIFIED',
    verification_time: formatDateTime(now)
  };
}


/* ==========================================================
   ADD PERSON (admin panel "Add Person" — create + verify in one write)
   Reads every detail from the form, assigns the next HRS ID,
   appends a new row and marks it VERIFIED immediately so the
   profile appears in the Verified tab (and directory when
   consent allows) without a separate verification pass.
========================================================== */

function addPerson(payload) {
  checkApiSecret(payload);

  var fullName = normalizeText(payload.full_name);
  var bloodGroup = normalizeUpper(payload.blood_group);
  var donorConsent = normalizeUpper(payload.donor_consent);

  if (!fullName) {
    throw new Error('full_name is required');
  }
  if (VALID_BLOOD_GROUPS.indexOf(bloodGroup) === -1) {
    throw new Error('Invalid blood group. Use A+, A-, B+, B-, AB+, AB-, O+, or O-');
  }
  if (donorConsent !== 'YES' && donorConsent !== 'NO') {
    throw new Error('Donor consent must be YES or NO');
  }

  // Optional profile details (kept blank when the staff member leaves them out).
  var dateOfBirth = normalizeText(payload.date_of_birth);
  var gender      = normalizeText(payload.gender);
  var phoneNumber = normalizeText(payload.phone_number);
  var email       = normalizeText(payload.email);
  var city        = normalizeText(payload.city) || 'Tumkur';
  var area        = normalizeText(payload.area);
  var storageConsent = normalizeUpper(payload.data_storage_consent);
  if (storageConsent !== 'YES' && storageConsent !== 'NO') {
    storageConsent = 'YES';
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  // Next HRS ID = max existing numeric ID + 1 (same convention as
  // assignHrsIdsToPendingRecords: HRS-0001, HRS-0002, ...).
  var idCol = requireColumn(columnMap, 'HRS ID');
  var lastRow = sheet.getLastRow();
  var maxNum = 0;
  if (lastRow >= 2) {
    var idValues = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < idValues.length; i++) {
      var match = String(idValues[i][0] || '').trim().match(/HRS-0*(\d+)/);
      if (match) {
        var num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  var hrsId = 'HRS-' + String(maxNum + 1).padStart(4, '0');

  var now = new Date();

  // Build the full row aligned by header name so the column ORDER in the
  // sheet does not matter.
  var values = new Array(headers.length).fill('');
  var fields = {
    'HRS ID': hrsId,
    'Full Name': fullName,
    'Date of Birth': dateOfBirth,
    'Gender': gender,
    'Phone Number': phoneNumber,
    'Email': email,
    'City': city,
    'Area': area,
    'Registration Time': formatDateTime(now),
    'Data Storage Consent': storageConsent,
    'Blood Group': bloodGroup,
    'Blood Group Status': 'Recorded',
    'Donor Consent': donorConsent,
    'Verification Status': 'VERIFIED',
    'Verification Time': formatDateTime(now),
    'Blood Donation Count': 0,
    'Availability Status': donorConsent === 'YES' ? 'AVAILABLE' : 'NOT PARTICIPATING',
    'Public Directory Visibility': donorConsent === 'YES' ? 'YES' : 'NO'
  };

  // Guard against a sheet that is missing a column: skip silently rather
  // than failing the whole insert. HRS ID and Full Name are required.
  requireColumn(columnMap, 'Full Name');
  for (var key in fields) {
    var col = columnMap[key];
    if (col) values[col - 1] = fields[key];
  }

  sheet.appendRow(values);
  SpreadsheetApp.flush();

  console.log('[add_person] ' + hrsId + ' ' + fullName + ' added and verified');

  return {
    message: 'Profile added and verified successfully',
    hrs_id: hrsId,
    full_name: fullName,
    blood_group: bloodGroup,
    donor_consent: donorConsent,
    verification_status: 'VERIFIED',
    verification_time: formatDateTime(now)
  };
}


/* ==========================================================
   SEND VERIFICATION EMAIL
========================================================== */

function sendVerificationEmail(payload) {
  checkApiSecret(payload);

  var hrsId = normalizeText(payload.hrs_id);
  if (!hrsId) {
    throw new Error('hrs_id is required');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var row = findProfileRow(sheet, columnMap, hrsId);
  if (!row) {
    throw new Error('Profile not found');
  }

  var emailCol = requireColumn(columnMap, 'Email');
  var email = normalizeText(sheet.getRange(row, emailCol).getValue());

  // No email on file — nothing to send. The portal treats this as a silent
  // skip: verification stays successful, the admin is not disturbed.
  if (!email) {
    return {
      skipped: true,
      reason: 'No email on file',
      hrs_id: hrsId
    };
  }

  var nameCol = requireColumn(columnMap, 'Full Name');

  var fullName = normalizeText(sheet.getRange(row, nameCol).getValue());

  // Use the blood group from the verify click if provided (avoids racing the
  // slower verify_profile write), otherwise fall back to the sheet value.
  var bloodGroup = normalizeUpper(payload.blood_group);
  if (!bloodGroup) {
    var bloodGroupCol = columnMap['Blood Group'] || null;
    if (bloodGroupCol) {
      bloodGroup = normalizeText(sheet.getRange(row, bloodGroupCol).getValue());
    }
  }

  var donorConsent = normalizeUpper(payload.donor_consent);

  // Pull the full profile row so the fallback email matches the rich SMTP
  // version (details grid, blood-group hero, footer).
  var readCell = function (colName) {
    var col = columnMap[colName] || null;
    return col ? normalizeText(sheet.getRange(row, col).getValue()) : '';
  };

  var params = {
    fullName: fullName,
    hrsId: hrsId,
    bloodGroup: bloodGroup,
    donorConsent: donorConsent,
    dateOfBirth: readCell('Date of Birth'),
    age: readCell('Age'),
    gender: readCell('Gender'),
    mobile: readCell('Phone Number'),
    email: email,
    city: readCell('City'),
    area: readCell('Area'),
    availability: readCell('Availability Status'),
    donationCount: readCell('Blood Donation Count'),
    nextEligibleAt: readCell('Next Eligible Time'),
    registeredAt: readCell('Registration Time'),
    verifiedAt: readCell('Verification Time')
  };

  MailApp.sendEmail({
    to: email,
    subject: 'Your HRS blood donor profile has been verified ✅',
    htmlBody: buildVerificationEmailHtml(params),
    name: 'HRS Blood Donor Portal'
  });

  return {
    sent: true,
    to: email,
    hrs_id: hrsId
  };
}

function escEmail(value) {
  if (value === null || value === undefined) return '&mdash;';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtEmailDate(value) {
  if (!value) return '&mdash;';
  var d = toDate(value);
  if (!d || isNaN(d.getTime())) return escEmail(String(value));
  // Render in IST (sheet wall-clock) as "12 Aug 2025".
  return Utilities.formatDate(d, 'Asia/Kolkata', 'd MMM yyyy');
}

function consentEmailLabel(value) {
  var v = String(value || '').toUpperCase().trim();
  if (v === 'YES') return 'Yes';
  if (v === 'NO') return 'No';
  return '&mdash;';
}

function emailGridCell(label, value, withDivider) {
  var border = withDivider ? 'border-left:1px solid #f4e7e0;' : '';
  return '<td class="cell-pad" width="50%" valign="top" style="padding:13px 20px; ' + border + 'vertical-align:top;">'
    + '<div style="font-size:10.5px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:#b39187; margin-bottom:5px; font-family:Arial,Helvetica,sans-serif;">' + escEmail(label) + '</div>'
    + '<div style="font-size:14.5px; font-weight:700; color:#2b211d; line-height:1.45; word-break:break-word; font-family:Arial,Helvetica,sans-serif;">' + escEmail(value) + '</div>'
    + '</td>';
}

function emailGridRow(leftLabel, leftValue, rightLabel, rightValue, bg, isLast) {
  var border = isLast ? '' : 'border-bottom:1px solid #f4e7e0;';
  return '<tr>'
    + '<td style="background:' + bg + '; ' + border + '" width="100%">'
    + '<table border="0" cellpadding="0" cellspacing="0" width="100%" class="two-col" style="width:100%;">'
    + '<tr>' + emailGridCell(leftLabel, leftValue, false) + emailGridCell(rightLabel, rightValue, true) + '</tr>'
    + '</table>'
    + '</td>'
    + '</tr>';
}

function buildVerificationEmailHtml(params) {
  var fullName = params.fullName || 'Donor';
  var location = [params.city, params.area].filter(function (v) { return v; }).join(' · ');
  var bloodGroup = (params.bloodGroup || '').toUpperCase() || '&mdash;';
  var verifiedAt = params.verifiedAt ? fmtEmailDate(params.verifiedAt) : fmtEmailDate(new Date().toISOString());

  var grid = ''
    + emailGridRow('HRS ID', params.hrsId, 'Full Name', params.fullName, '#ffffff', false)
    + emailGridRow('Date of Birth', fmtEmailDate(params.dateOfBirth), 'Age', params.age || '&mdash;', '#fdf8f5', false)
    + emailGridRow('Gender', params.gender, 'Mobile', params.mobile, '#ffffff', false)
    + emailGridRow('Email', params.email, 'Location', location || '&mdash;', '#fdf8f5', false)
    + emailGridRow('Blood Group', bloodGroup, 'Donor Consent', consentEmailLabel(params.donorConsent), '#ffffff', false)
    + emailGridRow('Availability', params.availability, 'Donations Made', params.donationCount || '0', '#fdf8f5', false)
    + emailGridRow('Next Eligible', fmtEmailDate(params.nextEligibleAt), 'Registered On', fmtEmailDate(params.registeredAt), '#ffffff', true);

  return ''
    + '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    + '<meta name="color-scheme" content="light">'
    + '<meta name="supported-color-schemes" content="light">'
    + '<title>Your HRS profile has been verified</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
    + '<style>@media only screen and (max-width:640px){.w600{width:100% !important;max-width:100% !important}.pad-outer{padding:22px 12px !important}.pad-card{padding:28px 22px !important}.pad-hero{padding:24px 18px !important}.pad-header{padding:32px 28px 28px !important}.drop{width:52px !important;height:52px !important;line-height:52px !important;font-size:25px !important}.brand{font-size:21px !important}.blood{font-size:44px !important}.cell-pad{padding:12px 16px !important}.btn{padding:14px 32px !important;font-size:14px !important}.two-col td{display:block !important;width:100% !important;box-sizing:border-box !important;border-left:0 !important}}</style>'
    + '</head>'
    + '<body style="margin:0;padding:0;background-color:#f4f0ec;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f4f0ec;">'
    + 'Blood group ' + bloodGroup + ' — your HRS donor profile has been officially verified.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f0ec;">'
    + '<tr><td align="center" class="pad-outer" style="padding:36px 14px;">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="w600" style="width:600px;max-width:600px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 16px 44px -18px rgba(120,36,28,.28);">'

    // Header
    + '<tr><td class="pad-header" style="background:linear-gradient(135deg,#7f1d1d 0%,#b91c1c 50%,#dc2626 100%);padding:38px 40px 32px;text-align:center;">'
    + '<div class="drop" style="display:inline-block;width:58px;height:58px;line-height:58px;border-radius:50%;background:rgba(255,255,255,.14);font-size:28px;text-align:center;">&#128184;</div>'
    + '<div class="brand" style="font-family:Manrope,Segoe UI,Arial,Helvetica,sans-serif;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:.3px;margin-top:14px;">HRS Blood Donor Portal</div>'
    + '<div style="font-size:11.5px;font-weight:700;letter-spacing:2.8px;text-transform:uppercase;color:rgba(255,216,216,.92);margin-top:7px;font-family:Arial,Helvetica,sans-serif;">Profile Verified</div>'
    + '</td></tr>'

    // Body
    + '<tr><td class="pad-card" style="padding:32px 40px 30px;background:#ffffff;">'
    + '<div style="font-family:Manrope,Segoe UI,Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#2b211d;">Dear ' + escEmail(fullName) + ',</div>'
    + '<div style="font-size:14.5px;line-height:1.78;color:#6f6259;margin-top:10px;font-family:Arial,Helvetica,sans-serif;">'
    + 'Great news — your blood donor profile has been <strong style="color:#b91c1c;">verified</strong> by our team. You are now part of a life-saving community of donors, and here is everything we have on record:</div>'

    // Blood group hero
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 4px;"><tr><td align="center">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#dc2626 0%,#a82121 60%,#8a1c1c 100%);border-radius:18px;box-shadow:0 10px 28px -10px rgba(185,28,28,.5);">'
    + '<tr><td class="pad-hero" style="padding:28px 24px;text-align:center;">'
    + '<div style="font-size:10.5px;font-weight:700;letter-spacing:2.6px;text-transform:uppercase;color:rgba(255,255,255,.82);font-family:Arial,Helvetica,sans-serif;">Your Blood Group</div>'
    + '<div class="blood" style="font-family:Manrope,Segoe UI,Arial,sans-serif;font-size:52px;font-weight:800;color:#ffffff;line-height:1.1;margin-top:4px;letter-spacing:1px;">' + bloodGroup + '</div>'
    + '</td></tr></table></td></tr></table>'

    // Verified badge
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 24px;"><tr><td align="center">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#0f766e,#115e59);border-radius:999px;">'
    + '<tr><td style="padding:9px 24px;font-size:13px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;letter-spacing:.2px;">&#9989; Verified on ' + verifiedAt + '</td></tr>'
    + '</table></td></tr></table>'

    // Profile details card
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;background:#fffdfb;border:1px solid #f4e7e0;border-radius:18px;overflow:hidden;">'
    + '<tr><td style="padding:15px 22px;background:#fdf3ef;border-bottom:1px solid #f4e7e0;">'
    + '<div style="font-family:Manrope,Segoe UI,Arial,Helvetica,sans-serif;font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:#b91c1c;">&#128203; Your Profile Details</div>'
    + '</td></tr>'
    + '<tr><td style="padding:0;">'
    + '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">'
    + grid
    + '</table>'
    + '</td></tr></table>'

    // CTA
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 4px;"><tr><td align="center">'
    + '<a href="' + PORTAL_URL + '" target="_blank" class="btn" style="display:inline-block;background:linear-gradient(135deg,#b91c1c 0%,#991b1b 100%);color:#ffffff;font-family:Manrope,Segoe UI,Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:15px 42px;border-radius:12px;letter-spacing:.3px;box-shadow:0 10px 24px -8px rgba(185,28,28,.5);">Visit the HRS Donor Portal &rarr;</a>'
    + '</td></tr></table>'
    + '<div style="text-align:center;font-size:11.5px;color:#a89a92;margin-top:12px;font-family:Arial,Helvetica,sans-serif;">'
    + 'Prefer a browser? Open <a href="' + PORTAL_URL + '" target="_blank" style="color:#b91c1c;text-decoration:underline;">' + PORTAL_URL + '</a></div>'
    + '</td></tr>'

    // Footer
    + '<tr><td style="background:#2b211d;padding:28px 40px;text-align:center;">'
    + '<div style="font-family:Manrope,Segoe UI,Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;color:#ffffff;letter-spacing:.3px;">HRS Blood Donor Portal</div>'
    + '<div style="font-size:12.5px;color:#cbb9b0;line-height:1.7;margin-top:6px;font-family:Arial,Helvetica,sans-serif;">One drop at a time — together we save lives. &#10084;&#65039;</div>'
    + '<div style="width:420px;max-width:100%;height:1px;background:rgba(255,255,255,.14);margin:16px auto 0;font-size:0;line-height:0;">&nbsp;</div>'
    + '<div style="font-size:11px;color:#9d8a81;line-height:1.7;margin-top:14px;font-family:Arial,Helvetica,sans-serif;">'
    + 'You are receiving this email because your donor profile on the<br>HRS Blood Donor Portal was verified.</div>'
    + '</td></tr>'

    + '</table></td></tr></table>'
    + '</body></html>';
}


/* ==========================================================
   DONATION COLUMN HELPERS
========================================================== */

function getDonationColumnNames(number) {
  return {
    date:      'Donation ' + number + ' Date',
    eligible:  'Donation ' + number + ' Eligible Time'
  };
}

function ensureDonationColumns(sheet, number) {

  var names = getDonationColumnNames(number);
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  if (!columnMap[names.date]) {
    var lastColumn = sheet.getLastColumn() + 1;
    sheet.getRange(1, lastColumn).setValue(names.date);
    headers = getHeaders(sheet);
    columnMap = getColumnMap(headers);
  }

  if (!columnMap[names.eligible]) {
    var lastColumn2 = sheet.getLastColumn() + 1;
    sheet.getRange(1, lastColumn2).setValue(names.eligible);
    headers = getHeaders(sheet);
    columnMap = getColumnMap(headers);
  }

  return getColumnMap(getHeaders(sheet));
}

function clearDonationHistory(sheet, row, columnMap) {

  Object.keys(columnMap).forEach(function (header) {
    if (
      /^Donation \d+ Date$/.test(header) ||
      /^Donation \d+ Eligible Time$/.test(header)
    ) {
      sheet.getRange(row, columnMap[header]).clearContent();
    }
  });
}


/* ==========================================================
   RECORD BLOOD DONATION
========================================================== */

function recordDonation(payload) {

  if (!payload.hrs_id) {
    throw new Error('hrs_id is required');
  }

  if (!payload.donation_time) {
    throw new Error('donation_time is required');
  }

  var donationTime = toDate(payload.donation_time);

  if (!donationTime) {
    throw new Error('Invalid donation_time');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var row = findProfileRow(sheet, columnMap, payload.hrs_id);

  if (!row) {
    throw new Error('Profile not found');
  }

  var verificationStatusCol = requireColumn(columnMap, 'Verification Status');
  var donorConsentCol       = requireColumn(columnMap, 'Donor Consent');
  var verificationTimeCol   = requireColumn(columnMap, 'Verification Time');
  var donationCountCol      = requireColumn(columnMap, 'Blood Donation Count');
  var lastDonationCol       = requireColumn(columnMap, 'Last Donation Time');
  var nextEligibleCol       = requireColumn(columnMap, 'Next Eligible Time');
  var availabilityCol       = requireColumn(columnMap, 'Availability Status');
  var publicVisibilityCol   = requireColumn(columnMap, 'Public Directory Visibility');

  var verificationStatus = normalizeUpper(
    sheet.getRange(row, verificationStatusCol).getValue()
  );

  if (verificationStatus !== 'VERIFIED') {
    throw new Error('Pending profiles cannot record blood donations');
  }

  var donorConsent = normalizeUpper(
    sheet.getRange(row, donorConsentCol).getValue()
  );

  if (donorConsent !== 'YES') {
    throw new Error('This person has not consented to blood donation');
  }

  var verificationTime = toDate(
    sheet.getRange(row, verificationTimeCol).getValue()
  );

  if (
    !verificationTime ||
    donationTime.getTime() <= verificationTime.getTime()
  ) {
    throw new Error('Donation time must be after verification time');
  }

  var donationCount = Number(
    sheet.getRange(row, donationCountCol).getValue()
  );

  if (!donationCount || donationCount < 0) {
    donationCount = 0;
  }

  var existingNextEligible = toDate(
    sheet.getRange(row, nextEligibleCol).getValue()
  );

  // A subsequent donation cannot happen before eligibility
  if (
    donationCount > 0 &&
    existingNextEligible &&
    donationTime.getTime() < existingNextEligible.getTime()
  ) {
    throw new Error(
      'Person is not eligible yet. Next eligible time: ' +
      formatDateTime(existingNextEligible)
    );
  }

  var newDonationNumber = donationCount + 1;

  // Add new columns automatically when more than existing columns
  columnMap = ensureDonationColumns(sheet, newDonationNumber);

  var donationColumns  = getDonationColumnNames(newDonationNumber);
  var donationDateCol  = requireColumn(columnMap, donationColumns.date);
  var donationEligibleCol = requireColumn(columnMap, donationColumns.eligible);

  // Calculate next eligibility — the interval depends on the donor's gender
  // (90 days men / 120 days women). The Gender header is read defensively: a
  // renamed/missing column falls back to the male interval rather than
  // blocking the donation write path.
  var genderCol = columnMap['Gender'];
  var donorGender = genderCol
    ? sheet.getRange(row, genderCol).getValue()
    : '';
  var eligibilityDays = getEligibilityDays(donorGender);
  var nextEligibleTime = addDays(donationTime, eligibilityDays);

  // Save donation — timestamps written as IST wall-clock STRINGS (not Date
  // objects) so the CSV export carries the correct wall clock regardless of
  // the spreadsheet's own timezone.
  sheet.getRange(row, donationDateCol).setValue(formatDateTime(donationTime));
  sheet.getRange(row, donationEligibleCol).setValue(formatDateTime(nextEligibleTime));

  // Update summary columns
  sheet.getRange(row, donationCountCol).setValue(newDonationNumber);
  sheet.getRange(row, lastDonationCol).setValue(formatDateTime(donationTime));
  sheet.getRange(row, nextEligibleCol).setValue(formatDateTime(nextEligibleTime));

  // The person just donated, so they are unavailable
  sheet.getRange(row, availabilityCol).setValue('TEMPORARILY UNAVAILABLE');
  sheet.getRange(row, publicVisibilityCol).setValue('YES');

  SpreadsheetApp.flush();

  return {
    message: 'Blood donation recorded successfully',
    hrs_id: payload.hrs_id,
    blood_donation_count: newDonationNumber,
    donation_time: formatDateTime(donationTime),
    next_eligible_time: formatDateTime(nextEligibleTime),
    eligibility_days: eligibilityDays,
    gender: normalizeText(donorGender),
    availability_status: 'TEMPORARILY UNAVAILABLE'
  };
}


/* ==========================================================
   UPDATE AVAILABILITY
========================================================== */

function updateAvailability(payload) {

  if (!payload.hrs_id) {
    throw new Error('hrs_id is required');
  }

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var row = findProfileRow(sheet, columnMap, payload.hrs_id);

  if (!row) {
    throw new Error('Profile not found');
  }

  var verificationStatusCol = requireColumn(columnMap, 'Verification Status');
  var donorConsentCol       = requireColumn(columnMap, 'Donor Consent');
  var donationCountCol      = requireColumn(columnMap, 'Blood Donation Count');
  var nextEligibleCol       = requireColumn(columnMap, 'Next Eligible Time');
  var availabilityCol       = requireColumn(columnMap, 'Availability Status');
  var publicVisibilityCol   = requireColumn(columnMap, 'Public Directory Visibility');

  var verificationStatus = normalizeUpper(
    sheet.getRange(row, verificationStatusCol).getValue()
  );

  var donorConsent = normalizeUpper(
    sheet.getRange(row, donorConsentCol).getValue()
  );

  var availabilityStatus;
  var publicVisibility;

  if (verificationStatus !== 'VERIFIED') {

    availabilityStatus = 'PENDING VERIFICATION';
    publicVisibility = 'NO';

  } else if (donorConsent !== 'YES') {

    availabilityStatus = 'NOT PARTICIPATING';
    publicVisibility = 'NO';

  } else {

    var donationCount = Number(
      sheet.getRange(row, donationCountCol).getValue()
    ) || 0;

    var nextEligibleTime = toDate(
      sheet.getRange(row, nextEligibleCol).getValue()
    );

    if (donationCount === 0 || !nextEligibleTime) {

      availabilityStatus = 'AVAILABLE';

    } else if (nextEligibleTime.getTime() > new Date().getTime()) {

      availabilityStatus = 'TEMPORARILY UNAVAILABLE';

    } else {

      availabilityStatus = 'AVAILABLE';
    }

    publicVisibility = 'YES';
  }

  sheet.getRange(row, availabilityCol).setValue(availabilityStatus);
  sheet.getRange(row, publicVisibilityCol).setValue(publicVisibility);

  SpreadsheetApp.flush();

  return {
    hrs_id: payload.hrs_id,
    availability_status: availabilityStatus,
    public_directory_visibility: publicVisibility
  };
}


/* ==========================================================
   ASSIGN HRS-ID (auto-assigned IDs written back to sheet)
   The portal auto-assigns HRS-0001, HRS-0002, … to pending
   Google-Form rows that have no ID.  This handler writes the
   assigned ID into column A of the matching row.

   Matching: phone number (country-code-normalised) + registration
   time.  Idempotent — skips rows that already have an HRS ID.
========================================================== */

// Canonicalize a registration-time value into a timezone-independent string so
// that a Google Form timestamp cell (a real Date stored at its UTC epoch) can be
// matched against the wall-clock string the CSV export shows (e.g. "2026-09-10 23:51:34").
//
// Strategy: compare wall-clock strings rendered in the DATESHEET's own timezone.
//   - Date  -> Utilities.formatDate(date, ssTz, 'yyyy-MM-dd HH:mm:ss') renders the
//              same wall-clock the published CSV shows, regardless of the script's runtime tz.
//   - ISO string with T/Z/offset -> parse to epoch, re-render in ssTz.
//   - Naive "YYYY-MM-DD HH:MM:SS" string -> treated as the sheet-local wall clock
//              (that is exactly what the CSV export produces), kept verbatim.
// This removes all dependence on the Apps Script runtime timezone.
function normalizeTimeStr(value, ssTz) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return ssTz ? Utilities.formatDate(value, ssTz, 'yyyy-MM-dd HH:mm:ss') : value.toISOString();
  }
  var str = String(value).trim();
  if (!str) return '';
  // Naive wall clock already in sheet-local time -> keep as-is.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    var m = str.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(:\d{2})?$/);
    var sec = m[3] || ':00';
    return m[1] + ' ' + m[2] + sec;
  }
  // ISO / RFC3339 / offset-carrying string -> parse and re-render in sheet tz.
  var d = new Date(str);
  if (!isNaN(d.getTime())) {
    return ssTz ? Utilities.formatDate(d, ssTz, 'yyyy-MM-dd HH:mm:ss') : d.toISOString();
  }
  return str;
}

function assignHrsId(payload) {
  checkApiSecret(payload);

  var hrsId            = normalizeText(payload.hrs_id);
  var rawPhone         = normalizeText(payload.phone_number);
  var registrationTime = normalizeText(payload.registration_time);

  if (!hrsId)            throw new Error('hrs_id is required');
  if (!rawPhone)         throw new Error('phone_number is required for row matching');
  if (!registrationTime) throw new Error('registration_time is required for row matching');

  var sheet     = getProfilesSheet();
  var ssTz      = getSpreadsheet().getSpreadsheetTimeZone();
  var headers   = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var idCol    = requireColumn(columnMap, 'HRS ID');
  var phoneCol = requireColumn(columnMap, 'Phone Number');
  var timeCol  = columnMap['Registration Time'];  // may be absent

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Sheet has no data rows');

  // Read enough columns to cover HRS ID + Phone + Registration Time
  var maxCol = Math.max(idCol, phoneCol, timeCol || 1);
  var data   = sheet.getRange(2, 1, lastRow - 1, maxCol).getValues();

  var normInputPhone = rawPhone.replace(/^91/, '');
  var inputTime      = timeCol ? normalizeTimeStr(registrationTime, ssTz) : '';

  // Pass 1: locate rows whose phone matches (stripping the "91" country code).
  // Rows that already carry an HRS ID are skipped (idempotent); we remember them
  // so a repeated call for an already-written ID reports the truth.
  var candidates      = []; // { rowNum, sheetPhone, sheetTime }
  var alreadyAssigned = []; // { rowNum, existingId }

  for (var i = 0; i < data.length; i++) {
    var row    = data[i];
    var rowNum = i + 2;

    var existingId   = normalizeText(row[idCol - 1]);
    var sheetPhone   = normalizeText(row[phoneCol - 1]);
    var normSheetPhone = sheetPhone.replace(/^91/, '');
    if (normInputPhone !== normSheetPhone) continue;

    if (existingId) {
      alreadyAssigned.push({ rowNum: rowNum, existingId: existingId });
      continue;
    }
    candidates.push({
      rowNum:     rowNum,
      sheetPhone: sheetPhone,
      sheetTime:  timeCol ? normalizeTimeStr(row[timeCol - 1], ssTz) : ''
    });
  }

  // Idempotent re-call: the row for this phone already carries an HRS ID.
  if (candidates.length === 0 && alreadyAssigned.length > 0) {
    var done = alreadyAssigned[0];
    return {
      message: 'HRS ID ' + done.existingId + ' already assigned to row ' + done.rowNum,
      hrs_id:  hrsId
    };
  }

  if (candidates.length === 0) {
    console.log('[assign_hrs_id] No match for phone=' + rawPhone + ' time=' + registrationTime);
    return { message: 'No matching row found', hrs_id: hrsId };
  }

  // Pick the write target. Phones are unique per submission in this sheet, so a
  // single phone match is authoritative; the registration time is only needed to
  // disambiguate when several rows share the phone.
  var target       = null;
  var timeMismatch = '';
  if (candidates.length === 1) {
    target = candidates[0];
    if (target.sheetTime && inputTime && target.sheetTime !== inputTime) {
      timeMismatch = ' (registration time differed: got ' + inputTime + ', sheet ' + target.sheetTime + ')';
    }
  } else {
    var timeMatches = candidates.filter(function (c) {
      return !inputTime || !c.sheetTime || inputTime === c.sheetTime;
    });
    if (timeMatches.length === 1) target = timeMatches[0];
  }

  if (!target) {
    var msg = candidates.length > 1
      ? 'Multiple rows match this phone number; registration time did not disambiguate'
      : 'No matching row found';
    console.log('[assign_hrs_id] ' + msg + ' phone=' + rawPhone + ' time=' + registrationTime);
    return { message: msg, hrs_id: hrsId };
  }

  // --- Match found — write the HRS ID into column A ---
  sheet.getRange(target.rowNum, idCol).setValue(hrsId);
  SpreadsheetApp.flush();
  console.log('[assign_hrs_id] Wrote ' + hrsId + ' to row ' + target.rowNum
    + ' (phone ' + target.sheetPhone + ')' + timeMismatch);
  return { message: 'HRS ID ' + hrsId + ' written to row ' + target.rowNum, hrs_id: hrsId };
}


/* ==========================================================
   PUBLIC PROFILES
========================================================== */

function getPublicProfiles() {

  var profiles = getProfiles();

  return profiles
    .filter(function (profile) {
      return normalizeUpper(profile['Verification Status']) === 'VERIFIED';
    })
    .filter(function (profile) {
      return normalizeUpper(profile['Donor Consent']) === 'YES';
    })
    .map(function (profile) {
      return {
        'HRS ID':              profile['HRS ID'],
        'Full Name':           profile['Full Name'],
        'Date of Birth':       profile['Date of Birth'],
        'Gender':              profile['Gender'],
        'City':                profile['City'],
        'Area':                profile['Area'],
        'Blood Group':         profile['Blood Group'],
        'Availability Status': profile['Availability Status']
      };
    });
}


/* ==========================================================
   STATISTICS
========================================================== */

function getStatistics() {

  var profiles = getProfiles();

  var now = new Date();

  var totalRecords = profiles.length;
  var verifiedProfiles = 0;
  var pendingProfiles = 0;
  var voluntaryDonors = 0;
  var availableNow = 0;
  var temporarilyUnavailable = 0;
  var notParticipating = 0;

  var bloodGroups = {};
  var cities = {};
  var areas = {};
  var genders = {};

  VALID_BLOOD_GROUPS.forEach(function (group) {
    bloodGroups[group] = 0;
  });

  profiles.forEach(function (profile) {

    var verificationStatus = normalizeUpper(profile['Verification Status']);
    var donorConsent       = normalizeUpper(profile['Donor Consent']);
    var availability       = normalizeUpper(profile['Availability Status']);
    var bloodGroup         = normalizeUpper(profile['Blood Group']);
    var city               = normalizeText(profile['City']);
    var area               = normalizeText(profile['Area']);
    var gender             = normalizeText(profile['Gender']);

    if (verificationStatus === 'VERIFIED') {
      verifiedProfiles++;
    } else {
      pendingProfiles++;
    }

    if (verificationStatus === 'VERIFIED' && donorConsent === 'YES') {
      voluntaryDonors++;
    }

    if (availability === 'AVAILABLE') {
      availableNow++;
    }

    if (availability === 'TEMPORARILY UNAVAILABLE') {
      temporarilyUnavailable++;
    }

    if (availability === 'NOT PARTICIPATING') {
      notParticipating++;
    }

    if (verificationStatus === 'VERIFIED' && VALID_BLOOD_GROUPS.includes(bloodGroup)) {
      bloodGroups[bloodGroup]++;
    }

    if (city)  cities[city]   = (cities[city]   || 0) + 1;
    if (area)  areas[area]     = (areas[area]     || 0) + 1;
    if (gender) genders[gender] = (genders[gender] || 0) + 1;
  });

  return {
    generated_at: now.toISOString(),

    overview: {
      total_records: totalRecords,
      verified_profiles: verifiedProfiles,
      pending_profiles: pendingProfiles,
      voluntary_donors: voluntaryDonors,
      available_now: availableNow,
      temporarily_unavailable: temporarilyUnavailable,
      not_participating: notParticipating
    },

    percentages: {
      verified: totalRecords
        ? Number(((verifiedProfiles / totalRecords) * 100).toFixed(1))
        : 0,
      voluntary_donors: totalRecords
        ? Number(((voluntaryDonors / totalRecords) * 100).toFixed(1))
        : 0
    },

    blood_group_distribution: bloodGroups,
    city_distribution: cities,
    area_distribution: areas,
    gender_distribution: genders
  };
}


/* ==========================================================
   DAILY AVAILABILITY REFRESH
========================================================== */

function refreshAllAvailability() {

  var sheet = getProfilesSheet();
  var headers = getHeaders(sheet);
  var columnMap = getColumnMap(headers);

  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  var verificationStatusCol = requireColumn(columnMap, 'Verification Status');
  var donorConsentCol       = requireColumn(columnMap, 'Donor Consent');
  var donationCountCol      = requireColumn(columnMap, 'Blood Donation Count');
  var nextEligibleCol       = requireColumn(columnMap, 'Next Eligible Time');
  var availabilityCol       = requireColumn(columnMap, 'Availability Status');
  var publicVisibilityCol   = requireColumn(columnMap, 'Public Directory Visibility');

  var data = sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues();

  var now = new Date();

  var availabilityValues = [];
  var visibilityValues   = [];

  data.forEach(function (row) {

    var verificationStatus = normalizeUpper(row[verificationStatusCol - 1]);
    var donorConsent       = normalizeUpper(row[donorConsentCol - 1]);
    var donationCount      = Number(row[donationCountCol - 1]) || 0;
    var nextEligible       = toDate(row[nextEligibleCol - 1]);

    var availability;
    var visibility;

    if (verificationStatus !== 'VERIFIED') {
      availability = 'PENDING VERIFICATION';
      visibility = 'NO';
    } else if (donorConsent !== 'YES') {
      availability = 'NOT PARTICIPATING';
      visibility = 'NO';
    } else if (
      donationCount === 0 ||
      !nextEligible ||
      nextEligible.getTime() <= now.getTime()
    ) {
      availability = 'AVAILABLE';
      visibility = 'YES';
    } else {
      availability = 'TEMPORARILY UNAVAILABLE';
      visibility = 'YES';
    }

    availabilityValues.push([availability]);
    visibilityValues.push([visibility]);
  });

  sheet
    .getRange(2, availabilityCol, availabilityValues.length, 1)
    .setValues(availabilityValues);

  sheet
    .getRange(2, publicVisibilityCol, visibilityValues.length, 1)
    .setValues(visibilityValues);

  SpreadsheetApp.flush();

  return {
    success: true,
    updated_profiles: data.length
  };
}


/* ==========================================================
   OPTIONAL: CREATE DAILY TRIGGER
========================================================== */

function createDailyAvailabilityTrigger() {

  // Remove existing triggers for this function first
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refreshAllAvailability') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger('refreshAllAvailability')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();

  return 'Daily availability trigger created';
}


/* ==========================================================
   DELETE PROFILES
========================================================== */

function deleteProfiles(hrsIds) {
  var sheet = getProfilesSheet();
  var data  = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return { success: true, deleted: 0, message: 'No records to delete' };
  }

  var header = data[0];
  var idCol  = header.indexOf('HRS ID');

  if (idCol === -1) {
    throw new Error('HRS ID column not found');
  }

  var idsToDelete;
  try {
    idsToDelete = JSON.parse(hrsIds).map(function (id) {
      return String(id).trim();
    });
  } catch (e) {
    idsToDelete = String(hrsIds).split(',').map(function (id) {
      return String(id).trim();
    }).filter(function (id) { return id; });
  }

  var deleted = 0;

  for (var i = data.length - 1; i >= 1; i--) {
    var rowId = String(data[i][idCol] || '').trim();
    if (idsToDelete.indexOf(rowId) !== -1) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }

  return { success: true, deleted: deleted, message: deleted + ' record(s) deleted' };
}


/* ==========================================================
   RESET ALL PROFILES (DESTRUCTIVE)
   Clears every profile row from the Profiles sheet so the
   directory becomes empty (header only). New registrations
   submitted via the Google Form will start from HRS-0001.
   Uses clearContent() instead of deleteRows() to avoid the
   Google Sheets "cannot delete all non-frozen rows" error
   on consecutive resets.
   Requires the RESET_PASSWORD.
========================================================== */

function resetProfiles(payload) {
  checkApiSecret(payload);

  if (!payload.password || String(payload.password) !== RESET_PASSWORD) {
    throw new Error('Incorrect reset password');
  }

  var sheet = getProfilesSheet();
  var data  = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return { success: true, count: 0, message: 'No profiles to reset' };
  }

  var header = data[0];
  var count  = data.length - 1;

  // Clear all data cells (keeps the header row intact).
  // clearContent() is used instead of deleteRows() because deleting ALL
  // non-frozen rows is rejected by Google Sheets when a frozen row exists.
  sheet.getRange(2, 1, count, header.length).clearContent();
  SpreadsheetApp.flush();

  return {
    success: true,
    count: count,
    message: count + ' profile(s) erased. New registrations start from HRS-0001.'
  };
}


/* ==========================================================
   ASSIGN HRS IDS TO PENDING RECORDS
========================================================== */

function assignHrsIdsToPendingRecords() {
  var sheet = getProfilesSheet();
  var data  = sheet.getDataRange().getValues();

  if (data.length < 2) {
    Logger.log('No records found');
    return;
  }

  var header = data[0];
  var idCol  = header.indexOf('HRS ID');

  if (idCol === -1) {
    Logger.log('HRS ID column not found');
    return;
  }

  var maxNum = 0;
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][idCol] || '').trim();
    var match = id.match(/HRS-0*(\d+)/);
    if (match && parseInt(match[1]) > maxNum) {
      maxNum = parseInt(match[1]);
    }
  }

  var assigned = 0;
  for (var j = 1; j < data.length; j++) {
    var currentId = String(data[j][idCol] || '').trim();
    if (!currentId) {
      maxNum++;
      var nextId = 'HRS-' + String(maxNum).padStart(4, '0');
      sheet.getRange(j + 1, idCol + 1).setValue(nextId);
      assigned++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log('Assigned ' + assigned + ' new HRS IDs. Next ID: HRS-' + String(maxNum + 1).padStart(4, '0'));
}
