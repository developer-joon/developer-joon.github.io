-- TARGET: breadlab-community-development
-- PROJECT REF: giuxonxvuqrdnmjwvhvt
-- PRODUCTION IS FORBIDDEN. Visually confirm the Dashboard project before every run.
-- SQL cannot cryptographically detect or verify the Supabase project ref.
--
-- IMPORTANT: run the marked selections separately and in order. Sections 01-10
-- and 12-20 each run once; Section 11 runs as 11A and 11B. The Dashboard sends
-- one selection as one query. Running the whole file, or all of Section 11, puts
-- CREATE INDEX CONCURRENTLY inside an implicit transaction and must not be used.
-- No section is wrapped by this bundle in a global transaction.
--
-- SOURCE MANIFEST (SHA-256 over exact repository bytes):
-- sha256: ab91c1ad0a53797e41c78e0c42d7877b5dc449bacb2c66af00ab5f0894e3eff0  supabase/migrations/202609260001_core_schema.sql
-- sha256: 0749099b6c03936a638819f8c9cc055587389659ebc6e031e8d8fefe93383c5a  supabase/migrations/202609260002_rls_and_rpcs.sql
-- sha256: 2840137594109163af4694dbda01a407072b9fe7abce4eddd30f5aa491a4a73e  supabase/migrations/202609260003_storage.sql
-- sha256: 5da0f553cdfad77c763544edaacd6c580e8036813185a841ec7028a8501485fa  supabase/migrations/202609260004_public_post_read_model.sql
-- sha256: 6e52ec44232a8513a2f92110265a7954eb2ebdd164865c11ebbdaecb3b949974  supabase/migrations/202609260005_profile_provisioning.sql
-- sha256: 0cda99d967f38bb652c6f0d03bfd58d3abdde34a070a6d6451fc28a1fb7dd544  supabase/migrations/202609270001_public_attachment_resolver.sql
-- sha256: e8f8a1d10e62a023bd7053c2f133fa427eb2ed2b6d0fa3e7cf9e1a2f7de20de5  supabase/migrations/202609270002_trusted_github_profile_provisioning.sql
-- sha256: 3be767966b7dce3144ea49b3bec9d8beec869185ce6d4eec54bbc23008312b08  supabase/migrations/202609270003_public_attachment_body_urls.sql
-- sha256: 293135f423787e61e109fb1ec5fa902bd8e4305b9788caf2f21a545be2840927  supabase/migrations/202609270004_post_tombstones.sql
-- sha256: cfa12710a039993dc56cd0ac33915225efe57d4316d704e453c0aa419ceb58c9  supabase/migrations/202609270005_unbounded_public_listing.sql
-- sha256: d85c3e3c62e7eba8d17bb6dd731a40bbdc0bf90aac26ece7b6173504320df16c  supabase/migrations/202609280001_public_post_attachment_count.sql
-- sha256: c15cdc66963990270cb7f06793eb12a9cfb624f8d8f3e30594826c6ba93b4b2c  supabase/migrations/202609280002_attach_expected_total.sql
-- sha256: 0bdbe059b70a0064a4bf43751a46bd61af2fdfda119f06b43536b222abf02662  supabase/migrations/202609280003_discussion_interactions.sql
-- sha256: e1bcb3380f8b5e2a08207606f0677f1035edfd43d9ed1eb84e655fda5eb66322  supabase/migrations/202609280004_moderation.sql
-- sha256: 9f7d238d14a5a202a03a7cf9240d10cd3f312eca6ea787dac27fcc9051ec9f1e  supabase/migrations/202609280005_community_snapshot_export.sql
-- sha256: 1b366c12ff7cd0ad05eb5022ae1227ecaeb906567ddc49d53e4551aa9f8f513e  supabase/migrations/202610040001_provider_neutral_profile_provisioning.sql
-- sha256: 4572548cd126bddaab4b74326ec13c4aa541e5fad93862054db8b4e9702e1487  supabase/migrations/202610040002_google_profile_metadata_provenance.sql
-- sha256: 18d734aa45e48bfccd0c7968ef1ff328f679e217c8cf8817479681b861e6864f  supabase/seed.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 01 OF 20: FRESH PROJECT PREFLIGHT
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
do $bootstrap_preflight$
begin
  if pg_catalog.to_regclass('public.profiles') is not null
     or pg_catalog.to_regclass('public.posts') is not null
     or pg_catalog.to_regclass('public.tags') is not null
     or exists (
       select 1
         from supabase_migrations.schema_migrations
        where version in (
          '202609260001', '202609260002', '202609260003', '202609260004', '202609260005',
          '202609270001', '202609270002', '202609270003', '202609270004', '202609270005',
          '202609280001', '202609280002', '202609280003', '202609280004', '202609280005',
          '202610040001', '202610040002'
        )
     ) then
    raise exception 'fresh project preflight failed: community schema or migration history already exists';
  end if;

  if pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regclass('auth.identities') is null
     or pg_catalog.to_regclass('storage.buckets') is null
     or pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'fresh project preflight failed: required Supabase platform schemas are missing';
  end if;

  raise notice 'FRESH PROJECT PREFLIGHT PASSED';
end
$bootstrap_preflight$;

-- ============================================================================
-- DASHBOARD RUN SECTION 02 OF 20: 202609260001_core_schema.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609260001_core_schema.sql
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
-- END SOURCE: supabase/migrations/202609260001_core_schema.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 03 OF 20: 202609260002_rls_and_rpcs.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609260002_rls_and_rpcs.sql
-- Task 3: fail-closed browser grants, public-read RLS, and controlled mutations.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter schema private owner to postgres;

-- These limits are production invariants, not optional development seed data.
insert into public.rate_limit_rules (id, action, window_seconds, max_requests, is_enabled)
values
  ('b1000000-0000-0000-0000-000000000001', 'post.create', 600, 5, true),
  ('b1000000-0000-0000-0000-000000000002', 'post.create', 86400, 30, true),
  ('b1000000-0000-0000-0000-000000000003', 'comment.create', 600, 20, true),
  ('b1000000-0000-0000-0000-000000000004', 'comment.create', 86400, 200, true),
  ('b1000000-0000-0000-0000-000000000005', 'report.create', 86400, 10, true)
on conflict (action, window_seconds) do update
set max_requests = excluded.max_requests,
    is_enabled = excluded.is_enabled,
    updated_at = pg_catalog.clock_timestamp();

create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or not exists (select 1 from public.profiles p where p.id = caller_id) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return caller_id;
end;
$$;

create function private.validate_post_tags(p_tag_ids uuid[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  supplied_count integer := coalesce(pg_catalog.cardinality(p_tag_ids), 0);
  active_distinct_count integer;
begin
  select count(distinct t.id)::integer
    into active_distinct_count
    from public.tags t
   where t.id = any(coalesce(p_tag_ids, array[]::uuid[]))
     and t.is_active;

  if supplied_count < 1 or supplied_count > 3 or active_distinct_count <> supplied_count then
    raise exception 'post requires between 1 and 3 active tags' using errcode = '22023';
  end if;
end;
$$;

create function private.require_read_committed()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'mutation RPCs require READ COMMITTED isolation' using errcode = '0A000';
  end if;
end;
$$;

-- Duplicate-body matching is intentionally case-sensitive. It trims outer
-- whitespace and collapses every internal whitespace run to one ASCII space.
create function private.normalize_duplicate_body(p_body text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.btrim(p_body), '[[:space:]]+', ' ', 'g')
$$;

create function private.consume_rate_limit(p_user_id uuid, p_action text, p_idempotency_key text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  rule record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rate-limit:' || p_user_id::text || ':' || p_action, 0)
  );

  for rule in
    select r.window_seconds, r.max_requests
      from public.rate_limit_rules r
     where r.action = p_action and r.is_enabled
     order by r.window_seconds
  loop
    if (select count(*) from public.rate_limit_events e
         where e.user_id = p_user_id
           and e.action = p_action
           and e.occurred_at > pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => rule.window_seconds)) >= rule.max_requests then
      raise sqlstate 'PGRST' using
        message = pg_catalog.format(
          '{"code":"rate_limit_exceeded","message":"Rate limit exceeded","details":%s,"hint":"Retry later"}',
          pg_catalog.to_json(p_action)::text
        ),
        detail = pg_catalog.jsonb_build_object(
          'status', 429,
          'headers', pg_catalog.jsonb_build_object('Retry-After', rule.window_seconds::text)
        )::text;
    end if;
  end loop;

  insert into public.rate_limit_events(user_id, action, idempotency_key, occurred_at)
  values (p_user_id, p_action, p_idempotency_key, pg_catalog.clock_timestamp());
end;
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid() and r.role = 'admin'
  )
$$;

alter function private.require_user() owner to postgres;
alter function private.validate_post_tags(uuid[]) owner to postgres;
alter function private.require_read_committed() owner to postgres;
alter function private.normalize_duplicate_body(text) owner to postgres;
alter function private.consume_rate_limit(uuid, text, text) owner to postgres;
alter function public.is_admin() owner to postgres;
revoke all on function private.require_user() from public, anon, authenticated;
revoke all on function private.validate_post_tags(uuid[]) from public, anon, authenticated;
revoke all on function private.require_read_committed() from public, anon, authenticated;
revoke all on function private.normalize_duplicate_body(text) from public, anon, authenticated;
revoke all on function private.consume_rate_limit(uuid, text, text) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Public reads are deliberately limited both by grants (profile columns) and RLS.
grant select (id, login, display_name, avatar_url, created_at) on public.profiles to anon, authenticated;
grant select on public.posts, public.comments, public.tags, public.post_tags to anon, authenticated;

create policy profiles_public_read on public.profiles
  for select to anon, authenticated using (true);
create policy posts_public_read on public.posts
  for select to anon, authenticated using (status = 'published' and deleted_at is null);
create policy comments_public_read on public.comments
  for select to anon, authenticated using (
    status = 'published' and deleted_at is null and exists (
      select 1 from public.posts p
       where p.id = comments.post_id and p.status = 'published' and p.deleted_at is null
    )
  );
create policy tags_public_read on public.tags
  for select to anon, authenticated using (is_active);
create policy post_tags_public_read on public.post_tags
  for select to anon, authenticated using (
    exists (select 1 from public.posts p where p.id = post_tags.post_id and p.status = 'published' and p.deleted_at is null)
    and exists (select 1 from public.tags t where t.id = post_tags.tag_id and t.is_active)
  );
