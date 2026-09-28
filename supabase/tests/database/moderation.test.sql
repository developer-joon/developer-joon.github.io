begin;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('c1000000-0000-0000-0000-000000000001','authenticated','authenticated','mod-member@example.test'),
 ('c1000000-0000-0000-0000-000000000002','authenticated','authenticated','mod-admin@example.test'),
 ('c1000000-0000-0000-0000-000000000003','authenticated','authenticated','mod-forged@example.test');
insert into public.profiles(id,github_user_id,login,display_name,avatar_url) values
 ('c1000000-0000-0000-0000-000000000001',99101,'mod-member','Mod Member','https://example.test/member.png'),
 ('c1000000-0000-0000-0000-000000000002',99102,'mod-admin','Mod Admin',null),
 ('c1000000-0000-0000-0000-000000000003',99103,'mod-forged','Forged Admin',null);
insert into public.user_roles(user_id,role) values
 ('c1000000-0000-0000-0000-000000000001','member'),
 ('c1000000-0000-0000-0000-000000000002','admin'),
 ('c1000000-0000-0000-0000-000000000003','member');
insert into public.posts(id,author_id,title,body_markdown,status,is_locked,is_pinned,created_at,updated_at,deleted_at) values
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Queue title',repeat('private body ',30),'published',false,true,'2026-09-20','2026-09-20',null),
 ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','Hidden title','hidden secret','hidden',false,false,'2026-09-21','2026-09-21',null),
 ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','Terminal title','deleted body','deleted',false,false,'2026-09-22','2026-09-22','2026-09-22'),
 ('c2000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001','Locked title','locked body','published',true,false,'2026-09-23','2026-09-23',null);
insert into public.comments(id,post_id,author_id,body_markdown,status,created_at,updated_at,deleted_at) values
 ('c4000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','comment excerpt secret','published','2026-09-20 01:00','2026-09-20 01:00',null),
 ('c4000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','terminal comment','deleted','2026-09-20 02:00','2026-09-20 02:00','2026-09-20 02:00'),
 ('c4000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','hard delete target','published','2026-09-20 03:00','2026-09-20 03:00',null),
 ('c4000000-0000-0000-0000-000000000004','c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','null cas target','published','2026-09-20 04:00','2026-09-20 04:00',null);
insert into public.tags(id,slug,label,is_active,sort_order) values
 ('c3000000-0000-0000-0000-000000000001','mod-active','Moderation Active',true,991),
 ('c3000000-0000-0000-0000-000000000002','mod-last','Moderation Last',true,992);
insert into public.reports(id,reporter_id,target_type,target_id,reason_code,status,created_at) values
 ('c5000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','post','c2000000-0000-0000-0000-000000000004','spam','open','2026-09-24'),
 ('c5000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','post','c2000000-0000-0000-0000-000000000002','spam','open','2026-09-25');

