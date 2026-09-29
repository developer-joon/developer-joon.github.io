begin;

select plan(57);

insert into auth.users (id, aud, role, email) values
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'snapshot-author@example.test');

insert into public.profiles (id, github_user_id, login, display_name) values
  ('e1000000-0000-4000-8000-000000000001', 98001, 'snapshot-author', 'Snapshot Author');

insert into public.tags (id, slug, label, is_active, sort_order) values
  ('e2000000-0000-4000-8000-000000000001', 'snapshot-first', 'Snapshot First', true, 20),
  ('e2000000-0000-4000-8000-000000000002', 'snapshot-second', 'Snapshot Second', true, 10),
  ('e2000000-0000-4000-8000-000000000003', 'snapshot-retired', 'Snapshot Retired', true, 1);

insert into public.posts (
  id, author_id, title, body_markdown, status, created_at, updated_at, deleted_at
) values
  ('e3000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Snapshot one', 'safe body', 'published', '2026-09-20 00:00:00+00', '2026-09-21 00:00:00+00', null),
  ('e3000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Snapshot two', 'e1000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001', 'published', '2026-09-20 00:00:00+00', '2026-09-22 00:00:00+00', null),
  ('e3000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001', 'Snapshot three', 'third body', 'published', '2026-09-20 00:00:00+00', '2026-09-22 00:00:00+00', null),
  ('e3000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001', 'Hidden snapshot', 'hidden secret', 'hidden', '2026-09-20 00:00:00+00', '2026-09-23 00:00:00+00', null),
  ('e3000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001', 'Deleted snapshot', 'deleted secret', 'deleted', '2026-09-20 00:00:00+00', '2026-09-24 00:00:00+00', '2026-09-24 00:00:00+00');

insert into public.post_tags (post_id, tag_id) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001'),
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002'),
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000003');

update public.tags
   set is_active = false
 where id = 'e2000000-0000-4000-8000-000000000003';

insert into public.attachments (
  id, owner_id, post_id, client_key, payload_sha256, storage_path,
  mime_type, byte_size, status, attached_at, deleted_at
) values (
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  'e4000000-0000-4000-8000-000000000001',
  repeat('e', 64),
  'e1000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001',
  'image/png', 123, 'attached', now(), null
);

select has_function(
  'public', 'list_public_community_snapshots_v1',
  array['integer', 'timestamp with time zone', 'timestamp with time zone', 'uuid'],
  'snapshot export RPC exists with the versioned signature'
);
select function_returns(
  'public', 'list_public_community_snapshots_v1',
  array['integer', 'timestamp with time zone', 'timestamp with time zone', 'uuid'], 'jsonb',
  'snapshot export RPC returns one PostgREST-friendly JSON document'
);
select ok(
  (
    select p.proargnames = array[
      'p_limit', 'p_snapshot_at', 'p_cursor_created_at', 'p_cursor_id'
    ]::text[]
      and p.pronargdefaults = 3
      from pg_proc p
     where p.oid = to_regprocedure(
       'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)'
     )
  ),
  'snapshot export exposes the exact named argument and default contract'
);
select ok(
  (
    select p.prosecdef
       and p.provolatile = 's'
       and p.proconfig = array['search_path=""']
       and pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p
     where p.oid = to_regprocedure(
       'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)'
     )
  ),
  'snapshot export is fixed-owner STABLE SECURITY DEFINER with empty search_path'
);
select ok(
  not has_function_privilege(
    'public',
    'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'PUBLIC cannot execute snapshot export'
);
select ok(
  has_function_privilege(
    'anon',
    'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'anon can execute snapshot export'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute snapshot export'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.list_public_community_snapshots_v1(integer,timestamp with time zone,timestamp with time zone,uuid)',
    'EXECUTE'
  ),
  'service_role receives no incidental snapshot export grant'
);
select ok(
  not has_table_privilege('anon', 'public.posts', 'INSERT')
  and not has_table_privilege('anon', 'public.posts', 'UPDATE')
  and not has_table_privilege('anon', 'public.posts', 'DELETE'),
  'snapshot export does not broaden post write grants'
);
select ok(not has_function_privilege('anon', 'private.public_post_body(uuid,text)', 'EXECUTE'), 'body mapper remains private from browser roles');
select ok(
  (
    select (
      select array_agg(a.attname order by keys.ordinality)
        from unnest(i.indkey) with ordinality as keys(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = i.indrelid
         and a.attnum = keys.attnum
    ) = array['created_at', 'id']::name[]
      and pg_get_expr(i.indpred, i.indrelid) like '%status%published%'
      and pg_get_expr(i.indpred, i.indrelid) like '%deleted_at IS NULL%'
      from pg_index i
     where i.indexrelid = 'public.posts_public_snapshot_export_idx'::regclass
  ),
  'snapshot export index uses immutable created_at/id keys for visible rows'
);
select ok(
  to_regclass('public.posts') is not null
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.posts'::regclass
       and conname = 'posts_snapshot_title_raw_length_check'
       and convalidated
  )
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.posts'::regclass
       and conname = 'posts_body_length_check'
       and convalidated
       and pg_get_constraintdef(oid) like '%char_length(body_markdown) <= 50000%'
  )
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname in (
         'profiles_snapshot_login_raw_length_check',
         'profiles_snapshot_display_name_raw_length_check'
       )
       and convalidated
    having count(*) = 2
  )
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.tags'::regclass
       and conname in (
         'tags_snapshot_slug_raw_length_check',
         'tags_snapshot_label_raw_length_check'
       )
       and convalidated
    having count(*) = 2
  )
  and exists (
    select 1 from pg_constraint
     where conrelid = 'public.posts'::regclass
       and conname in (
         'posts_snapshot_created_at_finite_check',
         'posts_snapshot_updated_at_finite_check'
       )
       and convalidated
    having count(*) = 2
  ),
  'all strict generator text and timestamp bounds have validated source constraints'
);

