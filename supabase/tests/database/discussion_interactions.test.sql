begin;

select plan(62);

insert into auth.users(id,aud,role,email) values
 ('81000000-0000-0000-0000-000000000001','authenticated','authenticated','discussion-a@example.test'),
 ('81000000-0000-0000-0000-000000000002','authenticated','authenticated','discussion-b@example.test');
insert into public.profiles(id,github_user_id,login,display_name,avatar_url) values
 ('81000000-0000-0000-0000-000000000001',98101,'discussion-a','Discussion A','https://example.test/a.png'),
 ('81000000-0000-0000-0000-000000000002',98102,'discussion-b','Discussion B',null);
insert into public.posts(id,author_id,title,body_markdown,status,is_locked,created_at,updated_at,deleted_at) values
 ('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','Discussion post','Discussion body','published',false,'2026-09-20','2026-09-20',null),
 ('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','Locked post','Locked body','published',true,'2026-09-21','2026-09-21',null),
 ('82000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001','Deleted discussion','Deleted body','deleted',false,'2026-09-22','2026-09-22','2026-09-22');
insert into public.comments(id,post_id,author_id,parent_id,body_markdown,status,deleted_at,created_at,updated_at) values
 ('84000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001',null,'hidden root secret','hidden',null,'2026-09-20 01:00','2026-09-20 01:00'),
 ('84000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000001','public reply','published',null,'2026-09-20 01:01','2026-09-20 01:01'),
 ('84000000-0000-0000-0000-000000000003','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002',null,'deleted root secret','deleted','2026-09-20 02:00','2026-09-20 02:00','2026-09-20 02:00'),
 ('84000000-0000-0000-0000-000000000004','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000003','hidden reply secret','hidden',null,'2026-09-20 02:01','2026-09-20 02:01'),
 ('84000000-0000-0000-0000-000000000005','82000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001',null,'deleted post slot','hidden',null,'2026-09-22 01:00','2026-09-22 01:00'),
 ('84000000-0000-0000-0000-000000000006','82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001',null,'locked post comment','published',null,'2026-09-21 01:00','2026-09-21 01:00');
insert into public.post_reactions(user_id,post_id) values
 ('81000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000001');
insert into public.comment_reactions(user_id,comment_id) values
 ('81000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000002'),
 ('81000000-0000-0000-0000-000000000002','84000000-0000-0000-0000-000000000002');