create function public.create_post(
  p_title text, p_body_markdown text, p_tag_ids uuid[], p_idempotency_key text
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; normalized_body text;
  request_fingerprint text; previous public.idempotency_keys%rowtype;
  new_id uuid; canonical_tags uuid[];
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  select array_agg(x order by x) into canonical_tags from unnest(p_tag_ids) x;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('title',p_title,'body',p_body_markdown,'tags',canonical_tags)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':post.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k
   where k.user_id=caller_id and k.operation='post.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='post.create' and k.key=canonical_key;
  perform private.validate_post_tags(p_tag_ids);
  normalized_body := private.normalize_duplicate_body(p_body_markdown);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-body:'||caller_id::text||':post:'||pg_catalog.md5(normalized_body),0));
  if exists(select 1 from public.posts p where p.author_id=caller_id and p.created_at>pg_catalog.clock_timestamp()-interval '10 minutes' and private.normalize_duplicate_body(p.body_markdown)=normalized_body) then
    raise exception 'duplicate post body within 10 minutes' using errcode='23505';
  end if;
  perform private.consume_rate_limit(caller_id,'post.create',canonical_key);
  insert into public.posts(author_id,title,body_markdown) values(caller_id,p_title,p_body_markdown) returning id into new_id;
  insert into public.post_tags(post_id,tag_id) select new_id,x from unnest(canonical_tags) x;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'post.create',canonical_key,request_fingerprint,'post',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

create function public.update_post(p_post_id uuid, p_title text, p_body_markdown text, p_tag_ids uuid[])
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; canonical_tags uuid[];
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform private.validate_post_tags(p_tag_ids);
  select array_agg(x order by x) into canonical_tags from unnest(p_tag_ids) x;
  perform 1 from public.posts p where p.id=p_post_id and p.author_id=caller_id and p.status='published' and p.deleted_at is null for update;
  if not found then raise exception 'post not found or not editable' using errcode='42501'; end if;
  update public.posts set title=p_title,body_markdown=p_body_markdown,updated_at=pg_catalog.clock_timestamp() where id=p_post_id;
  delete from public.post_tags where post_id=p_post_id;
  insert into public.post_tags(post_id,tag_id) select p_post_id,x from unnest(canonical_tags) x;
  return p_post_id;
end;
$$;

create function public.soft_delete_post(p_post_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  update public.posts set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where id=p_post_id and author_id=caller_id and status='published' and deleted_at is null;
  if not found then raise exception 'post not found or not editable' using errcode='42501'; end if;
  return p_post_id;
end;
$$;

create function public.create_comment(p_post_id uuid, p_parent_id uuid, p_body_markdown text, p_idempotency_key text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; normalized_body text;
  request_fingerprint text; previous public.idempotency_keys%rowtype; new_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then raise exception 'invalid idempotency key' using errcode='22023'; end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('post',p_post_id,'parent',p_parent_id,'body',p_body_markdown)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':comment.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k where k.user_id=caller_id and k.operation='comment.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='comment.create' and k.key=canonical_key;
  normalized_body := private.normalize_duplicate_body(p_body_markdown);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-body:'||caller_id::text||':comment:'||pg_catalog.md5(normalized_body),0));
  if exists(select 1 from public.comments c where c.author_id=caller_id and c.created_at>pg_catalog.clock_timestamp()-interval '10 minutes' and private.normalize_duplicate_body(c.body_markdown)=normalized_body) then
    raise exception 'duplicate comment body within 10 minutes' using errcode='23505';
  end if;
  -- Shared validation locks preserve post-then-comment order while allowing
  -- independent interactions; moderation UPDATE/DELETE still conflicts.
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'post not found, visible, or unlocked' using errcode='22023'; end if;
  if p_parent_id is not null then
    perform 1 from public.comments c where c.id=p_parent_id and c.post_id=p_post_id and c.parent_id is null and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'parent must be a visible top-level comment on the same post' using errcode='22023'; end if;
  end if;
  perform private.consume_rate_limit(caller_id,'comment.create',canonical_key);
  insert into public.comments(post_id,author_id,parent_id,body_markdown) values(p_post_id,caller_id,p_parent_id,p_body_markdown) returning id into new_id;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'comment.create',canonical_key,request_fingerprint,'comment',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

create function public.update_comment(p_comment_id uuid, p_body_markdown text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.comments c where c.id=p_comment_id and c.author_id=caller_id and c.status='published' and c.deleted_at is null for update;
  if not found then raise exception 'comment not found or not editable' using errcode='42501'; end if;
  update public.comments set body_markdown=p_body_markdown,updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  return p_comment_id;
end;
$$;

create function public.soft_delete_comment(p_comment_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.comments c where c.id=p_comment_id and c.author_id=caller_id and c.status='published' and c.deleted_at is null for update;
  if not found then raise exception 'comment not found or not editable' using errcode='42501'; end if;
  update public.comments set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  return p_comment_id;
end;
$$;

create function public.toggle_post_reaction(p_post_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; removed uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null for share;
  if not found then raise exception 'post not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('post-reaction:'||caller_id::text||':'||p_post_id::text,0));
  delete from public.post_reactions where user_id=caller_id and post_id=p_post_id returning id into removed;
  if removed is not null then return false; end if;
  insert into public.post_reactions(user_id,post_id) values(caller_id,p_post_id);
  return true;
end;
$$;

create function public.toggle_comment_reaction(p_comment_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; removed uuid; target_post_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  select c.post_id into target_post_id from public.comments c where c.id=p_comment_id;
  -- Moderation must use the same post-then-comment row-lock order.
  perform 1 from public.posts p where p.id=target_post_id and p.status='published' and p.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform 1 from public.comments c where c.id=p_comment_id and c.post_id=target_post_id and c.status='published' and c.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment-reaction:'||caller_id::text||':'||p_comment_id::text,0));
  delete from public.comment_reactions where user_id=caller_id and comment_id=p_comment_id returning id into removed;
  if removed is not null then return false; end if;
  insert into public.comment_reactions(user_id,comment_id) values(caller_id,p_comment_id);
  return true;
end;
$$;

create function public.create_report(p_target_type text, p_target_id uuid, p_reason_code text, p_detail text, p_idempotency_key text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; target_post_id uuid;
  request_fingerprint text; previous public.idempotency_keys%rowtype; new_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then raise exception 'invalid idempotency key' using errcode='22023'; end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('type',p_target_type,'target',p_target_id,'reason',p_reason_code,'detail',p_detail)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':report.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k where k.user_id=caller_id and k.operation='report.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='report.create' and k.key=canonical_key;
  if p_target_type='post' then
    perform 1 from public.posts p where p.id=p_target_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  elsif p_target_type='comment' then
    select c.post_id into target_post_id from public.comments c where c.id=p_target_id;
    -- Moderation must use the same post-then-comment row-lock order.
    perform 1 from public.posts p where p.id=target_post_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
    perform 1 from public.comments c where c.id=p_target_id and c.post_id=target_post_id and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  else
    raise exception 'report target not found or visible' using errcode='22023';
  end if;
  if exists(select 1 from public.reports r where r.reporter_id=caller_id and r.target_type=p_target_type and r.target_id=p_target_id and r.status in ('open','reviewing')) then raise exception 'open report already exists' using errcode='23505'; end if;
  perform private.consume_rate_limit(caller_id,'report.create',canonical_key);
  insert into public.reports(reporter_id,target_type,target_id,reason_code,detail) values(caller_id,p_target_type,p_target_id,p_reason_code,p_detail) returning id into new_id;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'report.create',canonical_key,request_fingerprint,'report',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

alter function public.create_post(text,text,uuid[],text) owner to postgres;
alter function public.update_post(uuid,text,text,uuid[]) owner to postgres;
alter function public.soft_delete_post(uuid) owner to postgres;
alter function public.create_comment(uuid,uuid,text,text) owner to postgres;
alter function public.update_comment(uuid,text) owner to postgres;
alter function public.soft_delete_comment(uuid) owner to postgres;
alter function public.toggle_post_reaction(uuid) owner to postgres;
alter function public.toggle_comment_reaction(uuid) owner to postgres;
alter function public.create_report(text,uuid,text,text,text) owner to postgres;

revoke all on function public.create_post(text,text,uuid[],text) from public, anon, authenticated;
revoke all on function public.update_post(uuid,text,text,uuid[]) from public, anon, authenticated;
revoke all on function public.soft_delete_post(uuid) from public, anon, authenticated;
revoke all on function public.create_comment(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.update_comment(uuid,text) from public, anon, authenticated;
revoke all on function public.soft_delete_comment(uuid) from public, anon, authenticated;
revoke all on function public.toggle_post_reaction(uuid) from public, anon, authenticated;
revoke all on function public.toggle_comment_reaction(uuid) from public, anon, authenticated;
revoke all on function public.create_report(text,uuid,text,text,text) from public, anon, authenticated;

grant execute on function public.create_post(text,text,uuid[],text) to authenticated;
grant execute on function public.update_post(uuid,text,text,uuid[]) to authenticated;
grant execute on function public.soft_delete_post(uuid) to authenticated;
grant execute on function public.create_comment(uuid,uuid,text,text) to authenticated;
grant execute on function public.update_comment(uuid,text) to authenticated;
grant execute on function public.soft_delete_comment(uuid) to authenticated;
grant execute on function public.toggle_post_reaction(uuid) to authenticated;
grant execute on function public.toggle_comment_reaction(uuid) to authenticated;
grant execute on function public.create_report(text,uuid,text,text,text) to authenticated;
-- END SOURCE: supabase/migrations/202609260002_rls_and_rpcs.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 04 OF 20: 202609260003_storage.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609260003_storage.sql
-- Task 4: private image storage and intent-first attachment lifecycle.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-images',
  'community-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.attachments
  add column client_key uuid,
  add column payload_sha256 text,
  add column cleanup_attempt_count integer not null default 0,
  add column next_attempt_at timestamptz default pg_catalog.clock_timestamp(),
  add column cleanup_claim_token uuid,
  add column cleanup_lease_until timestamptz,
  add column cleanup_last_error text,
  drop constraint attachments_status_check,
  drop constraint attachments_state_check;

-- Rows without upload identity predate the managed intent lifecycle. Preserve
-- valid linked attachments and unlinked pending rows, including their real
-- object paths. Only contradictory legacy linkage is made cleanup-safe.
update public.attachments
   set status = 'quarantined',
       post_id = null,
       attached_at = null,
       deleted_at = null,
       cleanup_last_error = 'legacy_invalid_attachment_state',
       next_attempt_at = pg_catalog.clock_timestamp()
 where client_key is null
   and payload_sha256 is null
   and (
     (status = 'pending' and post_id is not null)
     or (status = 'attached' and post_id is null)
   );

alter table public.attachments
  add constraint attachments_status_check check (
    status in ('pending', 'attached', 'quarantined', 'deleting', 'deleted', 'cleanup_failed')
  ),
  add constraint attachments_state_check check (
    (status = 'pending' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status in ('quarantined', 'deleting', 'cleanup_failed') and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  add constraint attachments_owner_storage_path_check check (
    (client_key is null and payload_sha256 is null)
    or storage_path ~ (
      '^' || owner_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  ),
  add constraint attachments_post_state_check check (
    (status = 'pending' and post_id is null)
    or (status = 'attached' and post_id is not null)
    or status in ('quarantined', 'deleting', 'deleted', 'cleanup_failed')
  ),
  add constraint attachments_cleanup_attempt_count_check check (
    cleanup_attempt_count between 0 and 5
  ),
  add constraint attachments_cleanup_lease_check check (
    (cleanup_claim_token is null and cleanup_lease_until is null)
    or (cleanup_claim_token is not null and cleanup_lease_until is not null)
  ),
  add constraint attachments_payload_sha256_check check (
    payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint attachments_upload_identity_check check (
    (client_key is null) = (payload_sha256 is null)
  );

-- This deliberately narrow table policy lets the Storage policy's correlated
-- legacy lookup run under the caller's real RLS context without a definer helper.
create policy attachments_select_own_attached_legacy
on public.attachments
for select
to authenticated
using (
  owner_id = auth.uid()
  and status = 'attached'
  and post_id is not null
  and client_key is null
  and payload_sha256 is null
);

-- The managed Storage branch needs the same caller-context correlation without
-- trusting a path prefix. Keep it separate from the legacy policy so identity
-- requirements remain explicit and auditable.
create policy attachments_select_own_attached_managed
on public.attachments
for select
to authenticated
using (
  owner_id = auth.uid()
  and status = 'attached'
  and post_id is not null
  and client_key is not null
  and payload_sha256 is not null
);
grant select (owner_id, post_id, storage_path, status, client_key, payload_sha256)
on public.attachments to authenticated;

-- Managed objects are readable only through their exact attached intent row.
-- Legacy objects additionally require at least one Storage owner field, and
-- every populated owner field must agree with the attachment owner. Service-role
-- uploads are ownerless, so only the managed identity branch accepts them.
create policy community_images_select_own_uuid
on storage.objects
for select
to authenticated
using (
  bucket_id = 'community-images'
  and archived_at is null
  and auth.uid() is not null
  and (
    exists (
      select 1
        from public.attachments a
       where a.owner_id = auth.uid()
         and a.storage_path collate "C" = name collate "C"
         and a.status = 'attached'
         and a.post_id is not null
         and a.client_key is not null
         and a.payload_sha256 is not null
    )
    or (
      (owner is not null or owner_id is not null)
      and (owner is null or owner = auth.uid())
      and (owner_id is null or owner_id = auth.uid()::text)
      and exists (
        select 1
          from public.attachments a
         where a.owner_id = auth.uid()
           and a.storage_path collate "C" = name collate "C"
           and a.status = 'attached'
           and a.post_id is not null
           and a.client_key is null
           and a.payload_sha256 is null
      )
    )
  )
);

alter table public.rate_limit_events
  add column upload_reservation_id uuid;

create unique index rate_limit_events_upload_reservation_idx
on public.rate_limit_events (upload_reservation_id)
where upload_reservation_id is not null;

create unique index attachments_owner_client_key_idx
on public.attachments (owner_id, client_key)
where client_key is not null;

create index attachments_cleanup_queue_idx
on public.attachments (next_attempt_at, created_at, id)
where status in ('pending', 'attached', 'quarantined', 'deleting');

insert into public.rate_limit_rules (
  id, action, window_seconds, max_requests, is_enabled
)
values (
  'b1000000-0000-0000-0000-000000000006',
  'attachment.upload',
  600,
  20,
  true
)
on conflict (action, window_seconds) do update
set max_requests = excluded.max_requests,
    is_enabled = excluded.is_enabled,
    updated_at = pg_catalog.clock_timestamp();

create type public.attachment_upload_intent as (
  id uuid,
  storage_path text,
  is_replay boolean,
  object_exists boolean
);

create function public.reserve_attachment_upload(p_idempotency_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  canonical_key text;
  reservation_id uuid := gen_random_uuid();
  reservation_started_at timestamptz := pg_catalog.clock_timestamp();
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  if p_idempotency_key is null then
    raise exception 'client key is required' using errcode = '22023';
  end if;
  canonical_key := p_idempotency_key::text;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-rate-reservation:' || caller_id::text || ':' || canonical_key, 0)
  );
  perform private.consume_rate_limit(caller_id, 'attachment.upload', canonical_key);

  update public.rate_limit_events e
     set upload_reservation_id = reservation_id
   where e.id = (
     select latest.id
       from public.rate_limit_events latest
      where latest.user_id = caller_id
        and latest.action = 'attachment.upload'
        and latest.idempotency_key = canonical_key
        and latest.upload_reservation_id is null
        and latest.occurred_at >= reservation_started_at
      order by latest.occurred_at desc, latest.id desc
      limit 1
   );
  if not found then
    raise exception 'upload rate reservation was not recorded' using errcode = '55000';
  end if;
  return reservation_id;
end;
$$;

create function public.refund_attachment_upload_replay(
  p_reservation_id uuid,
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_byte_size bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_reservation_id is null or p_idempotency_key is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rate-limit:' || caller_id::text || ':attachment.upload', 0)
  );

  delete from public.rate_limit_events e
   where e.upload_reservation_id = p_reservation_id
     and e.user_id = caller_id
     and e.action = 'attachment.upload'
     and e.idempotency_key = p_idempotency_key::text
     and exists (
       select 1
         from public.attachments a
         join storage.objects o
           on o.bucket_id = 'community-images'
          and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
        where a.owner_id = caller_id
          and a.client_key = p_idempotency_key
          and a.post_id is null
          and a.status in ('pending', 'quarantined')
          and (
            a.cleanup_lease_until is null
            or a.cleanup_lease_until <= pg_catalog.clock_timestamp()
          )
          and a.payload_sha256 = p_content_hash
          and a.mime_type = p_mime_type
          and a.byte_size = p_byte_size
          and o.metadata ->> 'mimetype' = a.mime_type
          and o.metadata ->> 'size' ~ '^[0-9]+$'
          and (o.metadata ->> 'size')::bigint = a.byte_size
          and coalesce(
            o.user_metadata ->> 'sha256',
            o.metadata ->> 'sha256',
            o.metadata #>> '{metadata,sha256}'
          ) = a.payload_sha256
     );

  return found;
end;
$$;

create function public.create_attachment_upload_intent(
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_byte_size bigint
)
returns public.attachment_upload_intent
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  canonical_key text;
  intended_path text;
  existing_attachment public.attachments%rowtype;
  any_object_exists boolean;
  matching_object_exists boolean;
  pending_count integer;
  pending_bytes bigint;
  created_intent public.attachment_upload_intent;
  -- Fifteen minutes is more than twice the hosted Edge worker's 400-second
  -- wall-clock ceiling, so a resumed intent cannot become cleanup-eligible
  -- while its validate-upload invocation can still perform Storage upload.
  upload_retry_grace constant interval := interval '15 minutes';
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_idempotency_key is null then
    raise exception 'client key is required' using errcode = '22023';
  end if;

  canonical_key := p_idempotency_key::text;
  intended_path := caller_id::text || '/' || canonical_key;

  -- One actor lock serializes replay, rate consumption, and both quota checks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-upload:' || caller_id::text, 0)
  );

  -- Replay precedes metadata and pending-quota checks. The Edge endpoint still
  -- applies a hard pre-decode request-rate gate, then refunds only a validated
  -- replay whose immutable Storage object matches this intent.
  select a.*
    into existing_attachment
    from public.attachments a
   where a.owner_id = caller_id
     and a.storage_path = intended_path
   for update;

  if found then
    if existing_attachment.mime_type is distinct from p_mime_type
       or existing_attachment.byte_size is distinct from p_byte_size
       or existing_attachment.payload_sha256 is distinct from p_content_hash then
      raise exception 'client key reused with different payload metadata'
        using errcode = '22023';
    end if;

    if existing_attachment.status in ('attached', 'deleting', 'deleted', 'cleanup_failed')
       or existing_attachment.post_id is not null then
      raise exception 'upload intent is no longer retryable' using errcode = '55000';
    end if;
    if existing_attachment.cleanup_lease_until > pg_catalog.clock_timestamp() then
      raise exception 'upload intent has an active cleanup lease' using errcode = '55000';
    end if;

    select exists (
             select 1 from storage.objects o
              where o.bucket_id = 'community-images' and o.name collate "C" = intended_path collate "C"
                and o.archived_at is null
           ),
           exists (
             select 1 from storage.objects o
              where o.bucket_id = 'community-images' and o.name collate "C" = intended_path collate "C"
                and o.archived_at is null
                and o.metadata ->> 'mimetype' = p_mime_type
                and o.metadata ->> 'size' ~ '^[0-9]+$'
                and (o.metadata ->> 'size')::bigint = p_byte_size
                and coalesce(
                  o.user_metadata ->> 'sha256',
                  o.metadata ->> 'sha256',
                  o.metadata #>> '{metadata,sha256}'
                ) = p_content_hash
           )
      into any_object_exists, matching_object_exists;
    if any_object_exists and not matching_object_exists then
      raise exception 'storage object metadata does not match intent' using errcode = '22023';
    end if;

    update public.attachments a
       set status = 'pending', cleanup_claim_token = null,
           cleanup_lease_until = null, cleanup_last_error = null,
           next_attempt_at = pg_catalog.clock_timestamp() + upload_retry_grace
     where a.id = existing_attachment.id;

    created_intent.id := existing_attachment.id;
    created_intent.storage_path := existing_attachment.storage_path;
    created_intent.is_replay := true;
    created_intent.object_exists := matching_object_exists;
    return created_intent;
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_byte_size is null
     or p_byte_size not between 1 and 5242880
     or p_content_hash is null
     or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid attachment metadata' using errcode = '22023';
  end if;

  -- Client keys determine paths, so a new intent may not adopt any object that
  -- predates its tracked attachment row. Replays returned above remain valid.
  if exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'community-images'
       and o.name collate "C" = intended_path collate "C"
       and o.archived_at is null
  ) then
    raise exception 'storage path already exists' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-rate-reservation:' || caller_id::text || ':' || canonical_key, 0)
  );
  if not exists (
    select 1 from public.rate_limit_events e
     where e.user_id = caller_id and e.action = 'attachment.upload'
       and e.idempotency_key = canonical_key
       and e.occurred_at > pg_catalog.clock_timestamp() - interval '10 minutes'
  ) then
    begin
      perform private.consume_rate_limit(caller_id, 'attachment.upload', canonical_key);
    exception
      when sqlstate 'PGRST' then
        raise exception 'attachment upload rate limit exceeded' using errcode = 'P0001';
    end;
  end if;

  select count(*)::integer, coalesce(sum(a.byte_size), 0)::bigint
    into pending_count, pending_bytes
    from public.attachments a
   where a.owner_id = caller_id
     and a.status in ('pending', 'quarantined');

  if pending_count >= 10 then
    raise exception 'pending attachment count limit exceeded'
      using errcode = '23514';
  end if;

  if pending_bytes + p_byte_size > 26214400 then
    raise exception 'pending attachment byte limit exceeded'
      using errcode = '23514';
  end if;

  insert into public.attachments (
    owner_id, client_key, payload_sha256, storage_path, mime_type, byte_size, status
  ) values (
    caller_id, p_idempotency_key, p_content_hash, intended_path, p_mime_type, p_byte_size, 'pending'
  )
  returning id, storage_path into created_intent;

  created_intent.is_replay := false;
  created_intent.object_exists := false;
  return created_intent;
end;
$$;

create function public.fail_attachment_upload(
  p_attachment_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  update public.attachments a
     set status = 'quarantined',
         cleanup_last_error = 'upload_failed',
         next_attempt_at = least(
           coalesce(a.next_attempt_at, pg_catalog.clock_timestamp()),
           pg_catalog.clock_timestamp()
         )
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.owner_id = caller_id
     and a.status in ('pending', 'quarantined')
     and a.post_id is null;

  return found;
end;
$$;

create function public.attach_attachments(
  p_post_id uuid,
  p_attachment_ids uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  requested_count integer := coalesce(pg_catalog.cardinality(p_attachment_ids), 0);
  distinct_count integer;
  linkable_count integer;
  pending_count integer;
  valid_pending_count integer;
  existing_count integer;
  final_count integer;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  select count(distinct requested_id)::integer
    into distinct_count
    from pg_catalog.unnest(coalesce(p_attachment_ids, array[]::uuid[])) requested_id;

  if requested_count < 1 or requested_count > 5
     or distinct_count <> requested_count
     or pg_catalog.array_position(p_attachment_ids, null::uuid) is not null then
    raise exception 'attachment list must contain 1 to 5 distinct ids; duplicate attachment ids are not allowed'
      using errcode = '22023';
  end if;

  perform 1
    from public.posts p
   where p.id = p_post_id
     and p.author_id = caller_id
     and p.status = 'published'
     and p.deleted_at is null
   for update;
  if not found then
    raise exception 'post not found or not attachable' using errcode = '42501';
  end if;

  perform 1
    from public.attachments a
   where a.id = any(p_attachment_ids)
   order by a.id
   for update;

  select count(*)::integer,
         count(*) filter (where a.status = 'pending')::integer
    into linkable_count, pending_count
    from public.attachments a
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and (
       (
         a.status = 'pending' and a.post_id is null
         and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp())
       )
       or (
         a.status = 'attached' and a.post_id = p_post_id
         and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp())
       )
     );

  if linkable_count <> requested_count then
    raise exception 'attachment not found or not linkable' using errcode = '42501';
  end if;

  -- Validate every object in the same transaction immediately before changing
  -- its pending intent to attached. Malformed metadata is a mismatch, not a cast
  -- error exposed to the caller.
  select count(*)::integer
    into valid_pending_count
    from public.attachments a
    join storage.objects o
      on o.bucket_id = 'community-images'
     and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null
     and o.metadata ->> 'mimetype' = a.mime_type
     and coalesce(
       o.user_metadata ->> 'sha256',
       o.metadata ->> 'sha256',
       o.metadata #>> '{metadata,sha256}'
     ) = a.payload_sha256
     and case
       when o.metadata ->> 'size' ~ '^[0-9]+$'
       then (o.metadata ->> 'size')::bigint = a.byte_size
       else false
     end;

  if valid_pending_count <> pending_count then
    raise exception 'storage object metadata does not match intent'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into existing_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  if existing_count + pending_count > 5 then
    raise exception 'a post may have at most 5 attachments' using errcode = '23514';
  end if;

  update public.attachments a
     set post_id = p_post_id,
         status = 'attached',
         attached_at = pg_catalog.clock_timestamp()
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null
     and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp());

  select count(*)::integer
    into final_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  return final_count;
end;
$$;

create function public.claim_attachment_cleanup(p_limit integer default 100)
returns table(id uuid, storage_path text, claim_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'cleanup limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select a.id
      from public.attachments a
      left join public.posts p on p.id = a.post_id
      left join lateral (
        select true as object_exists, o.owner, o.owner_id
          from storage.objects o
         where o.bucket_id = 'community-images'
           and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
         limit 1
      ) o on true
     where a.cleanup_attempt_count < 5
       and a.next_attempt_at <= pg_catalog.clock_timestamp()
       and (
         a.cleanup_lease_until is null
         or a.cleanup_lease_until <= pg_catalog.clock_timestamp()
       )
       and (
         (a.client_key is not null and a.payload_sha256 is not null)
         or o.object_exists is null
         or (
           (o.owner is not null or o.owner_id is not null)
           and (o.owner is null or o.owner = a.owner_id)
           and (o.owner_id is null or o.owner_id = a.owner_id::text)
         )
       )
       and (
         a.status = 'deleting'
         or (
           a.post_id is null
           and a.status in ('pending', 'quarantined')
           and (
             a.cleanup_last_error in ('upload_failed', 'legacy_invalid_attachment_state')
             or a.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
           )
         )
         or (
           a.post_id is not null
           and a.status in ('attached', 'quarantined')
           and p.status = 'deleted'
           and p.deleted_at < pg_catalog.clock_timestamp() - interval '30 days'
         )
       )
     order by a.next_attempt_at, a.created_at, a.id
     for update of a skip locked
     limit p_limit
  ), claimed as (
    update public.attachments a
       set cleanup_claim_token = gen_random_uuid(),
           cleanup_lease_until = pg_catalog.clock_timestamp() + interval '5 minutes'
      from candidates c
     where a.id = c.id
    returning a.id, a.storage_path, a.cleanup_claim_token
  )
  select c.id, c.storage_path, c.cleanup_claim_token
    from claimed c
   order by c.id;
end;
$$;

create function public.prepare_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.attachments a
     set status = 'deleting'
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp()
     and (
       (a.client_key is not null and a.payload_sha256 is not null)
       or not exists (
         select 1
           from storage.objects o
          where o.bucket_id = 'community-images'
            and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
       )
       or exists (
         select 1
           from storage.objects o
           where o.bucket_id = 'community-images'
            and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
            and (o.owner is not null or o.owner_id is not null)
            and (o.owner is null or o.owner = a.owner_id)
            and (o.owner_id is null or o.owner_id = a.owner_id::text)
           )
     )
     and (
       a.status = 'deleting'
       or (
         a.post_id is null
         and a.status in ('pending', 'quarantined')
         and (
           a.cleanup_last_error in ('upload_failed', 'legacy_invalid_attachment_state')
           or a.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
         )
       )
       or (
         a.post_id is not null
         and a.status in ('attached', 'quarantined')
         and exists (
           select 1 from public.posts p
            where p.id = a.post_id
              and p.status = 'deleted'
              and p.deleted_at < pg_catalog.clock_timestamp() - interval '30 days'
         )
       )
     );

  return found;
end;
$$;

create function public.complete_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.attachments a
     set status = 'deleted',
         deleted_at = pg_catalog.clock_timestamp(),
         cleanup_claim_token = null,
         cleanup_lease_until = null,
         next_attempt_at = null,
         cleanup_last_error = null
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.status = 'deleting'
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp();

  return found;
end;
$$;

create function public.release_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_attempt_count integer;
begin
  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'cleanup failure reason is required' using errcode = '22023';
  end if;

  if p_reason = 'eligibility_changed' then
    update public.attachments a
       set cleanup_claim_token = null,
           cleanup_lease_until = null
     where a.id = p_attachment_id
       and a.storage_path = p_storage_path
       and a.cleanup_claim_token = p_claim_token
       and a.cleanup_lease_until > pg_catalog.clock_timestamp();
    return found;
  end if;

  update public.attachments a
     set cleanup_attempt_count = a.cleanup_attempt_count + 1,
         status = case
           when a.cleanup_attempt_count + 1 >= 5 then 'cleanup_failed'
           else a.status
         end,
         next_attempt_at = case
           when a.cleanup_attempt_count + 1 >= 5 then null
           else pg_catalog.clock_timestamp()
                + pg_catalog.make_interval(secs => (30 * power(2, a.cleanup_attempt_count))::integer)
         end,
         cleanup_claim_token = null,
         cleanup_lease_until = null,
         cleanup_last_error = pg_catalog.left(p_reason, 1000)
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp()
  returning a.cleanup_attempt_count into new_attempt_count;

  return found;
end;
$$;

alter type public.attachment_upload_intent owner to postgres;
alter function public.reserve_attachment_upload(uuid) owner to postgres;
alter function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) owner to postgres;
alter function public.create_attachment_upload_intent(uuid,text,text,bigint) owner to postgres;
alter function public.fail_attachment_upload(uuid,text) owner to postgres;
alter function public.attach_attachments(uuid,uuid[]) owner to postgres;
alter function public.claim_attachment_cleanup(integer) owner to postgres;
alter function public.prepare_attachment_cleanup(uuid,text,uuid) owner to postgres;
alter function public.complete_attachment_cleanup(uuid,text,uuid) owner to postgres;
alter function public.release_attachment_cleanup(uuid,text,uuid,text) owner to postgres;

revoke all on function public.reserve_attachment_upload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.create_attachment_upload_intent(uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.fail_attachment_upload(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.attach_attachments(uuid,uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.claim_attachment_cleanup(integer) from public, anon, authenticated, service_role;
revoke all on function public.prepare_attachment_cleanup(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_attachment_cleanup(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.release_attachment_cleanup(uuid,text,uuid,text) from public, anon, authenticated, service_role;

grant execute on function public.reserve_attachment_upload(uuid) to authenticated;
grant execute on function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) to authenticated;
grant execute on function public.create_attachment_upload_intent(uuid,text,text,bigint) to authenticated;
grant execute on function public.fail_attachment_upload(uuid,text) to authenticated;
grant execute on function public.attach_attachments(uuid,uuid[]) to authenticated;
grant execute on function public.claim_attachment_cleanup(integer) to service_role;
grant execute on function public.prepare_attachment_cleanup(uuid,text,uuid) to service_role;
grant execute on function public.complete_attachment_cleanup(uuid,text,uuid) to service_role;
grant execute on function public.release_attachment_cleanup(uuid,text,uuid,text) to service_role;
-- END SOURCE: supabase/migrations/202609260003_storage.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 05 OF 20: 202609260004_public_post_read_model.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609260004_public_post_read_model.sql
-- Bounded public post list metrics and a controlled RLS-aware read RPC.

begin;

-- The migration backfill and trigger installation must observe one stable
-- write-free interval. These locks are held until the migration commits.
lock table public.comments, public.post_reactions in share row exclusive mode;

create table private.post_metrics (
  post_id uuid primary key references public.posts(id) on delete cascade,
  comment_count bigint not null default 0 check (comment_count >= 0)
);

create table private.post_reaction_counts (
  post_id uuid not null references public.posts(id) on delete cascade,
  reaction_bucket smallint not null check (reaction_bucket between 0 and 63),
  reaction_count bigint not null default 0 check (reaction_count >= 0),
  primary key (post_id, reaction_bucket)
);

create table private.post_reaction_daily_counts (
  post_id uuid not null references public.posts(id) on delete cascade,
  reaction_date date not null,
  reaction_bucket smallint not null check (reaction_bucket between 0 and 63),
  reaction_count bigint not null default 0 check (reaction_count >= 0),
  primary key (post_id, reaction_date, reaction_bucket)
);
insert into private.post_metrics(post_id, comment_count)
select p.id,
  (select count(*)::bigint from public.comments c where c.post_id=p.id and c.status='published' and c.deleted_at is null)
from public.posts p;

insert into private.post_reaction_counts(post_id,reaction_bucket,reaction_count)
select r.post_id,(get_byte(uuid_send(r.user_id),15)%64)::smallint,count(*)::bigint
from public.post_reactions r
group by r.post_id,(get_byte(uuid_send(r.user_id),15)%64)::smallint;

insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
select r.post_id, (r.created_at at time zone 'UTC')::date, (get_byte(uuid_send(r.user_id),15)%64)::smallint, count(*)::bigint
from public.post_reactions r
group by r.post_id,(r.created_at at time zone 'UTC')::date,(get_byte(uuid_send(r.user_id),15)%64)::smallint;

create function private.maintain_public_comment_count()
returns trigger language plpgsql set search_path='' as $$
declare old_public boolean := false; new_public boolean := false;
begin
  if tg_op <> 'INSERT' then old_public := old.status='published' and old.deleted_at is null; end if;
  if tg_op <> 'DELETE' then new_public := new.status='published' and new.deleted_at is null; end if;
  if tg_op <> 'INSERT' and old_public then
    update private.post_metrics
       set comment_count=greatest(0,comment_count-1)
     where post_id=old.post_id;
  end if;
  if tg_op <> 'DELETE' and new_public then
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
  end if;
  return coalesce(new,old);
end $$;

create trigger comments_maintain_public_count
after insert or delete or update of post_id,status,deleted_at on public.comments
for each row execute function private.maintain_public_comment_count();

create function private.maintain_post_reaction_daily_count()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op <> 'INSERT' then
    update private.post_reaction_counts
       set reaction_count=greatest(0,reaction_count-1)
     where post_id=old.post_id
       and reaction_bucket=(get_byte(uuid_send(old.user_id),15)%64)::smallint;
    update private.post_reaction_daily_counts
       set reaction_count=greatest(0,reaction_count-1)
     where post_id=old.post_id and reaction_date=(old.created_at at time zone 'UTC')::date
       and reaction_bucket=(get_byte(uuid_send(old.user_id),15)%64)::smallint;
  end if;
  if tg_op <> 'DELETE' then
    insert into private.post_reaction_counts(post_id,reaction_bucket,reaction_count)
    values(new.post_id,(get_byte(uuid_send(new.user_id),15)%64)::smallint,1)
    on conflict(post_id,reaction_bucket) do update
      set reaction_count=private.post_reaction_counts.reaction_count+1;
    insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
    values(new.post_id,(new.created_at at time zone 'UTC')::date,(get_byte(uuid_send(new.user_id),15)%64)::smallint,1)
    on conflict(post_id,reaction_date,reaction_bucket) do update
      set reaction_count=private.post_reaction_daily_counts.reaction_count+1;
  end if;
  return coalesce(new,old);
end $$;

create trigger post_reactions_maintain_daily_count
after insert or delete or update of user_id,post_id,created_at on public.post_reactions
for each row execute function private.maintain_post_reaction_daily_count();

-- The public RPC sums at most 30 days x 64 indexed buckets per post. Sharding
-- avoids serializing independent users on one hot counter row. This avoids a
-- scheduler dependency while never scanning raw reaction identities per request.
create function private.public_post_counts(p_post_id uuid)
returns table(comment_count bigint,reaction_count bigint,popularity_score bigint)
language sql stable security definer set search_path='' as $$
  select coalesce(m.comment_count,0), coalesce(total.reaction_count,0),
         coalesce(m.comment_count,0)+coalesce(r.recent_reaction_count,0)*2
  from (select 1) seed
  left join private.post_metrics m on m.post_id=p_post_id
  left join lateral (
    select coalesce(sum(a.reaction_count),0)::bigint reaction_count
    from private.post_reaction_counts a
    where a.post_id=p_post_id
  ) total on true
  left join lateral (
    select coalesce(sum(b.reaction_count),0)::bigint recent_reaction_count
    from private.post_reaction_daily_counts b
    where b.post_id=p_post_id
      and b.reaction_date between (statement_timestamp() at time zone 'UTC')::date-29
                              and (statement_timestamp() at time zone 'UTC')::date
  ) r on true
$$;

-- Later attachment migrations replace this implementation. Defining the read
-- model boundary here lets both detail and list reads consume one body mapper.
create function private.public_post_body(p_post_id uuid,p_body_markdown text)
returns text language sql stable set search_path='' as $$
  select p_body_markdown
$$;

create function private.public_post_excerpt(p_post_id uuid,p_body_markdown text)
returns text language sql stable set search_path='' as $$
  select pg_catalog.left(p_body_markdown,180)
$$;

create function public.list_public_posts(
  p_sort text,
  p_limit integer,
  p_search text default null,
  p_tag_id uuid default null,
  p_cursor_is_pinned boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_rank bigint default null,
  p_cursor_id uuid default null,
  p_cursor_search_rank real default null
)
returns table(
  row_number bigint,
  id uuid,
  title text,
  excerpt text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_search_query tsquery;
  v_candidate_count integer;
begin
  if p_sort not in ('newest','comments','popular') then
    raise exception 'invalid post sort' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if p_search is not null and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 200 then
    raise exception 'invalid search' using errcode='22023';
  end if;
  if (p_cursor_is_pinned is null) <> (p_cursor_created_at is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_id is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_search_rank is null)
     or (p_cursor_is_pinned is null and p_cursor_rank is not null)
     or (p_sort='newest' and p_cursor_rank is not null)
     or (p_sort<>'newest' and p_cursor_is_pinned is not null and p_cursor_rank is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at))
     or (p_cursor_search_rank is not null and not (p_cursor_search_rank >= 0 and p_cursor_search_rank < 1)) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  v_search_query := case
    when p_search is null or pg_catalog.btrim(p_search)='' then null
    else pg_catalog.websearch_to_tsquery('simple',pg_catalog.btrim(p_search))
  end;

  -- Bound anonymous work before evaluating per-post aggregate shards. The
  -- subquery stops as soon as one row beyond the supported capacity is found.
  select pg_catalog.count(*)::integer
    into v_candidate_count
    from (
      select 1
      from public.posts p
      where p.status='published' and p.deleted_at is null
        and (v_search_query is null or
          (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
           pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ v_search_query)
        and (p_tag_id is null or exists(
          select 1 from public.post_tags f
          join public.tags ft on ft.id=f.tag_id and ft.is_active
          where f.post_id=p.id and f.tag_id=p_tag_id
        ))
      limit 5001
    ) bounded_candidates;
  if v_candidate_count > 5000 then
    raise exception 'public post list capacity exceeded' using errcode='54000';
  end if;

  return query
  with candidates as (
    select p.id,p.title,private.public_post_excerpt(p.id,p.body_markdown) excerpt,
      p.created_at,p.updated_at,p.is_locked,p.is_pinned,
      pr.id author_id,pr.login author_login,pr.display_name author_display_name,pr.avatar_url author_avatar_url,
      coalesce(t.tags,'[]'::jsonb) tags,
      c.comment_count,c.reaction_count,c.popularity_score,
      case p_sort when 'comments' then c.comment_count when 'popular' then c.popularity_score else null end rank_key,
      case when v_search_query is null then 0::real
           else pg_catalog.ts_rank(s.search_document,v_search_query,32) end search_rank
    from public.posts p
    join public.profiles pr on pr.id=p.author_id
    cross join lateral private.public_post_counts(p.id) c
    cross join lateral (
      select pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
             pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B') search_document
    ) s
    left join lateral (
      select jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'label',t.label) order by t.sort_order,t.label,t.id) tags
      from public.post_tags pt join public.tags t on t.id=pt.tag_id
      where pt.post_id=p.id and t.is_active
    ) t on true
    where p.status='published' and p.deleted_at is null
      and (v_search_query is null or s.search_document @@ v_search_query)
      and (p_tag_id is null or exists(
        select 1 from public.post_tags f
        join public.tags ft on ft.id=f.tag_id and ft.is_active
        where f.post_id=p.id and f.tag_id=p_tag_id
      ))
  ), paged as (
    select x.*
    from candidates x
    where p_cursor_is_pinned is null
       or x.is_pinned < p_cursor_is_pinned
       or (x.is_pinned=p_cursor_is_pinned and (
         (p_sort='newest' and (x.search_rank,x.created_at,x.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id))
         or (p_sort<>'newest' and (x.search_rank,x.rank_key,x.created_at,x.id)<(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
       ))
    order by x.is_pinned desc,
      x.search_rank desc,
      case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
      x.created_at desc,x.id desc
    limit p_limit+1
  )
  select row_number() over (
           order by x.is_pinned desc,
             x.search_rank desc,
             case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
             x.created_at desc,x.id desc
         ), x.*
  from paged x
  order by x.is_pinned desc,
    x.search_rank desc,
    case when p_sort='comments' then x.comment_count when p_sort='popular' then x.popularity_score end desc nulls last,
    x.created_at desc,x.id desc;
end $$;

create function public.get_public_post(p_post_id uuid)
returns table(
  id uuid,
  title text,
  body_markdown text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint
)
language sql stable security definer set search_path='' as $$
  select p.id,p.title,p.body_markdown,p.created_at,p.updated_at,p.is_locked,p.is_pinned,
    pr.id,pr.login,pr.display_name,pr.avatar_url,
    coalesce(t.tags,'[]'::jsonb),c.comment_count,c.reaction_count,c.popularity_score
  from public.posts p
  join public.profiles pr on pr.id=p.author_id
  cross join lateral private.public_post_counts(p.id) c
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
      order by tag.sort_order,tag.label,tag.id
    ) tags
    from public.post_tags pt
    join public.tags tag on tag.id=pt.tag_id and tag.is_active
    where pt.post_id=p.id
  ) t on true
  where p.id=p_post_id and p.status='published' and p.deleted_at is null
$$;

alter function private.maintain_public_comment_count() owner to postgres;
alter function private.maintain_post_reaction_daily_count() owner to postgres;
alter function private.public_post_counts(uuid) owner to postgres;
alter function private.public_post_excerpt(uuid,text) owner to postgres;
alter function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on table private.post_metrics,private.post_reaction_counts,private.post_reaction_daily_counts from public,anon,authenticated;
revoke all on function private.maintain_public_comment_count(),private.maintain_post_reaction_daily_count(),private.public_post_counts(uuid) from public,anon,authenticated;
revoke all on function private.public_post_excerpt(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) to anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
-- END SOURCE: supabase/migrations/202609260004_public_post_read_model.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 06 OF 20: 202609260005_profile_provisioning.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609260005_profile_provisioning.sql
-- Provision application profiles from verified GitHub OAuth metadata without
-- granting browser roles direct write access to public.profiles.

create function private.provision_github_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider text;
  provider_id_text text;
  github_id bigint;
  github_login text;
  github_display_name text;
  github_avatar_url text;
  existing_github_id bigint;
begin
  provider := new.raw_app_meta_data ->> 'provider';

  -- Non-GitHub and incomplete/malformed auth rows remain valid auth platform
  -- rows, but fail closed by receiving no application profile.
  if provider is distinct from 'github' then
    return new;
  end if;

  provider_id_text := pg_catalog.btrim(new.raw_user_meta_data ->> 'provider_id');
  if provider_id_text is null or provider_id_text !~ '^[0-9]+$' then
    return new;
  end if;

  begin
    github_id := provider_id_text::bigint;
  exception
    when numeric_value_out_of_range then
      return new;
  end;

  if github_id <= 0 then
    return new;
  end if;

  github_login := pg_catalog.btrim(new.raw_user_meta_data ->> 'user_name');
  if github_login is null
     or pg_catalog.char_length(github_login) not between 1 and 39
     or github_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$' then
    return new;
  end if;

  github_display_name := pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name');
  if github_display_name is not null
     and pg_catalog.char_length(github_display_name) not between 1 and 120 then
    return new;
  end if;

  github_avatar_url := pg_catalog.btrim(new.raw_user_meta_data ->> 'avatar_url');
  if github_avatar_url is not null
     and (
       pg_catalog.char_length(github_avatar_url) > 2048
       or github_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    github_avatar_url := null;
  end if;

  -- Serialize claims for one provider identity so concurrent auth events cannot
  -- race through the conflict checks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-profile:' || github_id::text, 0)
  );

  select p.github_user_id
    into existing_github_id
    from public.profiles as p
   where p.id = new.id
   for update;

  if found and existing_github_id <> github_id then
    raise exception 'GitHub identity does not match existing profile'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.profiles as p
     where p.github_user_id = github_id
       and p.id <> new.id
  ) then
    raise exception 'GitHub identity is already linked to another profile'
      using errcode = '23505';
  end if;

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url
  ) values (
    new.id,
    github_id,
    github_login,
    github_display_name,
    github_avatar_url
  )
  on conflict (id) do update
    set login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = pg_catalog.clock_timestamp()
    where public.profiles.github_user_id = excluded.github_user_id;

  return new;
end;
$$;

alter function private.provision_github_profile() owner to postgres;
revoke all on function private.provision_github_profile() from public, anon, authenticated;

create trigger users_provision_github_profile
after insert or update of raw_app_meta_data, raw_user_meta_data on auth.users
for each row execute function private.provision_github_profile();
-- END SOURCE: supabase/migrations/202609260005_profile_provisioning.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 07 OF 20: 202609270001_public_attachment_resolver.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609270001_public_attachment_resolver.sql
-- Service-only authorization boundary for public attachment delivery.

begin;

create function public.resolve_public_attachment(p_attachment_id uuid)
returns table(
  attachment_id uuid,
  owner_id uuid,
  object_token uuid,
  storage_path text,
  mime_type text,
  byte_size bigint
)
language sql stable security definer set search_path='' as $$
  select a.id,a.owner_id,a.client_key,a.storage_path,a.mime_type,a.byte_size
    from public.attachments a
    join public.posts p on p.id=a.post_id
   where a.id=p_attachment_id
     and a.client_key is not null
     and a.payload_sha256 is not null
     and a.storage_path collate "C" =
       (a.owner_id::text||'/'||a.client_key::text) collate "C"
     and a.status='attached'
     and a.deleted_at is null
     and p.status='published'
     and p.deleted_at is null
$$;

alter function public.resolve_public_attachment(uuid) owner to postgres;
revoke all on function public.resolve_public_attachment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_public_attachment(uuid) to service_role;

commit;
-- END SOURCE: supabase/migrations/202609270001_public_attachment_resolver.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 08 OF 20: 202609270002_trusted_github_profile_provisioning.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609270002_trusted_github_profile_provisioning.sql
-- Replace user-editable auth.users metadata provisioning with trusted OAuth
-- identity records managed by Supabase Auth.

drop trigger if exists users_provision_github_profile on auth.users;

drop trigger if exists identities_provision_github_profile on auth.identities;

create or replace function private.provision_github_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_id_text text;
  github_id bigint;
  github_login text;
  github_display_name text;
  github_avatar_url text;
  existing_github_id bigint;
begin
  -- Non-GitHub and malformed identity rows remain valid auth platform rows,
  -- but fail closed by receiving no application profile.
  if new.provider is distinct from 'github' then
    return new;
  end if;

  provider_id_text := pg_catalog.btrim(new.provider_id);
  if provider_id_text is null or provider_id_text !~ '^[0-9]+$' then
    return new;
  end if;

  begin
    github_id := provider_id_text::bigint;
  exception
    when numeric_value_out_of_range then
      return new;
  end;

  if github_id <= 0 then
    return new;
  end if;

  github_login := pg_catalog.btrim(new.identity_data ->> 'user_name');
  if github_login is null
     or pg_catalog.char_length(github_login) not between 1 and 39
     or github_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or github_login ~ '--' then
    return new;
  end if;

  github_display_name := pg_catalog.btrim(new.identity_data ->> 'full_name');
  if github_display_name is not null
     and pg_catalog.char_length(github_display_name) not between 1 and 120 then
    github_display_name := null;
  end if;

  github_avatar_url := pg_catalog.btrim(new.identity_data ->> 'avatar_url');
  if github_avatar_url is not null
     and (
       pg_catalog.char_length(github_avatar_url) not between 1 and 2048
       or github_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    github_avatar_url := null;
  end if;

  -- Serialize both claims that must remain one-to-one. The user lock prevents
  -- concurrent identities from assigning different GitHub ids to one profile;
  -- the provider lock prevents one GitHub id from reaching different users.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-profile-user:' || new.user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-profile-provider:' || github_id::text, 0)
  );

  select p.github_user_id
    into existing_github_id
    from public.profiles as p
   where p.id = new.user_id
   for update;

  if found and existing_github_id <> github_id then
    raise exception 'GitHub identity does not match existing profile'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.profiles as p
     where p.github_user_id = github_id
       and p.id <> new.user_id
  ) then
    raise exception 'GitHub identity is already linked to another profile'
      using errcode = '23505';
  end if;

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url
  ) values (
    new.user_id,
    github_id,
    github_login,
    github_display_name,
    github_avatar_url
  )
  on conflict (id) do update
    set login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = pg_catalog.clock_timestamp()
    where public.profiles.github_user_id = excluded.github_user_id;

  return new;
end;
$$;

alter function private.provision_github_profile() owner to postgres;
revoke all on function private.provision_github_profile() from public, anon, authenticated;

create trigger identities_provision_github_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_github_profile();
-- END SOURCE: supabase/migrations/202609270002_trusted_github_profile_provisioning.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 09 OF 20: 202609270003_public_attachment_body_urls.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609270003_public_attachment_body_urls.sql
-- Rewrite public post attachment references without exposing private Storage paths.

begin;

alter table public.posts drop constraint posts_body_length_check;
alter table public.posts add constraint posts_body_length_check check (
  pg_catalog.char_length(pg_catalog.btrim(body_markdown)) between 1 and 50000
  and pg_catalog.char_length(body_markdown) <= 50000
);

-- Scan one bounded UTF-8 byte string while copying untouched spans exactly.
-- The mapping arrays are capped by the wrapper; this helper reads no relation.
create or replace function private.scan_public_post_body(
  p_body text,
  p_attachment_ids uuid[],
  p_storage_paths text[]
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  unavailable constant text := 'about:blank#attachment-unavailable';
  src bytea;
  result bytea := ''::bytea;
  n integer;
  i integer := 0;
  copy_at integer := 0;
  j integer;
  k integer;
  span_end integer;
  core_end integer;
  replace_at integer;
  quote_end integer := -1;
  nesting integer := 0;
  transformations integer := 0;
  c integer;
  previous integer;
  escaped boolean;
  strip_angle boolean;
  candidate text;
  core text;
  lowered text;
  uri_path text;
  path_value text;
  key_name text;
  replacement text;
  mapped_id uuid;
  item integer;
begin
  if p_body is null then
    return null;
  end if;
  if pg_catalog.char_length(p_body)>50000 then
    raise exception 'public post body capacity exceeded' using errcode='54000';
  end if;
  if coalesce(pg_catalog.cardinality(p_attachment_ids),0)>5
     or coalesce(pg_catalog.cardinality(p_storage_paths),0)>5
     or coalesce(pg_catalog.cardinality(p_attachment_ids),0)<>
        coalesce(pg_catalog.cardinality(p_storage_paths),0) then
    raise exception 'public post attachment capacity exceeded' using errcode='54000';
  end if;

  src := pg_catalog.convert_to(p_body,'UTF8');
  n := pg_catalog.length(src);
  while i<n loop
    c := pg_catalog.get_byte(src,i);
    previous := case when i=0 then null else pg_catalog.get_byte(src,i-1) end;

    if quote_end>=0 then
      if i=quote_end then
        quote_end := -1;
        i := i+1;
        continue;
      elsif i>quote_end then
        quote_end := -1;
      end if;
    end if;

    -- Any unescaped quote establishes a one-line lexical span, independent of
    -- preceding punctuation. Backslash parity distinguishes escaped quotes.
    if c in (34,39) and quote_end<0 then
      k := i;
      escaped := false;
      while k>0 and pg_catalog.get_byte(src,k-1)=92 loop
        escaped := not escaped;
        k := k-1;
      end loop;
      if not escaped then
        j := i+1;
        escaped := false;
        while j<n loop
          if pg_catalog.get_byte(src,j) in (10,13) then
            exit;
          elsif escaped then
            escaped := false;
          elsif pg_catalog.get_byte(src,j)=92 then
            escaped := true;
          elsif pg_catalog.get_byte(src,j)=c then
            j := j+1;
            exit;
          end if;
          j := j+1;
        end loop;
        candidate := pg_catalog.convert_from(pg_catalog.substr(src,i+1,j-i),'UTF8');
        if candidate ~* '(^|[^[:alnum:]_-])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[[:space:]]*='
           or candidate ~* '(^|[^[:alnum:]_-])sb_secret_[[:alnum:]_-]+($|[^[:alnum:]_-])' then
          replace_at := i;
          replacement := unavailable;
          if i>copy_at and previous in (9,32) and j<n and pg_catalog.get_byte(src,j)=41 then
            replace_at := i-1;
            replacement := '';
          end if;
          transformations := transformations+1;
          if transformations>256 then
            raise exception 'public post body transformation capacity exceeded' using errcode='54000';
          end if;
          result := result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
                   ||pg_catalog.convert_to(replacement,'UTF8');
          i := j;
          copy_at := j;
          continue;
        end if;
        if j>i+1 and pg_catalog.get_byte(src,j-1)=c then
          quote_end := j-1;
        end if;
        i := i+1;
        continue;
      end if;
    end if;

    -- Absolute URI recognition precedes every standalone-path rule. Only a
    -- managed endpoint or credential can change an otherwise ordinary URI.
    if (c between 65 and 90 or c between 97 and 122)
       and (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (43,45,46)
       )) then
      j := i+1;
      while j<n and (
        pg_catalog.get_byte(src,j) between 48 and 57 or
        pg_catalog.get_byte(src,j) between 65 and 90 or
        pg_catalog.get_byte(src,j) between 97 and 122 or
        pg_catalog.get_byte(src,j) in (43,45,46)
      ) loop
        j := j+1;
      end loop;
      if j<n and pg_catalog.get_byte(src,j)=58 then
          span_end := j+1;
          while span_end<n and pg_catalog.get_byte(src,span_end)>32
            and pg_catalog.get_byte(src,span_end) not in (34,39,60,62) loop
            span_end := span_end+1;
          end loop;
          core_end := span_end;
          while core_end>j+1 and pg_catalog.get_byte(src,core_end-1) in (33,35,41,44,46,59,63,91,93) loop
            core_end := core_end-1;
          end loop;
          candidate := pg_catalog.convert_from(pg_catalog.substr(src,i+1,span_end-i),'UTF8');
          core := pg_catalog.convert_from(pg_catalog.substr(src,i+1,core_end-i),'UTF8');
          lowered := pg_catalog.lower(core);
          replacement := null;
          uri_path := null;
          if j+2<n and pg_catalog.get_byte(src,j+1)=47 and pg_catalog.get_byte(src,j+2)=47 then
            k := pg_catalog.strpos(pg_catalog.substr(lowered,j-i+4),'/');
            if k>0 then
              uri_path := pg_catalog.substr(core,j-i+3+k);
            end if;
          else
            uri_path := pg_catalog.substr(core,j-i+2);
          end if;
          if uri_path is not null then
            lowered := pg_catalog.lower(uri_path);
            if lowered ~ '^/?storage/v1/object/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?storage/v1/object/','','i');
              if pg_catalog.starts_with(pg_catalog.lower(path_value),'public/') then path_value:=pg_catalog.substr(path_value,8);
              elsif pg_catalog.starts_with(pg_catalog.lower(path_value),'sign/') then path_value:=pg_catalog.substr(path_value,6);
              elsif pg_catalog.starts_with(pg_catalog.lower(path_value),'authenticated/') then path_value:=pg_catalog.substr(path_value,15);
              end if;
              if pg_catalog.starts_with(pg_catalog.lower(path_value),'community-images/') then
                path_value:=pg_catalog.substr(path_value,18);
                path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
                mapped_id:=null;
                for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
                  if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
                end loop;
                replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
              else replacement:=unavailable;
              end if;
            elsif lowered ~ '^/?community-images/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?community-images/','','i');
              path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
              mapped_id:=null;
              for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
                if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
              end loop;
              replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
            elsif lowered ~ '^/?functions/v1/public-attachment/' then
              path_value:=pg_catalog.regexp_replace(uri_path,'^/?functions/v1/public-attachment/','','i');
              path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
              mapped_id:=null;
              for item in 1..coalesce(pg_catalog.cardinality(p_attachment_ids),0) loop
                if pg_catalog.lower(path_value)=p_attachment_ids[item]::text then mapped_id:=p_attachment_ids[item]; exit; end if;
              end loop;
              replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
            end if;
          end if;
          if replacement is null and (
               candidate ~* '(^|[^[:alnum:]_-])(token|api[_-]?key|signature|signed|secret|service[_-]?role|x-amz-(credential|signature))[[:space:]]*='
               or candidate ~* '(^|[^[:alnum:]_-])sb_secret_[[:alnum:]_-]+($|[^[:alnum:]_-])'
             ) then
            replacement := unavailable;
          end if;
          if replacement is not null then
            strip_angle:=i>=3 and previous=60
              and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
            replace_at:=case when strip_angle then i-1 else i end;
            transformations := transformations+1;
            if transformations>256 then
              raise exception 'public post body transformation capacity exceeded' using errcode='54000';
            end if;
            result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
                   ||pg_catalog.convert_to(replacement,'UTF8')
                   ||pg_catalog.substr(src,core_end+1,span_end-core_end);
            if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
              span_end:=span_end+1;
            end if;
            i:=span_end;
            copy_at:=span_end;
          else
            i:=span_end;
          end if;
          k:=core_end;
          while k<span_end loop
            c:=pg_catalog.get_byte(src,k);
            if c in (40,91,123) then
              nesting:=nesting+1;
              if nesting>32 then return unavailable; end if;
            elsif c in (41,93,125) and nesting>0 then
              nesting:=nesting-1;
            end if;
            k:=k+1;
          end loop;
          continue;
      end if;
    end if;

    -- Managed route candidates are bounded by Markdown/token delimiters. Their
    -- query and fragment are intentionally discarded; bare ?/# remain syntax.
    candidate := null;
    if (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (45,95)
       )) and (
       pg_catalog.substr(src,i+1,19)=pg_catalog.convert_to('/storage/v1/object/','UTF8')
       or pg_catalog.substr(src,i+1,18)=pg_catalog.convert_to('storage/v1/object/','UTF8')
       or pg_catalog.substr(src,i+1,32)=pg_catalog.convert_to('/functions/v1/public-attachment/','UTF8')
       or pg_catalog.substr(src,i+1,31)=pg_catalog.convert_to('functions/v1/public-attachment/','UTF8')
       or pg_catalog.substr(src,i+1,17)=pg_catalog.convert_to('community-images/','UTF8')) then
      span_end:=i;
      while span_end<n and pg_catalog.get_byte(src,span_end)>32
        and pg_catalog.get_byte(src,span_end) not in (34,39,60,62) loop
        span_end:=span_end+1;
      end loop;
      core_end:=span_end;
      while core_end>i and pg_catalog.get_byte(src,core_end-1) in (33,35,41,44,46,58,59,61,63,91,93) loop core_end:=core_end-1; end loop;
      core:=pg_catalog.convert_from(pg_catalog.substr(src,i+1,core_end-i),'UTF8');
      lowered:=pg_catalog.lower(core);
      path_value:=null;
      if lowered ~ '^/?storage/v1/object/' then
        path_value:=pg_catalog.regexp_replace(core,'^/?storage/v1/object/','','i');
        path_value:=pg_catalog.regexp_replace(path_value,'^(public|sign|authenticated)/','','i');
        if pg_catalog.starts_with(pg_catalog.lower(path_value),'community-images/') then path_value:=pg_catalog.substr(path_value,18); end if;
      elsif pg_catalog.starts_with(lowered,'community-images/') then
        path_value:=pg_catalog.substr(core,18);
      end if;
      mapped_id:=null;
      if path_value is not null then
        path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
        for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
          if path_value collate "C"=p_storage_paths[item] collate "C" then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
      elsif lowered ~ '^/?functions/v1/public-attachment/' then
        path_value:=pg_catalog.regexp_replace(core,'^/?functions/v1/public-attachment/','','i');
        path_value:=pg_catalog.split_part(pg_catalog.split_part(path_value,'?',1),'#',1);
        for item in 1..coalesce(pg_catalog.cardinality(p_attachment_ids),0) loop
          if pg_catalog.lower(path_value)=p_attachment_ids[item]::text then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
      end if;
      replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
      strip_angle:=i>=3 and previous=60
        and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
      replace_at:=case when strip_angle then i-1 else i end;
      transformations := transformations+1;
      if transformations>256 then
        raise exception 'public post body transformation capacity exceeded' using errcode='54000';
      end if;
      result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)
             ||pg_catalog.convert_to(replacement,'UTF8')
             ||pg_catalog.substr(src,core_end+1,span_end-core_end);
      if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
        span_end:=span_end+1;
      end if;
      k:=core_end;
      while k<span_end loop
        c:=pg_catalog.get_byte(src,k);
        if c in (40,91,123) then
          nesting:=nesting+1;
          if nesting>32 then return unavailable; end if;
        elsif c in (41,93,125) and nesting>0 then
          nesting:=nesting-1;
        end if;
        k:=k+1;
      end loop;
      i:=span_end;
      copy_at:=span_end;
      continue;
    end if;

    -- A UUID/UUID pair is sensitive only when it is a standalone token.
    if i+73<=n
       and (c between 48 and 57 or c between 65 and 70 or c between 97 and 102)
       and (previous is null or not (
         previous between 48 and 57 or previous between 65 and 90 or
         previous between 97 and 122 or previous in (45,95)
       ))
       and not (
         i>=18
         and pg_catalog.substr(src,i-16,17)=pg_catalog.convert_to('community-images/','UTF8')
         and (
           pg_catalog.get_byte(src,i-18) between 48 and 57 or
           pg_catalog.get_byte(src,i-18) between 65 and 90 or
           pg_catalog.get_byte(src,i-18) between 97 and 122 or
           pg_catalog.get_byte(src,i-18) in (45,95)
         )
       ) then
      j:=i;
      while j<i+73 and (
        pg_catalog.get_byte(src,j) between 48 and 57 or
        pg_catalog.get_byte(src,j) between 65 and 70 or
        pg_catalog.get_byte(src,j) between 97 and 102 or
        pg_catalog.get_byte(src,j) in (45,47)
      ) loop j:=j+1; end loop;
      if j=i+73 then
        candidate:=pg_catalog.convert_from(pg_catalog.substr(src,i+1,73),'UTF8');
      end if;
      if j=i+73
         and candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (i+73=n or not (
           pg_catalog.get_byte(src,i+73) between 48 and 57 or pg_catalog.get_byte(src,i+73) between 65 and 90 or
           pg_catalog.get_byte(src,i+73) between 97 and 122 or pg_catalog.get_byte(src,i+73) in (45,95)
         )) then
        span_end:=i+73;
        if span_end<n and pg_catalog.get_byte(src,span_end) in (35,63)
           and span_end+1<n and pg_catalog.get_byte(src,span_end+1)>32
           and pg_catalog.get_byte(src,span_end+1) not in (34,39,41,60,62) then
          span_end:=span_end+1;
          while span_end<n and pg_catalog.get_byte(src,span_end)>32
            and pg_catalog.get_byte(src,span_end) not in (34,39,41,60,62) loop span_end:=span_end+1; end loop;
        end if;
        mapped_id:=null;
        for item in 1..coalesce(pg_catalog.cardinality(p_storage_paths),0) loop
          if pg_catalog.lower(candidate)=p_storage_paths[item] then mapped_id:=p_attachment_ids[item]; exit; end if;
        end loop;
        replacement:=coalesce('/functions/v1/public-attachment/'||mapped_id::text,unavailable);
        strip_angle:=i>=3 and previous=60
          and pg_catalog.get_byte(src,i-2)=40 and pg_catalog.get_byte(src,i-3)=93;
        replace_at:=case when strip_angle then i-1 else i end;
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,replace_at-copy_at)||pg_catalog.convert_to(replacement,'UTF8');
        if strip_angle and span_end<n and pg_catalog.get_byte(src,span_end)=62 then
          span_end:=span_end+1;
        end if;
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    -- Standalone assignments consume one escaped or unescaped value token.
    if (c between 65 and 90 or c between 97 and 122)
       and (previous is null or not (previous between 48 and 57 or previous between 65 and 90 or previous between 97 and 122 or previous in (45,95))) then
      j:=i+1;
      while j<n and (pg_catalog.get_byte(src,j) between 48 and 57 or pg_catalog.get_byte(src,j) between 65 and 90 or pg_catalog.get_byte(src,j) between 97 and 122 or pg_catalog.get_byte(src,j) in (45,95)) loop j:=j+1; end loop;
      key_name:=pg_catalog.lower(pg_catalog.convert_from(pg_catalog.substr(src,i+1,j-i),'UTF8'));
      k:=j;
      while k<n and pg_catalog.get_byte(src,k) in (9,32) loop k:=k+1; end loop;
      if key_name in ('token','apikey','api-key','api_key','signature','signed','secret','service-role','service_role','x-amz-credential','x-amz-signature')
         and k<n and pg_catalog.get_byte(src,k)=61 then
        span_end:=k+1;
        if span_end<n and pg_catalog.get_byte(src,span_end) in (34,39) then
          c:=pg_catalog.get_byte(src,span_end);
          span_end:=span_end+1;
          escaped:=false;
          while span_end<n loop
            if pg_catalog.get_byte(src,span_end) in (10,13) then exit;
            elsif escaped then escaped:=false;
            elsif pg_catalog.get_byte(src,span_end)=92 then escaped:=true;
            elsif pg_catalog.get_byte(src,span_end)=c then span_end:=span_end+1; exit;
            end if;
            span_end:=span_end+1;
          end loop;
          core_end:=span_end;
        else
          escaped:=false;
          while span_end<n loop
            c:=pg_catalog.get_byte(src,span_end);
            if escaped then escaped:=false;
            elsif c=92 then escaped:=true;
            elsif c<=32 or c in (34,39,41,60,62) then exit;
            end if;
            span_end:=span_end+1;
          end loop;
          core_end:=span_end;
          while core_end>k+1 and pg_catalog.get_byte(src,core_end-1) in (33,44,46,59,63,91,93) loop core_end:=core_end-1; end loop;
        end if;
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,i-copy_at)||pg_catalog.convert_to(unavailable,'UTF8')
               ||pg_catalog.substr(src,core_end+1,span_end-core_end);
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    if i+10<=n
       and pg_catalog.get_byte(src,i) in (83,115)
       and pg_catalog.get_byte(src,i+1) in (66,98)
       and pg_catalog.get_byte(src,i+2)=95
       and pg_catalog.get_byte(src,i+3) in (83,115)
       and pg_catalog.get_byte(src,i+4) in (69,101)
       and pg_catalog.get_byte(src,i+5) in (67,99)
       and pg_catalog.get_byte(src,i+6) in (82,114)
       and pg_catalog.get_byte(src,i+7) in (69,101)
       and pg_catalog.get_byte(src,i+8) in (84,116)
       and pg_catalog.get_byte(src,i+9)=95
       and (previous is null or not (previous between 48 and 57 or previous between 65 and 90 or previous between 97 and 122 or previous in (45,95))) then
      span_end:=i+10;
      while span_end<n and (pg_catalog.get_byte(src,span_end) between 48 and 57 or pg_catalog.get_byte(src,span_end) between 65 and 90 or pg_catalog.get_byte(src,span_end) between 97 and 122 or pg_catalog.get_byte(src,span_end) in (45,95)) loop span_end:=span_end+1; end loop;
      if span_end>i+10 and (span_end=n or not (pg_catalog.get_byte(src,span_end) between 48 and 57 or pg_catalog.get_byte(src,span_end) between 65 and 90 or pg_catalog.get_byte(src,span_end) between 97 and 122 or pg_catalog.get_byte(src,span_end) in (45,95))) then
        transformations := transformations+1;
        if transformations>256 then
          raise exception 'public post body transformation capacity exceeded' using errcode='54000';
        end if;
        result:=result||pg_catalog.substr(src,copy_at+1,i-copy_at)||pg_catalog.convert_to(unavailable,'UTF8');
        i:=span_end;
        copy_at:=span_end;
        continue;
      end if;
    end if;

    if c in (40,91,123) then
      nesting:=nesting+1;
      if nesting>32 then return unavailable; end if;
    elsif c in (41,93,125) and nesting>0 then
      nesting:=nesting-1;
    end if;
    i:=i+1;
  end loop;
  result:=result||pg_catalog.substr(src,copy_at+1);
  return pg_catalog.convert_from(result,'UTF8');
