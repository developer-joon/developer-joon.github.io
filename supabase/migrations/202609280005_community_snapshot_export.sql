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
