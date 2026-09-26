begin;

select plan(175);

-- Deterministic actors and content are inserted as the migration owner so the
-- browser-role assertions below never rely on table-owner RLS bypass.
insert into auth.users (id, aud, role, email) values
  ('91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test'),
  ('91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test'),
  ('91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'rls-admin@example.test');
insert into public.profiles (id, github_user_id, login, display_name, avatar_url) values
  ('91000000-0000-0000-0000-000000000001', 91001, 'rls-a', 'RLS A', 'https://example.test/a.png'),
  ('91000000-0000-0000-0000-000000000002', 91002, 'rls-b', 'RLS B', 'https://example.test/b.png'),
  ('91000000-0000-0000-0000-000000000003', 91003, 'rls-admin', 'RLS Admin', null);
insert into public.user_roles (user_id, role) values
  ('91000000-0000-0000-0000-000000000003', 'admin');
insert into public.tags (id, slug, label, is_active, sort_order) values
  ('93000000-0000-0000-0000-000000000001', 'rls-active', 'RLS Active', true, 901),
  ('93000000-0000-0000-0000-000000000002', 'rls-inactive', 'RLS Inactive', false, 902);
insert into public.posts (id, author_id, title, body_markdown, status, is_locked, deleted_at) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'RLS published', 'visible', 'published', false, null),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'RLS hidden', 'hidden', 'hidden', false, null),
  ('92000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', 'RLS deleted', 'deleted', 'deleted', false, now());
insert into public.post_tags (post_id, tag_id) values
  ('92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001'),
  ('92000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001');
insert into public.comments (id, post_id, author_id, body_markdown, status, deleted_at) values
  ('94000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'visible comment', 'published', null),
  ('94000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'hidden comment', 'hidden', null),
  ('94000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'comment on hidden post', 'published', null);
insert into public.post_reactions (user_id, post_id) values
  ('91000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000002');
insert into public.comment_reactions (user_id, comment_id) values
  ('91000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002');

select ok((select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(array['profiles','user_roles','posts','comments','tags','post_tags','post_reactions','comment_reactions','attachments','reports','moderation_audit_logs','idempotency_keys','rate_limit_rules','rate_limit_events'])), 'RLS remains enabled on all 14 tables');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename <> 'attachments'), 5, 'Task 3 keeps exactly five narrow public-read policies; Task 4 attachment RLS is tested separately');
select ok(has_table_privilege('anon', 'public.posts', 'SELECT'), 'anon has post SELECT');
select ok(has_table_privilege('authenticated', 'public.posts', 'SELECT'), 'authenticated has post SELECT');
select ok(has_column_privilege('anon', 'public.profiles', 'display_name', 'SELECT'), 'anon can select safe profile fields');
select ok(not has_column_privilege('anon', 'public.profiles', 'github_user_id', 'SELECT'), 'anon cannot select GitHub identity linkage');

set local role anon;
select is((select count(*)::integer from public.posts where id::text like '92000000-%'), 1, 'anon sees only published non-deleted post');
select is((select count(*)::integer from public.comments where id::text like '94000000-%'), 1, 'anon sees only published comment on visible post');
select is((select count(*)::integer from public.tags where id::text like '93000000-%'), 1, 'anon sees only active tag');
select is((select count(*)::integer from public.post_tags where post_id::text like '92000000-%'), 1, 'anon sees tags only for visible posts');
select throws_ok($$select * from public.post_reactions$$, '42501', 'permission denied for table post_reactions', 'anon cannot read raw post reaction identities');
select throws_ok($$select * from public.comment_reactions$$, '42501', 'permission denied for table comment_reactions', 'anon cannot read raw comment reaction identities');
select lives_ok($$select id, login, display_name, avatar_url, created_at from public.profiles limit 1$$, 'anon can read safe profile projection');
select throws_like($$select github_user_id from public.profiles limit 1$$, '%permission denied%', 'anon cannot read protected profile field');
select throws_like($$select * from public.user_roles$$, '%permission denied%', 'anon cannot read roles');
select throws_like($$select * from public.reports$$, '%permission denied%', 'anon cannot read reports');
select throws_like($$select * from public.attachments$$, '%permission denied%', 'anon cannot read attachments');
select throws_like($$select * from public.idempotency_keys$$, '%permission denied%', 'anon cannot read idempotency state');
select throws_like($$select * from public.rate_limit_rules$$, '%permission denied%', 'anon cannot read rate-limit rules');
select throws_like($$select * from public.rate_limit_events$$, '%permission denied%', 'anon cannot read rate-limit events');
select throws_like($$select * from public.moderation_audit_logs$$, '%permission denied%', 'anon cannot read audit logs');
select throws_like($$insert into public.posts(author_id,title,body_markdown) values ('91000000-0000-0000-0000-000000000001','bad','bad')$$, '%permission denied%', 'anon cannot insert posts directly');
select is(public.is_admin(), false, 'anon is not admin');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.posts where id::text like '92000000-%'), 1, 'member sees only visible posts including own hidden content being absent');
select throws_ok($$select * from public.post_reactions$$, '42501', 'permission denied for table post_reactions', 'authenticated cannot read raw post reaction identities');
select throws_ok($$select * from public.comment_reactions$$, '42501', 'permission denied for table comment_reactions', 'authenticated cannot read raw comment reaction identities');
select throws_like($$update public.posts set title='stolen' where id='92000000-0000-0000-0000-000000000001'$$, '%permission denied%', 'member cannot update even own post directly');
select throws_like($$delete from public.comments where id='94000000-0000-0000-0000-000000000001'$$, '%permission denied%', 'member cannot delete comments directly');
select throws_like($$insert into public.user_roles(user_id,role) values ('91000000-0000-0000-0000-000000000001','admin')$$, '%permission denied%', 'member cannot self-assign admin');
select throws_like($$insert into public.moderation_audit_logs(actor_id,action,target_type,target_id) values ('91000000-0000-0000-0000-000000000001','fake','post','92000000-0000-0000-0000-000000000001')$$, '%permission denied%', 'member cannot forge audit records');
select is(public.is_admin(), false, 'user A is not admin');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', true);
select is(public.is_admin(), false, 'user B is not admin');
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000003', true);
select is(public.is_admin(), true, 'database role row makes admin true');
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","user_role":"admin"}', true);
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select is(public.is_admin(), false, 'client JWT admin flag is ignored');
select throws_like($$select * from public.user_roles$$, '%permission denied%', 'admin browser role still cannot enumerate role table');
reset role;