-- Exact RPC surface, fixed owner, empty search_path, and browser/service ACLs.
select has_function('public','create_report_v2',array['text','uuid','text','text','text'],'create_report_v2 exists');
select has_function('public','list_moderation_reports_v1',array['text','integer','timestamp with time zone','uuid'],'report queue exists');
select has_function('public','set_report_status_v1',array['uuid','text','text','text','text'],'set report status exists');
select has_function('public','moderate_post_v1',array['uuid','text','boolean','boolean','text','text','text'],'post moderation exists');
select has_function('public','moderate_comment_v1',array['uuid','text','text','text','text'],'comment moderation exists');
select has_function('public','list_moderation_audit_logs_v1',array['integer','timestamp with time zone','uuid','text','uuid'],'audit list exists');
select has_function('public','set_tag_active_v1',array['uuid','boolean','boolean','text','text'],'tag moderation exists');
select ok((select bool_and(p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array[
 'public.create_report_v2(text,uuid,text,text,text)'::regprocedure,
 'public.list_moderation_reports_v1(text,integer,timestamptz,uuid)'::regprocedure,
 'public.set_report_status_v1(uuid,text,text,text,text)'::regprocedure,
 'public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text)'::regprocedure,
 'public.moderate_comment_v1(uuid,text,text,text,text)'::regprocedure,
 'public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid)'::regprocedure,
 'public.set_tag_active_v1(uuid,boolean,boolean,text,text)'::regprocedure
])),'moderation RPCs are fixed-owner SECURITY DEFINER with empty search_path');
select ok((select bool_and(not has_function_privilege('public',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) from pg_proc p where p.oid=any(array[
 'public.create_report_v2(text,uuid,text,text,text)'::regprocedure,
 'public.list_moderation_reports_v1(text,integer,timestamptz,uuid)'::regprocedure,
 'public.set_report_status_v1(uuid,text,text,text,text)'::regprocedure,
 'public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text)'::regprocedure,
 'public.moderate_comment_v1(uuid,text,text,text,text)'::regprocedure,
 'public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid)'::regprocedure,
 'public.set_tag_active_v1(uuid,boolean,boolean,text,text)'::regprocedure
])),'moderation RPC execution is authenticated-only');
select ok(not has_function_privilege('authenticated','public.create_report(text,uuid,text,text,text)','EXECUTE'),'legacy create_report is revoked');
select is((select pg_get_indexdef(to_regclass('public.reports_queue_idx'))),'CREATE INDEX reports_queue_idx ON public.reports USING btree (created_at DESC, id DESC) WHERE (status = ANY (ARRAY[''open''::text, ''reviewing''::text]))','active report queue index has exact cursor order and predicate');
select is((select pg_get_indexdef(to_regclass('public.reports_created_id_idx'))),'CREATE INDEX reports_created_id_idx ON public.reports USING btree (created_at DESC, id DESC)','all-status report queue index has exact cursor order');
select is((select pg_get_indexdef(to_regclass('public.reports_status_created_id_idx'))),'CREATE INDEX reports_status_created_id_idx ON public.reports USING btree (status, created_at DESC, id DESC)','status report queue index has exact filter and cursor order');
select is((select pg_get_indexdef(to_regclass('public.moderation_audit_logs_target_created_id_idx'))),'CREATE INDEX moderation_audit_logs_target_created_id_idx ON public.moderation_audit_logs USING btree (target_type, target_id, created_at DESC, id DESC)','audit target index has complete filter and cursor order');
select is((select count(*)::integer from pg_indexes where schemaname='public' and indexname in ('reports_moderation_queue_idx','moderation_audit_logs_target_idx','moderation_audit_logs_created_idx')),0,'obsolete overlapping moderation indexes are removed');

set local role anon;
select throws_like($$select public.create_report_v2('post','c2000000-0000-0000-0000-000000000001','spam',null,'anon-key')$$,'%permission denied%','anon cannot create reports');
reset role;

-- Member reporting: canonical values, target visibility, rate/idempotency, and one audit.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000001';
create temporary table moderation_results(name text primary key,id uuid,payload jsonb);
insert into moderation_results(name,id) select 'post-report',public.create_report_v2('post','c2000000-0000-0000-0000-000000000001','  SPAM  ','  details  ',' report-key ');
select is(public.create_report_v2('post','c2000000-0000-0000-0000-000000000001','spam','details','report-key'),(select id from moderation_results where name='post-report'),'report replay returns the same id');
select throws_ok($$select public.create_report_v2('post','c2000000-0000-0000-0000-000000000001','harassment','details','report-key')$$,'22023','idempotency key reused with different request','changed report replay is rejected');
select throws_ok($$select public.create_report_v2('post','c2000000-0000-0000-0000-000000000002','spam',null,'hidden-target')$$,'22023','report target not found or visible','hidden report target is rejected');
select throws_ok($$select public.create_report_v2('post','c2000000-0000-0000-0000-000000000004','unknown',null,'bad-reason')$$,'22023','invalid report reason','unknown report reason is rejected');
select throws_ok($$select public.create_report_v2('post','c2000000-0000-0000-0000-000000000004','other','   ','missing-detail')$$,'22023','report detail required for other','other requires canonical nonblank detail');
insert into moderation_results(name,id) select 'comment-report',public.create_report_v2('comment','c4000000-0000-0000-0000-000000000001','harmful',null,'comment-report-key');
insert into moderation_results(name,id) select 'dangling-report',public.create_report_v2('comment','c4000000-0000-0000-0000-000000000003','spam',null,'dangling-report-key');
reset role;
select is((select reason_code from public.reports where id=(select id from moderation_results where name='post-report')),'spam','report reason is canonicalized');
select is((select detail from public.reports where id=(select id from moderation_results where name='post-report')),'details','report detail is canonicalized');
select is((select count(*)::integer from public.moderation_audit_logs where action='report.created' and target_id=(select id from moderation_results where name='post-report')),1,'report creation emits exactly one audit across replay');
select is((select count(*)::integer from public.rate_limit_events where action='report.create' and user_id='c1000000-0000-0000-0000-000000000001'),3,'only distinct successful reports consume rate slots');

-- Forged JWT metadata is not authorization; actual admin role is.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000003","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.list_moderation_reports_v1()$$,'42501','admin required','forged admin metadata cannot list reports');
select throws_ok($$select public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',false,true,'hide','forged','forged-key')$$,'42501','admin required','forged admin metadata cannot moderate');
select set_config('request.jwt.claims','',true);
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';

-- Queue projection, privacy, status filters, keyset validation, and lookahead.
insert into moderation_results(name,payload) select 'queue',public.list_moderation_reports_v1('active',1);
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload) key where name='queue'),'{"has_more":true,"items":true,"next_cursor":true}'::jsonb,'queue wrapper has exact keys');
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload->'items'->0) key where name='queue'),'{"created_at":true,"detail":true,"id":true,"reason_code":true,"reporter":true,"resolved_at":true,"resolved_by":true,"status":true,"target":true}'::jsonb,'queue report has exact minimal keys');
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload->'items'->0->'reporter') key where name='queue'),'{"avatar_url":true,"display_name":true,"id":true,"login":true}'::jsonb,'reporter summary has exact keys');
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload->'items'->0->'target') key where name='queue'),'{"available":true,"excerpt":true,"id":true,"is_locked":true,"is_pinned":true,"post_id":true,"status":true,"title":true,"type":true}'::jsonb,'available target summary has exact keys');
select is((select payload->'items'->0->'target'->>'available' from moderation_results where name='queue'),'true','existing report target is marked available');
select ok((select char_length(payload->'items'->0->'target'->>'excerpt')<=240 and payload::text not like '%private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body private body%' from moderation_results where name='queue'),'queue bounds excerpts and never returns a full long body');
select is(public.list_moderation_reports_v1('resolved')->'items','[]'::jsonb,'resolved filter excludes active reports');
select throws_ok($$select public.list_moderation_reports_v1('bad')$$,'22023','invalid report status filter','invalid queue status is rejected');
select throws_ok($$select public.list_moderation_reports_v1('all',0)$$,'22023','invalid page limit','queue limit is bounded');
select throws_ok($$select public.list_moderation_reports_v1('all',10,'2026-09-20')$$,'22023','invalid cursor','partial queue cursor is rejected');
select throws_ok($$select public.list_moderation_reports_v1('all',10,'infinity','c5000000-0000-0000-0000-000000000001')$$,'22023','invalid cursor','nonfinite queue cursor is rejected');

