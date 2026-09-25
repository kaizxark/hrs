import { createClient } from '@supabase/supabase-js';
import { parse } from 'node:csv-parser';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

// Initialize Supabase client with service role for bypassing RLS during migration
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Google Sheets CSV URL (public export)
const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTI9MNntfRcNQsCJCPBhNIbsc-ZCh5kqw28-x7Aa3kfeUwBCXDd7TPAt2pb6ag8HWdwkcpgsqeSKQmF/pub?output=csv';

// Pipeline helper
const pipelinePromise = promisify(pipeline);

async function migrateProfiles() {
  console.log('Starting profile migration from Google Sheets to Supabase...');
  
  // Fetch CSV data
  const response = await fetch(GOOGLE_SHEETS_CSV_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
  }
  
  const csvStream = response.body;
  if (!csvStream) {
    throw new Error('No response body from CSV fetch');
  }
  
  let count = 0;
  let errorCount = 0;
  
  // Parse CSV and insert rows
  await pipelinePromise(
    csvStream,
    parse({ columns: true, trim: true }),
    new Transform({
      objectMode: true,
      async transform(row, encoding, callback) {
        try {
          // Map Google Sheets columns to Supabase profile columns
          const profile = {
            'HRS ID': row['HRS ID'] || null,
            'Full Name': row['Full Name'] || null,
            'Date of Birth': row['Date of Birth'] ? new Date(row['Date of Birth']) : null,
            Gender: row['Gender'] || null,
            'Phone Number': row['Phone Number'] || null,
            Email: row['Email'] || null,
            City: row['City'] || null,
            Area: row['Area'] || null,
            'Registration Time': row['Registration Time'] ? new Date(row['Registration Time']) : null,
            'Blood Group': row['Blood Group'] || null,
            'Blood Group Status': row['Blood Group Status'] || null,
            'Data Storage Consent': row['Data Storage Consent'] || null,
            'Donor Consent': row['Donor Consent'] || null,
            'Verification Status': row['Verification Status'] || null,
            'Verification Time': row['Verification Time'] ? new Date(row['Verification Time']) : null,
            'Blood Donation Count': parseInt(row['Blood Donation Count'] || '0', 10) || 0,
            'Last Donation Time': row['Last Donation Time'] ? new Date(row['Last Donation Time']) : null,
            'Next Eligible Time': row['Next Eligible Time'] ? new Date(row['Next Eligible Time']) : null,
            'Availability Status': row['Availability Status'] || null,
            'Public Directory Visibility': row['Public Directory Visibility'] || null,
            'Donation 1 Date': row['Donation 1 Date'] ? new Date(row['Donation 1 Date']) : null,
            'Donation 1 Eligible Time': row['Donation 1 Eligible Time'] ? new Date(row['Donation 1 Eligible Time']) : null,
            'Donation 2 Date': row['Donation 2 Date'] ? new Date(row['Donation 2 Date']) : null,
            'Donation 2 Eligible Time': row['Donation 2 Eligible Time'] ? new Date(row['Donation 2 Eligible Time']) : null,
            'Donation 3 Date': row['Donation 3 Date'] ? new Date(row['Donation 3 Date']) : null,
            'Donation 3 Eligible Time': row['Donation 3 Eligible Time'] ? new Date(row['Donation 3 Eligible Time']) : null,
            'Donation 4 Date': row['Donation 4 Date'] ? new Date(row['Donation 4 Date']) : null,
            'Donation 4 Eligible Time': row['Donation 4 Eligible Time'] ? new Date(row['Donation 4 Eligible Time']) : null,
            'Donation 5 Date': row['Donation 5 Date'] ? new Date(row['Donation 5 Date']) : null,
            'Donation 5 Eligible Time': row['Donation 5 Eligible Time'] ? new Date(row['Donation 5 Eligible Time']) : null,
          };
          
          // Insert into Supabase
          const { error } = await supabase
            .from('profiles')
            .insert(profile);
          
          if (error) {
            console.error(`Error inserting profile ${profile['HRS ID']}:`, error);
            errorCount++;
          } else {
            count++;
            if (count % 10 === 0) {
              console.log(`Inserted ${count} profiles...`);
            }
          }
          
          callback();
        } catch (err) {
          console.error('Error processing row:', err);
          errorCount++;
          callback(err);
        }
      }
    })
  );
  
  console.log(`Migration complete! Inserted: ${count}, Errors: ${errorCount}`);
  
  if (errorCount > 0) {
    console.warn('Some rows failed to insert. Check logs above.');
    process.exit(1);
  } else {
    console.log('All profiles migrated successfully!');
  }
}

// Transform stream class (Node.js v16.6+ compatible)
class Transform extends require('stream').Transform {
  constructor(opts) {
    super(opts);
  }
}

// Run migration
migrateProfiles().catch(console.error);