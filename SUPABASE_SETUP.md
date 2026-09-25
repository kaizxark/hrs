# Supabase Setup Guide for HRS Migration

## Step 1: Create Supabase Account
1. Go to [https://supabase.com](https://supabase.com)
2. Sign up for a free account (GitHub, email, or other providers)
3. Verify your email if required

## Step 2: Create New Project
1. Click "New Project" on your Supabase dashboard
2. Fill in project details:
   - **Name**: `hrs-camp-test` (or similar)
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users (likely Mumbai/Asia for IST timezone)
3. Click "Create new project"
4. Wait for project to be provisioned (may take 1-2 minutes)

## Step 3: Get Connection Credentials
1. Once project is ready, go to **Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://[project-id].supabase.co`
   - **anon public key**: (for client-side)
   - **service_role key**: (for server-side/migration - **KEEP SECRET**)

## Step 4: Enable Required Extensions
1. Go to **Database** → **Extensions**
2. Enable these extensions (click the toggle):
   - `uuid-ossp` (for UUID generation)

## Step 5: Run Database Schema
1. Go to **SQL Editor**
2. Create a new query
3. Copy and paste the contents of `supabase/schema.sql`
4. Click "Run" to create tables

## Step 6: Set Environment Variables
Create/update your `.env` file with:
```
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[your-service-role-key]
SUPABASE_ANON_KEY=[your-anon-key]
DATABASE_URL="postgresql://postgres:[password]@db.[project-id].supabase.co:5432/postgres"
```

Note: For the DATABASE_URL, you need to:
1. Go to Settings → Database
2. Connection string → URI format
3. Copy the connection string and replace `[YOUR-PASSWORD]` with the database password you set when creating the project

## Step 7: Test Connection
Run this command to test:
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('profiles').select('count').then(console.log).catch(console.error);
"
```

## Step 8: Migration Process
1. Ensure your Google Sheets CSV is publicly accessible
2. Run the migration script:
   ```bash
   node supabase/migrate.js
   ```
3. Verify data was migrated correctly by checking the Supabase table editor

## Important Notes:
- Keep your service_role key secure - it has full access to your database
- The anon key is safe to expose in client-side code
- For production, consider setting up Row Level Security (RLS) policies properly
- Test thoroughly before switching the app to use Supabase as primary