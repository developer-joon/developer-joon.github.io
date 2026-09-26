begin;

select plan(112);

-- Core relations exist and are protected before any policies are added.
select has_table('public', table_name, format('%s table exists', table_name))
from unnest(array[
  'profiles', 'user_roles', 'posts', 'comments', 'tags', 'post_tags',
  'post_reactions', 'comment_reactions', 'attachments', 'reports',
  'moderation_audit_logs', 'idempotency_keys', 'rate_limit_rules',
  'rate_limit_events'
]) as table_name;

select ok(
  (select count(*) = 14
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = any(array[
       'profiles', 'user_roles', 'posts', 'comments', 'tags', 'post_tags',
       'post_reactions', 'comment_reactions', 'attachments', 'reports',
       'moderation_audit_logs', 'idempotency_keys', 'rate_limit_rules',
       'rate_limit_events'
     ])
     and c.relrowsecurity),
  'RLS is enabled on every core public table'
);

select is(
  (select count(*)::integer
   from pg_policies
   where schemaname = 'public'
     and tablename = any(array[
       'profiles', 'user_roles', 'posts', 'comments', 'tags', 'post_tags',
       'post_reactions', 'comment_reactions', 'attachments', 'reports',
       'moderation_audit_logs', 'idempotency_keys', 'rate_limit_rules',
       'rate_limit_events'
     ])),
  0,
  'core tables have no policies before the RLS task'
);

select is(
  (select count(*)::integer
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name = any(array[
       'profiles', 'user_roles', 'posts', 'comments', 'tags', 'post_tags',
       'post_reactions', 'comment_reactions', 'attachments', 'reports',
       'moderation_audit_logs', 'idempotency_keys', 'rate_limit_rules',
       'rate_limit_events'
     ])),
  0,
  'anon and authenticated have no direct core table grants'
);

