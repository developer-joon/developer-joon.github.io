create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint not null unique,
  login text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_github_user_id_check check (github_user_id > 0),
  constraint profiles_login_check check (char_length(btrim(login)) between 1 and 39),
  constraint profiles_display_name_check check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  constraint profiles_timestamps_check check (updated_at >= created_at)
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'member',
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id) on delete set null,
  constraint user_roles_role_check check (role in ('member', 'admin'))
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  body_markdown text not null,
  status text not null default 'published',
  is_locked boolean not null default false,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_title_length_check check (char_length(btrim(title)) between 2 and 120),
  constraint posts_body_length_check check (char_length(btrim(body_markdown)) between 1 and 50000),
  constraint posts_status_check check (status in ('published', 'hidden', 'deleted')),
  constraint posts_deleted_state_check check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  ),
  constraint posts_timestamps_check check (
    updated_at >= created_at and (deleted_at is null or deleted_at >= created_at)
  )
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  parent_id uuid,
  body_markdown text not null,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comments_id_post_id_key unique (id, post_id),
  constraint comments_parent_id_post_id_fkey
    foreign key (parent_id, post_id)
    references public.comments(id, post_id)
    on delete cascade,
  constraint comments_body_length_check check (char_length(btrim(body_markdown)) between 1 and 5000),
  constraint comments_status_check check (status in ('published', 'hidden', 'deleted')),
  constraint comments_deleted_state_check check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  ),
  constraint comments_timestamps_check check (
    updated_at >= created_at and (deleted_at is null or deleted_at >= created_at)
  ),
  constraint comments_not_self_parent_check check (parent_id is null or parent_id <> id)
);

create function public.enforce_top_level_comment_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_parent_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.post_id is distinct from old.post_id
       or new.parent_id is distinct from old.parent_id then
      raise exception 'comment relationship keys are immutable'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.parent_id is null then
    return new;
  end if;

  select c.parent_id
    into parent_parent_id
    from public.comments as c
   where c.id = new.parent_id
     and c.post_id = new.post_id;

  if found and parent_parent_id is not null then
    raise exception 'comment parent must be a top-level comment'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger comments_enforce_top_level_parent
before insert or update of parent_id, post_id on public.comments
for each row execute function public.enforce_top_level_comment_parent();

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  constraint tags_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint tags_label_check check (char_length(btrim(label)) between 1 and 50),
  constraint tags_sort_order_check check (sort_order >= 0)
);

create table public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

create function public.enforce_post_tag_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing_tag_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.post_id is distinct from old.post_id
       or new.tag_id is distinct from old.tag_id then
      raise exception 'post tag relationship keys are immutable'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- The count is safe only at effective READ COMMITTED: after this per-post
  -- transaction lock is acquired, the following statement-level snapshot sees
  -- a prior writer's commit. Stronger transaction snapshots are unsupported.
  -- Relationship changes are DELETE + INSERT: DELETE frees the old slot, and
  -- the replacement INSERT revalidates isolation, tag activity, and the limit.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'post_tags INSERT requires READ COMMITTED isolation'
      using errcode = '0A000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('post-tags:' || new.post_id::text, 0)
  );

  if not exists (
    select 1 from public.tags as t where t.id = new.tag_id and t.is_active
  ) then
    raise exception 'post tags must reference an active tag'
      using errcode = '23514';
  end if;

  select count(*)
    into existing_tag_count
    from public.post_tags as pt
   where pt.post_id = new.post_id;

  if existing_tag_count >= 3 then
    raise exception 'a post may have at most 3 tags'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger post_tags_enforce_limit
before insert or update of post_id, tag_id on public.post_tags
for each row execute function public.enforce_post_tag_limit();

