-- =============================================================================
-- Supabase Schema & Row-Level Security (RLS) for Cloud Saves
--
-- This schema defines the user-scoped cloud_saves table.
-- Authentication is handled by Supabase Auth (auth.uid()).
--
-- Security Model:
-- - Row-Level Security is strictly ENABLED on public.cloud_saves.
-- - Anon / Authenticated users can ONLY select, insert, update, or delete
--   their own save records where user_id = auth.uid().
-- - Users CANNOT read, overwrite, or delete saves belonging to other users.
-- - No service_role key is required or permitted for client operations.
-- =============================================================================

-- Ensure UUID extension is available
create extension if not exists "uuid-ossp";

-- Cloud Saves Table
create table if not exists public.cloud_saves (
    id uuid default gen_random_uuid() primary key,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    slot_id text not null,
    name text,
    description text,
    data text not null,
    checksum text,
    version integer not null default 1,
    size_bytes integer,
    metadata jsonb default '{}'::jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

    -- Ensure a user has at most one record per slot_id
    constraint cloud_saves_user_slot_unique unique (user_id, slot_id)
);

-- Enable Row-Level Security
alter table public.cloud_saves enable row level security;

-- Force RLS even for table owners (best practice for defense-in-depth)
alter table public.cloud_saves force row level security;

-- Fast user-scoped lookups
create index if not exists idx_cloud_saves_user_id on public.cloud_saves(user_id);
create index if not exists idx_cloud_saves_user_slot on public.cloud_saves(user_id, slot_id);

-- RLS Policies: User-scoped isolation via auth.uid()
-- Drop first so this schema file can be applied repeatedly in local projects.

drop policy if exists "Users can view own cloud saves" on public.cloud_saves;
drop policy if exists "Users can insert own cloud saves" on public.cloud_saves;
drop policy if exists "Users can update own cloud saves" on public.cloud_saves;
drop policy if exists "Users can delete own cloud saves" on public.cloud_saves;

-- 1. SELECT: Users can only read their own cloud saves
create policy "Users can view own cloud saves"
    on public.cloud_saves
    for select
    to authenticated
    using (auth.uid() = user_id);

-- 2. INSERT: Users can only insert cloud saves for themselves
create policy "Users can insert own cloud saves"
    on public.cloud_saves
    for insert
    to authenticated
    with check (auth.uid() = user_id);

-- 3. UPDATE: Users can only update their own cloud saves
create policy "Users can update own cloud saves"
    on public.cloud_saves
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 4. DELETE: Users can only delete their own cloud saves
create policy "Users can delete own cloud saves"
    on public.cloud_saves
    for delete
    to authenticated
    using (auth.uid() = user_id);

-- Trigger to automatically update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_cloud_saves_updated_at on public.cloud_saves;
create trigger set_cloud_saves_updated_at
    before update on public.cloud_saves
    for each row
    execute function public.handle_updated_at();