-- Future objects must remain fail-closed for browser roles and PUBLIC.
select is(
  (
    select count(*)::integer
    from (values ('postgres'::name), ('supabase_admin'::name)) as owners(role_name)
    cross join (values ('r'::"char", 'tables'), ('S'::"char", 'sequences'), ('f'::"char", 'functions')) as object_types(object_type, object_label)
    join pg_roles owner_role on owner_role.rolname = owners.role_name
    left join pg_namespace nsp on nsp.nspname = 'public'
    left join pg_default_acl defaults
      on defaults.defaclrole = owner_role.oid
     and defaults.defaclnamespace = nsp.oid
     and defaults.defaclobjtype = object_types.object_type
    cross join lateral aclexplode(coalesce(defaults.defaclacl, acldefault(object_types.object_type, owner_role.oid))) acl
    left join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where owners.role_name = 'postgres'
      and object_types.object_label = 'tables'
      and (acl.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated'))
  ),
  0,
  'postgres default table privileges expose nothing to PUBLIC or browser roles'
);
select is(
  (
    select count(*)::integer
    from pg_default_acl defaults
    join pg_roles owner_role on owner_role.oid = defaults.defaclrole
    join pg_namespace nsp on nsp.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) acl
    left join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where owner_role.rolname = 'postgres' and nsp.nspname = 'public' and defaults.defaclobjtype = 'S'
      and (acl.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated'))
  ), 0, 'postgres default sequence privileges expose nothing to PUBLIC or browser roles'
);
set local role postgres;
create function pg_temp.future_function_acl_probe()
returns integer
language sql
as $$ select 1 $$;
reset role;

select is(
  has_function_privilege('anon', 'pg_temp.future_function_acl_probe()', 'EXECUTE'),
  false,
  'postgres future functions are not executable by anon'
);
select is(
  has_function_privilege('authenticated', 'pg_temp.future_function_acl_probe()', 'EXECUTE'),
  false,
  'postgres future functions are not executable by authenticated'
);
-- UUID primary keys and timestamp types.
select col_type_is('public', table_name, 'id', 'uuid', format('%s.id is uuid', table_name))
from unnest(array[
  'profiles', 'posts', 'comments', 'tags', 'post_reactions',
  'comment_reactions', 'attachments', 'reports', 'moderation_audit_logs',
  'idempotency_keys', 'rate_limit_rules', 'rate_limit_events'
]) as table_name;

select col_is_pk('public', table_name, 'id', format('%s.id is the primary key', table_name))
from unnest(array[
  'profiles', 'posts', 'comments', 'tags', 'post_reactions',
  'comment_reactions', 'attachments', 'reports', 'moderation_audit_logs',
  'idempotency_keys', 'rate_limit_rules', 'rate_limit_events'
]) as table_name;

select col_type_is('public', table_name, 'created_at', 'timestamp with time zone', format('%s.created_at is timestamptz', table_name))
from unnest(array[
  'profiles', 'posts', 'comments', 'post_reactions', 'comment_reactions',
  'attachments', 'reports', 'moderation_audit_logs', 'idempotency_keys',
  'rate_limit_rules'
]) as table_name;

select col_type_is('public', 'rate_limit_events', 'occurred_at', 'timestamp with time zone', 'rate_limit_events.occurred_at is timestamptz');

-- Required keys, uniqueness, checks, and indexes are named for operability.
create function pg_temp.has_named_constraint(p_table text, p_constraint text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = p_table
      and con.conname = p_constraint
  );
$$;

select ok(pg_temp.has_named_constraint('profiles', 'profiles_github_user_id_key'), 'GitHub user id is unique');
select ok(pg_temp.has_named_constraint('user_roles', 'user_roles_pkey'), 'one role row per user');
select ok(pg_temp.has_named_constraint('posts', 'posts_title_length_check'), 'post title length is constrained');
select ok(pg_temp.has_named_constraint('posts', 'posts_body_length_check'), 'post body length is constrained');
select ok(pg_temp.has_named_constraint('posts', 'posts_status_check'), 'post status is constrained');
select ok(pg_temp.has_named_constraint('posts', 'posts_deleted_state_check'), 'post deletion timestamp matches state');
select ok(pg_temp.has_named_constraint('comments', 'comments_body_length_check'), 'comment body length is constrained');
select ok(pg_temp.has_named_constraint('comments', 'comments_status_check'), 'comment status is constrained');
select ok(pg_temp.has_named_constraint('comments', 'comments_deleted_state_check'), 'comment deletion timestamp matches state');
select ok(pg_temp.has_named_constraint('post_tags', 'post_tags_pkey'), 'post and tag pair is unique');
select ok(pg_temp.has_named_constraint('post_reactions', 'post_reactions_user_id_post_id_key'), 'post reaction is unique per user and post');
select ok(pg_temp.has_named_constraint('comment_reactions', 'comment_reactions_user_id_comment_id_key'), 'comment reaction is unique per user and comment');
select ok(pg_temp.has_named_constraint('attachments', 'attachments_storage_path_key'), 'attachment storage path is unique');
select ok(pg_temp.has_named_constraint('attachments', 'attachments_state_check'), 'attachment timestamps match state');
select ok(pg_temp.has_named_constraint('reports', 'reports_target_type_check'), 'report target type is constrained');
select ok(pg_temp.has_named_constraint('reports', 'reports_status_check'), 'report status is constrained');
select ok(pg_temp.has_named_constraint('reports', 'reports_resolution_state_check'), 'report resolution fields match state');
select ok(pg_temp.has_named_constraint('idempotency_keys', 'idempotency_keys_user_id_operation_key_key'), 'idempotency keys are scoped to user and operation');
select ok(pg_temp.has_named_constraint('rate_limit_rules', 'rate_limit_rules_action_window_seconds_key'), 'rate limit windows are unique per action');

select has_index('public', 'posts', 'posts_public_list_idx', 'post list index exists');
select has_index('public', 'posts', 'posts_search_idx', 'post full-text search index exists');
select has_index('public', 'comments', 'comments_post_thread_idx', 'comment thread index exists');
select has_index('public', 'post_tags', 'post_tags_tag_post_idx', 'tag filter index exists');
select has_index('public', 'attachments', 'attachments_owner_status_idx', 'attachment owner/status index exists');
select has_index('public', 'reports', 'reports_queue_idx', 'report queue index exists');
select has_index('public', 'rate_limit_events', 'rate_limit_events_lookup_idx', 'rate-limit lookup index exists');

-- Explicit foreign-key delete actions.
select is((select delete_rule from information_schema.referential_constraints where constraint_schema = 'public' and constraint_name = 'profiles_id_fkey'), 'CASCADE', 'profile follows auth user deletion');
select is((select delete_rule from information_schema.referential_constraints where constraint_schema = 'public' and constraint_name = 'posts_author_id_fkey'), 'RESTRICT', 'post author deletion is restricted');
select is((select delete_rule from information_schema.referential_constraints where constraint_schema = 'public' and constraint_name = 'comments_post_id_fkey'), 'CASCADE', 'comments follow hard-deleted post');
select is((select delete_rule from information_schema.referential_constraints where constraint_schema = 'public' and constraint_name = 'comments_parent_id_post_id_fkey'), 'CASCADE', 'replies follow hard-deleted parent');
select is((select delete_rule from information_schema.referential_constraints where constraint_schema = 'public' and constraint_name = 'attachments_post_id_fkey'), 'SET NULL', 'attachments detach from hard-deleted post');

-- Real constraint behavior.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'one@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'two@example.test');

insert into public.profiles (id, github_user_id, login, display_name)
values
  ('00000000-0000-0000-0000-000000000001', 1001, 'one', 'One'),
  ('00000000-0000-0000-0000-000000000002', 1002, 'two', 'Two');

select throws_like(
  $$insert into public.profiles (id, github_user_id, login) values ('00000000-0000-0000-0000-000000000003', 1001, 'duplicate')$$,
  '%profiles_github_user_id_key%',
  'duplicate GitHub user id is rejected'
);

select throws_like(
  $$insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000001', 'owner')$$,
  '%user_roles_role_check%',
  'unknown role is rejected'
);

insert into public.posts (id, author_id, title, body_markdown)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Valid title', 'Valid body'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Second post', 'Second body');