select throws_like(
  $$update public.posts set title = title || repeat(' ', 121) where id = 'e3000000-0000-4000-8000-000000000001'$$,
  '%posts_snapshot_title_raw_length_check%',
  'raw title length rejects over-limit padding'
);
select throws_like(
  $$update public.posts set body_markdown = body_markdown || repeat(' ', 50001) where id = 'e3000000-0000-4000-8000-000000000001'$$,
  '%posts_body_length_check%',
  'existing raw body length rejects over-limit padding'
);
select throws_like(
  $$update public.profiles set login = login || repeat(' ', 40) where id = 'e1000000-0000-4000-8000-000000000001'$$,
  '%profiles_snapshot_login_raw_length_check%',
  'raw profile login length rejects over-limit padding'
);
select throws_like(
  $$update public.profiles set display_name = display_name || repeat(' ', 121) where id = 'e1000000-0000-4000-8000-000000000001'$$,
  '%profiles_snapshot_display_name_raw_length_check%',
  'raw profile display name length rejects over-limit padding'
);
select throws_like(
  $$update public.tags set label = label || repeat(' ', 51) where id = 'e2000000-0000-4000-8000-000000000001'$$,
  '%tags_snapshot_label_raw_length_check%',
  'raw tag label length rejects over-limit padding'
);
select throws_like(
  $$update public.tags set slug = repeat('a', 81) where id = 'e2000000-0000-4000-8000-000000000001'$$,
  '%tags_snapshot_slug_raw_length_check%',
  'raw tag slug length rejects values above the generator bound'
);
select throws_like(
  $$update public.posts set id = 'e3000000-0000-4000-8000-000000000099' where id = 'e3000000-0000-4000-8000-000000000001'$$,
  '%post snapshot ordering keys are immutable%',
  'post id is immutable at the table write boundary'
);
select throws_like(
  $$update public.posts set created_at = created_at + interval '1 second' where id = 'e3000000-0000-4000-8000-000000000001'$$,
  '%post snapshot ordering keys are immutable%',
  'post created_at is immutable at the table write boundary'
);
select throws_like(
  $$update public.posts set updated_at = 'infinity' where id = 'e3000000-0000-4000-8000-000000000001'$$,
  '%posts_snapshot_updated_at_finite_check%',
  'post updated_at must remain finite at the table write boundary'
);
select throws_like(
  $$insert into public.posts (id, author_id, title, body_markdown, status, created_at, updated_at) values ('e3000000-0000-4000-8000-000000000098', 'e1000000-0000-4000-8000-000000000001', 'Non-finite snapshot', 'body', 'published', 'infinity', 'infinity')$$,
  '%posts_snapshot_created_at_finite_check%',
  'new posts cannot use a non-finite creation timestamp'
);

set local role anon;

