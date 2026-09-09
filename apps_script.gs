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
const API_SECRET = 'hrs_9Kx72pLm_YourVeryLongSecret_2026';

const ELIGIBILITY_DAYS = 90;

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

  const date = new Date(value);

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

  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd HH:mm:ss"
  );
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
        result = { success: true, message: 'Email step skipped (no handler)' };
        meta = {
          actionType: 'PROFILE_EMAIL',
          action: 'Sent verification email',
          targetId: payload.hrs_id
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
   Volunteer sheet columns: Full Name, Username, Password
========================================================== */

function createVolunteer(params) {
  checkApiSecret(params);

  var username = normalizeText(params.username);
  var fullName = normalizeText(params.full_name);
  var passwordHash = normalizeText(params.password_hash);

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
    sheet.appendRow(['Full Name', 'Username', 'Password']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  // Duplicate-username guard (case-insensitive) before appending.
  var existing = sheet.getDataRange().getValues();
  for (var r = 1; r < existing.length; r++) {
    var existingName = normalizeText(String(existing[r][1]));
    if (existingName !== '' && existingName.toLowerCase() === username.toLowerCase()) {
      throw new Error('Username already exists: ' + username);
    }
  }

  sheet.appendRow([fullName, username, passwordHash]);
  SpreadsheetApp.flush();

  console.log('[create_volunteer] ' + username + ' (' + fullName + ') added');
  return { success: true, username: username, full_name: fullName };
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

  // Verification
  sheet.getRange(row, verificationStatusCol).setValue('VERIFIED');
  sheet.getRange(row, verificationTimeCol).setValue(now);

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

  // Calculate next eligibility
  var nextEligibleTime = addDays(donationTime, ELIGIBILITY_DAYS);

  // Save donation
  sheet.getRange(row, donationDateCol).setValue(donationTime);
  sheet.getRange(row, donationEligibleCol).setValue(nextEligibleTime);

  // Update summary columns
  sheet.getRange(row, donationCountCol).setValue(newDonationNumber);
  sheet.getRange(row, lastDonationCol).setValue(donationTime);
  sheet.getRange(row, nextEligibleCol).setValue(nextEligibleTime);

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
      var nextId = 'HRS-' + String(maxNum).padStart(5, '0');
      sheet.getRange(j + 1, idCol + 1).setValue(nextId);
      assigned++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log('Assigned ' + assigned + ' new HRS IDs. Next ID: HRS-' + String(maxNum + 1).padStart(5, '0'));
}