select has_function('public','get_public_post_v3',array['uuid'],'v3 post read exists');
select has_function('public','list_public_post_comments_v2',array['uuid','integer','timestamp with time zone','uuid','boolean','timestamp with time zone','uuid'],'v2 comment read exists');
select has_function('public','create_comment_v2',array['uuid','uuid','text','text'],'v2 comment create exists');
select has_function('public','set_post_reaction',array['uuid','boolean'],'desired post reaction exists');
select has_function('public','set_comment_reaction',array['uuid','boolean'],'desired comment reaction exists');
select ok((select bool_and(p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array['public.get_public_post_v3(uuid)'::regprocedure,'public.list_public_post_comments_v2(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)'::regprocedure,'public.create_comment_v2(uuid,uuid,text,text)'::regprocedure,'public.set_post_reaction(uuid,boolean)'::regprocedure,'public.set_comment_reaction(uuid,boolean)'::regprocedure])),'new RPCs are fixed-owner SECURITY DEFINER with empty search path');
select ok((select bool_and(not has_function_privilege('public',oid,'EXECUTE') and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid=any(array['public.get_public_post_v3(uuid)'::regprocedure,'public.list_public_post_comments_v2(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)'::regprocedure,'public.create_comment_v2(uuid,uuid,text,text)'::regprocedure,'public.set_post_reaction(uuid,boolean)'::regprocedure,'public.set_comment_reaction(uuid,boolean)'::regprocedure])),'PUBLIC and service_role cannot execute new RPCs');
select ok(has_function_privilege('anon','public.get_public_post_v3(uuid)','EXECUTE') and has_function_privilege('authenticated','public.get_public_post_v3(uuid)','EXECUTE') and has_function_privilege('anon','public.list_public_post_comments_v2(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE') and has_function_privilege('authenticated','public.list_public_post_comments_v2(uuid,integer,timestamp with time zone,uuid,boolean,timestamp with time zone,uuid)','EXECUTE'),'versioned reads grant anon and authenticated only');
select ok(not has_function_privilege('anon','public.create_comment_v2(uuid,uuid,text,text)','EXECUTE') and has_function_privilege('authenticated','public.create_comment_v2(uuid,uuid,text,text)','EXECUTE') and not has_function_privilege('anon','public.set_post_reaction(uuid,boolean)','EXECUTE') and has_function_privilege('authenticated','public.set_post_reaction(uuid,boolean)','EXECUTE'),'mutations are authenticated only');
select ok(not has_function_privilege('authenticated','public.toggle_post_reaction(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.toggle_comment_reaction(uuid)','EXECUTE'),'lossy toggle RPCs are revoked');
select ok(not has_table_privilege('anon','public.comments','SELECT') and not has_table_privilege('authenticated','public.comments','SELECT'),'browser roles cannot bypass canonical comment projection');
select ok(not has_table_privilege('anon','public.comment_reactions','SELECT') and not has_table_privilege('authenticated','public.comment_reactions','SELECT'),'raw comment reaction identities remain private');

select ok(exists(
  select 1 from pg_catalog.pg_class i
  join pg_catalog.pg_index x on x.indexrelid=i.oid
  where i.relname='comments_post_roots_created_idx'
    and x.indrelid='public.comments'::regclass and x.indisvalid and x.indisready
    and pg_catalog.pg_get_indexdef(i.oid,1,true)='post_id'
    and pg_catalog.pg_get_indexdef(i.oid,2,true)='created_at'
    and pg_catalog.pg_get_indexdef(i.oid,3,true)='id'
    and pg_catalog.pg_get_expr(x.indpred,x.indrelid)='(parent_id IS NULL)'
),'all-state root comments have the complete bounded-list index');
select ok(exists(
  select 1 from pg_catalog.pg_class i
  join pg_catalog.pg_index x on x.indexrelid=i.oid
  where i.relname='comments_post_replies_created_idx'
    and x.indrelid='public.comments'::regclass and x.indisvalid and x.indisready
    and pg_catalog.pg_get_indexdef(i.oid,1,true)='post_id'
    and pg_catalog.pg_get_indexdef(i.oid,2,true)='parent_id'
    and pg_catalog.pg_get_indexdef(i.oid,3,true)='created_at'
    and pg_catalog.pg_get_indexdef(i.oid,4,true)='id'
    and pg_catalog.pg_get_expr(x.indpred,x.indrelid)='(parent_id IS NOT NULL)'
),'all-state replies have the complete bounded-list index');
select ok(not exists(select 1 from pg_catalog.pg_class where relname='comment_reactions_comment_count_idx' and relkind='i'),'redundant reaction-count index is absent');

create function pg_temp.explain_json(p_sql text) returns jsonb language plpgsql as $$
declare v_plan jsonb;
begin
  execute 'explain (format json, costs off) '||p_sql into v_plan;
  return v_plan;
end $$;
set local enable_seqscan=off;
select ok(pg_temp.explain_json($q$
  select id,created_at from public.comments
  where post_id='82000000-0000-0000-0000-000000000001' and parent_id is null
  order by created_at,id limit 51
$q$)::text like '%comments_post_roots_created_idx%','root bounded scan uses the complete root index');
select ok(pg_temp.explain_json($q$
  select id,created_at from public.comments
  where post_id='82000000-0000-0000-0000-000000000001'
    and parent_id='84000000-0000-0000-0000-000000000001'
  order by created_at,id limit 51
$q$)::text like '%comments_post_replies_created_idx%','reply bounded scan uses the complete reply index');
set local enable_seqscan=on;

set local role anon;
select is(public.get_public_post_v3('82999999-0000-0000-0000-000000000099'),'{"kind":"not_found"}'::jsonb,'missing v3 post is exact not_found');
select is(public.get_public_post_v3('82000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":1}'::jsonb,'deleted tombstone counts every discussion slot');
select is(public.get_public_post_v3('82000000-0000-0000-0000-000000000001')->'post'->'viewer_reacted','false'::jsonb,'anon post viewer state is false');
select is(public.get_public_post_v3('82000000-0000-0000-0000-000000000001')->'post'->>'comment_count','4','published count equals all slots');
select is((select jsonb_agg(item->>'kind') from jsonb_array_elements(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items') item),'["hidden","published","deleted","hidden"]'::jsonb,'hidden/deleted roots and replies preserve deterministic slots');
select is((public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->0),jsonb_build_object('id','84000000-0000-0000-0000-000000000001'::uuid,'parent_id',null,'kind','hidden'),'hidden placeholder has exact minimal keys');
select is((public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->2),jsonb_build_object('id','84000000-0000-0000-0000-000000000003'::uuid,'parent_id',null,'kind','deleted'),'deleted placeholder has exact minimal keys');
select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->1) key),'{"author_avatar_url":true,"author_display_name":true,"author_id":true,"author_login":true,"body_markdown":true,"created_at":true,"id":true,"kind":true,"parent_id":true,"reaction_count":true,"updated_at":true,"viewer_reacted":true}'::jsonb,'published comment has exact canonical keys');
select is(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->1->>'reaction_count','2','comment reaction count is authoritative');
select is(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->1->'viewer_reacted','false'::jsonb,'anon comment viewer state is false');
select is(jsonb_array_length(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'),(public.get_public_post_v3('82000000-0000-0000-0000-000000000001')->'post'->>'comment_count')::integer,'post count aligns with listed slots');
select throws_ok($$select public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001',0)$$,'22023','invalid page limit','v2 comment read rejects invalid limit');
select throws_ok($$select public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001',2,'2026-09-20')$$,'22023','invalid cursor','v2 comment read rejects partial cursor');
select throws_like($$select public.set_post_reaction('82000000-0000-0000-0000-000000000001',true)$$,'%permission denied%','anon cannot mutate reactions');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='81000000-0000-0000-0000-000000000001';
select is(public.get_public_post_v3('82000000-0000-0000-0000-000000000001')->'post'->'viewer_reacted','true'::jsonb,'authenticated post viewer state is true');
select is(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001')->'items'->1->'viewer_reacted','true'::jsonb,'authenticated comment viewer state is true');
select is(public.set_post_reaction('82000000-0000-0000-0000-000000000001',true),'{"reacted":true,"reaction_count":1}'::jsonb,'repeating desired post true is idempotent');
select is(public.set_post_reaction('82000000-0000-0000-0000-000000000001',false),'{"reacted":false,"reaction_count":0}'::jsonb,'desired post false removes reaction');
select is(public.set_post_reaction('82000000-0000-0000-0000-000000000001',false),'{"reacted":false,"reaction_count":0}'::jsonb,'repeating desired post false is idempotent');
select is(public.set_comment_reaction('84000000-0000-0000-0000-000000000002',true),'{"reacted":true,"reaction_count":2}'::jsonb,'repeating desired comment true preserves authoritative count');
select is(public.set_comment_reaction('84000000-0000-0000-0000-000000000002',false),'{"reacted":false,"reaction_count":1}'::jsonb,'desired comment false removes only actor identity');
select is(public.set_comment_reaction('84000000-0000-0000-0000-000000000002',false),'{"reacted":false,"reaction_count":1}'::jsonb,'repeating desired comment false is idempotent');
select throws_ok($$select public.set_comment_reaction('84000000-0000-0000-0000-000000000001',true)$$,'22023','comment not found or visible','hidden comment rejects reaction');
select throws_ok($$select public.set_post_reaction('82999999-0000-0000-0000-000000000099',true)$$,'22023','post not found or visible','missing post rejects reaction');
select throws_ok($$select public.set_post_reaction('82000000-0000-0000-0000-000000000001',null)$$,'22023','invalid desired reaction state','null desired state is rejected');
select throws_ok($$select public.set_post_reaction('82000000-0000-0000-0000-000000000002',true)$$,'22023','post not found or visible','locked post rejects post reaction');
select throws_ok($$select public.set_comment_reaction('84000000-0000-0000-0000-000000000006',true)$$,'22023','comment not found or visible','locked post rejects comment reaction');
select throws_ok($$select public.create_comment_v2('82000000-0000-0000-0000-000000000002',null,'locked v2 comment','locked-v2')$$,'22023','post not found, visible, or unlocked','v2 create preserves locked-post rejection');
create temporary table created_comment(payload jsonb);
insert into created_comment select public.create_comment_v2('82000000-0000-0000-0000-000000000001',null,'  created v2 comment  ','create-v2-key');
select is((select jsonb_object_agg(key,true order by key) from created_comment,jsonb_object_keys(payload) key),'{"author_avatar_url":true,"author_display_name":true,"author_id":true,"author_login":true,"body_markdown":true,"created_at":true,"id":true,"kind":true,"parent_id":true,"reaction_count":true,"updated_at":true,"viewer_reacted":true}'::jsonb,'v2 create returns canonical published shape');
select is((select payload->>'body_markdown' from created_comment),'created v2 comment','v2 create stores a trimmed body');
select is((select payload from created_comment),public.create_comment_v2('82000000-0000-0000-0000-000000000001',null,'  created v2 comment  ','create-v2-key'),'v2 create replay remains identical after canonical storage');
create temporary table legacy_comment(id uuid);
insert into legacy_comment select public.create_comment('82000000-0000-0000-0000-000000000001',null,'  legacy canonical body  ','legacy-trim-key');
select is((select id from legacy_comment),public.create_comment('82000000-0000-0000-0000-000000000001',null,'  legacy canonical body  ','legacy-trim-key'),'legacy create replay remains idempotent after canonical storage');
reset role;
select is((select c.body_markdown from public.comments c join legacy_comment l on l.id=c.id),'legacy canonical body','legacy create stores a trimmed body');
set local role authenticated;
set local request.jwt.claim.sub='81000000-0000-0000-0000-000000000001';
select public.update_comment((select id from legacy_comment),'  updated canonical body  ');
reset role;
select is((select c.body_markdown from public.comments c join legacy_comment l on l.id=c.id),'updated canonical body','legacy update stores a trimmed body');
select is((select count(*)::integer from public.comments where id=(select (payload->>'id')::uuid from created_comment)),1,'v2 create replay does not duplicate rows');
insert into public.comments(id,post_id,author_id,body_markdown) values
 ('84000000-0000-0000-0000-000000000090','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','  direct canonical body  '),
 ('84000000-0000-0000-0000-000000000091','82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','  '||repeat('x',5000)||'  ');
select is((select body_markdown from public.comments where id='84000000-0000-0000-0000-000000000090'),'direct canonical body','direct comment writes store a trimmed body');
select is((select char_length(body_markdown) from public.comments where id='84000000-0000-0000-0000-000000000091'),5000,'canonical 5000-character body remains valid and stored canonically');
select throws_like($$insert into public.comments(post_id,author_id,body_markdown) values('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','   ')$$,'%comments_body_length_check%','canonical empty body remains rejected');
delete from public.comments where id in ((select id from legacy_comment),'84000000-0000-0000-0000-000000000090','84000000-0000-0000-0000-000000000091');

select is((select comment_count from private.post_metrics where post_id='82000000-0000-0000-0000-000000000001'),5::bigint,'physical insert increments slot metric');
update public.comments set status='hidden' where id=(select (payload->>'id')::uuid from created_comment);
select is((select comment_count from private.post_metrics where post_id='82000000-0000-0000-0000-000000000001'),5::bigint,'status transition does not change slot metric');
delete from public.comments where id=(select (payload->>'id')::uuid from created_comment);
select is((select comment_count from private.post_metrics where post_id='82000000-0000-0000-0000-000000000001'),4::bigint,'physical delete decrements slot metric');
select is(public.get_public_post_v3('82000000-0000-0000-0000-000000000003'),'{"kind":"deleted","comment_count":1}'::jsonb,'private-only slot keeps deleted tombstone');

set local role anon;
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001',2)->'items') item),'["84000000-0000-0000-0000-000000000001","84000000-0000-0000-0000-000000000002"]'::jsonb,'first v2 page preserves root-reply order');
select is(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001',2)->>'has_more','true','v2 page retains lookahead');
select is((select jsonb_agg(item->>'id') from jsonb_array_elements(public.list_public_post_comments_v2('82000000-0000-0000-0000-000000000001',2,'2026-09-20 01:00+00','84000000-0000-0000-0000-000000000001',true,'2026-09-20 01:01+00','84000000-0000-0000-0000-000000000002')->'items') item),'["84000000-0000-0000-0000-000000000003","84000000-0000-0000-0000-000000000004"]'::jsonb,'v2 cursor continues across tombstone slots without duplicates');
reset role;

select * from finish();
rollback;