select throws_like(
  $$select public.list_public_community_snapshots_v1(null, null, null, null)$$,
  '%invalid snapshot export limit%',
  'null limit is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(0, null, null, null)$$,
  '%invalid snapshot export limit%',
  'zero limit is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(101, null, null, null)$$,
  '%invalid snapshot export limit%',
  'limit above 100 is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '2026-09-23 00:00:00+00', '2026-09-22 00:00:00+00', null)$$,
  '%invalid snapshot export cursor%',
  'cursor timestamp without id is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '2026-09-23 00:00:00+00', null, 'e3000000-0000-4000-8000-000000000001')$$,
  '%invalid snapshot export cursor%',
  'cursor id without timestamp is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '2026-09-23 00:00:00+00', 'infinity', 'e3000000-0000-4000-8000-000000000001')$$,
  '%invalid snapshot export cursor%',
  'non-finite cursor timestamp is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, 'infinity', null, null)$$,
  '%invalid snapshot export cutoff%',
  'non-finite snapshot cutoff is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '0001-01-01 00:00:00+00', null, null)$$,
  '%invalid snapshot export cutoff%',
  'finite cutoff outside the snapshot wire range is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '2026-09-23 00:00:00+00', '0001-01-01 00:00:00+00', 'e3000000-0000-4000-8000-000000000001')$$,
  '%invalid snapshot export cursor%',
  'finite cursor outside the snapshot wire range is rejected'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, null, '2026-09-22 00:00:00+00', 'e3000000-0000-4000-8000-000000000001')$$,
  '%snapshot export cursor requires explicit snapshot cutoff%',
  'a cursor cannot be resumed without its explicit snapshot cutoff'
);
select throws_like(
  $$select public.list_public_community_snapshots_v1(1, '2026-09-21 00:00:00+00', '2026-09-22 00:00:00+00', 'e3000000-0000-4000-8000-000000000001')$$,
  '%snapshot export cursor exceeds cutoff%',
  'cursor timestamp cannot exceed the snapshot cutoff'
);

create temporary table snapshot_pages (
  first_page jsonb not null,
  second_page jsonb
);

insert into snapshot_pages (first_page)
select public.list_public_community_snapshots_v1(2, null, null, null);

reset role;

update public.posts
   set updated_at = (select (first_page ->> 'snapshot_at')::timestamptz + interval '1 microsecond' from snapshot_pages)
 where id = 'e3000000-0000-4000-8000-000000000003';

insert into public.posts (
  id, author_id, title, body_markdown, status, created_at, updated_at, deleted_at
)
select
  'e3000000-0000-4000-8000-000000000006',
  'e1000000-0000-4000-8000-000000000001',
  'Post-cutoff snapshot',
  'must not leak into the frozen export',
  'published',
  (first_page ->> 'snapshot_at')::timestamptz + interval '1 microsecond',
  (first_page ->> 'snapshot_at')::timestamptz + interval '1 microsecond',
  null
from snapshot_pages;

set local role anon;

update snapshot_pages
   set second_page = public.list_public_community_snapshots_v1(
     2,
     (first_page ->> 'snapshot_at')::timestamptz,
     (first_page ->> 'next_cursor_created_at')::timestamptz,
     (first_page ->> 'next_cursor_id')::uuid
   );