select throws_like(
  $$insert into public.posts (author_id, title, body_markdown) values ('00000000-0000-0000-0000-000000000001', ' x ', 'body')$$,
  '%posts_title_length_check%',
  'trimmed one-character post title is rejected'
);
select throws_like(
  $$insert into public.posts (author_id, title, body_markdown) values ('00000000-0000-0000-0000-000000000001', 'Title', '   ')$$,
  '%posts_body_length_check%',
  'blank post body is rejected'
);
select throws_like(
  $$update public.posts set status = 'deleted' where id = '10000000-0000-0000-0000-000000000001'$$,
  '%posts_deleted_state_check%',
  'deleted post requires deleted_at'
);

insert into public.comments (id, post_id, author_id, body_markdown)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Top level'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Another top level');
insert into public.comments (id, post_id, author_id, parent_id, body_markdown)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Reply');
select is(
  (select parent_id from public.comments where id = '20000000-0000-0000-0000-000000000002'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'a valid reply is inserted with its parent relationship established'
);

select throws_like(
  $$insert into public.comments (post_id, author_id, parent_id, body_markdown) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Nested reply')$$,
  '%top-level comment%',
  'a reply cannot target another reply'
);
select throws_like(
  $$update public.comments set parent_id = '20000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000003'$$,
  '%relationship keys are immutable%',
  'an existing comment parent cannot be changed'
);
select throws_like(
  $$insert into public.comments (post_id, author_id, parent_id, body_markdown) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Wrong post')$$,
  '%comments_parent_id_post_id_fkey%',
  'reply parent must belong to the same post'
);
select throws_like(
  $$insert into public.comments (post_id, author_id, body_markdown) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '   ')$$,
  '%comments_body_length_check%',
  'blank comment is rejected'
);
select throws_like(
  $$update public.comments set parent_id = '20000000-0000-0000-0000-000000000003' where id = '20000000-0000-0000-0000-000000000001'$$,
  '%relationship keys are immutable%',
  'a comment with replies cannot be updated into a reply'
);
select throws_like(
  $$update public.comments set parent_id = null where id = '20000000-0000-0000-0000-000000000002'$$,
  '%relationship keys are immutable%',
  'a reply cannot be converted to a top-level comment'
);
select throws_like(
  $$update public.comments set post_id = '10000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000002'$$,
  '%relationship keys are immutable%',
  'a comment cannot move to another post'
);