-- Report state machine, CAS, replay, terminal immutability, and audit cardinality.
insert into moderation_results(name,payload) select 'report-reviewing',public.set_report_status_v1((select id from moderation_results where name='post-report'),'open','reviewing','  investigate  ',' status-key ');
select is((select payload->>'status' from moderation_results where name='report-reviewing'),'reviewing','open transitions to reviewing');
select is(public.set_report_status_v1((select id from moderation_results where name='post-report'),'open','reviewing','investigate','status-key')->>'status','reviewing','report status replay ignores stale expected state');
select throws_ok($$select public.set_report_status_v1((select id from moderation_results where name='post-report'),'reviewing','resolved','changed','status-key')$$,'22023','idempotency key reused with different request','changed report status replay is rejected');
select throws_ok($$select public.set_report_status_v1((select id from moderation_results where name='post-report'),'open','resolved','wrong cas','wrong-cas-key')$$,'40001','report state changed','report CAS mismatch fails');
select throws_ok($$select public.set_report_status_v1('c5000000-0000-0000-0000-000000000001',null,'resolved','null cas','report-null-cas')$$,'40001','report state changed','null report expected status is rejected as stale CAS');
reset role;
select is((select count(*)::integer from public.moderation_audit_logs where action='report.status_changed' and target_id=(select id from moderation_results where name='post-report')),1,'only real successful report transition is audited');
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
select is(public.set_report_status_v1((select id from moderation_results where name='post-report'),'reviewing','resolved','confirmed','resolve-key')->>'status','resolved','reviewing transitions to resolved');
select throws_ok($$select public.set_report_status_v1((select id from moderation_results where name='post-report'),'resolved','dismissed','terminal','terminal-key')$$,'22023','report status transition not allowed','terminal report is immutable');
reset role;
select ok((select resolved_at is not null and resolved_by='c1000000-0000-0000-0000-000000000002' from public.reports where id=(select id from moderation_results where name='post-report')),'terminal report resolution fields are consistent');

