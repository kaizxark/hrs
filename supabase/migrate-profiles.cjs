// Migration script: Google Sheets CSV -> Supabase profiles table
// Usage: node supabase/migrate-profiles.cjs

const dotenv = require('dotenv');
dotenv.config();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GOOGLE_SHEETS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTI9MNntfRcNQsCJCPBhNIbsc-ZCh5kqw28-x7Aa3kfeUwBCXDd7TPAt2pb6ag8HWdwkcpgsqeSKQmF/pub?output=csv';

// Simple CSV parser that handles quoted fields
function parseCSV(text) {
  const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines.length === 0) return [];

  const parseLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

// Parse a date string, return ISO string or null
function parseDate(str) {
  if (!str || str.trim() === '') return null;
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Parse an integer, return number or 0
function parseInt2(str) {
  const n = parseInt(str || '0', 10);
  return isNaN(n) ? 0 : n;
}

async function migrate() {
  console.log('Fetching CSV from Google Sheets...');
  const resp = await fetch(GOOGLE_SHEETS_CSV_URL, { redirect: 'follow' });
  if (!resp.ok) {
    throw new Error('Failed to fetch CSV: ' + resp.status + ' ' + resp.statusText);
  }
  const text = await resp.text();
  console.log('CSV fetched, length:', text.length, 'bytes');

  const rows = parseCSV(text);
  console.log('Parsed', rows.length, 'rows from CSV');

  if (rows.length === 0) {
    console.log('No rows to migrate.');
    return;
  }

  // Show first row for debugging
  console.log('First row keys:', Object.keys(rows[0]));
  console.log('First row HRS ID:', rows[0]['HRS ID']);

  // Clear existing profiles (optional — comment out to append)
  console.log('Clearing existing profiles...');
  const { error: deleteError } = await supabase
    .from('profiles')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
  if (deleteError) {
    console.warn('Delete error (may be ok if table was empty):', deleteError.message);
  }

  // Insert in batches of 50
  const BATCH_SIZE = 50;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const profiles = batch.map(row => ({
      'HRS ID': row['HRS ID'] || null,
      'Full Name': row['Full Name'] || null,
      'Date of Birth': parseDate(row['Date of Birth']),
      'gender': row['Gender'] || null,
      'Phone Number': row['Phone Number'] || null,
      'email': row['Email'] || null,
      'city': row['City'] || null,
      'area': row['Area'] || null,
      'Registration Time': parseDate(row['Registration Time']),
      'Blood Group': row['Blood Group'] || null,
      'Blood Group Status': row['Blood Group Status'] || null,
      'Data Storage Consent': row['Data Storage Consent'] || null,
      'Donor Consent': row['Donor Consent'] || null,
      'Verification Status': row['Verification Status'] || null,
      'Verification Time': parseDate(row['Verification Time']),
      'Blood Donation Count': parseInt2(row['Blood Donation Count']),
      'Last Donation Time': parseDate(row['Last Donation Time']),
      'Next Eligible Time': parseDate(row['Next Eligible Time']),
      'Availability Status': row['Availability Status'] || null,
      'Public Directory Visibility': row['Public Directory Visibility'] || null,
      'Donation 1 Date': parseDate(row['Donation 1 Date']),
      'Donation 1 Eligible Time': parseDate(row['Donation 1 Eligible Time']),
      'Donation 2 Date': parseDate(row['Donation 2 Date']),
      'Donation 2 Eligible Time': parseDate(row['Donation 2 Eligible Time']),
      'Donation 3 Date': parseDate(row['Donation 3 Date']),
      'Donation 3 Eligible Time': parseDate(row['Donation 3 Eligible Time']),
      'Donation 4 Date': parseDate(row['Donation 4 Date']),
      'Donation 4 Eligible Time': parseDate(row['Donation 4 Eligible Time']),
      'Donation 5 Date': parseDate(row['Donation 5 Date']),
      'Donation 5 Eligible Time': parseDate(row['Donation 5 Eligible Time']),
    }));

    // Filter out rows with no HRS ID (empty rows)
    const validProfiles = profiles.filter(p => p['HRS ID']);

    if (validProfiles.length === 0) continue;

    const { data, error } = await supabase
      .from('profiles')
      .insert(validProfiles);

    if (error) {
      console.error('Batch insert error at row', i, ':', error.message);
      errors += validProfiles.length;
    } else {
      inserted += validProfiles.length;
      console.log('Inserted batch:', i, '-', i + validProfiles.length - 1,
        '(' + inserted + '/' + rows.length + ')');
    }
  }

  console.log('');
  console.log('=== Migration Complete ===');
  console.log('Total CSV rows:', rows.length);
  console.log('Inserted:', inserted);
  console.log('Errors:', errors);

  // Verify count in database
  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true });
  console.log('Final database count:', count);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});