end;
$$;

create or replace function private.public_post_body(
  p_post_id uuid,
  p_body_markdown text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attachment_ids uuid[];
  storage_paths text[];
begin
  if p_body_markdown is null then return null; end if;
  if pg_catalog.char_length(p_body_markdown)>50000 then
    raise exception 'public post body capacity exceeded' using errcode='54000';
  end if;
  select coalesce(pg_catalog.array_agg(a.id order by a.id),array[]::uuid[]),
         coalesce(pg_catalog.array_agg(a.storage_path order by a.id),array[]::text[])
    into attachment_ids,storage_paths
    from (
      select x.id,x.storage_path
        from public.attachments x
       where x.post_id=p_post_id and x.status='attached' and x.deleted_at is null
         and x.client_key is not null and x.payload_sha256 is not null
         and x.storage_path collate "C"=(x.owner_id::text||'/'||x.client_key::text) collate "C"
       order by x.id
       limit 6
    ) a;
  if pg_catalog.cardinality(attachment_ids)>5 then
    raise exception 'public post attachment capacity exceeded' using errcode='54000';
  end if;
  return private.scan_public_post_body(p_body_markdown,attachment_ids,storage_paths);
end;
$$;

drop function if exists private.public_attachment_destination(uuid,text,text);

create or replace function private.public_post_excerpt(p_post_id uuid,p_body_markdown text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_body text;
begin
  if p_body_markdown is null then
    return null;
  end if;
  bounded_body := pg_catalog.left(p_body_markdown,2048);
  if pg_catalog.char_length(p_body_markdown)>2048 and bounded_body !~ '[[:space:]]$' then
    bounded_body := pg_catalog.regexp_replace(bounded_body,'[^[:space:]]*$','','n');
  end if;
  return pg_catalog.left(private.public_post_body(p_post_id,bounded_body),180);
end;
$$;

create or replace function public.get_public_post(p_post_id uuid)
returns table(
  id uuid,
  title text,
  body_markdown text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint
)
language sql stable security definer set search_path='' as $$
  select p.id,p.title,private.public_post_body(p.id,p.body_markdown),
    p.created_at,p.updated_at,p.is_locked,p.is_pinned,
    pr.id,pr.login,pr.display_name,pr.avatar_url,
    coalesce(t.tags,'[]'::jsonb),c.comment_count,c.reaction_count,c.popularity_score
  from public.posts p
  join public.profiles pr on pr.id=p.author_id
  cross join lateral private.public_post_counts(p.id) c
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
      order by tag.sort_order,tag.label,tag.id
    ) tags
    from public.post_tags pt
    join public.tags tag on tag.id=pt.tag_id and tag.is_active
    where pt.post_id=p.id
  ) t on true
  where p.id=p_post_id and p.status='published' and p.deleted_at is null