-- Privileged report writes may set resolution fields only on the exact active-to-terminal transition.
select lives_ok($$update public.reports set status='reviewing' where id='c5000000-0000-0000-0000-000000000002'$$,'privileged direct update can move an open report to reviewing with null resolution fields');
select ok((select resolved_at is null and resolved_by is null from public.reports where id='c5000000-0000-0000-0000-000000000002'),'reviewing report keeps both resolution fields null');
select throws_ok($$update public.reports set resolved_at=clock_timestamp(),resolved_by='c1000000-0000-0000-0000-000000000002' where id='c5000000-0000-0000-0000-000000000002'$$,'23514','report resolution fields may change only on terminal transition','reviewing report cannot gain resolution fields');
select lives_ok($$update public.reports set status='dismissed',resolved_at=clock_timestamp(),resolved_by='c1000000-0000-0000-0000-000000000002' where id='c5000000-0000-0000-0000-000000000002'$$,'privileged direct terminal transition sets resolver and timestamp together');
select throws_ok($$update public.reports set resolved_at=resolved_at+interval '1 second' where id='c5000000-0000-0000-0000-000000000002'$$,'23514','report resolution fields may change only on terminal transition','terminal report timestamp cannot be rewritten');
select throws_ok($$update public.reports set resolved_by='c1000000-0000-0000-0000-000000000001' where id='c5000000-0000-0000-0000-000000000002'$$,'23514','report resolution fields may change only on terminal transition','terminal report resolver cannot be rewritten');