-- PostgREST uses the browser database role, so these exact privilege checks
-- cover users A/B/admin independently of client-controlled JWT claims.
select ok(not has_table_privilege('anon', 'public.post_reactions', 'SELECT'), 'anon has no raw post reaction SELECT grant');
select ok(not has_table_privilege('authenticated', 'public.post_reactions', 'SELECT'), 'authenticated has no raw post reaction SELECT grant');
select ok(not has_table_privilege('anon', 'public.comment_reactions', 'SELECT'), 'anon has no raw comment reaction SELECT grant');
select ok(not has_table_privilege('authenticated', 'public.comment_reactions', 'SELECT'), 'authenticated has no raw comment reaction SELECT grant');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename in ('post_reactions','comment_reactions')), 'raw reaction tables have no browser RLS policies');

-- Exact direct-table actor/resource/operation matrix. JWT identities are listed
-- explicitly even where the database role intentionally has the same ACL: this
-- prevents a future ownership/admin policy from silently widening direct CRUD.
select is(
  has_table_privilege(actor_role, format('public.%I', table_name), operation),
  expected,
  format('%s direct %s on %s is %s', actor_name, operation, table_name, expected)
)
from (values
  ('anon',  'anon',          null::uuid),
  ('user A','authenticated', '91000000-0000-0000-0000-000000000001'::uuid),
  ('user B','authenticated', '91000000-0000-0000-0000-000000000002'::uuid),
  ('admin', 'authenticated', '91000000-0000-0000-0000-000000000003'::uuid)
) actors(actor_name, actor_role, actor_id)
cross join (values
  ('posts'),('comments'),('post_reactions'),('comment_reactions'),
  ('attachments'),('reports'),('user_roles'),('moderation_audit_logs')
) resources(table_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) operations(operation)
cross join lateral (
  select operation='SELECT' and table_name in ('posts','comments') as expected,
         pg_catalog.set_config('request.jwt.claim.sub', coalesce(actor_id::text,''), true)
) expectation;

select is((select prosecdef from pg_proc where oid='public.is_admin()'::regprocedure), true, 'is_admin is SECURITY DEFINER');
select is((select proconfig from pg_proc where oid='public.is_admin()'::regprocedure), array['search_path=""'], 'is_admin has empty search_path');
select ok(not has_function_privilege('public', 'public.is_admin()', 'EXECUTE'), 'PUBLIC cannot execute is_admin');
select ok(has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'), 'anon can execute is_admin safely');
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'), 'authenticated can execute is_admin');
select is((select count(*)::integer from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')), 0, 'browser roles have no direct write grants on core tables');
select is((select count(*)::integer from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and table_name = any(array['user_roles','reports','attachments','idempotency_keys','rate_limit_rules','rate_limit_events','moderation_audit_logs'])), 0, 'sensitive tables have no browser grants');

select * from finish();
rollback;
