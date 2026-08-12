-- Metadata index only. Message/attachment content lives in each user's own
-- Google Drive (see src/services/drive.js); this database never holds a
-- permanent copy of it. pending_sync_messages is a short-lived buffer, not
-- an archive.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_id text unique not null,
  email text unique not null,
  display_name text,
  avatar_url text,
  drive_folder_id text,
  refresh_token_encrypted text,
  is_online boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references users(id),
  user_b_id uuid not null references users(id),
  user_a_drive_file_id text,
  user_b_drive_file_id text,
  last_message_preview text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);

create table if not exists pending_sync_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  sender_id uuid not null references users(id),
  content text,
  message_type text not null default 'text' check (message_type in ('text', 'file')),
  file_drive_id text,
  synced_to_a boolean not null default false,
  synced_to_b boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_a on conversations(user_a_id);
create index if not exists idx_conversations_user_b on conversations(user_b_id);
create index if not exists idx_pending_sync_conversation on pending_sync_messages(conversation_id);
create index if not exists idx_pending_sync_unsynced
  on pending_sync_messages(created_at)
  where not synced_to_a or not synced_to_b;
