-- ============================================================
-- Minuta — Full Database Migration
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- 1. projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users not null,
  created_at timestamptz default now()
);

create index idx_projects_owner_id on projects(owner_id);
alter table projects enable row level security;

create policy "users see own projects" on projects for select using (auth.uid() = owner_id);
create policy "users insert own projects" on projects for insert with check (auth.uid() = owner_id);
create policy "users update own projects" on projects for update using (auth.uid() = owner_id);
create policy "users delete own projects" on projects for delete using (auth.uid() = owner_id);

-- 2. meetings
create table meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  file_name text not null,
  raw_text text not null,
  meeting_date date,
  speaker_count int,
  word_count int,
  summary jsonb,
  processing_status text default 'pending' check (
    processing_status in ('pending', 'processing', 'complete', 'failed')
  ),
  processing_error text,
  created_at timestamptz default now()
);

alter table meetings enable row level security;
create policy "users see own meetings" on meetings for select using (
  exists (
    select 1 from projects
    where projects.id = meetings.project_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users insert own meetings" on meetings for insert with check (
  exists (
    select 1 from projects
    where projects.id = meetings.project_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users update own meetings" on meetings for update using (
  exists (select 1 from projects where projects.id = meetings.project_id and projects.owner_id = auth.uid())
);
create policy "users delete own meetings" on meetings for delete using (
  exists (select 1 from projects where projects.id = meetings.project_id and projects.owner_id = auth.uid())
);

-- 3. extractions
create table extractions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  type text not null check (type in ('decision', 'action_item')),
  description text not null,
  owner text,
  due_date text,
  urgency text check (urgency in ('Immediate', 'This Week', 'Low Priority', 'No Action')),
  context text,
  related_topic text,
  status text default 'Pending' check (status in ('Pending', 'In Progress', 'Done')),
  verified boolean default false,
  supporting_quote text,
  quote_location text,
  superseded_by uuid references extractions(id),
  created_at timestamptz default now()
);

alter table extractions enable row level security;
create policy "users see own extractions" on extractions for select using (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = extractions.meeting_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users insert own extractions" on extractions for insert with check (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = extractions.meeting_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users update own extractions" on extractions for update using (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = extractions.meeting_id
    and projects.owner_id = auth.uid()
  )
);

-- 4. sentiment_segments
create table sentiment_segments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  segment_index int not null,
  speaker text,
  text_excerpt text,
  sentiment_label text check (
    sentiment_label in ('positive', 'neutral', 'conflict', 'frustrated', 'uncertain', 'enthusiastic')
  ),
  sentiment_score float,
  start_time text,
  created_at timestamptz default now()
);

alter table sentiment_segments enable row level security;
create policy "users see own sentiment" on sentiment_segments for select using (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = sentiment_segments.meeting_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users insert own sentiment" on sentiment_segments for insert with check (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = sentiment_segments.meeting_id
    and projects.owner_id = auth.uid()
  )
);

-- 5. chat_messages
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

alter table chat_messages enable row level security;
create policy "users see own chat" on chat_messages for select using (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = chat_messages.meeting_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users insert own chat" on chat_messages for insert with check (
  exists (
    select 1 from meetings
    join projects on projects.id = meetings.project_id
    where meetings.id = chat_messages.meeting_id
    and projects.owner_id = auth.uid()
  )
);

-- 6. issues
create table issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  title text not null,
  description text,
  status text check (status in ('open', 'in_progress', 'resolved', 'obsolete')),
  opened_in uuid references meetings(id),
  resolved_in uuid references meetings(id),
  obsoleted_in uuid references meetings(id),
  created_at timestamptz default now()
);

alter table issues enable row level security;
create policy "users see own issues" on issues for select using (
  exists (select 1 from projects where projects.id = issues.project_id and projects.owner_id = auth.uid())
);
create policy "users insert own issues" on issues for insert with check (
  exists (select 1 from projects where projects.id = issues.project_id and projects.owner_id = auth.uid())
);
create policy "users update own issues" on issues for update using (
  exists (select 1 from projects where projects.id = issues.project_id and projects.owner_id = auth.uid())
);

-- 7. issue_mentions
create table issue_mentions (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references issues(id) on delete cascade not null,
  meeting_id uuid references meetings(id) on delete cascade not null,
  mention_type text check (
    mention_type in ('raised', 'discussed', 'escalated', 'resolved', 'obsoleted', 'reopened')
  ),
  context text,
  supporting_quote text,
  created_at timestamptz default now()
);

alter table issue_mentions enable row level security;
create policy "users see own issue mentions" on issue_mentions for select using (
  exists (
    select 1 from issues
    join projects on projects.id = issues.project_id
    where issues.id = issue_mentions.issue_id
    and projects.owner_id = auth.uid()
  )
);
create policy "users insert own issue mentions" on issue_mentions for insert with check (
  exists (
    select 1 from issues
    join projects on projects.id = issues.project_id
    where issues.id = issue_mentions.issue_id
    and projects.owner_id = auth.uid()
  )
);