-- Post moderation CAS/actions; lock does not block owner edit/delete, hide/delete unpin.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
select throws_ok($$select public.moderate_post_v1('c2000000-0000-0000-0000-000000000004','published',true,false,'lock','already locked','post-noop-key')$$,'22023','post moderation action has no effect','fresh post no-op is rejected before idempotency');
select is(public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',false,true,'lock','  safety  ','post-lock-key')->>'is_locked','true','admin locks a post');
select is(public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',false,true,'lock','safety','post-lock-key')->>'is_locked','true','post moderation replay returns authoritative state');
select throws_ok($$select public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',true,true,'unlock','changed','post-lock-key')$$,'22023','idempotency key reused with different request','changed post replay is rejected');
select throws_ok($$select public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',false,true,'hide','cas','post-cas-key')$$,'40001','post state changed','post expected-state mismatch fails');
select is(public.moderate_post_v1('c2000000-0000-0000-0000-000000000001','published',true,true,'hide','policy','post-hide-key')-'updated_at',jsonb_build_object('id','c2000000-0000-0000-0000-000000000001'::uuid,'status','hidden','is_locked',true,'is_pinned',false,'deleted_at',null),'post hide returns authoritative minimal state and unpins');
select throws_ok($$select public.moderate_post_v1('c2000000-0000-0000-0000-000000000003','deleted',false,false,'restore','terminal','post-terminal')$$,'22023','post moderation transition not allowed','deleted post is terminal');
reset role;
select is((select count(*)::integer from public.idempotency_keys where operation='post.moderate.v1' and key='post-noop-key'),0,'rejected post no-op stores no idempotency row');
select is((select count(*)::integer from public.moderation_audit_logs where action='post.lock' and target_id='c2000000-0000-0000-0000-000000000004'),0,'rejected post no-op stores no audit row');
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_like($$update public.posts set status='published',deleted_at=null where id='c2000000-0000-0000-0000-000000000003'$$,'%permission denied%','browser direct retention restore remains denied');
select lives_ok($$select public.update_post('c2000000-0000-0000-0000-000000000004','Locked owner edit','still allowed',array['c3000000-0000-0000-0000-000000000001']::uuid[])$$,'locked post preserves owner edit semantics');
select lives_ok($$select public.soft_delete_post('c2000000-0000-0000-0000-000000000004')$$,'locked post preserves owner delete semantics');
reset role;
select throws_ok($$update public.posts set status='hidden' where id='c2000000-0000-0000-0000-000000000003'$$,'23514',null,'deleted-to-hidden restore requires deleted_at to be cleared');
select throws_ok($$update public.posts set deleted_at=null where id='c2000000-0000-0000-0000-000000000003'$$,'23514',null,'deleted content cannot clear deleted_at without leaving deleted');
select throws_ok($$update public.posts set status='deleted' where id='c2000000-0000-0000-0000-000000000002'$$,'23514',null,'entering deleted requires a non-null deleted_at');
select lives_ok($$update public.posts set status='published',deleted_at=null where id='c2000000-0000-0000-0000-000000000003'$$,'privileged retention workflow can restore a deleted post');
select is((select status from public.posts where id='c2000000-0000-0000-0000-000000000003'),'published','privileged post restore reaches published state');

-- Comment moderation takes post then comment locks and enforces transitions/CAS.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
select is(public.moderate_comment_v1('c4000000-0000-0000-0000-000000000001','published','hide','comment policy','comment-hide-key')->>'status','hidden','admin hides a comment');
select is(public.moderate_comment_v1('c4000000-0000-0000-0000-000000000001','published','hide','comment policy','comment-hide-key')->>'status','hidden','comment moderation replays safely');
select throws_ok($$select public.moderate_comment_v1('c4000000-0000-0000-0000-000000000001','published','restore','cas','comment-cas')$$,'40001','comment state changed','comment CAS mismatch fails');
select throws_ok($$select public.moderate_comment_v1('c4000000-0000-0000-0000-000000000004',null,'delete','null cas','comment-null-cas')$$,'40001','comment state changed','null comment expected status is rejected as stale CAS');
select is(public.moderate_comment_v1('c4000000-0000-0000-0000-000000000001','hidden','restore','appeal','comment-restore-key')->>'status','published','hidden comment restores to published');
select throws_ok($$select public.moderate_comment_v1('c4000000-0000-0000-0000-000000000002','deleted','restore','terminal','comment-terminal')$$,'22023','comment moderation transition not allowed','deleted comment is terminal');
reset role;
select lives_ok($$update public.comments set status='hidden',deleted_at=null where id='c4000000-0000-0000-0000-000000000002'$$,'privileged retention workflow can recover deleted content into operator-selected hidden state');
select is((select status from public.comments where id='c4000000-0000-0000-0000-000000000002'),'hidden','privileged deleted recovery can choose hidden rather than automatic origin restoration');

-- Hard-deleted polymorphic targets remain identifiable and report moderation remains available.
delete from public.comment_reactions where comment_id='c4000000-0000-0000-0000-000000000003';
delete from public.comments where parent_id='c4000000-0000-0000-0000-000000000003';
delete from public.comments where id='c4000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
select is((select item->'target' from jsonb_array_elements(public.list_moderation_reports_v1('all',100)->'items') item where item->>'id'=(select id::text from moderation_results where name='dangling-report')),jsonb_build_object('type','comment','id','c4000000-0000-0000-0000-000000000003'::uuid,'available',false),'hard-deleted target preserves exact discriminant and target id only');
select is(public.set_report_status_v1((select id from moderation_results where name='dangling-report'),'open','resolved','target retained','dangling-status')->'target',jsonb_build_object('type','comment','id','c4000000-0000-0000-0000-000000000003'::uuid,'available',false),'dangling report can transition while preserving unavailable target identity');
reset role;
select is((select count(*)::integer from public.moderation_audit_logs where action='report.status_changed' and target_id=(select id from moderation_results where name='dangling-report')),1,'dangling report transition preserves one audit record');

-- Tag CAS/idempotency allows all tags inactive by policy and audits once.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
select throws_ok($$select public.set_tag_active_v1('c3000000-0000-0000-0000-000000000002',true,true,'already active','tag-noop-key')$$,'22023','tag active state has no effect','fresh tag no-op is rejected before idempotency');
select is(public.set_tag_active_v1('c3000000-0000-0000-0000-000000000001',true,false,'retire','tag-key')->>'is_active','false','admin deactivates a tag');
select is(public.set_tag_active_v1('c3000000-0000-0000-0000-000000000001',true,false,'retire','tag-key')->>'is_active','false','tag mutation replays safely');
select throws_ok($$select public.set_tag_active_v1('c3000000-0000-0000-0000-000000000001',false,true,'changed','tag-key')$$,'22023','idempotency key reused with different request','changed tag replay is rejected');
select throws_ok($$select public.set_tag_active_v1('c3000000-0000-0000-0000-000000000002',false,true,'cas','tag-cas')$$,'40001','tag state changed','tag CAS mismatch fails');
select is(public.set_tag_active_v1('c3000000-0000-0000-0000-000000000002',true,false,'allow zero active','tag-last')->>'is_active','false','policy permits all tags to become inactive');
reset role;
select is((select count(*)::integer from public.idempotency_keys where operation='tag.active.v1' and key='tag-noop-key'),0,'rejected tag no-op stores no idempotency row');
select is((select count(*)::integer from public.moderation_audit_logs where action='tag.active_changed' and target_id='c3000000-0000-0000-0000-000000000002'),1,'tag no-op adds no audit beyond the later real mutation');
select is((select count(*)::integer from public.moderation_audit_logs where action='tag.active_changed' and target_id='c3000000-0000-0000-0000-000000000001'),1,'tag replay creates exactly one audit');

-- Audit list has bounded exact projection and target filters.
set local role authenticated;
set local request.jwt.claim.sub='c1000000-0000-0000-0000-000000000002';
insert into moderation_results(name,payload) select 'audit-list',public.list_moderation_audit_logs_v1(2);
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload) key where name='audit-list'),'{"has_more":true,"items":true,"next_cursor":true}'::jsonb,'audit wrapper has exact keys');
select is((select jsonb_object_agg(key,true order by key) from moderation_results,jsonb_object_keys(payload->'items'->0) key where name='audit-list'),'{"action":true,"actor":true,"created_at":true,"id":true,"metadata":true,"reason":true,"target_id":true,"target_type":true}'::jsonb,'audit item has exact minimal keys');
select ok((select payload::text not like '%private body%' and payload::text not like '%secret%' from moderation_results where name='audit-list'),'audit list exposes no content bodies');
select is(jsonb_array_length(public.list_moderation_audit_logs_v1(100,null,null,'tag','c3000000-0000-0000-0000-000000000001')->'items'),1,'audit target pair filters exactly');
select throws_ok($$select public.list_moderation_audit_logs_v1(0)$$,'22023','invalid page limit','audit limit is bounded');
select throws_ok($$select public.list_moderation_audit_logs_v1(10,'2026-09-20')$$,'22023','invalid cursor','partial audit cursor is rejected');
select throws_ok($$select public.list_moderation_audit_logs_v1(10,null,null,'post',null)$$,'22023','invalid target filter','partial audit target filter is rejected');
select throws_ok($$select public.list_moderation_audit_logs_v1(10,'-infinity','c5000000-0000-0000-0000-000000000001')$$,'22023','invalid cursor','nonfinite audit cursor is rejected');
reset role;

-- Database invariants: immutable report identity/content and append-only audit evidence.
select throws_ok($$update public.reports set reason_code='other' where id=(select id from moderation_results where name='comment-report')$$,'23514','report immutable fields cannot change','report reason is immutable even to privileged direct writes');
select throws_ok($$update public.moderation_audit_logs set reason='tampered' where target_id=(select id from moderation_results where name='post-report')$$,'23514','moderation audit logs are append-only','audit UPDATE is rejected');
select throws_ok($$delete from public.moderation_audit_logs where target_id=(select id from moderation_results where name='post-report')$$,'23514','moderation audit logs are append-only','audit DELETE is rejected');
select throws_ok($$truncate public.moderation_audit_logs$$,'23514','moderation audit logs are append-only','audit TRUNCATE is rejected');
select ok((select prosrc ~ 'from public.posts.+for update' and prosrc ~ 'from public.comments.+for update' from pg_proc where oid='public.moderate_comment_v1(uuid,text,text,text,text)'::regprocedure),'comment moderation documents post-before-comment row locking in executable code');

select * from finish();
rollback;