$$;

alter function private.scan_public_post_body(text,uuid[],text[]) owner to postgres;
alter function private.public_post_body(uuid,text) owner to postgres;
alter function private.public_post_excerpt(uuid,text) owner to postgres;
alter function public.get_public_post(uuid) owner to postgres;
revoke all on function private.scan_public_post_body(text,uuid[],text[]) from public,anon,authenticated,service_role;
revoke all on function private.public_post_body(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.public_post_excerpt(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post(uuid) from public,anon,authenticated;
grant execute on function public.get_public_post(uuid) to anon,authenticated;

commit;
-- END SOURCE: supabase/migrations/202609270003_public_attachment_body_urls.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 10 OF 20: 202609270004_post_tombstones.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609270004_post_tombstones.sql
-- Safe public post tombstones and bounded comment reads.

begin;

-- Root order omits parent_id, so this partial index supports the root keyset walk.
create index comments_public_roots_page_idx
  on public.comments(post_id,created_at,id)
  where parent_id is null and status='published' and deleted_at is null;
-- The narrower reply index bounds each lateral reply seek by parent and cursor.
create index comments_public_replies_page_idx
  on public.comments(post_id,parent_id,created_at,id)
  where parent_id is not null and status='published' and deleted_at is null;

create or replace function public.get_public_post_v2(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_deleted_at timestamptz;
  v_post jsonb;
  v_comment_count bigint;
begin
  select p.status,p.deleted_at
    into v_status,v_deleted_at
    from public.posts p
   where p.id=p_post_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind','not_found');
  end if;
  if v_status='hidden' then
    return pg_catalog.jsonb_build_object('kind','hidden');
  end if;
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(detail)
      into v_post
      from public.get_public_post(p_post_id) detail;
    if v_post is null then
      return pg_catalog.jsonb_build_object('kind','not_found');
    end if;
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null then
    select pg_catalog.count(*)::bigint
      into v_comment_count
      from public.comments c
      join public.comments root
        on root.id=coalesce(c.parent_id,c.id)
       and root.post_id=c.post_id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where c.post_id=p_post_id
       and c.status='published'
       and c.deleted_at is null;
    if v_comment_count > 0 then
      return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_comment_count);
    end if;
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end
$$;

create function public.list_public_post_comments(
  p_post_id uuid,
  p_limit integer default 50,
  p_cursor_root_created_at timestamptz default null,
  p_cursor_root_id uuid default null,
  p_cursor_is_reply boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursors jsonb;
  v_has_more boolean;
  v_next_cursor jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if (p_cursor_root_created_at is null) <> (p_cursor_root_id is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_is_reply is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_created_at is null)
     or (p_cursor_root_created_at is null) <> (p_cursor_id is null)
     or (p_cursor_root_created_at is not null and (
       not pg_catalog.isfinite(p_cursor_root_created_at)
       or not pg_catalog.isfinite(p_cursor_created_at)
       or (not p_cursor_is_reply and (
         p_cursor_root_id<>p_cursor_id
         or p_cursor_root_created_at<>p_cursor_created_at
       ))
       or (p_cursor_is_reply and p_cursor_root_id=p_cursor_id)
     )) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  with visible_roots as materialized (
    select root.id,root.created_at
      from public.posts p
      join public.comments root
        on root.post_id=p.id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where p.id=p_post_id
       and (
         (p.status='published' and p.deleted_at is null)
         or (p.status='deleted' and p.deleted_at is not null)
       )
       and (
         p_cursor_root_created_at is null
         or (root.created_at,root.id)>=(p_cursor_root_created_at,p_cursor_root_id)
       )
     order by root.created_at,root.id
     -- A continuation can include its cursor root while yielding no remaining
     -- items from it, so retain one extra root for the item lookahead.
     limit p_limit+1+case when p_cursor_root_created_at is null then 0 else 1 end
  ), bounded_items as materialized (
    select
      root.created_at root_created_at,
      root.id root_id,
      item.is_reply,
      item.id,item.parent_id,item.body_markdown,item.created_at,item.updated_at,
      item.author_id,item.author_login,item.author_display_name,item.author_avatar_url
    from visible_roots root
    cross join lateral (
      select
        false is_reply,
        root_comment.id,root_comment.parent_id,root_comment.body_markdown,
        root_comment.created_at,root_comment.updated_at,
        author.id author_id,author.login author_login,
        author.display_name author_display_name,author.avatar_url author_avatar_url
      from public.comments root_comment
      join public.profiles author on author.id=root_comment.author_id
      where root_comment.id=root.id and root_comment.post_id=p_post_id
      union all
      (
        select
          true,
          reply.id,reply.parent_id,reply.body_markdown,reply.created_at,reply.updated_at,
          author.id,author.login,author.display_name,author.avatar_url
        from public.comments reply
        join public.profiles author on author.id=reply.author_id
        where reply.post_id=p_post_id
          and reply.parent_id=root.id
          and reply.status='published'
          and reply.deleted_at is null
          and (
            p_cursor_root_created_at is null
            or (root.created_at,root.id)>(p_cursor_root_created_at,p_cursor_root_id)
            or (
              (root.created_at,root.id)=(p_cursor_root_created_at,p_cursor_root_id)
              and (true,reply.created_at,reply.id)>
                  (p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
            )
          )
        order by reply.created_at,reply.id
        limit p_limit+1
      )
    ) item
    where p_cursor_root_created_at is null
       or (root.created_at,root.id,item.is_reply,item.created_at,item.id)>
          (p_cursor_root_created_at,p_cursor_root_id,p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
    order by root.created_at,root.id,item.is_reply,item.created_at,item.id
    limit p_limit+1
  ), page_items as materialized (
    select *
      from bounded_items
     order by root_created_at,root_id,is_reply,created_at,id
     limit p_limit
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',id,
          'parent_id',parent_id,
          'body_markdown',body_markdown,
          'created_at',created_at,
          'updated_at',updated_at,
          'author_id',author_id,
          'author_login',author_login,
          'author_display_name',author_display_name,
          'author_avatar_url',author_avatar_url
        ) order by root_created_at,root_id,is_reply,created_at,id
      ),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'root_created_at',root_created_at,
          'root_id',root_id,
          'is_reply',is_reply,
          'created_at',created_at,
          'id',id
        ) order by root_created_at,root_id,is_reply,created_at,id
      ),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*)>p_limit from bounded_items)
    into v_items,v_cursors,v_has_more
    from page_items;

  v_next_cursor := case when v_has_more then v_cursors->(p_limit-1) else 'null'::jsonb end;
  return pg_catalog.jsonb_build_object(
    'items',v_items,
    'has_more',v_has_more,
    'next_cursor',v_next_cursor
  );
