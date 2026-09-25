-- Supabase schema for HRS Blood Donor Portal
-- This schema mirrors the Google Sheets structure for donor profiles

-- Enable UUID extension if needed
create extension if not exists "uuid-ossp";

-- Profiles table (mirrors Google Sheets Profiles tab)
create table public.profiles (
    id uuid primary key default uuid_generate_v4(),
    "HRS ID" text unique not null,
    "Full Name" text not null,
    "Date of Birth" date,
    Gender text,
    "Phone Number" text,
    Email text,
    City text,
    Area text,
    "Registration Time" timestamp with time zone,
    "Blood Group" text,
    "Blood Group Status" text,
    "Data Storage Consent" text,
    "Donor Consent" text,
    "Verification Status" text,
    "Verification Time" timestamp with time zone,
    "Blood Donation Count" integer default 0,
    "Last Donation Time" timestamp with time zone,
    "Next Eligible Time" timestamp with time zone,
    "Availability Status" text,
    "Public Directory Visibility" text,
    -- Individual donation tracking (normalized would be better but keeping sheet structure)
    "Donation 1 Date" timestamp with time zone,
    "Donation 1 Eligible Time" timestamp with time zone,
    "Donation 2 Date" timestamp with time zone,
    "Donation 2 Eligible Time" timestamp with time zone,
    "Donation 3 Date" timestamp with time zone,
    "Donation 3 Eligible Time" timestamp with time zone,
    "Donation 4 Date" timestamp with time zone,
    "Donation 4 Eligible Time" timestamp with time zone,
    "Donation 5 Date" timestamp with time zone,
    "Donation 5 Eligible Time" timestamp with time zone,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- Indexes for common queries
create index idx_problems_hrs_id on public.profiles("HRS ID");
create index idx_problems_city on public.profiles(City);
create index idx_problems_blood_group on public.profiles("Blood Group");
create index idx_problems_verification on public.profiles("Verification Status");
create index idx_problems_availability on public.profiles("Availability Status");

-- Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- Public (anon) reads are restricted to rows that already qualify for the
-- public directory. Full records — pending profiles, hidden profiles, and
-- contact details — are only reachable server-side with the service-role key.
-- Previously this table was both publicly readable and anon-writable
-- (using/with check = true), which allowed anyone holding the anon key to read
-- every donor's phone/email and to modify or delete the directory.
create policy "Public directory rows are readable"
    on public.profiles for select
    to anon
    using (
        "Public Directory Visibility" = 'YES'
        and "Verification Status" = 'Verified'
        and "Donor Consent" = 'YES'
    );

-- No anon insert/update/delete policies: all writes happen through the server's
-- service-role client, which bypasses RLS by design.

-- Staff table (mirrors Google Sheets Volunteer/Admin tabs)
create table public.staff (
    id uuid primary key default uuid_generate_v4(),
    username text unique not null,
    password_hash text not null,  -- scrypt hashed password
    display_name text not null,
    role text check (role in ('admin', 'volunteer')) default 'volunteer',
    active boolean default true,
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now()
);

-- Indexes for staff
create index idx_staff_username on public.staff(username);
create index idx_staff_active on public.staff(active);

-- Enable RLS for staff
alter table public.staff enable row level security;

-- Staff rows are never read directly by the browser — all staff access goes
-- through the tRPC server (service-role key) — so no anon/authenticated policy
-- is defined. RLS therefore denies everyone except the service role.
-- The previous policies matched `auth.uid()` against public.staff.id, but this
-- app does not use Supabase Auth, so the subquery could never succeed.

-- Audit logs table
create table public.audit_logs (
    id uuid primary key default uuid_generate_v4(),
    action text not null,
    action_label text not null,
    actor_id uuid references public.staff(id) on delete set null,
    actor_open_id text,
    actor_name text,
    actor_role text check (actor_role in ('user', 'admin', 'volunteer')),
    target_type text,
    target_id text,
    details jsonb,
    success boolean default true,
    ip_address text,
    created_at timestamp with time zone default now()
);

-- Indexes for audit logs
create index idx_audit_logs_action on public.audit_logs(action);
create index idx_audit_logs_created_at on public.audit_logs(created_at);
create index idx_audit_logs_actor_id on public.audit_logs(actor_id);

-- Enable RLS for audit logs
alter table public.audit_logs enable row level security;

-- Audit logs are written and read server-side only (service role). No client
-- policy is defined, so RLS denies anon/authenticated access to the trail.

-- Users table for OAuth authentication (existing from MySQL migration)
create table public.users (
    id uuid primary key default uuid_generate_v4(),
    open_id text unique not null,
    name text,
    email text,
    login_method text,
    role text check (role in ('user', 'admin')) default 'user',
    created_at timestamp with time zone default now(),
    updated_at timestamp with time zone default now(),
    last_signed_in timestamp with time zone default now()
);

-- Indexes for users
create index idx_users_open_id on public.users(open_id);
create index idx_users_role on public.users(role);

-- Enable RLS for users
alter table public.users enable row level security;

-- The users table backs the OAuth flow and is only touched server-side
-- (service role). No client policy is defined.

-- updated_at trigger helper. Must be defined BEFORE the triggers that use it,
-- and the assignment needs dynamic SQL — `new.[col_name]` is not valid PL/pgSQL
-- (it was `new.[col_name] = now()` previously, which fails to compile).
create or replace function public.moddatetime(col_name text)
returns trigger as $$
begin
    execute format('new.%I = now()', col_name);
    return new;
end;
$$ language plpgsql;

-- Trigger to update updated_at column
create trigger update_profiles_updated_at
    before update on public.profiles
    for each row
    execute function public.moddatetime('updated_at');

create trigger update_staff_updated_at
    before update on public.staff
    for each row
    execute function public.moddatetime('updated_at');

create trigger update_users_updated_at
    before update on public.users
    for each row
    execute function public.moddatetime('updated_at');

-- Grants: anon may SELECT the public directory only (RLS still filters rows);
-- the service role (used by the server) gets full access and bypasses RLS.
grant usage on schema public to anon, service_role;
grant select on public.profiles to anon;
grant all on all tables in schema public to service_role;