insert into public.tags (id, slug, label, sort_order, is_active)
values
  ('30000000-0000-0000-0000-000000000001', 'one', 'One', 1, true),
  ('30000000-0000-0000-0000-000000000002', 'two', 'Two', 2, true),
  ('30000000-0000-0000-0000-000000000003', 'three', 'Three', 3, true),
  ('30000000-0000-0000-0000-000000000004', 'four', 'Four', 4, true),
  ('30000000-0000-0000-0000-000000000005', 'inactive', 'Inactive', 5, false);
insert into public.post_tags (post_id, tag_id) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003');
select throws_like(
  $$insert into public.post_tags (post_id, tag_id) values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004')$$,
  '%at most 3 tags%',
  'a post cannot have more than three tags'
);
insert into public.post_tags (post_id, tag_id)
values ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004');
select throws_like(
  $$update public.post_tags set post_id = '10000000-0000-0000-0000-000000000001' where post_id = '10000000-0000-0000-0000-000000000002' and tag_id = '30000000-0000-0000-0000-000000000004'$$,
  '%relationship keys are immutable%',
  'moving an existing tag cannot give a post more than three tags'
);
select is(
  (select count(*)::integer from public.post_tags where post_id = '10000000-0000-0000-0000-000000000001'),
  3,
  'a rejected tag move leaves the destination at three tags'
);
select throws_like(
  $$update public.post_tags set post_id = '10000000-0000-0000-0000-000000000002' where post_id = '10000000-0000-0000-0000-000000000001' and tag_id = '30000000-0000-0000-0000-000000000001'$$,
  '%relationship keys are immutable%',
  'moving an existing tag is rejected even when the destination is under the limit'
);
select throws_like(
  $$update public.post_tags set tag_id = '30000000-0000-0000-0000-000000000003' where post_id = '10000000-0000-0000-0000-000000000002' and tag_id = '30000000-0000-0000-0000-000000000004'$$,
  '%relationship keys are immutable%',
  'an existing post tag cannot be reassigned to another active tag'
);
select throws_like(
  $$update public.post_tags set tag_id = '30000000-0000-0000-0000-000000000005' where post_id = '10000000-0000-0000-0000-000000000002' and tag_id = '30000000-0000-0000-0000-000000000004'$$,
  '%relationship keys are immutable%',
  'an existing post tag cannot be reassigned to an inactive tag'
);

insert into public.post_reactions (user_id, post_id)
values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
select throws_like(
  $$insert into public.post_reactions (user_id, post_id) values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')$$,
  '%post_reactions_user_id_post_id_key%',
  'duplicate post reaction is rejected'
);

insert into public.comment_reactions (user_id, comment_id)
values ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
select throws_like(
  $$insert into public.comment_reactions (user_id, comment_id) values ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')$$,
  '%comment_reactions_user_id_comment_id_key%',
  'duplicate comment reaction is rejected'
);

select throws_like(
  $$insert into public.attachments (owner_id, storage_path, mime_type, byte_size, status) values ('00000000-0000-0000-0000-000000000001', 'path/image.png', 'image/png', 20, 'attached')$$,
  '%attachments_state_check%',
  'attached attachment requires attached_at'
);

insert into public.reports (reporter_id, target_type, target_id, reason_code)
values ('00000000-0000-0000-0000-000000000001', 'post', '10000000-0000-0000-0000-000000000001', 'spam');
select throws_like(
  $$insert into public.reports (reporter_id, target_type, target_id, reason_code) values ('00000000-0000-0000-0000-000000000001', 'post', '10000000-0000-0000-0000-000000000001', 'duplicate')$$,
  '%reports_one_open_per_reporter_target_idx%',
  'duplicate open report is rejected'
);
select throws_like(
  $$update public.reports set status = 'resolved' where reporter_id = '00000000-0000-0000-0000-000000000001'$$,
  '%reports_resolution_state_check%',
  'resolved report requires resolver and timestamp'
);

select throws_like(
  $$insert into public.rate_limit_rules (action, window_seconds, max_requests) values ('post.create', 0, 5)$$,
  '%rate_limit_rules_window_seconds_check%',
  'rate limit window must be positive'
);

select * from finish();
rollback;