end
$$;

alter function public.get_public_post_v2(uuid) owner to postgres;
alter function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) owner to postgres;

revoke all on function public.get_public_post_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_v2(uuid) to anon,authenticated;
grant execute on function public.list_public_post_comments(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) to anon,authenticated;

commit;
-- END SOURCE: supabase/migrations/202609270004_post_tombstones.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 11 OF 20: 202609270005_unbounded_public_listing.sql
-- Do not run this whole section; follow the 11A/11B selections below.
-- ============================================================================
-- SECTION 11 HAS TWO RUN SELECTIONS (the source bytes below remain unchanged):
-- 11A: select and run only the CREATE INDEX CONCURRENTLY statement (source lines 9-12).
-- 11B: then select and run from the following DO $$ (source line 14) through COMMIT.
-- Never send 11A and 11B as one Dashboard query.
-- BEGIN SOURCE: supabase/migrations/202609270005_unbounded_public_listing.sql
-- Keep cursor-based public post listing available beyond a fixed corpus size.

-- Supabase CLI executes migration files without wrapping them in an implicit
-- transaction, so this can build while reaction writes continue. If a later
-- statement fails, retrying the migration keeps the completed valid index via
-- IF NOT EXISTS. An interrupted concurrent build can leave an invalid index;
-- drop that invalid index concurrently before retrying rather than blocking
-- writes with a transactional rebuild.
create index concurrently if not exists post_reaction_daily_recent_idx
  on private.post_reaction_daily_counts (reaction_date,post_id)
  include (reaction_count)
  where reaction_count > 0;

do $$
declare
  v_indisvalid boolean;
  v_indisready boolean;
begin
  select i.indisvalid,i.indisready
    into v_indisvalid,v_indisready
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join pg_catalog.pg_index i on i.indexrelid=c.oid
  where n.nspname='private'
    and c.relname='post_reaction_daily_recent_idx';

  if not coalesce(v_indisvalid,false) or not coalesce(v_indisready,false) then
    raise exception 'post_reaction_daily_recent_idx is invalid or not ready; run DROP INDEX CONCURRENTLY IF EXISTS private.post_reaction_daily_recent_idx; then retry migration'
      using errcode='55000';
  end if;
end $$;

begin;

