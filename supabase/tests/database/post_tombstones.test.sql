begin;

select plan(41);

insert into auth.users (id,aud,role,email) values
  ('71000000-0000-0000-0000-000000000001','authenticated','authenticated','tomb-a@example.test'),
  ('71000000-0000-0000-0000-000000000002','authenticated','authenticated','tomb-b@example.test');
insert into public.profiles(id,github_user_id,login,display_name,avatar_url) values
  ('71000000-0000-0000-0000-000000000001',97101,'tomb-a','Tomb A','https://example.test/a.png'),
  ('71000000-0000-0000-0000-000000000002',97102,'tomb-b','Tomb B',null);
insert into public.posts(id,author_id,title,body_markdown,status,deleted_at,created_at,updated_at) values
  ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','Published','published body','published',null,'2026-09-01','2026-09-01'),
  ('72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','Hidden secret','hidden secret body','hidden',null,'2026-09-02','2026-09-02'),
  ('72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','Deleted with comments','deleted secret body','deleted','2026-09-03','2026-09-03','2026-09-03'),
  ('72000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','Deleted empty','empty secret body','deleted','2026-09-04','2026-09-04','2026-09-04'),
  ('72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','Deleted private comments','private secret body','deleted','2026-09-05','2026-09-05','2026-09-05');