select is(jsonb_array_length(first_page -> 'items'), 2, 'first page returns no more than the requested limit') from snapshot_pages;
select is((first_page ->> 'has_more')::boolean, true, 'lookahead reports another page') from snapshot_pages;
select is(
  (select array_agg(key order by key) from jsonb_object_keys(first_page) key),
  array['has_more', 'items', 'next_cursor_created_at', 'next_cursor_id', 'snapshot_at']::text[],
  'top-level response exposes only items and cursor metadata'
) from snapshot_pages;
select is(
  (
    select array_agg(key order by key)
      from jsonb_object_keys((first_page -> 'items') -> 0) key
  ),
  array['author', 'body_markdown', 'created_at', 'id', 'tags', 'title', 'updated_at']::text[],
  'export items expose exactly the approved post projection'
) from snapshot_pages;
select is(
  (
    select array_agg(item ->> 'id' order by ordinality)
      from jsonb_array_elements(first_page -> 'items') with ordinality as x(item, ordinality)
  ),
  array[
    'e3000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000002'
  ]::text[],
  'items use immutable created_at ASC, id ASC order'
) from snapshot_pages;
select ok(pg_catalog.isfinite((first_page ->> 'snapshot_at')::timestamptz), 'first page returns its finite effective snapshot cutoff') from snapshot_pages;
select is(second_page ->> 'snapshot_at', first_page ->> 'snapshot_at', 'later pages echo the explicit first-page snapshot cutoff') from snapshot_pages;
select is(first_page ->> 'next_cursor_created_at', '2026-09-20T00:00:00+00:00', 'next cursor timestamp matches the last returned item creation time') from snapshot_pages;
select is(first_page ->> 'next_cursor_id', 'e3000000-0000-4000-8000-000000000002', 'next cursor id matches the last returned item') from snapshot_pages;
select is(jsonb_array_length(second_page -> 'items'), 0, 'second page omits a row updated after the snapshot cutoff') from snapshot_pages;
select ok(
  not exists (
    select 1
      from jsonb_array_elements(first_page -> 'items') a
      join jsonb_array_elements(second_page -> 'items') b on a ->> 'id' = b ->> 'id'
  ),
  'cursor pages contain no duplicate ids'
) from snapshot_pages;
select is(
  (
    select array_agg(item ->> 'id' order by page_no, ordinality)
      from (
        select 1 as page_no, item, ordinality
          from jsonb_array_elements(first_page -> 'items') with ordinality as x(item, ordinality)
        union all
        select 2, item, ordinality
          from jsonb_array_elements(second_page -> 'items') with ordinality as x(item, ordinality)
      ) pages
  ),
  array[
    'e3000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000002'
  ]::text[],
  'a row updated after the first page is omitted from that snapshot sweep'
) from snapshot_pages;
select ok(
  not (
    ((first_page -> 'items') || (second_page -> 'items'))
    @> '[{"id":"e3000000-0000-4000-8000-000000000006"}]'::jsonb
  ),
  'a row inserted after the first-page snapshot cutoff is excluded from later pages'
) from snapshot_pages;
select is((second_page ->> 'has_more')::boolean, false, 'last page reports no further rows') from snapshot_pages;
select is(second_page -> 'next_cursor_created_at', 'null'::jsonb, 'last page has no timestamp cursor') from snapshot_pages;
select is(second_page -> 'next_cursor_id', 'null'::jsonb, 'last page has no id cursor') from snapshot_pages;
select ok(
  not (
    ((first_page -> 'items') || (second_page -> 'items'))
    @> '[{"id":"e3000000-0000-4000-8000-000000000004"}]'::jsonb
  ),
  'hidden UUID probe returns nothing'
) from snapshot_pages;
select ok(
  not (
    ((first_page -> 'items') || (second_page -> 'items'))
    @> '[{"id":"e3000000-0000-4000-8000-000000000005"}]'::jsonb
  ),
  'deleted UUID probe returns nothing'
) from snapshot_pages;
select is(
  (
    select item ->> 'body_markdown'
      from jsonb_array_elements(first_page -> 'items') item
     where item ->> 'id' = 'e3000000-0000-4000-8000-000000000002'
  ),
  '/functions/v1/public-attachment/e5000000-0000-4000-8000-000000000001',
  'full exported body uses the private public-body attachment mapper'
) from snapshot_pages;
select ok(
  position('e1000000-0000-4000-8000-000000000001/e4000000' in first_page::text) = 0
  and position('storage/v1/object' in first_page::text) = 0,
  'export payload exposes neither raw paths nor private Storage URLs'
) from snapshot_pages;
select is(
  (
    select array_agg(key order by key)
      from jsonb_object_keys((first_page -> 'items' -> 0) -> 'author') key
  ),
  array['display_name', 'login']::text[],
  'author projection contains exactly login and display_name'
) from snapshot_pages;
select is(
  (first_page -> 'items' -> 0 -> 'author'),
  jsonb_build_object('login', 'snapshot-author', 'display_name', 'Snapshot Author'),
  'author values come from the canonical profile'
) from snapshot_pages;
select is(
  (
    select array_agg(tag ->> 'slug' order by ordinality)
      from jsonb_array_elements(first_page -> 'items' -> 0 -> 'tags') with ordinality as x(tag, ordinality)
  ),
  array['snapshot-second', 'snapshot-first']::text[],
  'only active tags are exported in sort order'
) from snapshot_pages;
select is(
  (
    select array_agg(key order by key)
      from jsonb_object_keys(first_page -> 'items' -> 0 -> 'tags' -> 0) key
  ),
  array['id', 'label', 'slug']::text[],
  'tag projection contains only public tag fields'
) from snapshot_pages;

select * from finish();
rollback;