create function private.public_post_page_keys(
  p_sort text,
  p_limit integer,
  p_search_query tsquery,
  p_tag_id uuid,
  p_cursor_is_pinned boolean,
  p_cursor_created_at timestamptz,
  p_cursor_rank bigint,
  p_cursor_id uuid,
  p_cursor_search_rank real
)
returns table(
  id uuid,
  is_pinned boolean,
  created_at timestamptz,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
begin
  -- The common no-search newest path can walk the published keyset index and
  -- stop before any metrics, excerpts, profiles, or display tags are loaded.
  if p_sort='newest' and p_search_query is null then
    return query
    select p.id,p.is_pinned,p.created_at,null::bigint,0::real
    from public.posts p
    where p.status='published' and p.deleted_at is null
      and (p_tag_id is null or exists(
        select 1
        from public.post_tags pt
        join public.tags t on t.id=pt.tag_id and t.is_active
        where pt.post_id=p.id and pt.tag_id=p_tag_id
      ))
      and (p_cursor_is_pinned is null
        or p.is_pinned < p_cursor_is_pinned
        or (p.is_pinned=p_cursor_is_pinned
          and (0::real,p.created_at,p.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id)))
    order by p.is_pinned desc,p.created_at desc,p.id desc
    limit p_limit+1;
    return;
  end if;

  -- Search rank is part of every searched cursor, including newest. Ranking is
  -- completed on keys before the selected page is hydrated.
  if p_sort='newest' then
    return query
    with ranked as (
      select p.id,p.is_pinned,p.created_at,
        pg_catalog.ts_rank(
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
          p_search_query,32
        )::real search_rank
      from public.posts p
      where p.status='published' and p.deleted_at is null
        and (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
             pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query
        and (p_tag_id is null or exists(
          select 1 from public.post_tags pt
          join public.tags t on t.id=pt.tag_id and t.is_active
          where pt.post_id=p.id and pt.tag_id=p_tag_id
        ))
    )
    select r.id,r.is_pinned,r.created_at,null::bigint,r.search_rank
    from ranked r
    where p_cursor_is_pinned is null
      or r.is_pinned < p_cursor_is_pinned
      or (r.is_pinned=p_cursor_is_pinned
        and (r.search_rank,r.created_at,r.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id))
    order by r.is_pinned desc,r.search_rank desc,r.created_at desc,r.id desc
    limit p_limit+1;
    return;
  end if;

  -- Comments are ranked from the maintained one-row-per-post metric. There is
  -- no raw comment scan and no per-candidate aggregate helper invocation.
  if p_sort='comments' then
    return query
    with ranked as (
      select p.id,p.is_pinned,p.created_at,
        coalesce(m.comment_count,0)::bigint rank_key,
        case when p_search_query is null then 0::real else
          pg_catalog.ts_rank(
            pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
            pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
            p_search_query,32
          )::real end search_rank
      from public.posts p
      left join private.post_metrics m on m.post_id=p.id
      where p.status='published' and p.deleted_at is null
        and (p_search_query is null or
          (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
           pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query)
        and (p_tag_id is null or exists(
          select 1 from public.post_tags pt
          join public.tags t on t.id=pt.tag_id and t.is_active
          where pt.post_id=p.id and pt.tag_id=p_tag_id
        ))
    )
    select r.id,r.is_pinned,r.created_at,r.rank_key,r.search_rank
    from ranked r
    where p_cursor_is_pinned is null
      or r.is_pinned < p_cursor_is_pinned
      or (r.is_pinned=p_cursor_is_pinned
        and (r.search_rank,r.rank_key,r.created_at,r.id)
          <(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
    order by r.is_pinned desc,r.search_rank desc,r.rank_key desc,r.created_at desc,r.id desc
    limit p_limit+1;
    return;
  end if;

  -- Popularity uses only the bounded 30-UTC-day daily aggregate plus the
  -- maintained comment metric. All-time reactions are loaded after paging for
  -- display, so old reaction buckets do not participate in corpus ranking.
  return query
  with recent_reactions as materialized (
    select d.post_id,coalesce(sum(d.reaction_count),0)::bigint recent_count
    from private.post_reaction_daily_counts d
    where d.reaction_date between (pg_catalog.statement_timestamp() at time zone 'UTC')::date-29
                              and (pg_catalog.statement_timestamp() at time zone 'UTC')::date
      and d.reaction_count > 0
    group by d.post_id
  ), ranked as (
    select p.id,p.is_pinned,p.created_at,
      (coalesce(m.comment_count,0)+coalesce(rr.recent_count,0)*2)::bigint rank_key,
      case when p_search_query is null then 0::real else
        pg_catalog.ts_rank(
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
          p_search_query,32
        )::real end search_rank
    from public.posts p
    left join private.post_metrics m on m.post_id=p.id
    left join recent_reactions rr on rr.post_id=p.id
    where p.status='published' and p.deleted_at is null
      and (p_search_query is null or
        (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
         pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query)
      and (p_tag_id is null or exists(
        select 1 from public.post_tags pt
        join public.tags t on t.id=pt.tag_id and t.is_active
        where pt.post_id=p.id and pt.tag_id=p_tag_id
      ))
  )
  select r.id,r.is_pinned,r.created_at,r.rank_key,r.search_rank
  from ranked r
  where p_cursor_is_pinned is null
    or r.is_pinned < p_cursor_is_pinned
    or (r.is_pinned=p_cursor_is_pinned
      and (r.search_rank,r.rank_key,r.created_at,r.id)
        <(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
  order by r.is_pinned desc,r.search_rank desc,r.rank_key desc,r.created_at desc,r.id desc
  limit p_limit+1;
end $$;

create or replace function public.list_public_posts(
  p_sort text,
  p_limit integer,
  p_search text default null,
  p_tag_id uuid default null,
  p_cursor_is_pinned boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_rank bigint default null,
  p_cursor_id uuid default null,
  p_cursor_search_rank real default null
)
returns table(
  row_number bigint,
  id uuid,
  title text,
  excerpt text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_search_query tsquery;
begin
  if p_sort is null or p_sort not in ('newest','comments','popular') then
    raise exception 'invalid post sort' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if p_search is not null and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 200 then
    raise exception 'invalid search' using errcode='22023';
  end if;

  v_search_query := case
    when p_search is null or pg_catalog.btrim(p_search)='' then null
    else pg_catalog.websearch_to_tsquery('simple',pg_catalog.btrim(p_search))
  end;

  if (p_cursor_is_pinned is null) <> (p_cursor_created_at is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_id is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_search_rank is null)
     or (p_cursor_is_pinned is null and p_cursor_rank is not null)
     or (p_sort='newest' and p_cursor_rank is not null)
     or (p_sort<>'newest' and p_cursor_is_pinned is not null and p_cursor_rank is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at))
     or (p_cursor_search_rank is not null and not (p_cursor_search_rank >= 0 and p_cursor_search_rank < 1))
     or (p_cursor_is_pinned is not null and v_search_query is null and p_cursor_search_rank <> 0)
     or (p_cursor_rank is not null and p_cursor_rank < 0) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  return query
  with page_keys as materialized (
    select k.*
    from private.public_post_page_keys(
      p_sort,p_limit,v_search_query,p_tag_id,p_cursor_is_pinned,
      p_cursor_created_at,p_cursor_rank,p_cursor_id,p_cursor_search_rank
    ) k
  ), hydrated as (
    select k.id,p.title,private.public_post_excerpt(p.id,p.body_markdown) excerpt,
      p.created_at,p.updated_at,p.is_locked,p.is_pinned,
      pr.id author_id,pr.login author_login,pr.display_name author_display_name,pr.avatar_url author_avatar_url,
      coalesce(t.tags,'[]'::jsonb) tags,
      c.comment_count,c.reaction_count,c.popularity_score,k.rank_key,k.search_rank
    from page_keys k
    join public.posts p on p.id=k.id
    join public.profiles pr on pr.id=p.author_id
    cross join lateral private.public_post_counts(p.id) c
    left join lateral (
      select jsonb_agg(
        jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
        order by tag.sort_order,tag.label,tag.id
      ) tags
      from public.post_tags pt
      join public.tags tag on tag.id=pt.tag_id and tag.is_active
      where pt.post_id=p.id
    ) t on true
  )
  select pg_catalog.row_number() over (
           order by x.is_pinned desc,x.search_rank desc,x.rank_key desc nulls last,x.created_at desc,x.id desc
         ),x.*
  from hydrated x
  order by x.is_pinned desc,x.search_rank desc,x.rank_key desc nulls last,x.created_at desc,x.id desc;
end $$;

alter function private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
alter function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
revoke all on function private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated,service_role;
revoke all on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated,service_role;
grant execute on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) to anon,authenticated;

commit;
-- END SOURCE: supabase/migrations/202609270005_unbounded_public_listing.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 12 OF 20: 202609280001_public_post_attachment_count.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609280001_public_post_attachment_count.sql
-- Expose the authoritative attached-row count with public post details.

begin;

create or replace function public.get_public_post_v2(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_deleted_at timestamptz;
  v_post jsonb;
  v_comment_count bigint;
begin
  select p.status,p.deleted_at
    into v_status,v_deleted_at
    from public.posts p
   where p.id=p_post_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind','not_found');
  end if;
  if v_status='hidden' then
    return pg_catalog.jsonb_build_object('kind','hidden');
  end if;
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(detail)
      into v_post
      from public.get_public_post(p_post_id) detail;
    if v_post is null then
      return pg_catalog.jsonb_build_object('kind','not_found');
    end if;
    v_post := v_post || pg_catalog.jsonb_build_object(
      'attachment_count',
      (select pg_catalog.count(*)::integer
         from public.attachments a
        where a.post_id=p_post_id and a.status='attached')
    );
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null then
    select pg_catalog.count(*)::bigint
      into v_comment_count
      from public.comments c
      join public.comments root
        on root.id=coalesce(c.parent_id,c.id)
       and root.post_id=c.post_id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where c.post_id=p_post_id
       and c.status='published'
       and c.deleted_at is null;
    if v_comment_count > 0 then
      return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_comment_count);
    end if;
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end
$$;

alter function public.get_public_post_v2(uuid) owner to postgres;
revoke all on function public.get_public_post_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_v2(uuid) to anon,authenticated;

commit;
-- END SOURCE: supabase/migrations/202609280001_public_post_attachment_count.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 13 OF 20: 202609280002_attach_expected_total.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609280002_attach_expected_total.sql
-- Make the client-observed attachment total an atomic server-side precondition.

begin;

alter function public.attach_attachments(uuid,uuid[])
  rename to attach_attachments_legacy;

revoke all on function public.attach_attachments_legacy(uuid,uuid[])
  from public, anon, authenticated, service_role;

create function public.attach_attachments(
  p_post_id uuid,
  p_attachment_ids uuid[],
  p_expected_total integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  requested_count integer := coalesce(pg_catalog.cardinality(p_attachment_ids),0);
  distinct_count integer;
  linkable_count integer;
  existing_count integer;
  pending_count integer;
  final_count integer;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_expected_total is null or p_expected_total not between 1 and 5 then
    raise exception 'expected attachment total must be between 1 and 5'
      using errcode = '22023';
  end if;

  select count(distinct requested_id)::integer
    into distinct_count
    from pg_catalog.unnest(coalesce(p_attachment_ids,array[]::uuid[])) requested_id;
  if requested_count < 1 or requested_count > 5
     or distinct_count <> requested_count
     or pg_catalog.array_position(p_attachment_ids,null::uuid) is not null then
    raise exception 'attachment list must contain 1 to 5 distinct ids; duplicate attachment ids are not allowed'
      using errcode = '22023';
  end if;

  -- Serialize every checked attach for a post before evaluating the expected
  -- total. The legacy implementation takes the same lock reentrantly.
  perform 1
    from public.posts p
   where p.id = p_post_id
     and p.author_id = caller_id
     and p.status = 'published'
     and p.deleted_at is null
   for update;
  if not found then
    raise exception 'post not found or not attachable' using errcode = '42501';
  end if;

  select count(*)::integer
    into linkable_count
    from public.attachments a
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and (
       (a.status = 'pending' and a.post_id is null)
       or (a.status = 'attached' and a.post_id = p_post_id)
     )
     and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp());
  if linkable_count <> requested_count then
    raise exception 'attachment not found or not linkable' using errcode = '42501';
  end if;

  select count(*)::integer
    into existing_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  select count(*)::integer
    into pending_count
    from public.attachments a
   where a.id = any(coalesce(p_attachment_ids,array[]::uuid[]))
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null;

  if existing_count + pending_count <> p_expected_total then
    raise exception 'attachment total changed concurrently'
      using errcode = '40001';
  end if;

  final_count := public.attach_attachments_legacy(p_post_id,p_attachment_ids);
  if final_count <> p_expected_total then
    raise exception 'attachment total changed concurrently'
      using errcode = '40001';
  end if;
  return final_count;
end;
$$;

alter function public.attach_attachments(uuid,uuid[],integer) owner to postgres;
revoke all on function public.attach_attachments(uuid,uuid[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.attach_attachments(uuid,uuid[],integer)
  to authenticated;

comment on function public.attach_attachments(uuid,uuid[],integer) is
  'Atomically attach owned pending images when the locked post total matches the caller checkpoint.';
comment on function public.attach_attachments_legacy(uuid,uuid[]) is
  'Internal implementation retained for the checked attach wrapper; not client executable.';

commit;
-- END SOURCE: supabase/migrations/202609280002_attach_expected_total.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 14 OF 20: 202609280003_discussion_interactions.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609280003_discussion_interactions.sql
-- Versioned discussion projections and retry-safe desired-state reactions.

begin;

lock table public.comments in share row exclusive mode;

-- Canonicalize every write path, including the still-executable legacy RPCs.
update public.comments set body_markdown=pg_catalog.btrim(body_markdown);

create function private.canonicalize_comment_body()
returns trigger language plpgsql set search_path='' as $$
begin
  new.body_markdown:=pg_catalog.btrim(new.body_markdown);
  return new;
end $$;

create trigger comments_canonicalize_body
before insert or update of body_markdown on public.comments
for each row execute function private.canonicalize_comment_body();

-- A discussion slot is a physical comment row, regardless of moderation state.
update private.post_metrics m
   set comment_count=(select pg_catalog.count(*)::bigint from public.comments c where c.post_id=m.post_id);
insert into private.post_metrics(post_id,comment_count)
select p.id,pg_catalog.count(c.id)::bigint
  from public.posts p left join public.comments c on c.post_id=p.id
 where not exists(select 1 from private.post_metrics m where m.post_id=p.id)
 group by p.id;

create or replace function private.maintain_public_comment_count()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
    return new;
  elsif tg_op='DELETE' then
    update private.post_metrics set comment_count=greatest(0::bigint,comment_count-1) where post_id=old.post_id;
    return old;
  elsif new.post_id is distinct from old.post_id then
    update private.post_metrics set comment_count=greatest(0::bigint,comment_count-1) where post_id=old.post_id;
    insert into private.post_metrics(post_id,comment_count) values(new.post_id,1)
    on conflict(post_id) do update set comment_count=private.post_metrics.comment_count+1;
  end if;
  return new;
end $$;

create index comments_post_roots_created_idx
  on public.comments(post_id,created_at,id) where parent_id is null;
create index comments_post_replies_created_idx
  on public.comments(post_id,parent_id,created_at,id) where parent_id is not null;

create function private.public_comment_json(p_comment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when c.status='published' and c.deleted_at is null then
    pg_catalog.jsonb_build_object(
      'id',c.id,'parent_id',c.parent_id,'kind','published',
      'body_markdown',c.body_markdown,'created_at',c.created_at,'updated_at',c.updated_at,
      'author_id',a.id,'author_login',a.login,'author_display_name',a.display_name,'author_avatar_url',a.avatar_url,
      'reaction_count',(select pg_catalog.count(*) from public.comment_reactions r where r.comment_id=c.id),
      'viewer_reacted',coalesce((select true from public.comment_reactions r where r.comment_id=c.id and r.user_id=auth.uid()),false)
    )
  else null end
  from public.comments c join public.profiles a on a.id=c.author_id
  where c.id=p_comment_id
$$;

create function public.get_public_post_v3(p_post_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_status text; v_deleted_at timestamptz; v_post jsonb; v_count bigint;
begin
  select p.status,p.deleted_at into v_status,v_deleted_at from public.posts p where p.id=p_post_id;
  if not found then return pg_catalog.jsonb_build_object('kind','not_found'); end if;
  if v_status='hidden' then return pg_catalog.jsonb_build_object('kind','hidden'); end if;
  select coalesce(m.comment_count,0) into v_count from private.post_metrics m where m.post_id=p_post_id;
  v_count:=coalesce(v_count,0);
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(d) into v_post from public.get_public_post(p_post_id) d;
    if v_post is null then return pg_catalog.jsonb_build_object('kind','not_found'); end if;
    v_post:=v_post||pg_catalog.jsonb_build_object(
      'viewer_reacted',coalesce((select true from public.post_reactions r where r.post_id=p_post_id and r.user_id=auth.uid()),false)
    );
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null and v_count>0 then
    return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_count);
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end $$;

create function public.list_public_post_comments_v2(
  p_post_id uuid,
  p_limit integer default 50,
  p_cursor_root_created_at timestamptz default null,
  p_cursor_root_id uuid default null,
  p_cursor_is_reply boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_cursors jsonb; v_has_more boolean; v_next_cursor jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_root_created_at is null)<>(p_cursor_root_id is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_is_reply is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_created_at is null)
     or (p_cursor_root_created_at is null)<>(p_cursor_id is null)
     or (p_cursor_root_created_at is not null and (
       not pg_catalog.isfinite(p_cursor_root_created_at) or not pg_catalog.isfinite(p_cursor_created_at)
       or (not p_cursor_is_reply and (p_cursor_root_id<>p_cursor_id or p_cursor_root_created_at<>p_cursor_created_at))
       or (p_cursor_is_reply and p_cursor_root_id=p_cursor_id)
     )) then raise exception 'invalid cursor' using errcode='22023'; end if;

  with roots as materialized (
    select c.id,c.created_at
      from public.posts p join public.comments c on c.post_id=p.id and c.parent_id is null
      left join private.post_metrics m on m.post_id=p.id
     where p.id=p_post_id
       and ((p.status='published' and p.deleted_at is null)
         or (p.status='deleted' and p.deleted_at is not null and coalesce(m.comment_count,0)>0))
       and (p_cursor_root_created_at is null or (c.created_at,c.id)>=(p_cursor_root_created_at,p_cursor_root_id))
     order by c.created_at,c.id
     limit p_limit+1+case when p_cursor_root_created_at is null then 0 else 1 end
  ), bounded as materialized (
    select root.created_at root_created_at,root.id root_id,item.is_reply,
           item.id,item.parent_id,item.status,item.deleted_at,item.created_at,item.payload
      from roots root
      cross join lateral (
        select false is_reply,c.id,c.parent_id,c.status,c.deleted_at,c.created_at,
               case when c.status='published' and c.deleted_at is null then private.public_comment_json(c.id)
                    else pg_catalog.jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.status) end payload
          from public.comments c where c.id=root.id and c.post_id=p_post_id
        union all
        (select true,c.id,c.parent_id,c.status,c.deleted_at,c.created_at,
                case when c.status='published' and c.deleted_at is null then private.public_comment_json(c.id)
                     else pg_catalog.jsonb_build_object('id',c.id,'parent_id',c.parent_id,'kind',c.status) end
           from public.comments c
          where c.post_id=p_post_id and c.parent_id=root.id
            and (p_cursor_root_created_at is null
              or (root.created_at,root.id)>(p_cursor_root_created_at,p_cursor_root_id)
              or ((root.created_at,root.id)=(p_cursor_root_created_at,p_cursor_root_id)
                and (true,c.created_at,c.id)>(p_cursor_is_reply,p_cursor_created_at,p_cursor_id)))
          order by c.created_at,c.id limit p_limit+1)
      ) item
     where p_cursor_root_created_at is null
        or (root.created_at,root.id,item.is_reply,item.created_at,item.id)>
           (p_cursor_root_created_at,p_cursor_root_id,p_cursor_is_reply,p_cursor_created_at,p_cursor_id)
     order by root.created_at,root.id,item.is_reply,item.created_at,item.id
     limit p_limit+1
  ), page as materialized (
    select * from bounded order by root_created_at,root_id,is_reply,created_at,id limit p_limit
  )
  select coalesce(pg_catalog.jsonb_agg(payload order by root_created_at,root_id,is_reply,created_at,id),'[]'::jsonb),
         coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('root_created_at',root_created_at,'root_id',root_id,'is_reply',is_reply,'created_at',created_at,'id',id) order by root_created_at,root_id,is_reply,created_at,id),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from bounded)
    into v_items,v_cursors,v_has_more from page;
  v_next_cursor:=case when v_has_more then v_cursors->(p_limit-1) else 'null'::jsonb end;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next_cursor);
end $$;

create function public.create_comment_v2(p_post_id uuid,p_parent_id uuid,p_body_markdown text,p_idempotency_key text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; v_result jsonb;
begin
  v_id:=public.create_comment(p_post_id,p_parent_id,p_body_markdown,p_idempotency_key);
  v_result:=private.public_comment_json(v_id);
  if v_result is null then raise exception 'created comment is not visible' using errcode='22023'; end if;
  return v_result;
end $$;

create function public.set_post_reaction(p_post_id uuid,p_reacted boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid; v_count bigint;
begin
  perform private.require_read_committed(); v_user:=private.require_user();
  if p_reacted is null then raise exception 'invalid desired reaction state' using errcode='22023'; end if;
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'post not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('post-reaction:'||v_user::text||':'||p_post_id::text,0));
  if p_reacted then insert into public.post_reactions(user_id,post_id) values(v_user,p_post_id) on conflict(user_id,post_id) do nothing;
  else delete from public.post_reactions where user_id=v_user and post_id=p_post_id; end if;
  select pg_catalog.count(*)::bigint into v_count from public.post_reactions where post_id=p_post_id;
  return pg_catalog.jsonb_build_object('reacted',p_reacted,'reaction_count',v_count);
end $$;

create function public.set_comment_reaction(p_comment_id uuid,p_reacted boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid; v_post_id uuid; v_count bigint;
begin
  perform private.require_read_committed(); v_user:=private.require_user();
  if p_reacted is null then raise exception 'invalid desired reaction state' using errcode='22023'; end if;
  select c.post_id into v_post_id from public.comments c where c.id=p_comment_id;
  perform 1 from public.posts p where p.id=v_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform 1 from public.comments c where c.id=p_comment_id and c.post_id=v_post_id and c.status='published' and c.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment-reaction:'||v_user::text||':'||p_comment_id::text,0));
  if p_reacted then insert into public.comment_reactions(user_id,comment_id) values(v_user,p_comment_id) on conflict(user_id,comment_id) do nothing;
  else delete from public.comment_reactions where user_id=v_user and comment_id=p_comment_id; end if;
  select pg_catalog.count(*)::bigint into v_count from public.comment_reactions where comment_id=p_comment_id;
  return pg_catalog.jsonb_build_object('reacted',p_reacted,'reaction_count',v_count);
end $$;

alter function private.canonicalize_comment_body() owner to postgres;
alter function private.maintain_public_comment_count() owner to postgres;
alter function private.public_comment_json(uuid) owner to postgres;
alter function public.get_public_post_v3(uuid) owner to postgres;
alter function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) owner to postgres;
alter function public.create_comment_v2(uuid,uuid,text,text) owner to postgres;
alter function public.set_post_reaction(uuid,boolean) owner to postgres;
alter function public.set_comment_reaction(uuid,boolean) owner to postgres;

revoke all on function private.canonicalize_comment_body() from public,anon,authenticated,service_role;
revoke select on public.comments from anon,authenticated;
revoke all on function private.public_comment_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_public_post_v3(uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_comment_v2(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.set_post_reaction(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.set_comment_reaction(uuid,boolean) from public,anon,authenticated,service_role;
revoke execute on function public.toggle_post_reaction(uuid) from authenticated;
revoke execute on function public.toggle_comment_reaction(uuid) from authenticated;
grant execute on function public.get_public_post_v3(uuid) to anon,authenticated;
grant execute on function public.list_public_post_comments_v2(uuid,integer,timestamptz,uuid,boolean,timestamptz,uuid) to anon,authenticated;
grant execute on function public.create_comment_v2(uuid,uuid,text,text) to authenticated;
grant execute on function public.set_post_reaction(uuid,boolean) to authenticated;
grant execute on function public.set_comment_reaction(uuid,boolean) to authenticated;

commit;
-- END SOURCE: supabase/migrations/202609280003_discussion_interactions.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 15 OF 20: 202609280004_moderation.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609280004_moderation.sql
-- Task 12: moderation queue, controlled state transitions, and append-only audit evidence.
begin;

create function private.require_admin()
returns uuid language plpgsql stable set search_path='' as $$
declare v_actor uuid;
begin
  v_actor:=private.require_user();
  if not exists(select 1 from public.user_roles r where r.user_id=v_actor and r.role='admin') then
    raise exception 'admin required' using errcode='42501';
  end if;
  return v_actor;
end $$;

create function private.moderation_key(p_key text)
returns text language plpgsql immutable set search_path='' as $$
declare v_key text:=pg_catalog.btrim(p_key);
begin
  if v_key is null or pg_catalog.char_length(v_key) not between 1 and 200 then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  return v_key;
end $$;

create function private.moderation_reason(p_reason text)
returns text language plpgsql immutable set search_path='' as $$
declare v_reason text:=pg_catalog.btrim(p_reason);
begin
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 2000 then
    raise exception 'invalid moderation reason' using errcode='22023';
  end if;
  return v_reason;
end $$;

create function private.report_queue_item(p_report_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',r.id,'status',r.status,'reason_code',r.reason_code,'detail',r.detail,
    'created_at',r.created_at,'resolved_at',r.resolved_at,'resolved_by',r.resolved_by,
    'reporter',pg_catalog.jsonb_build_object('id',u.id,'login',u.login,'display_name',u.display_name,'avatar_url',u.avatar_url),
    'target',case r.target_type
      when 'post' then case when p.id is null
        then pg_catalog.jsonb_build_object('type','post','id',r.target_id,'available',false)
        else pg_catalog.jsonb_build_object(
          'type','post','id',r.target_id,'available',true,'post_id',p.id,'status',p.status,'title',p.title,
          'excerpt',pg_catalog.left(pg_catalog.regexp_replace(p.body_markdown,'[[:space:]]+',' ','g'),240),
          'is_locked',p.is_locked,'is_pinned',p.is_pinned)
        end
      when 'comment' then case when c.id is null
        then pg_catalog.jsonb_build_object('type','comment','id',r.target_id,'available',false)
        else pg_catalog.jsonb_build_object(
          'type','comment','id',r.target_id,'available',true,'post_id',p.id,'status',c.status,'title',p.title,
          'excerpt',pg_catalog.left(pg_catalog.regexp_replace(c.body_markdown,'[[:space:]]+',' ','g'),240),
          'is_locked',p.is_locked,'is_pinned',p.is_pinned)
        end
    end)
  from public.reports r
  join public.profiles u on u.id=r.reporter_id
  left join public.comments c on r.target_type='comment' and c.id=r.target_id
  left join public.posts p on p.id=case when r.target_type='post' then r.target_id else c.post_id end
  where r.id=p_report_id
$$;

create function private.moderation_post_state(p_post_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',p.id,'status',p.status,'is_locked',p.is_locked,
    'is_pinned',p.is_pinned,'updated_at',p.updated_at,'deleted_at',p.deleted_at)
  from public.posts p where p.id=p_post_id
$$;

create function private.moderation_comment_state(p_comment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',c.id,'post_id',c.post_id,'status',c.status,
    'updated_at',c.updated_at,'deleted_at',c.deleted_at)
  from public.comments c where c.id=p_comment_id
$$;

create function private.moderation_tag_state(p_tag_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',t.id,'slug',t.slug,'label',t.label,
    'is_active',t.is_active,'sort_order',t.sort_order)
  from public.tags t where t.id=p_tag_id
$$;

create function private.enforce_report_updates()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason_code is distinct from old.reason_code
     or new.detail is distinct from old.detail
     or new.created_at is distinct from old.created_at then
    raise exception 'report immutable fields cannot change' using errcode='23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='open' and new.status in ('reviewing','resolved','dismissed'))
    or (old.status='reviewing' and new.status in ('resolved','dismissed'))
  ) then
    raise exception 'illegal report status transition' using errcode='23514';
  end if;
  if (new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by)
     and not (old.status in ('open','reviewing') and new.status in ('resolved','dismissed')) then
    raise exception 'report resolution fields may change only on terminal transition' using errcode='23514';
  end if;
  return new;
end $$;
create trigger reports_enforce_updates before update on public.reports
for each row execute function private.enforce_report_updates();

create function private.enforce_content_status_transition()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status is distinct from old.status and not (
    (old.status='published' and new.status in ('hidden','deleted'))
    or (old.status='hidden' and new.status in ('published','deleted'))
    -- Privileged restore workflows remain available during the existing
    -- soft-delete retention window. Browser roles still have no table UPDATE,
    -- and moderation RPCs deliberately reject restoring deleted content.
    or (old.status='deleted' and new.status in ('published','hidden'))
  ) then
    raise exception 'illegal % status transition',pg_catalog.rtrim(tg_table_name,'s') using errcode='23514';
  end if;
  return new;
end $$;
create trigger posts_enforce_status_transition before update of status on public.posts
for each row execute function private.enforce_content_status_transition();
create trigger comments_enforce_status_transition before update of status on public.comments
for each row execute function private.enforce_content_status_transition();

create function private.enforce_audit_append_only()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
     and old.actor_id is not null and new.actor_id is null
     and (pg_catalog.to_jsonb(new)-'actor_id')=(pg_catalog.to_jsonb(old)-'actor_id')
     and not exists(select 1 from public.profiles p where p.id=old.actor_id) then
    return new;
  end if;
  raise exception 'moderation audit logs are append-only' using errcode='23514';
end $$;
create trigger moderation_audit_logs_append_only_row
before update or delete on public.moderation_audit_logs
for each row execute function private.enforce_audit_append_only();
create trigger moderation_audit_logs_append_only_truncate
before truncate on public.moderation_audit_logs
for each statement execute function private.enforce_audit_append_only();

drop index public.reports_queue_idx;
drop index public.moderation_audit_logs_target_idx;
create index reports_queue_idx on public.reports(created_at desc,id desc)
  where status in ('open','reviewing');
create index reports_created_id_idx on public.reports(created_at desc,id desc);
create index reports_status_created_id_idx on public.reports(status,created_at desc,id desc);
create index moderation_audit_logs_target_created_id_idx
  on public.moderation_audit_logs(target_type,target_id,created_at desc,id desc);

create function public.create_report_v2(
  p_target_type text,p_target_id uuid,p_reason_code text,p_detail text,p_idempotency_key text
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_detail text; v_hash text;
  v_previous public.idempotency_keys%rowtype; v_id uuid; v_post_id uuid;
begin
  perform private.require_read_committed();
  v_actor:=private.require_user();
  v_key:=private.moderation_key(p_idempotency_key);
  v_reason:=pg_catalog.lower(pg_catalog.btrim(p_reason_code));
  v_detail:=nullif(pg_catalog.btrim(p_detail),'');
  if v_reason is null or v_reason not in ('spam','harassment','harmful','other') then
    raise exception 'invalid report reason' using errcode='22023';
  end if;
  if v_detail is not null and pg_catalog.char_length(v_detail)>2000 then
    raise exception 'invalid report detail' using errcode='22023';
  end if;
  if v_reason='other' and v_detail is null then
    raise exception 'report detail required for other' using errcode='22023';
  end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('type',p_target_type,'target',p_target_id,'reason',v_reason,'detail',v_detail)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':report.create.v2:'||v_key,0));
  select * into v_previous from public.idempotency_keys k
   where k.user_id=v_actor and k.operation='report.create.v2' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return v_previous.resource_id;
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='report.create.v2' and key=v_key;
  if p_target_type='post' then
    perform 1 from public.posts p where p.id=p_target_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  elsif p_target_type='comment' then
    select c.post_id into v_post_id from public.comments c where c.id=p_target_id;
    perform 1 from public.posts p where p.id=v_post_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
    perform 1 from public.comments c where c.id=p_target_id and c.post_id=v_post_id and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  else
    raise exception 'report target not found or visible' using errcode='22023';
  end if;
  if exists(select 1 from public.reports r where r.reporter_id=v_actor and r.target_type=p_target_type and r.target_id=p_target_id and r.status in ('open','reviewing')) then
    raise exception 'open report already exists' using errcode='23505';
  end if;
  perform private.consume_rate_limit(v_actor,'report.create',v_key);
  insert into public.reports(reporter_id,target_type,target_id,reason_code,detail)
  values(v_actor,p_target_type,p_target_id,v_reason,v_detail) returning id into v_id;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'report.created','report',v_id,null,pg_catalog.jsonb_build_object('reported_target_type',p_target_type,'reported_target_id',p_target_id));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'report.create.v2',v_key,v_hash,'report',v_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return v_id;
end $$;

create function public.list_moderation_reports_v1(
  p_status text default 'active',p_limit integer default 50,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('active','open','reviewing','resolved','dismissed','all') then
    raise exception 'invalid report status filter' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;
  with candidates as materialized (
    select r.id,r.created_at,private.report_queue_item(r.id) item
    from public.reports r
    where (p_status='all' or (p_status='active' and r.status in ('open','reviewing')) or r.status=p_status)
      and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from candidates),
         case when (select pg_catalog.count(*)>p_limit from candidates)
           then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
           else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.set_report_status_v1(
  p_report_id uuid,p_expected_status text,p_desired_status text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_report public.reports%rowtype; v_post_id uuid;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('report',p_report_id,'expected',p_expected_status,'desired',p_desired_status,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':report.status.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='report.status.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.report_queue_item(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='report.status.v1' and key=v_key;
  select * into v_report from public.reports where id=p_report_id;
  if not found then raise exception 'report not found' using errcode='22023'; end if;
  if v_report.target_type='post' then
    v_post_id:=v_report.target_id;
  else
    select post_id into v_post_id from public.comments where id=v_report.target_id;
  end if;
  if v_post_id is not null then
    perform 1 from public.posts where id=v_post_id for update;
    if v_report.target_type='comment' then
      perform 1 from public.comments where id=v_report.target_id and post_id=v_post_id for update;
    end if;
  end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if v_report.status is distinct from p_expected_status then raise exception 'report state changed' using errcode='40001'; end if;
  if not ((v_report.status='open' and p_desired_status in ('reviewing','resolved','dismissed')) or (v_report.status='reviewing' and p_desired_status in ('resolved','dismissed'))) then
    raise exception 'report status transition not allowed' using errcode='22023';
  end if;
  update public.reports set status=p_desired_status,
    resolved_at=case when p_desired_status in ('resolved','dismissed') then pg_catalog.clock_timestamp() else null end,
    resolved_by=case when p_desired_status in ('resolved','dismissed') then v_actor else null end
  where id=p_report_id;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'report.status_changed','report',p_report_id,v_reason,pg_catalog.jsonb_build_object('from',v_report.status,'to',p_desired_status));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'report.status.v1',v_key,v_hash,'report',p_report_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.report_queue_item(p_report_id);
end $$;

create function public.moderate_post_v1(
  p_post_id uuid,p_expected_status text,p_expected_locked boolean,p_expected_pinned boolean,
  p_action text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_post public.posts%rowtype; v_changed boolean:=false;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_action is null or p_action not in ('hide','restore','lock','unlock','pin','unpin','delete') then raise exception 'invalid post moderation action' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('post',p_post_id,'expected_status',p_expected_status,'expected_locked',p_expected_locked,'expected_pinned',p_expected_pinned,'action',p_action,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':post.moderate.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='post.moderate.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_post_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='post.moderate.v1' and key=v_key;
  select * into v_post from public.posts where id=p_post_id for update;
  if not found then raise exception 'post not found' using errcode='22023'; end if;
  if v_post.status is distinct from p_expected_status or v_post.is_locked is distinct from p_expected_locked or v_post.is_pinned is distinct from p_expected_pinned then raise exception 'post state changed' using errcode='40001'; end if;
  if v_post.status='deleted'
     or (p_action='hide' and v_post.status<>'published')
     or (p_action='restore' and v_post.status<>'hidden')
     or (p_action='delete' and v_post.status not in ('published','hidden'))
     or (p_action='pin' and v_post.status<>'published') then
    raise exception 'post moderation transition not allowed' using errcode='22023';
  end if;
  if p_action='hide' then update public.posts set status='hidden',is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='restore' then update public.posts set status='published',updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='delete' then update public.posts set status='deleted',deleted_at=pg_catalog.clock_timestamp(),is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='lock' and not v_post.is_locked then update public.posts set is_locked=true,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='unlock' and v_post.is_locked then update public.posts set is_locked=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='pin' and not v_post.is_pinned then update public.posts set is_pinned=true,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='unpin' and v_post.is_pinned then update public.posts set is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  end if;
  if not v_changed then
    raise exception 'post moderation action has no effect' using errcode='22023';
  end if;
  if v_changed then
    insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
    values(v_actor,'post.'||p_action,'post',p_post_id,v_reason,pg_catalog.jsonb_build_object('prior_status',v_post.status,'prior_locked',v_post.is_locked,'prior_pinned',v_post.is_pinned));
  end if;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'post.moderate.v1',v_key,v_hash,'post',p_post_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_post_state(p_post_id);
end $$;

create function public.moderate_comment_v1(
  p_comment_id uuid,p_expected_status text,p_action text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_comment public.comments%rowtype; v_post_id uuid;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_action is null or p_action not in ('hide','restore','delete') then raise exception 'invalid comment moderation action' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('comment',p_comment_id,'expected',p_expected_status,'action',p_action,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':comment.moderate.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='comment.moderate.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_comment_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='comment.moderate.v1' and key=v_key;
  select c.post_id into v_post_id from public.comments c where c.id=p_comment_id;
  perform 1 from public.posts p where p.id=v_post_id for update;
  select * into v_comment from public.comments c where c.id=p_comment_id and c.post_id=v_post_id for update;
  if not found then raise exception 'comment not found' using errcode='22023'; end if;
  if v_comment.status is distinct from p_expected_status then raise exception 'comment state changed' using errcode='40001'; end if;
  if not ((v_comment.status='published' and p_action in ('hide','delete')) or (v_comment.status='hidden' and p_action in ('restore','delete'))) then
    raise exception 'comment moderation transition not allowed' using errcode='22023';
  end if;
  if p_action='hide' then update public.comments set status='hidden',updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  elsif p_action='restore' then update public.comments set status='published',updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  else update public.comments set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p_comment_id; end if;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'comment.'||p_action,'comment',p_comment_id,v_reason,pg_catalog.jsonb_build_object('from',v_comment.status,'to',case p_action when 'hide' then 'hidden' when 'restore' then 'published' else 'deleted' end,'post_id',v_post_id));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'comment.moderate.v1',v_key,v_hash,'comment',p_comment_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_comment_state(p_comment_id);
end $$;

create function public.list_moderation_audit_logs_v1(
  p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_target_type text default null,p_target_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  if (p_target_type is null)<>(p_target_id is null) then raise exception 'invalid target filter' using errcode='22023'; end if;
  with candidates as materialized (
    select l.id,l.created_at,pg_catalog.jsonb_build_object(
      'id',l.id,'actor',case when a.id is null then null else pg_catalog.jsonb_build_object('id',a.id,'login',a.login,'display_name',a.display_name,'avatar_url',a.avatar_url) end,
      'action',l.action,'target_type',l.target_type,'target_id',l.target_id,'reason',l.reason,'metadata',l.metadata,'created_at',l.created_at) item
    from public.moderation_audit_logs l left join public.profiles a on a.id=l.actor_id
    where (p_target_type is null or (l.target_type=p_target_type and l.target_id=p_target_id))
      and (p_cursor_created_at is null or (l.created_at,l.id)<(p_cursor_created_at,p_cursor_id))
    order by l.created_at desc,l.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from candidates),
         case when (select pg_catalog.count(*)>p_limit from candidates)
           then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
           else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.set_tag_active_v1(
  p_tag_id uuid,p_expected_active boolean,p_desired_active boolean,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_active boolean;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_expected_active is null or p_desired_active is null then raise exception 'invalid tag active state' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('tag',p_tag_id,'expected',p_expected_active,'desired',p_desired_active,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':tag.active.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='tag.active.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_tag_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='tag.active.v1' and key=v_key;
  select t.is_active into v_active from public.tags t where t.id=p_tag_id for update;
  if not found then raise exception 'tag not found' using errcode='22023'; end if;
  if v_active is distinct from p_expected_active then raise exception 'tag state changed' using errcode='40001'; end if;
  if v_active is not distinct from p_desired_active then
    raise exception 'tag active state has no effect' using errcode='22023';
  end if;
  if v_active is distinct from p_desired_active then
    update public.tags set is_active=p_desired_active where id=p_tag_id;
    insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
    values(v_actor,'tag.active_changed','tag',p_tag_id,v_reason,pg_catalog.jsonb_build_object('from',v_active,'to',p_desired_active));
  end if;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'tag.active.v1',v_key,v_hash,'tag',p_tag_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_tag_state(p_tag_id);
end $$;

alter function private.require_admin() owner to postgres;
alter function private.moderation_key(text) owner to postgres;
alter function private.moderation_reason(text) owner to postgres;
alter function private.report_queue_item(uuid) owner to postgres;
alter function private.moderation_post_state(uuid) owner to postgres;
alter function private.moderation_comment_state(uuid) owner to postgres;
alter function private.moderation_tag_state(uuid) owner to postgres;
alter function private.enforce_report_updates() owner to postgres;
alter function private.enforce_content_status_transition() owner to postgres;
alter function private.enforce_audit_append_only() owner to postgres;
alter function public.create_report_v2(text,uuid,text,text,text) owner to postgres;
alter function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) owner to postgres;
alter function public.set_report_status_v1(uuid,text,text,text,text) owner to postgres;
alter function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) owner to postgres;
alter function public.moderate_comment_v1(uuid,text,text,text,text) owner to postgres;
alter function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) owner to postgres;
alter function public.set_tag_active_v1(uuid,boolean,boolean,text,text) owner to postgres;

revoke all on function private.require_admin() from public,anon,authenticated,service_role;
revoke all on function private.moderation_key(text) from public,anon,authenticated,service_role;
revoke all on function private.moderation_reason(text) from public,anon,authenticated,service_role;
revoke all on function private.report_queue_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_post_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_comment_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_tag_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.enforce_report_updates() from public,anon,authenticated,service_role;
revoke all on function private.enforce_content_status_transition() from public,anon,authenticated,service_role;
revoke all on function private.enforce_audit_append_only() from public,anon,authenticated,service_role;
revoke all on function public.create_report_v2(text,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_report_status_v1(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.moderate_comment_v1(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_tag_active_v1(uuid,boolean,boolean,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.create_report(text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_report_v2(text,uuid,text,text,text) to authenticated;
grant execute on function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.set_report_status_v1(uuid,text,text,text,text) to authenticated;
grant execute on function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) to authenticated;
grant execute on function public.moderate_comment_v1(uuid,text,text,text,text) to authenticated;
grant execute on function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) to authenticated;
grant execute on function public.set_tag_active_v1(uuid,boolean,boolean,text,text) to authenticated;

commit;
-- END SOURCE: supabase/migrations/202609280004_moderation.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 16 OF 20: 202609280005_community_snapshot_export.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202609280005_community_snapshot_export.sql
-- Bounded anonymous export boundary for static community snapshots.

begin;

-- Backfill and constraint/trigger installation form one write boundary. Without
-- these locks, a legacy-shaped row could race between normalization and the new
-- validated constraints.
lock table public.posts, public.profiles, public.tags in access exclusive mode;

-- Snapshot generation rejects raw strings outside these bounds. Keep the source
-- schema at least as strict so a padded value cannot poison the whole export.
-- Values that were legal under the prior btrim-based constraints are first
-- canonicalized to the already-validated logical value.
update public.posts
   set title = pg_catalog.btrim(title)
 where title is distinct from pg_catalog.btrim(title);

update public.profiles
   set login = pg_catalog.btrim(login),
       display_name = case
         when display_name is null then null
         else pg_catalog.btrim(display_name)
       end
 where login is distinct from pg_catalog.btrim(login)
    or display_name is distinct from pg_catalog.btrim(display_name);

-- Move all but one row in each trim-equivalent label group before trimming.
-- The retry suffix handles a pre-existing label that happens to equal the
-- deterministic UUID-based candidate.
do $$
declare
  duplicate_tag record;
  candidate text;
  attempt integer;
begin
  for duplicate_tag in
    select id, pg_catalog.btrim(label) as canonical_label
      from (
        select
          id,
          label,
          pg_catalog.row_number() over (
            partition by pg_catalog.btrim(label)
            order by id
          ) as duplicate_rank,
          pg_catalog.count(*) over (
            partition by pg_catalog.btrim(label)
          ) as duplicate_count
        from public.tags
      ) ranked
     where duplicate_count > 1
       and duplicate_rank > 1
     order by id
  loop
    attempt := 0;
    loop
      candidate := pg_catalog.left(duplicate_tag.canonical_label, 11)
        || '-'
        || pg_catalog.replace(duplicate_tag.id::text, '-', '')
        || case when attempt = 0 then '' else '-' || attempt::text end;
      exit when not exists (
        select 1
          from public.tags t
         where t.id <> duplicate_tag.id
           and pg_catalog.btrim(t.label) = candidate
      );
      attempt := attempt + 1;
      if attempt > 9999 then
        raise exception 'unable to canonicalize duplicate tag label'
          using errcode = '23505';
      end if;
    end loop;

    update public.tags
       set label = candidate
     where id = duplicate_tag.id;
  end loop;
end;
$$;

update public.tags
   set label = pg_catalog.btrim(label)
 where label is distinct from pg_catalog.btrim(label);

-- Preserve a readable prefix and append a row-unique digest suffix. Process
-- rows one at a time so a prior-legal slug equal to the first candidate cannot
-- abort the migration. Retry suffixes shorten the prefix to stay within 80.
do $$
declare
  oversized_tag record;
  candidate text;
  attempt integer;
  prefix_limit integer;
begin
  for oversized_tag in
    select id, slug as original_slug
      from public.tags
     where pg_catalog.char_length(slug) > 80
     order by id
  loop
    attempt := 0;
    loop
      prefix_limit := case
        when attempt = 0 then 47
        else 46 - pg_catalog.char_length(attempt::text)
      end;
      candidate := pg_catalog.rtrim(
        pg_catalog.left(oversized_tag.original_slug, prefix_limit),
        '-'
      )
        || '-'
        || pg_catalog.md5(oversized_tag.id::text || ':' || oversized_tag.original_slug)
        || case when attempt = 0 then '' else '-' || attempt::text end;
      exit when not exists (
        select 1
          from public.tags t
         where t.id <> oversized_tag.id
           and t.slug = candidate
      );
      attempt := attempt + 1;
      if attempt > 9999 then
        raise exception 'unable to canonicalize oversized tag slug'
          using errcode = '23505';
      end if;
    end loop;

    update public.tags
       set slug = candidate
     where id = oversized_tag.id;
  end loop;
end;
$$;

-- PostgreSQL supports timestamp values outside the four-digit-year wire format
-- accepted by the snapshot consumer. Clamp every projected timestamp to the
-- exact consumer range, then re-establish row ordering in the same statement.
with normalized as (
  select
    id,
    case created_at
      when '-infinity'::timestamptz then '1970-01-01 00:00:00+00'::timestamptz
      when 'infinity'::timestamptz then '9999-12-31 23:59:59.999999+00'::timestamptz
      else greatest(
        '1000-01-01 00:00:00+00'::timestamptz,
        least(created_at, '9999-12-31 23:59:59.999999+00'::timestamptz)
      )
    end as created_at,
    case updated_at
      when '-infinity'::timestamptz then '1970-01-01 00:00:00+00'::timestamptz
      when 'infinity'::timestamptz then '9999-12-31 23:59:59.999999+00'::timestamptz
      else greatest(
        '1000-01-01 00:00:00+00'::timestamptz,
        least(updated_at, '9999-12-31 23:59:59.999999+00'::timestamptz)
      )
    end as updated_at,
    case
      when deleted_at is null then null
      when deleted_at = '-infinity'::timestamptz then '1970-01-01 00:00:00+00'::timestamptz
      when deleted_at = 'infinity'::timestamptz then '9999-12-31 23:59:59.999999+00'::timestamptz
      else greatest(
        '1000-01-01 00:00:00+00'::timestamptz,
        least(deleted_at, '9999-12-31 23:59:59.999999+00'::timestamptz)
      )
    end as deleted_at
  from public.posts
  where created_at < '1000-01-01 00:00:00+00'::timestamptz
     or created_at > '9999-12-31 23:59:59.999999+00'::timestamptz
     or updated_at < '1000-01-01 00:00:00+00'::timestamptz
     or updated_at > '9999-12-31 23:59:59.999999+00'::timestamptz
)
update public.posts p
   set created_at = n.created_at,
       updated_at = greatest(n.created_at, n.updated_at),
       deleted_at = case
         when n.deleted_at is null then null
         else greatest(n.created_at, n.deleted_at)
       end
  from normalized n
 where p.id = n.id;

alter table public.posts
  add constraint posts_snapshot_title_raw_length_check
  check (pg_catalog.char_length(title) between 2 and 120),
  add constraint posts_snapshot_created_at_finite_check
  check (
    pg_catalog.isfinite(created_at)
    and created_at between
      '1000-01-01 00:00:00+00'::timestamptz
      and '9999-12-31 23:59:59.999999+00'::timestamptz
  ),
  add constraint posts_snapshot_updated_at_finite_check
  check (
    pg_catalog.isfinite(updated_at)
    and updated_at between
      '1000-01-01 00:00:00+00'::timestamptz
      and '9999-12-31 23:59:59.999999+00'::timestamptz
  );

alter table public.profiles
  add constraint profiles_snapshot_login_raw_length_check
  check (pg_catalog.char_length(login) between 1 and 39),
  add constraint profiles_snapshot_display_name_raw_length_check
  check (
    display_name is null
    or pg_catalog.char_length(display_name) between 1 and 120
  );

alter table public.tags
  add constraint tags_snapshot_slug_raw_length_check
  check (pg_catalog.char_length(slug) between 1 and 80),
  add constraint tags_snapshot_label_raw_length_check
  check (pg_catalog.char_length(label) between 1 and 50);

create function private.enforce_post_snapshot_keys_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'post snapshot ordering keys are immutable'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_post_snapshot_keys_immutable() from public;

create trigger posts_enforce_snapshot_keys_immutable
before update of id, created_at on public.posts
for each row execute function private.enforce_post_snapshot_keys_immutable();

create index posts_public_snapshot_export_idx
  on public.posts (created_at asc, id asc)
  where status = 'published' and deleted_at is null;

create function public.list_public_community_snapshots_v1(
  p_limit integer,
  p_snapshot_at timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  export_document jsonb;
  effective_snapshot_at timestamptz := coalesce(
    p_snapshot_at,
    pg_catalog.statement_timestamp()
  );
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid snapshot export limit' using errcode = '22023';
  end if;

  if not pg_catalog.isfinite(effective_snapshot_at)
     or effective_snapshot_at < '1000-01-01 00:00:00+00'::timestamptz
     or effective_snapshot_at > '9999-12-31 23:59:59.999999+00'::timestamptz then
    raise exception 'invalid snapshot export cutoff' using errcode = '22023';
  end if;

  if (p_cursor_created_at is null) <> (p_cursor_id is null)
     or (
       p_cursor_created_at is not null
       and (
         not pg_catalog.isfinite(p_cursor_created_at)
         or p_cursor_created_at < '1000-01-01 00:00:00+00'::timestamptz
         or p_cursor_created_at > '9999-12-31 23:59:59.999999+00'::timestamptz
       )
     ) then
    raise exception 'invalid snapshot export cursor' using errcode = '22023';
  end if;

  if p_cursor_created_at is not null and p_snapshot_at is null then
    raise exception 'snapshot export cursor requires explicit snapshot cutoff' using errcode = '22023';
  end if;

  if p_cursor_created_at is not null and p_cursor_created_at > effective_snapshot_at then
    raise exception 'snapshot export cursor exceeds cutoff' using errcode = '22023';
  end if;

  -- The keyset is deliberately oldest-first so a snapshot builder can retain its
  -- last exported immutable (created_at, id) pair and resume monotonically. The
  -- cutoff freezes membership across requests. The extra row
  -- is used only for has_more and is never rendered or returned.
  with lookahead as materialized (
    select
      p.id,
      p.title,
      p.body_markdown,
      p.created_at,
      p.updated_at,
      pr.login as author_login,
      pr.display_name as author_display_name
    from public.posts p
    join public.profiles pr on pr.id = p.author_id
    where p.status = 'published'
      and p.deleted_at is null
      and p.created_at <= effective_snapshot_at
      and p.updated_at <= effective_snapshot_at
      and (
        p_cursor_created_at is null
        or (p.created_at, p.id) > (p_cursor_created_at, p_cursor_id)
      )
    order by p.created_at asc, p.id asc
    limit p_limit + 1
  ), page as materialized (
    select l.*
    from lookahead l
    order by l.created_at asc, l.id asc
    limit p_limit
  ), rendered as (
    select
      p.id,
      p.created_at,
      pg_catalog.jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'body_markdown', private.public_post_body(p.id, p.body_markdown),
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'author', pg_catalog.jsonb_build_object(
          'login', p.author_login,
          'display_name', p.author_display_name
        ),
        'tags', coalesce(tags.value, '[]'::jsonb)
      ) as value
    from page p
    left join lateral (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', t.id,
          'slug', t.slug,
          'label', t.label
        )
        order by t.sort_order asc, t.label asc, t.id asc
      ) as value
      from public.post_tags pt
      join public.tags t on t.id = pt.tag_id and t.is_active
      where pt.post_id = p.id
    ) tags on true
  ), stats as (
    select pg_catalog.count(*) > p_limit as has_more
    from lookahead
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce(
      (
        select pg_catalog.jsonb_agg(r.value order by r.created_at asc, r.id asc)
        from rendered r
      ),
      '[]'::jsonb
    ),
    'has_more', s.has_more,
    'snapshot_at', effective_snapshot_at,
    'next_cursor_created_at', case
      when s.has_more then (
        select p.created_at
        from page p
        order by p.created_at desc, p.id desc
        limit 1
      )
      else null
    end,
    'next_cursor_id', case
      when s.has_more then (
        select p.id
        from page p
        order by p.created_at desc, p.id desc
        limit 1
      )
      else null
    end
  )
  into export_document
  from stats s;

  return export_document;
end;
$$;

alter function public.list_public_community_snapshots_v1(integer,timestamptz,timestamptz,uuid)
  owner to postgres;

revoke all on function public.list_public_community_snapshots_v1(integer,timestamptz,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_public_community_snapshots_v1(integer,timestamptz,timestamptz,uuid)
  to anon;

commit;
-- END SOURCE: supabase/migrations/202609280005_community_snapshot_export.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 17 OF 20: 202610040001_provider_neutral_profile_provisioning.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202610040001_provider_neutral_profile_provisioning.sql
-- Provision provider-neutral application profiles from trusted OAuth identities.

alter table public.profiles
  alter column github_user_id drop not null;

drop trigger if exists identities_provision_github_profile on auth.identities;
drop trigger if exists identities_provision_oauth_profile on auth.identities;

drop function if exists private.provision_github_profile();

create function private.provision_oauth_profile_identity(
  identity_provider text,
  identity_provider_id text,
  identity_user_id uuid,
  identity_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_id_text text;
  github_id bigint;
  profile_login text;
  profile_display_name text;
  profile_avatar_url text;
  existing_github_id bigint;
begin
  if identity_provider not in ('google', 'github', 'kakao')
     or identity_user_id is null
     or pg_catalog.jsonb_typeof(identity_data) is distinct from 'object' then
    return;
  end if;

  provider_id_text := pg_catalog.btrim(identity_provider_id);
  if provider_id_text is null
     or pg_catalog.char_length(provider_id_text) not between 1 and 255
     or provider_id_text !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254})$' then
    return;
  end if;

  if identity_provider = 'github' then
    if provider_id_text !~ '^[0-9]+$' then
      return;
    end if;

    begin
      github_id := provider_id_text::bigint;
    exception
      when numeric_value_out_of_range then
        return;
    end;

    if github_id <= 0 then
      return;
    end if;

    profile_login := pg_catalog.btrim(identity_data ->> 'user_name');
    if profile_login is null
       or pg_catalog.char_length(profile_login) not between 1 and 39
       or profile_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
       or profile_login ~ '--' then
      return;
    end if;
  else
    profile_login := identity_provider || '-' || pg_catalog.md5(identity_user_id::text);
  end if;

  profile_display_name := pg_catalog.btrim(
    coalesce(identity_data ->> 'full_name', identity_data ->> 'name')
  );
  if profile_display_name is not null
     and pg_catalog.char_length(profile_display_name) not between 1 and 120 then
    profile_display_name := null;
  end if;

  profile_avatar_url := pg_catalog.btrim(
    coalesce(identity_data ->> 'avatar_url', identity_data ->> 'picture')
  );
  if profile_avatar_url is not null
     and (
       pg_catalog.char_length(profile_avatar_url) not between 1 and 2048
       or profile_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    profile_avatar_url := null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-user:' || identity_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-provider:' || identity_provider || ':' || provider_id_text, 0)
  );

  if identity_provider <> 'github' then
    insert into public.profiles (
      id,
      github_user_id,
      login,
      display_name,
      avatar_url
    ) values (
      identity_user_id,
      null,
      profile_login,
      profile_display_name,
      profile_avatar_url
    )
    on conflict (id) do nothing;

    return;
  end if;

  select p.github_user_id
    into existing_github_id
    from public.profiles as p
   where p.id = identity_user_id
   for update;

  if found
     and existing_github_id is not null
     and existing_github_id <> github_id then
    raise exception 'GitHub identity does not match existing profile'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.profiles as p
     where p.github_user_id = github_id
       and p.id <> identity_user_id
  ) then
    raise exception 'GitHub identity is already linked to another profile'
      using errcode = '23505';
  end if;

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url
  ) values (
    identity_user_id,
    github_id,
    profile_login,
    profile_display_name,
    profile_avatar_url
  )
  on conflict (id) do update
    set github_user_id = excluded.github_user_id,
        login = excluded.login,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = pg_catalog.clock_timestamp()
    where public.profiles.github_user_id is null
       or public.profiles.github_user_id = excluded.github_user_id;
end;
$$;

alter function private.provision_oauth_profile_identity(text, text, uuid, jsonb) owner to postgres;
revoke all on function private.provision_oauth_profile_identity(text, text, uuid, jsonb) from public, anon, authenticated;

create function private.provision_oauth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_oauth_profile_identity(
    new.provider,
    new.provider_id,
    new.user_id,
    new.identity_data
  );
  return new;
end;
$$;

alter function private.provision_oauth_profile() owner to postgres;
revoke all on function private.provision_oauth_profile() from public, anon, authenticated;

create trigger identities_provision_oauth_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_oauth_profile();

-- Backfill only users that are still missing an application profile. Existing
-- GitHub profiles are deliberately untouched, and auth-managed rows are never
-- updated merely to fire a trigger.
do $$
declare
  trusted_identity record;
begin
  for trusted_identity in
    select i.provider, i.provider_id, i.user_id, i.identity_data
      from auth.identities as i
     where i.provider in ('google', 'github', 'kakao')
       and not exists (
         select 1 from public.profiles as p where p.id = i.user_id
       )
     order by i.user_id,
              case i.provider when 'github' then 0 when 'google' then 1 else 2 end,
              i.provider_id
  loop
    begin
      perform private.provision_oauth_profile_identity(
        trusted_identity.provider,
        trusted_identity.provider_id,
        trusted_identity.user_id,
        trusted_identity.identity_data
      );
    exception
      when unique_violation or check_violation then
        raise warning 'Skipped conflicting OAuth profile backfill for user %', trusted_identity.user_id;
    end;
  end loop;
end;
$$;
-- END SOURCE: supabase/migrations/202610040001_provider_neutral_profile_provisioning.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 18 OF 20: 202610040002_google_profile_metadata_provenance.sql
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/migrations/202610040002_google_profile_metadata_provenance.sql
-- Converge every recorded 001 revision on Google-only profile metadata.

begin;

lock table auth.identities in share row exclusive mode;
lock table public.profiles in share row exclusive mode;

alter table public.profiles
  add column metadata_provider text;

alter table public.profiles
  add constraint profiles_metadata_provider_check
  check (metadata_provider is null or metadata_provider in ('google', 'github'));

-- A legacy GitHub id is durable evidence of GitHub-owned metadata. The
-- deterministic login plus a valid trusted Google identity identifies profiles
-- created by either deployed 001 revision without persisting the provider id.
update public.profiles
   set metadata_provider = 'github'
 where github_user_id is not null;

update public.profiles as p
   set metadata_provider = 'google'
 where p.metadata_provider is null
   and p.github_user_id is null
   and p.login = 'google-' || pg_catalog.md5(p.id::text)
   and exists (
     select 1
       from auth.identities as i
      where i.user_id = p.id
        and i.provider = 'google'
        and pg_catalog.jsonb_typeof(i.identity_data) = 'object'
        and pg_catalog.char_length(pg_catalog.btrim(i.provider_id)) between 1 and 255
        and pg_catalog.btrim(i.provider_id) ~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254})$'
   );

create or replace function private.provision_oauth_profile_identity(
  identity_provider text,
  identity_provider_id text,
  identity_user_id uuid,
  identity_data jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_id_text text;
  profile_login text;
  profile_display_name text;
  profile_avatar_url text;
begin
  if identity_provider is distinct from 'google'
     or identity_user_id is null
     or pg_catalog.jsonb_typeof(identity_data) is distinct from 'object' then
    return;
  end if;

  provider_id_text := pg_catalog.btrim(identity_provider_id);
  if provider_id_text is null
     or pg_catalog.char_length(provider_id_text) not between 1 and 255
     or provider_id_text !~ '^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254})$' then
    return;
  end if;

  profile_login := 'google-' || pg_catalog.md5(identity_user_id::text);

  profile_display_name := pg_catalog.btrim(
    coalesce(identity_data ->> 'full_name', identity_data ->> 'name')
  );
  if profile_display_name is not null
     and pg_catalog.char_length(profile_display_name) not between 1 and 120 then
    profile_display_name := null;
  end if;

  profile_avatar_url := pg_catalog.btrim(
    coalesce(identity_data ->> 'avatar_url', identity_data ->> 'picture')
  );
  if profile_avatar_url is not null
     and (
       pg_catalog.char_length(profile_avatar_url) not between 1 and 2048
       or profile_avatar_url !~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^[:space:]]*)?$'
     ) then
    profile_avatar_url := null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-user:' || identity_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('oauth-profile-provider:google:' || provider_id_text, 0)
  );

  insert into public.profiles (
    id,
    github_user_id,
    login,
    display_name,
    avatar_url,
    metadata_provider
  ) values (
    identity_user_id,
    null,
    profile_login,
    profile_display_name,
    profile_avatar_url,
    'google'
  )
  on conflict (id) do update
     set display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         updated_at = pg_catalog.clock_timestamp()
   where public.profiles.metadata_provider = 'google';
end;
$$;

alter function private.provision_oauth_profile_identity(text, text, uuid, jsonb) owner to postgres;
revoke all on function private.provision_oauth_profile_identity(text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function private.provision_oauth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_oauth_profile_identity(
    new.provider,
    new.provider_id,
    new.user_id,
    new.identity_data
  );
  return new;
end;
$$;

alter function private.provision_oauth_profile() owner to postgres;
revoke all on function private.provision_oauth_profile() from public, anon, authenticated;

drop trigger if exists identities_provision_oauth_profile on auth.identities;
create trigger identities_provision_oauth_profile
after insert or update of provider_id, user_id, identity_data, provider on auth.identities
for each row execute function private.provision_oauth_profile();

create or replace function private.backfill_oauth_profiles()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trusted_identity record;
begin
  for trusted_identity in
    select i.provider, i.provider_id, i.user_id, i.identity_data
      from auth.identities as i
     where i.provider = 'google'
       and not exists (
         select 1 from public.profiles as p where p.id = i.user_id
       )
     order by i.user_id, i.provider_id
  loop
    begin
      perform private.provision_oauth_profile_identity(
        trusted_identity.provider,
        trusted_identity.provider_id,
        trusted_identity.user_id,
        trusted_identity.identity_data
      );
    exception
      when unique_violation or check_violation then
        raise warning 'Skipped conflicting OAuth profile backfill for user %', trusted_identity.user_id;
    end;
  end loop;
end;
$$;

alter function private.backfill_oauth_profiles() owner to postgres;
revoke all on function private.backfill_oauth_profiles() from public, anon, authenticated;

select private.backfill_oauth_profiles();

revoke select (metadata_provider) on public.profiles from public, anon, authenticated;
revoke insert (metadata_provider), update (metadata_provider) on public.profiles from public, anon, authenticated;

commit;
-- END SOURCE: supabase/migrations/202610040002_google_profile_metadata_provenance.sql

-- ============================================================================
-- DASHBOARD RUN SECTION 19 OF 20: DEVELOPMENT SEED AND MIGRATION HISTORY
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
-- BEGIN SOURCE: supabase/seed.sql
insert into public.tags (id, slug, label, is_active, sort_order)
values
  ('a1000000-0000-0000-0000-000000000001', 'ai-agent', 'AI·Agent', true, 10),
  ('a1000000-0000-0000-0000-000000000002', 'development', '개발', true, 20),
  ('a1000000-0000-0000-0000-000000000003', 'infra-cloud', '인프라·클라우드', true, 30),
  ('a1000000-0000-0000-0000-000000000004', 'side-project', '사이드 프로젝트', true, 40),
  ('a1000000-0000-0000-0000-000000000005', 'free-talk', '자유 이야기', true, 50)
on conflict (id) do update
set slug = excluded.slug,
    label = excluded.label,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order;
-- END SOURCE: supabase/seed.sql

-- The CLI 2.118.0 local reset schema was inspected before generating this file:
-- (version text primary key, statements text[], name text). The official CLI
-- records parsed statements, but db push determines applied status by version.
-- Empty statements truthfully avoid inventing parser output while version/name
-- prevent these already-executed files from being replayed by a future db push.
insert into supabase_migrations.schema_migrations (version, statements, name)
values
  ('202609260001', array[]::text[], 'core_schema'),
  ('202609260002', array[]::text[], 'rls_and_rpcs'),
  ('202609260003', array[]::text[], 'storage'),
  ('202609260004', array[]::text[], 'public_post_read_model'),
  ('202609260005', array[]::text[], 'profile_provisioning'),
  ('202609270001', array[]::text[], 'public_attachment_resolver'),
  ('202609270002', array[]::text[], 'trusted_github_profile_provisioning'),
  ('202609270003', array[]::text[], 'public_attachment_body_urls'),
  ('202609270004', array[]::text[], 'post_tombstones'),
  ('202609270005', array[]::text[], 'unbounded_public_listing'),
  ('202609280001', array[]::text[], 'public_post_attachment_count'),
  ('202609280002', array[]::text[], 'attach_expected_total'),
  ('202609280003', array[]::text[], 'discussion_interactions'),
  ('202609280004', array[]::text[], 'moderation'),
  ('202609280005', array[]::text[], 'community_snapshot_export'),
  ('202610040001', array[]::text[], 'provider_neutral_profile_provisioning'),
  ('202610040002', array[]::text[], 'google_profile_metadata_provenance');

-- ============================================================================
-- DASHBOARD RUN SECTION 20 OF 20: READ-ONLY VERIFICATION
-- Select only this section in SQL Editor, click Run, and stop on any error.
-- ============================================================================
do $bootstrap_verify$
declare
  trigger_definition text;
  provision_definition text;
  seed_count integer;
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.posts') is null
     or pg_catalog.to_regclass('public.comments') is null
     or pg_catalog.to_regclass('public.tags') is null
     or pg_catalog.to_regclass('private.post_metrics') is null then
    raise exception 'verification failed: a core community relation is missing';
  end if;

  if pg_catalog.to_regprocedure('public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)') is null
     or pg_catalog.to_regprocedure('private.provision_oauth_profile_identity(text,text,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('private.backfill_oauth_profiles()') is null then
    raise exception 'verification failed: a core function is missing';
  end if;

  select pg_catalog.pg_get_triggerdef(t.oid)
    into trigger_definition
    from pg_catalog.pg_trigger as t
    join pg_catalog.pg_class as c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'auth'
     and c.relname = 'identities'
     and t.tgname = 'identities_provision_oauth_profile'
     and not t.tgisinternal;
  if trigger_definition is null
     or trigger_definition not like '%EXECUTE FUNCTION private.provision_oauth_profile()%' then
    raise exception 'verification failed: Google profile trigger is missing or unexpected';
  end if;

  select pg_catalog.pg_get_functiondef('private.provision_oauth_profile_identity(text,text,uuid,jsonb)'::regprocedure)
    into provision_definition;
  if provision_definition not ilike '%identity_provider is distinct from ''google''%'
     or provision_definition ilike '%identity_provider = ''github''%'
     or provision_definition ilike '%identity_provider = ''kakao''%'
     or provision_definition ilike '%identity_provider in (%github%'
     or provision_definition ilike '%identity_provider in (%kakao%' then
    raise exception 'verification failed: DB provisioning is not statically Google-only (github/kakao found)';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'metadata_provider'
       and not attisdropped
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_metadata_provider_check'
  ) then
    raise exception 'verification failed: profile metadata provenance is missing';
  end if;

  select count(*) into seed_count from public.tags;
  if seed_count <> 5
     or (select count(*) from public.tags where id in (
       'a1000000-0000-0000-0000-000000000001'::uuid,
       'a1000000-0000-0000-0000-000000000002'::uuid,
       'a1000000-0000-0000-0000-000000000003'::uuid,
       'a1000000-0000-0000-0000-000000000004'::uuid,
       'a1000000-0000-0000-0000-000000000005'::uuid
     )) <> 5 then
    raise exception 'verification failed: expected exactly 5 development seed tags';
  end if;

  if (select count(*) from supabase_migrations.schema_migrations where version between '202609260001' and '202610040002') <> 17 then
    raise exception 'verification failed: expected 17 application migration history rows';
  end if;

  raise notice 'BOOTSTRAP VERIFIED: 17 migrations, Google-only provisioning, provenance, and 5 seed tags';
end
$bootstrap_verify$;