insert into public.comments(id,post_id,author_id,parent_id,body_markdown,status,deleted_at,created_at,updated_at) values
  ('74000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'top one','published',null,'2026-09-03 01:00','2026-09-03 01:00'),
  ('74000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','reply one','published',null,'2026-09-03 01:01','2026-09-03 01:01'),
  ('74000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'top two','published',null,'2026-09-03 02:00','2026-09-03 02:00'),
  ('74000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'hidden child','hidden',null,'2026-09-03 03:00','2026-09-03 03:00'),
  ('74000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'deleted child','deleted','2026-09-03 04:00','2026-09-03 04:00','2026-09-03 04:00'),
  ('74000000-0000-0000-0000-000000000006','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000002',null,'only hidden','hidden',null,'2026-09-05 01:00','2026-09-05 01:00'),
  ('74000000-0000-0000-0000-000000000007','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000002',null,'only deleted','deleted','2026-09-05 02:00','2026-09-05 02:00','2026-09-05 02:00'),
  ('74000000-0000-0000-0000-000000000008','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002',null,'published parent comment','published',null,'2026-09-01 01:00','2026-09-01 01:00');

select has_function('public','get_public_post_v2',array['uuid'],'v2 scalar post RPC exists');
select has_function('public','list_public_post_comments',array['uuid'],'constrained comment RPC exists');
select ok(not has_function_privilege('public','public.get_public_post_v2(uuid)','EXECUTE'),'PUBLIC cannot execute v2 post RPC');
select ok(not has_function_privilege('service_role','public.get_public_post_v2(uuid)','EXECUTE'),'service role cannot execute v2 post RPC');
select ok(has_function_privilege('anon','public.get_public_post_v2(uuid)','EXECUTE'),'anon can execute v2 post RPC');
select ok(has_function_privilege('authenticated','public.get_public_post_v2(uuid)','EXECUTE'),'authenticated can execute v2 post RPC');
select ok(not has_function_privilege('public','public.list_public_post_comments(uuid)','EXECUTE'),'PUBLIC cannot execute comment RPC');
select ok(not has_function_privilege('service_role','public.list_public_post_comments(uuid)','EXECUTE'),'service role cannot execute comment RPC');
select ok(has_function_privilege('anon','public.list_public_post_comments(uuid)','EXECUTE'),'anon can execute comment RPC');
select ok(has_function_privilege('authenticated','public.list_public_post_comments(uuid)','EXECUTE'),'authenticated can execute comment RPC');
select ok((select prosecdef and proconfig=array['search_path=""'] and pg_get_userbyid(proowner)='postgres' and provolatile='s' from pg_proc where oid='public.get_public_post_v2(uuid)'::regprocedure),'v2 post RPC is stable fixed-owner SECURITY DEFINER with empty search path');
select ok((select prosecdef and proconfig=array['search_path=""'] and pg_get_userbyid(proowner)='postgres' and provolatile='s' from pg_proc where oid='public.list_public_post_comments(uuid)'::regprocedure),'comment RPC is stable fixed-owner SECURITY DEFINER with empty search path');

set local role anon;
select is(public.get_public_post_v2('72999999-0000-0000-0000-000000000099'),'{"kind":"not_found"}'::jsonb,'missing post is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000002'),'{"kind":"hidden"}'::jsonb,'hidden post is an exact existence-only state');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000004'),'{"kind":"not_found"}'::jsonb,'deleted post without public comments is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000005'),'{"kind":"not_found"}'::jsonb,'deleted post with only hidden/deleted comments is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":3}'::jsonb,'deleted post exposes only exact kind and visible count');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->>'kind'),'published','published post returns published state');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->'post'->>'body_markdown'),'published body','published body is returned through the sanitizer');
select is((select count(*)::integer from public.list_public_post_comments('72000000-0000-0000-0000-000000000002')),0,'hidden parent comments are inaccessible');
select is((select count(*)::integer from public.list_public_post_comments('72000000-0000-0000-0000-000000000004')),0,'invalid deleted tombstone comments are inaccessible');
select is((select count(*)::integer from public.list_public_post_comments('72000000-0000-0000-0000-000000000003')),3,'valid deleted tombstone exposes published nondeleted comments');
select is((select array_agg(id order by row_number) from public.list_public_post_comments('72000000-0000-0000-0000-000000000003')),array['74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000003']::uuid[],'comments use deterministic top-level then reply order');
select is((select jsonb_agg(body_markdown order by row_number) from public.list_public_post_comments('72000000-0000-0000-0000-000000000003')),'["top one","reply one","top two"]'::jsonb,'hidden and deleted comments never enter the public comment result');
select is(pg_catalog.pg_get_function_result('public.list_public_post_comments(uuid)'::regprocedure),'TABLE(row_number bigint, id uuid, parent_id uuid, body_markdown text, created_at timestamp with time zone, updated_at timestamp with time zone, author_id uuid, author_login text, author_display_name text, author_avatar_url text)','comment RPC exposes only the minimum safe fields');
select is((select jsonb_object_agg(column_name,true order by column_name) from information_schema.columns where table_schema='public' and table_name='list_public_post_comments'),null::jsonb,'comment read is an RPC, not a public relation');
reset role;

create or replace function private.public_post_body(p_post_id uuid,p_body_markdown text)
returns text language plpgsql stable security definer set search_path='' as $$
begin
  perform pg_catalog.set_config('test.public_post_body_called',p_post_id::text,false);
  return 'instrumented:'||p_body_markdown;
end $$;
select pg_catalog.set_config('test.public_post_body_called','',false);
set local role anon;
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000002'),'{"kind":"hidden"}'::jsonb,'instrumented hidden read remains exact');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":3}'::jsonb,'instrumented deleted read remains exact');
select is(pg_catalog.current_setting('test.public_post_body_called',true),'','non-published states do not invoke the body sanitizer');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->'post'->>'body_markdown'),'instrumented:published body','published state invokes the body sanitizer');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='71000000-0000-0000-0000-000000000001';
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":3}'::jsonb,'authenticated receives the same tombstone');
select is((select count(*)::integer from public.list_public_post_comments('72000000-0000-0000-0000-000000000003')),3,'authenticated can read tombstone comments');
select throws_ok($$select public.create_comment('72000000-0000-0000-0000-000000000003',null,'new comment','tomb-create')$$,'22023','post not found, visible, or unlocked','deleted post rejects new comments');
select throws_ok($$select public.create_comment('72000000-0000-0000-0000-000000000003','74000000-0000-0000-0000-000000000001','new reply','tomb-reply')$$,'22023','post not found, visible, or unlocked','deleted post rejects new replies');
select throws_ok($$select public.toggle_post_reaction('72000000-0000-0000-0000-000000000003')$$,'22023','post not found or visible','deleted post rejects reactions');
select throws_ok($$select public.toggle_comment_reaction('74000000-0000-0000-0000-000000000001')$$,'22023','comment not found or visible','deleted post comment rejects reactions');
reset role;

update public.comments set status='hidden' where id in ('74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000002');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":1}'::jsonb,'tombstone count follows public comment transitions');
update public.comments set status='hidden' where id='74000000-0000-0000-0000-000000000003';
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"not_found"}'::jsonb,'hiding the final public comment removes the tombstone');
select is((select count(*)::integer from public.list_public_post_comments('72000000-0000-0000-0000-000000000003')),0,'comment read disappears with final public comment');
select ok((select polqual is not null from pg_policy where polrelid='public.comments'::regclass and polname='comments_public_read'),'base comment RLS remains in place');
select is((select count(*)::integer from pg_policy where polrelid='public.comments'::regclass),1,'no broader base comment policy was added');

select * from finish();
rollback;
