begin;

select plan(59);

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
  ('72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','Deleted private comments','private secret body','deleted','2026-09-05','2026-09-05','2026-09-05'),
  ('72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001','Continuation boundary','continuation body','published',null,'2026-09-06','2026-09-06');
insert into public.attachments(id,owner_id,post_id,storage_path,mime_type,byte_size,status,created_at,attached_at) values
  ('76000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','legacy/attached.png','image/png',1,'attached','2026-09-01','2026-09-01');
insert into public.attachments(id,owner_id,post_id,storage_path,mime_type,byte_size,status,created_at) values
  ('76000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001',null,'legacy/pending.png','image/png',1,'pending','2026-09-01');
insert into public.comments(id,post_id,author_id,parent_id,body_markdown,status,deleted_at,created_at,updated_at) values
  ('74000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'top one','published',null,'2026-09-03 01:00','2026-09-03 01:00'),
  ('74000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','reply one','published',null,'2026-09-03 01:01','2026-09-03 01:01'),
  ('74000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'top two','published',null,'2026-09-03 02:00','2026-09-03 02:00'),
  ('74000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'hidden child','hidden',null,'2026-09-03 03:00','2026-09-03 03:00'),
  ('74000000-0000-0000-0000-000000000005','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'deleted child','deleted','2026-09-03 04:00','2026-09-03 04:00','2026-09-03 04:00'),
  ('74000000-0000-0000-0000-000000000006','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000002',null,'only hidden','hidden',null,'2026-09-05 01:00','2026-09-05 01:00'),
  ('74000000-0000-0000-0000-000000000007','72000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000002',null,'only deleted','deleted','2026-09-05 02:00','2026-09-05 02:00','2026-09-05 02:00'),
  ('74000000-0000-0000-0000-000000000008','72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002',null,'published parent comment','published',null,'2026-09-01 01:00','2026-09-01 01:00'),
  ('74000000-0000-0000-0000-000000000009','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'hidden root','hidden',null,'2026-09-03 05:00','2026-09-03 05:00'),
  ('74000000-0000-0000-0000-000000000010','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000009','orphan hidden reply','published',null,'2026-09-03 05:01','2026-09-03 05:01'),
  ('74000000-0000-0000-0000-000000000011','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002',null,'deleted root','deleted','2026-09-03 06:00','2026-09-03 06:00','2026-09-03 06:00'),
  ('74000000-0000-0000-0000-000000000012','72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000011','orphan deleted reply','published',null,'2026-09-03 06:01','2026-09-03 06:01'),
  ('74000000-0000-0000-0000-000000000013','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001',null,'boundary root one','published',null,'2026-09-06 01:00','2026-09-06 01:00'),
  ('74000000-0000-0000-0000-000000000014','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000013','boundary reply one','published',null,'2026-09-06 01:01','2026-09-06 01:01'),
  ('74000000-0000-0000-0000-000000000015','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001',null,'boundary root two','published',null,'2026-09-06 02:00','2026-09-06 02:00'),
  ('74000000-0000-0000-0000-000000000016','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001',null,'boundary root three','published',null,'2026-09-06 03:00','2026-09-06 03:00'),
  ('74000000-0000-0000-0000-000000000017','72000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001',null,'boundary root four','published',null,'2026-09-06 04:00','2026-09-06 04:00');

select has_function('public','get_public_post_v2',array['uuid'],'v2 scalar post RPC exists');
select has_function('public','list_public_post_comments',array['uuid','integer','timestamp with time zone','uuid','boolean','timestamp with time zone','uuid'],'bounded comment RPC identity exists');
select is(pg_catalog.pg_get_function_result('public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)'::regprocedure),'jsonb','comment RPC returns one scalar page envelope');
select ok(not has_function_privilege('public','public.get_public_post_v2(uuid)','EXECUTE'),'PUBLIC cannot execute v2 post RPC');
select ok(not has_function_privilege('service_role','public.get_public_post_v2(uuid)','EXECUTE'),'service role cannot execute v2 post RPC');
select ok(has_function_privilege('anon','public.get_public_post_v2(uuid)','EXECUTE'),'anon can execute v2 post RPC');
select ok(has_function_privilege('authenticated','public.get_public_post_v2(uuid)','EXECUTE'),'authenticated can execute v2 post RPC');
select ok(not has_function_privilege('public','public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE'),'PUBLIC cannot execute comment RPC');
select ok(not has_function_privilege('service_role','public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE'),'service role cannot execute comment RPC');
select ok(has_function_privilege('anon','public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE'),'anon can execute comment RPC');
select ok(has_function_privilege('authenticated','public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE'),'authenticated can execute comment RPC');
select ok((select prosecdef and proconfig=array['search_path=""'] and pg_get_userbyid(proowner)='postgres' and provolatile='s' from pg_proc where oid='public.get_public_post_v2(uuid)'::regprocedure),'v2 post RPC is stable fixed-owner SECURITY DEFINER with empty search path');
select ok((select prosecdef and proconfig=array['search_path=""'] and pg_get_userbyid(proowner)='postgres' and provolatile='s' from pg_proc where oid='public.list_public_post_comments(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)'::regprocedure),'comment RPC is stable fixed-owner SECURITY DEFINER with empty search path');

set local role anon;
select is(public.get_public_post_v2('72999999-0000-0000-0000-000000000099'),'{"kind":"not_found"}'::jsonb,'missing post is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000002'),'{"kind":"hidden"}'::jsonb,'hidden post is an exact existence-only state');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000004'),'{"kind":"not_found"}'::jsonb,'deleted post without public comments is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000005'),'{"kind":"not_found"}'::jsonb,'deleted post with only hidden/deleted comments is not found');
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":3}'::jsonb,'deleted count excludes replies whose hidden or deleted root is not visible');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->>'kind'),'published','published post returns published state');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->'post'->>'body_markdown'),'published body','published body is returned through the sanitizer');
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->'post'->>'attachment_count'),'1','published post counts attached rows and excludes pending rows');

select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000002'),'{"items":[],"has_more":false,"next_cursor":null}'::jsonb,'hidden parent comments are inaccessible with an exact empty envelope');
select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000004'),'{"items":[],"has_more":false,"next_cursor":null}'::jsonb,'invalid deleted tombstone comments are inaccessible');
select is(pg_catalog.jsonb_array_length(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')->'items'),3,'default comment page returns all three visible fixture comments');
select is((select pg_catalog.jsonb_agg(item->>'body_markdown') from pg_catalog.jsonb_array_elements(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')->'items') item),'["top one","reply one","top two"]'::jsonb,'visibility and deterministic root-before-reply order match');
select is((select pg_catalog.jsonb_object_agg(key,true order by key) from pg_catalog.jsonb_object_keys(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')->'items'->0) key),'{"id":true,"parent_id":true,"body_markdown":true,"created_at":true,"updated_at":true,"author_id":true,"author_login":true,"author_display_name":true,"author_avatar_url":true}'::jsonb,'comment items expose only safe fields');
select is((select pg_catalog.jsonb_object_agg(key,true order by key) from pg_catalog.jsonb_object_keys(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')) key),'{"has_more":true,"items":true,"next_cursor":true}'::jsonb,'page envelope has exact keys');
select is(pg_catalog.jsonb_array_length(public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2)->'items'),2,'page removes the lookahead row');
select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2)->>'has_more','true','page exposes lookahead state');
select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2)->'next_cursor'->>'root_id','74000000-0000-0000-0000-000000000001','next cursor identifies the last delivered root');
select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2)->'next_cursor'->>'is_reply','true','next cursor preserves reply ordering dimension');
select is((select pg_catalog.jsonb_agg(item->>'body_markdown') from pg_catalog.jsonb_array_elements(public.list_public_post_comments(
  '72000000-0000-0000-0000-000000000003',2,
  '2026-09-03 01:00+00','74000000-0000-0000-0000-000000000001',true,
  '2026-09-03 01:01+00','74000000-0000-0000-0000-000000000002'
)->'items') item),'["top two"]'::jsonb,'complete keyset cursor continues without duplicates');
select is(public.list_public_post_comments(
  '72000000-0000-0000-0000-000000000003',2,
  '2026-09-03 01:00+00','74000000-0000-0000-0000-000000000001',true,
  '2026-09-03 01:01+00','74000000-0000-0000-0000-000000000002'
)->'next_cursor','null'::jsonb,'final page exposes no continuation cursor');
select is((select pg_catalog.jsonb_agg(item->>'body_markdown') from pg_catalog.jsonb_array_elements(public.list_public_post_comments(
  '72000000-0000-0000-0000-000000000006',2,
  '2026-09-06 01:00+00','74000000-0000-0000-0000-000000000013',true,
  '2026-09-06 01:01+00','74000000-0000-0000-0000-000000000014'
)->'items') item),'["boundary root two","boundary root three"]'::jsonb,'continuation page skips its exhausted cursor root');
select is(public.list_public_post_comments(
  '72000000-0000-0000-0000-000000000006',2,
  '2026-09-06 01:00+00','74000000-0000-0000-0000-000000000013',true,
  '2026-09-06 01:01+00','74000000-0000-0000-0000-000000000014'
)->'has_more','true'::jsonb,'continuation retains lookahead after an exhausted cursor root');
reset role;
insert into public.comments(id,post_id,author_id,parent_id,body_markdown,status,deleted_at,created_at,updated_at)
select
  ('74100000-0000-0000-0000-'||pg_catalog.lpad(g::text,12,'0'))::uuid,
  '72000000-0000-0000-0000-000000000001'::uuid,
  '71000000-0000-0000-0000-000000000002'::uuid,
  '74000000-0000-0000-0000-000000000008'::uuid,
  'deep reply '||g,'published',null,
  '2026-09-01 01:00+00'::timestamptz+g*interval '1 second',
  '2026-09-01 01:00+00'::timestamptz+g*interval '1 second'
from pg_catalog.generate_series(1,120) g;
set local role anon;
select is(pg_catalog.jsonb_array_length(public.list_public_post_comments(
  '72000000-0000-0000-0000-000000000001',100,
  '2026-09-01 01:00+00','74000000-0000-0000-0000-000000000008',true,
  '2026-09-01 01:01:40+00','74100000-0000-0000-0000-000000000100'
)->'items'),20,'continuation applies before the bounded reply lookahead');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',null)$$,'22023','invalid page limit','null limit is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',0)$$,'22023','invalid page limit','zero limit is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',101)$$,'22023','invalid page limit','limit above 100 is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2,'2026-09-03 01:00+00')$$,'22023','invalid cursor','partial cursor is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2,'infinity','74000000-0000-0000-0000-000000000001',false,'2026-09-03 01:00+00','74000000-0000-0000-0000-000000000001')$$,'22023','invalid cursor','non-finite cursor timestamp is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2,'2026-09-03 01:00+00','74000000-0000-0000-0000-000000000001',false,'2026-09-03 01:01+00','74000000-0000-0000-0000-000000000002')$$,'22023','invalid cursor','structurally invalid root cursor is rejected');
select throws_ok($$select public.list_public_post_comments('72000000-0000-0000-0000-000000000003',2,'2026-09-03 01:00+00','74000000-0000-0000-0000-000000000001',true,'2026-09-03 01:01+00','74000000-0000-0000-0000-000000000001')$$,'22023','invalid cursor','structurally invalid reply cursor is rejected');
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
select is((public.get_public_post_v2('72000000-0000-0000-0000-000000000001')->'post'->>'body_markdown'),'instrumented:published body','published state delegates to the existing sanitized read');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='71000000-0000-0000-0000-000000000001';
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":3}'::jsonb,'authenticated receives the same tombstone');
select is(pg_catalog.jsonb_array_length(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')->'items'),3,'authenticated can read tombstone comments');
select throws_ok($$select public.create_comment('72000000-0000-0000-0000-000000000003',null,'new comment','tomb-create')$$,'22023','post not found, visible, or unlocked','deleted post rejects new comments');
select throws_ok($$select public.create_comment('72000000-0000-0000-0000-000000000003','74000000-0000-0000-0000-000000000001','new reply','tomb-reply')$$,'22023','post not found, visible, or unlocked','deleted post rejects new replies');
select throws_ok($$select public.set_post_reaction('72000000-0000-0000-0000-000000000003',true)$$,'22023','post not found or visible','deleted post rejects reactions');
select throws_ok($$select public.set_comment_reaction('74000000-0000-0000-0000-000000000001',true)$$,'22023','comment not found or visible','deleted post comment rejects reactions');
reset role;

update public.comments set status='hidden' where id='74000000-0000-0000-0000-000000000001';
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":1}'::jsonb,'hiding a root removes its still-published reply from the tombstone count');
select is((select pg_catalog.jsonb_agg(item->>'body_markdown') from pg_catalog.jsonb_array_elements(public.list_public_post_comments('72000000-0000-0000-0000-000000000003')->'items') item),'["top two"]'::jsonb,'hiding a root removes its still-published reply from comment reads');
update public.comments set status='hidden' where id='74000000-0000-0000-0000-000000000003';
select is(public.get_public_post_v2('72000000-0000-0000-0000-000000000003'),'{"kind":"not_found"}'::jsonb,'hiding the final visible root removes the tombstone despite orphan replies');
select is(public.list_public_post_comments('72000000-0000-0000-0000-000000000003'),'{"items":[],"has_more":false,"next_cursor":null}'::jsonb,'comment read disappears with final visible root');
select ok((select polqual is not null from pg_policy where polrelid='public.comments'::regclass and polname='comments_public_read'),'base comment RLS remains in place');
select is((select count(*)::integer from pg_policy where polrelid='public.comments'::regclass),1,'no broader base comment policy was added');

select * from finish();
rollback;