create table public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create table public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  comment_id uuid not null references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, comment_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  storage_path text not null unique,
  mime_type text not null,
  byte_size bigint not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  deleted_at timestamptz,
  constraint attachments_storage_path_check check (char_length(btrim(storage_path)) between 1 and 1024),
  constraint attachments_mime_type_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint attachments_byte_size_check check (byte_size between 1 and 5242880),
  constraint attachments_status_check check (status in ('pending', 'attached', 'quarantined', 'deleted')),
  constraint attachments_state_check check (
    (status = 'pending' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status = 'quarantined' and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  constraint attachments_timestamps_check check (
    (attached_at is null or attached_at >= created_at)
    and (deleted_at is null or deleted_at >= created_at)
  )
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null,
  target_id uuid not null,
  reason_code text not null,
  detail text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint reports_target_type_check check (target_type in ('post', 'comment')),
  constraint reports_reason_code_check check (char_length(btrim(reason_code)) between 1 and 50),
  constraint reports_detail_check check (detail is null or char_length(btrim(detail)) between 1 and 2000),
  constraint reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint reports_resolution_state_check check (
    (status in ('open', 'reviewing') and resolved_at is null and resolved_by is null)
    or (status in ('resolved', 'dismissed') and resolved_at is not null and resolved_by is not null)
  ),
  constraint reports_timestamps_check check (resolved_at is null or resolved_at >= created_at)
);

create unique index reports_one_open_per_reporter_target_idx
  on public.reports (reporter_id, target_type, target_id)
  where status in ('open', 'reviewing');

create table public.moderation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moderation_audit_logs_action_check check (char_length(btrim(action)) between 1 and 100),
  constraint moderation_audit_logs_target_type_check check (target_type in ('post', 'comment', 'report', 'tag', 'attachment', 'user')),
  constraint moderation_audit_logs_reason_check check (reason is null or char_length(btrim(reason)) between 1 and 2000),
  constraint moderation_audit_logs_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null,
  key text not null,
  request_hash text not null,
  resource_type text,
  resource_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, operation, key),
  constraint idempotency_keys_operation_check check (char_length(btrim(operation)) between 1 and 100),
  constraint idempotency_keys_key_check check (char_length(btrim(key)) between 1 and 200),
  constraint idempotency_keys_request_hash_check check (char_length(btrim(request_hash)) between 1 and 128),
  constraint idempotency_keys_resource_check check ((resource_type is null) = (resource_id is null)),
  constraint idempotency_keys_expiry_check check (expires_at > created_at)
);

create table public.rate_limit_rules (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  window_seconds integer not null,
  max_requests integer not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action, window_seconds),
  constraint rate_limit_rules_action_check check (char_length(btrim(action)) between 1 and 100),
  constraint rate_limit_rules_window_seconds_check check (window_seconds > 0),
  constraint rate_limit_rules_max_requests_check check (max_requests > 0),
  constraint rate_limit_rules_timestamps_check check (updated_at >= created_at)
);

create table public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  occurred_at timestamptz not null default now(),
  idempotency_key text,
  constraint rate_limit_events_action_check check (char_length(btrim(action)) between 1 and 100),
  constraint rate_limit_events_idempotency_key_check check (idempotency_key is null or char_length(btrim(idempotency_key)) between 1 and 200)
);

create index profiles_login_idx on public.profiles (login);
create index posts_public_list_idx on public.posts (is_pinned desc, created_at desc, id desc) where status = 'published';
create index posts_author_created_idx on public.posts (author_id, created_at desc, id desc);
create index posts_search_idx on public.posts using gin (
  (setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', body_markdown), 'B'))
) where status = 'published';
create index comments_post_thread_idx on public.comments (post_id, parent_id, created_at, id) where status = 'published';
create index comments_author_created_idx on public.comments (author_id, created_at desc);
create index post_tags_tag_post_idx on public.post_tags (tag_id, post_id);
create index post_reactions_post_created_idx on public.post_reactions (post_id, created_at desc);
create index comment_reactions_comment_created_idx on public.comment_reactions (comment_id, created_at desc);
create index attachments_owner_status_idx on public.attachments (owner_id, status, created_at desc);
create index attachments_post_idx on public.attachments (post_id) where post_id is not null;
create index reports_queue_idx on public.reports (status, created_at, id) where status in ('open', 'reviewing');
create index reports_reporter_created_idx on public.reports (reporter_id, created_at desc);
create index moderation_audit_logs_target_idx on public.moderation_audit_logs (target_type, target_id, created_at desc);
create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);
create index rate_limit_events_lookup_idx on public.rate_limit_events (user_id, action, occurred_at desc);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.tags enable row level security;
alter table public.post_tags enable row level security;
alter table public.post_reactions enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.attachments enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_audit_logs enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.rate_limit_rules enable row level security;
alter table public.rate_limit_events enable row level security;

revoke all on table
  public.profiles,
  public.user_roles,
  public.posts,
  public.comments,
  public.tags,
  public.post_tags,
  public.post_reactions,
  public.comment_reactions,
  public.attachments,
  public.reports,
  public.moderation_audit_logs,
  public.idempotency_keys,
  public.rate_limit_rules,
  public.rate_limit_events
from public, anon, authenticated;

revoke all on function public.enforce_top_level_comment_parent() from public, anon, authenticated;
revoke all on function public.enforce_post_tag_limit() from public, anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
-- supabase_admin owns platform-managed objects and remains outside app migration scope.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
