begin;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('d1000000-0000-0000-0000-000000000001','authenticated','authenticated','correction-owner@example.test'),
 ('d1000000-0000-0000-0000-000000000002','authenticated','authenticated','correction-other@example.test'),
 ('d1000000-0000-0000-0000-000000000003','authenticated','authenticated','correction-admin@example.test'),
 ('d1000000-0000-0000-0000-000000000004','authenticated','authenticated','correction-forged@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('d1000000-0000-0000-0000-000000000001',99701,'correction-owner','Correction Owner'),
 ('d1000000-0000-0000-0000-000000000002',99702,'correction-other','Correction Other'),
 ('d1000000-0000-0000-0000-000000000003',99703,'correction-admin','Correction Admin'),
 ('d1000000-0000-0000-0000-000000000004',99704,'correction-forged','Correction Forged');
insert into public.user_roles(user_id,role) values
 ('d1000000-0000-0000-0000-000000000001','member'),
 ('d1000000-0000-0000-0000-000000000002','member'),
 ('d1000000-0000-0000-0000-000000000003','admin'),
 ('d1000000-0000-0000-0000-000000000004','member');

select has_table('public','benefit_correction_requests','dedicated correction request table exists');
select has_table('public','benefit_correction_events','dedicated correction event table exists');
select has_table('public','benefit_correction_operator_rate_events','dedicated service-operator rate events exist');
select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_correction_requests'::regclass,'public.benefit_correction_events'::regclass,'public.benefit_correction_operator_rate_events'::regclass])),'correction tables enable RLS');
select ok((select bool_and(not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class where oid=any(array['public.benefit_correction_requests'::regclass,'public.benefit_correction_events'::regclass,'public.benefit_correction_operator_rate_events'::regclass])),'browser roles have no direct correction table privileges');

select has_function('public','create_benefit_correction_request_v1',array['uuid','text','text','text','text','text','text','text'],'create correction RPC exists');
select has_function('public','list_my_benefit_correction_requests_v1',array['integer','timestamp with time zone','uuid'],'own correction list RPC exists');
select has_function('public','list_benefit_correction_queue_v1',array['text','integer','timestamp with time zone','uuid'],'admin correction queue RPC exists');
select has_function('public','review_benefit_correction_request_v1',array['uuid','text','text','text','uuid'],'review correction RPC exists');
select has_function('public','mark_benefit_correction_applied_v1',array['uuid','text','text','uuid'],'operator apply RPC exists');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array[
 'public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text)'::regprocedure,
 'public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid)'::regprocedure,
 'public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid)'::regprocedure,
 'public.review_benefit_correction_request_v1(uuid,text,text,text,uuid)'::regprocedure,
 'public.mark_benefit_correction_applied_v1(uuid,text,text,uuid)'::regprocedure
])),'correction RPCs are fixed-owner SECURITY DEFINER with empty search_path');
select ok(has_function_privilege('authenticated','public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text)','EXECUTE'),'create is authenticated-only');
select ok(has_function_privilege('authenticated','public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid)','EXECUTE') and not has_function_privilege('anon','public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid)','EXECUTE'),'own list is authenticated-only');
select ok(has_function_privilege('authenticated','public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid)','EXECUTE') and has_function_privilege('authenticated','public.review_benefit_correction_request_v1(uuid,text,text,text,uuid)','EXECUTE'),'admin browser RPCs have authenticated grants and enforce admin in-database');
select ok(not has_function_privilege('public','public.mark_benefit_correction_applied_v1(uuid,text,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.mark_benefit_correction_applied_v1(uuid,text,text,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.mark_benefit_correction_applied_v1(uuid,text,text,uuid)','EXECUTE') and has_function_privilege('service_role','public.mark_benefit_correction_applied_v1(uuid,text,text,uuid)','EXECUTE'),'apply is service/operator-only');
select is((select max_requests from public.rate_limit_rules where action='benefit_correction.create' and window_seconds=3600 and is_enabled),5,'production correction rate limit is five per hour');
select is((select max_requests from public.rate_limit_rules where action='benefit_correction.review' and window_seconds=3600 and is_enabled),100,'admin review mutations are rate limited');
select is((select max_requests from public.rate_limit_rules where action='benefit_correction.apply' and window_seconds=3600 and is_enabled),100,'operator apply mutations are rate limited');
select ok((select bool_and(p.proconfig @> array['plan_cache_mode=force_custom_plan']) from pg_proc p where p.oid=any(array['public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid)'::regprocedure,'public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid)'::regprocedure])),'keyset list RPCs prevent generic plans from defeating parameter-specific indexes');
select is((select pg_get_indexdef('public.benefit_correction_requests_active_queue_idx'::regclass)),'CREATE INDEX benefit_correction_requests_active_queue_idx ON public.benefit_correction_requests USING btree (created_at DESC, id DESC) WHERE (status = ANY (ARRAY[''submitted''::text, ''reviewing''::text, ''approved''::text]))','active queue index matches global cursor order');
select ok((select strpos(prosrc,'if p_status=''active'' then')>0 from pg_proc where oid='public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid)'::regprocedure),'queue RPC gives the active predicate a dedicated plan branch');
select ok((select strpos(prosrc,'actor_kind=''user'' and actor_snapshot=v_actor::text and operation=''review'' and client_key=p_client_key')>0 from pg_proc where oid='public.review_benefit_correction_request_v1(uuid,text,text,text,uuid)'::regprocedure),'review replay lookup matches the unique event key exactly');

create function pg_temp.explain_json(p_sql text)
returns jsonb language plpgsql as $$
declare v_plan jsonb;
begin
  execute 'explain (format json,costs off) '||p_sql into v_plan;
  return v_plan;
end $$;
set local enable_seqscan=off;
create temporary table correction_plans(name text primary key,plan jsonb);
insert into correction_plans values
  ('active-keyset',pg_temp.explain_json($sql$
    select id,created_at from public.benefit_correction_requests
    where status in ('submitted','reviewing','approved')
      and (created_at,id)<('infinity'::timestamptz,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
    order by created_at desc,id desc limit 51
  $sql$)),
  ('review-replay',pg_temp.explain_json($sql$
    select request_id,payload_fingerprint from public.benefit_correction_events
    where actor_kind='user' and actor_snapshot='d1000000-0000-0000-0000-000000000003'
      and operation='review' and client_key='d3000000-0000-0000-0000-000000000010'
  $sql$));
select ok((select plan#>>'{0,Plan,Plans,0,Node Type}' in ('Index Scan','Index Only Scan')
  and plan#>>'{0,Plan,Plans,0,Index Name}'='benefit_correction_requests_active_queue_idx'
  and plan::text not like '%BitmapOr%' and plan::text not like '%"Node Type": "Sort"%'
  from correction_plans where name='active-keyset'),'active keyset query traverses the ordered partial index without bitmap OR or sort');
select ok((select plan#>>'{0,Plan,Node Type}' in ('Index Scan','Index Only Scan')
  and plan#>>'{0,Plan,Index Name}'=(select indexrelid::regclass::text from pg_index where indrelid='public.benefit_correction_events'::regclass and indisunique and indnatts=4 and pg_get_indexdef(indexrelid) like '%(actor_kind, actor_snapshot, operation, client_key)%')
  from correction_plans where name='review-replay'),'review replay lookup uses the unique event idempotency index');
reset enable_seqscan;

set local role anon;
select throws_like($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000001','KR-CRN-1101112948086','health','old','new','all employees','https://example.com/source','company-benefits-2026-10-31-v1')$$,'%permission denied%','anonymous create is denied');
reset role;
set local role authenticated;
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000001','KR-CRN-1101112948086','health','old','new','all employees','https://example.com/source','company-benefits-2026-10-31-v1')$$,'42501','authentication required','missing authenticated identity is denied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000001';
create temporary table correction_results(name text primary key,payload jsonb);
insert into correction_results values ('created',public.create_benefit_correction_request_v1(
 'd2000000-0000-0000-0000-000000000001',' KR-CRN-1101112948086 ',' health ',' Current display ',' Proposed display ',' All employees ',' https://example.com/source?id=1 ',' company-benefits-2026-10-31-v1 '
));
select is(public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000001','KR-CRN-1101112948086','health','Current display','Proposed display','All employees','https://example.com/source?id=1','company-benefits-2026-10-31-v1')->>'id',(select payload->>'id' from correction_results where name='created'),'matching client UUID replays one request');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000001','KR-CRN-1101112948086','health','changed','Proposed display','All employees','https://example.com/source?id=1','company-benefits-2026-10-31-v1')$$,'22023','client key reused with different payload','client UUID cannot change fingerprint');
select throws_ok($$select public.create_benefit_correction_request_v1(null,'KR-CRN-1101112948086','health','old','new','scope','https://example.com','company-benefits-2026-10-31-v1')$$,'22023','client key is required','null client key is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000002','not-canonical','health','old','new','scope','https://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid company id','malformed company is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000003','KR-CRN-1101112948086','unknown','old','new','scope','https://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid category id','unknown category is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000004','KR-CRN-1101112948086','health','old','new','scope','http://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid public source URL','non-HTTPS URL is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000005','KR-CRN-1101112948086','health','old','new','scope','https://user:secret@example.com/path','company-benefits-2026-10-31-v1')$$,'22023','invalid public source URL','URL credentials are rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000006','KR-CRN-1101112948086','health','old','new','scope','https://127.0.0.1/path','company-benefits-2026-10-31-v1')$$,'22023','invalid public source URL','loopback URL is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000007','KR-CRN-1101112948086','health','old','new','scope','https://example.com','latest')$$,'22023','invalid data version','malformed observed version is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000008','KR-CRN-1101112948086','health',repeat('x',5001),'new','scope','https://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid current text','oversized submitted text is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000009','KR-CRN-1101112948086','health','old',repeat('x',5001),'scope','https://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid proposed text','oversized proposed text is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-00000000000a','KR-CRN-1101112948086','health','old','new',repeat('x',2001),'https://example.com','company-benefits-2026-10-31-v1')$$,'22023','invalid scope text','oversized scope text is rejected');
select throws_ok($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-00000000000b','KR-CRN-1101112948086','health','old','new','scope','https://example.com','company-benefits-2026-99-99-v1')$$,'22023','invalid data version','impossible observed date is rejected');
insert into correction_results values ('mine',public.list_my_benefit_correction_requests_v1(20));
select is((select jsonb_array_length(payload->'items') from correction_results where name='mine'),1,'owner sees own request');
select is((select jsonb_object_agg(key,true order by key) from correction_results,jsonb_object_keys(payload->'items'->0) key where name='mine'),'{"admin_response":true,"applied_at":true,"applied_data_version":true,"category_id":true,"company_id":true,"created_at":true,"current_text":true,"id":true,"observed_data_version":true,"proposed_text":true,"scope_text":true,"source_url":true,"status":true,"updated_at":true}'::jsonb,'owner projection has exact safe keys');
select ok((select payload::text not like '%example.test%' and payload::text not like '%provider%' and payload::text not like '%token%' from correction_results where name='mine'),'owner projection leaks no identity/provider/token data');
select throws_ok($$select public.list_my_benefit_correction_requests_v1(0)$$,'22023','invalid page limit','owner page limit is bounded');
select throws_ok($$select public.list_my_benefit_correction_requests_v1(10,'2026-10-01')$$,'22023','invalid cursor','partial owner cursor is rejected');
reset role;

select is((select submitter_id from public.benefit_correction_requests where id=((select payload->>'id' from correction_results where name='created')::uuid)),'d1000000-0000-0000-0000-000000000001'::uuid,'submitter is derived server-side');
select ok((select client_key='d2000000-0000-0000-0000-000000000001' and payload_fingerprint ~ '^[0-9a-f]{64}$' and current_text='Current display' and source_url='https://example.com/source?id=1' from public.benefit_correction_requests where id=((select payload->>'id' from correction_results where name='created')::uuid)),'submitted payload is canonicalized with a SHA-256 fingerprint');
select is((select count(*)::integer from public.benefit_correction_events where request_id=((select payload->>'id' from correction_results where name='created')::uuid) and action='submitted'),1,'create replay emits one submitted event');
select is((select count(*)::integer from public.rate_limit_events where user_id='d1000000-0000-0000-0000-000000000001' and action='benefit_correction.create'),1,'create replay consumes one rate slot');

set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000002';
select is(jsonb_array_length(public.list_my_benefit_correction_requests_v1()->'items'),0,'other member cannot see owner request');
select throws_like($$insert into public.benefit_correction_requests(submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version) values ('d1000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000090',repeat('a',64),'US-CIK0000320193','health','old','new','scope','https://example.com','company-benefits-2026-10-31-v1')$$,'%permission denied%','member cannot insert requests directly');
select throws_like(format('update public.benefit_correction_requests set status=''approved'' where id=%L',(select payload->>'id' from correction_results where name='created')),'%permission denied%','member cannot update requests directly');
select throws_like(format('delete from public.benefit_correction_requests where id=%L',(select payload->>'id' from correction_results where name='created')),'%permission denied%','member cannot delete requests directly');
select throws_ok($$select public.list_benefit_correction_queue_v1()$$,'42501','admin required','member cannot list moderation queue');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''submitted'',''start_review'',''reviewing'',''d3000000-0000-0000-0000-000000000001'')',(select payload->>'id' from correction_results where name='created')),'42501','admin required','member cannot review');
select throws_like(format('select public.mark_benefit_correction_applied_v1(%L,''approved'',''company-benefits-2026-11-01-v2'',''d3000000-0000-0000-0000-000000000002'')',(select payload->>'id' from correction_results where name='created')),'%permission denied%','member cannot mark applied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.list_benefit_correction_queue_v1()$$,'42501','admin required','forged JWT admin cannot list queue');
select set_config('request.jwt.claims','',true);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000003';
insert into correction_results values ('queue',public.list_benefit_correction_queue_v1('active',20));
select is((select jsonb_array_length(payload->'items') from correction_results where name='queue'),1,'admin sees active queue');
select is((select jsonb_object_agg(key,true order by key) from correction_results,jsonb_object_keys(payload->'items'->0) key where name='queue'),'{"admin_response":true,"applied_at":true,"applied_data_version":true,"category_id":true,"company_id":true,"created_at":true,"current_text":true,"id":true,"observed_data_version":true,"proposed_text":true,"reviewed_at":true,"scope_text":true,"source_url":true,"status":true,"updated_at":true}'::jsonb,'admin queue projection omits submitter and reviewer identifiers');
select ok((select payload::text not like '%example.test%' and payload::text not like '%provider%' and payload::text not like '%token%' from correction_results where name='queue'),'admin queue leaks no email/provider/token data');
select throws_ok($$select public.list_benefit_correction_queue_v1('bad')$$,'22023','invalid correction status filter','queue status filter is bounded');
select throws_ok($$select public.list_benefit_correction_queue_v1('all',0)$$,'22023','invalid page limit','queue page limit is bounded');
select throws_ok($$select public.list_benefit_correction_queue_v1('all',10,'2026-10-01')$$,'22023','invalid cursor','partial queue cursor is rejected');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''submitted'',''start_review'',repeat(''x'',2001),''d3000000-0000-0000-0000-000000000009'')',(select payload->>'id' from correction_results where name='created')),'22023','invalid admin response','oversized admin response is rejected');
insert into correction_results values ('reviewing',public.review_benefit_correction_request_v1(((select payload->>'id' from correction_results where name='created')::uuid),'submitted','start_review','Initial review','d3000000-0000-0000-0000-000000000010'));
select is((select payload->>'status' from correction_results where name='reviewing'),'reviewing','submitted transitions to reviewing');
select is(public.review_benefit_correction_request_v1(((select payload->>'id' from correction_results where name='created')::uuid),'submitted','start_review','Initial review','d3000000-0000-0000-0000-000000000010')->>'status','reviewing','review action replays despite stale expected status');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''reviewing'',''approve'',''changed replay'',''d3000000-0000-0000-0000-000000000010'')',(select payload->>'id' from correction_results where name='created')),'22023','client key reused with different payload','changed review replay is rejected');
select is(public.review_benefit_correction_request_v1(((select payload->>'id' from correction_results where name='created')::uuid),'reviewing','request_additional_material','Please add official evidence','d3000000-0000-0000-0000-000000000011')->>'status','reviewing','additional material is recorded without a state cycle');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''submitted'',''approve'',''stale'',''d3000000-0000-0000-0000-000000000012'')',(select payload->>'id' from correction_results where name='created')),'40001','correction state changed','review CAS mismatch fails');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''reviewing'',''start_review'',''cycle'',''d3000000-0000-0000-0000-000000000013'')',(select payload->>'id' from correction_results where name='created')),'22023','correction review action not allowed','reviewing cannot cycle to start review');
select is(public.review_benefit_correction_request_v1(((select payload->>'id' from correction_results where name='created')::uuid),'reviewing','approve','Verified','d3000000-0000-0000-0000-000000000014')->>'status','approved','reviewing transitions to approved');
select throws_ok(format('select public.review_benefit_correction_request_v1(%L,''approved'',''reject'',''terminal rewrite'',''d3000000-0000-0000-0000-000000000015'')',(select payload->>'id' from correction_results where name='created')),'22023','invalid expected correction status','approved is terminal to browser review');
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='d1000000-0000-0000-0000-000000000003' and action='benefit_correction.review'),3,'review replays and rejected actions consume no extra rate slots');

insert into public.benefit_correction_requests(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version)
values ('d4000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000080',repeat('b',64),'US-CIK0000320193','leave','Old leave','Proposed leave','US employees','https://example.com/leave','company-benefits-2026-10-31-v1');
insert into public.benefit_correction_events(request_id,actor_kind,actor_id,actor_snapshot,operation,client_key,payload_fingerprint,action,from_status,to_status)
values ('d4000000-0000-0000-0000-000000000001','user','d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','create','d2000000-0000-0000-0000-000000000080',repeat('b',64),'submitted',null,'submitted');
set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000003';
select is(public.review_benefit_correction_request_v1('d4000000-0000-0000-0000-000000000001','submitted','start_review','Reviewing rejection fixture','d3000000-0000-0000-0000-000000000016')->>'status','reviewing','second request enters review');
select is(public.review_benefit_correction_request_v1('d4000000-0000-0000-0000-000000000001','reviewing','reject','Evidence does not support correction','d3000000-0000-0000-0000-000000000017')->>'status','rejected','reviewing transitions to rejected');
reset role;
select ok((select status='rejected' and admin_response='Evidence does not support correction' and reviewer_id='d1000000-0000-0000-0000-000000000003' and reviewed_at is not null and applied_at is null from public.benefit_correction_requests where id='d4000000-0000-0000-0000-000000000001'),'rejected terminal fields are consistent');
select throws_ok($$update public.benefit_correction_requests set status='applied',applied_data_version='company-benefits-2026-11-01-v2',applied_at=clock_timestamp() where id='d4000000-0000-0000-0000-000000000001'$$,'23514','illegal correction status transition','rejected request cannot transition to applied');
select throws_ok($$update public.benefit_correction_requests set admin_response='rewritten' where id='d4000000-0000-0000-0000-000000000001'$$,'23514','terminal correction review fields are immutable','rejected admin response cannot be rewritten');
set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000003';
insert into correction_results values ('queue-page-1',public.list_benefit_correction_queue_v1('all',1));
insert into correction_results values ('queue-page-2',public.list_benefit_correction_queue_v1(
  'all',1,
  ((select payload->'next_cursor'->>'created_at' from correction_results where name='queue-page-1')::timestamptz),
  ((select payload->'next_cursor'->>'id' from correction_results where name='queue-page-1')::uuid)
));
select ok((select payload->>'has_more'='true' and jsonb_array_length(payload->'items')=1 from correction_results where name='queue-page-1'),'admin queue first keyset page has a continuation');
select ok((select jsonb_array_length(payload->'items')=1 from correction_results where name='queue-page-2'),'admin queue traverses to the next keyset page');
select isnt((select payload->'items'->0->>'id' from correction_results where name='queue-page-1'),(select payload->'items'->0->>'id' from correction_results where name='queue-page-2'),'admin queue keyset pages do not duplicate requests');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000001';
insert into correction_results values ('owner-page-1',public.list_my_benefit_correction_requests_v1(1));
insert into correction_results values ('owner-page-2',public.list_my_benefit_correction_requests_v1(1,((select payload->'next_cursor'->>'created_at' from correction_results where name='owner-page-1')::timestamptz),((select payload->'next_cursor'->>'id' from correction_results where name='owner-page-1')::uuid)));
select ok((select payload->>'has_more'='true' and jsonb_array_length(payload->'items')=1 and payload->'next_cursor' is not null from correction_results where name='owner-page-1'),'owner first page returns one item and a complete cursor');
select ok((select payload->>'has_more'='false' and jsonb_array_length(payload->'items')=1 and payload->'next_cursor'='null'::jsonb from correction_results where name='owner-page-2'),'owner second page terminates without omissions');
select isnt((select payload->'items'->0->>'id' from correction_results where name='owner-page-1'),(select payload->'items'->0->>'id' from correction_results where name='owner-page-2'),'owner keyset pages do not duplicate requests');
reset role;

select throws_ok(format('update public.benefit_correction_requests set proposed_text=''tampered'' where id=%L',(select payload->>'id' from correction_results where name='created')),'23514','correction submitted payload is immutable','submitted payload is immutable even to privileged direct writes');
select throws_ok(format('update public.benefit_correction_requests set submitter_id=''d1000000-0000-0000-0000-000000000002'' where id=%L',(select payload->>'id' from correction_results where name='created')),'23514','correction submitted payload is immutable','request owner is immutable');
select throws_ok(format('update public.benefit_correction_requests set applied_data_version=''company-benefits-2026-11-01-v2'',applied_at=clock_timestamp() where id=%L',(select payload->>'id' from correction_results where name='created')),'23514','correction application fields may change only on applied transition','application fields cannot appear before applied');
select throws_ok(format('update public.benefit_correction_events set action=''tampered'' where request_id=%L',(select payload->>'id' from correction_results where name='created')),'23514','benefit correction events are append-only','audit UPDATE is rejected');
select throws_ok(format('delete from public.benefit_correction_events where request_id=%L',(select payload->>'id' from correction_results where name='created')),'23514','benefit correction events are append-only','audit DELETE is rejected');
select throws_ok($$truncate public.benefit_correction_events$$,'23514','benefit correction events are append-only','audit TRUNCATE is rejected');
select throws_like($$delete from public.profiles where id='d1000000-0000-0000-0000-000000000003'$$,'%violates foreign key constraint%','deleting an audit actor is restricted');
select ok((select bool_and(actor_kind='user' and actor_id is not null and actor_snapshot=actor_id::text) from public.benefit_correction_events where actor_id='d1000000-0000-0000-0000-000000000003'),'failed actor deletion leaves immutable audit attribution unchanged');

grant all on correction_results to service_role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select ok(auth.uid() is null,'service operator invocation has no browser-user subject');
select throws_ok($$select public.mark_benefit_correction_applied_v1('d4000000-0000-0000-0000-000000000001','approved','company-benefits-2026-11-01-v2','d3000000-0000-0000-0000-000000000019')$$,'40001','correction state changed','operator cannot apply a rejected request');
insert into correction_results values ('applied',public.mark_benefit_correction_applied_v1(((select payload->>'id' from correction_results where name='created')::uuid),'approved','company-benefits-2026-11-01-v2','d3000000-0000-0000-0000-000000000020'));
select is((select payload->>'status' from correction_results where name='applied'),'applied','operator marks approved request applied');
select is((select jsonb_object_agg(key,true order by key) from correction_results,jsonb_object_keys(payload) key where name='applied'),'{"admin_response":true,"applied_at":true,"applied_data_version":true,"category_id":true,"company_id":true,"created_at":true,"current_text":true,"id":true,"observed_data_version":true,"proposed_text":true,"reviewed_at":true,"scope_text":true,"source_url":true,"status":true,"updated_at":true}'::jsonb,'operator response omits submitter and reviewer identifiers');
select is(public.mark_benefit_correction_applied_v1(((select payload->>'id' from correction_results where name='created')::uuid),'approved','company-benefits-2026-11-01-v2','d3000000-0000-0000-0000-000000000020')->>'status','applied','operator application replays safely');
select throws_ok(format('select public.mark_benefit_correction_applied_v1(%L,''approved'',''company-benefits-2026-11-02-v3'',''d3000000-0000-0000-0000-000000000020'')',(select payload->>'id' from correction_results where name='created')),'22023','client key reused with different payload','application client key cannot change payload');
select throws_ok(format('select public.mark_benefit_correction_applied_v1(%L,''approved'',''bad-version'',''d3000000-0000-0000-0000-000000000021'')',(select payload->>'id' from correction_results where name='created')),'22023','invalid data version','applied version is validated');
reset role;
select ok((select status='applied' and reviewer_id='d1000000-0000-0000-0000-000000000003' and reviewed_at is not null and applied_data_version='company-benefits-2026-11-01-v2' and applied_at is not null from public.benefit_correction_requests where id=((select payload->>'id' from correction_results where name='created')::uuid)),'terminal fields remain consistent after application');
select is((select count(*)::integer from public.benefit_correction_events where request_id=((select payload->>'id' from correction_results where name='created')::uuid) and action='applied'),1,'application replay emits one audit event');
select ok((select actor_kind='service_role' and actor_id is null and actor_snapshot='service_role' from public.benefit_correction_events where request_id=((select payload->>'id' from correction_results where name='created')::uuid) and action='applied'),'service operator audit uses a non-user immutable actor snapshot');
select is((select count(*)::integer from public.benefit_correction_operator_rate_events where actor_snapshot='service_role' and action='benefit_correction.apply'),1,'application replay consumes one service-operator rate slot');

insert into public.rate_limit_events(user_id,action,idempotency_key)
select 'd1000000-0000-0000-0000-000000000003','benefit_correction.review','review-saturated-'||g from generate_series(1,95) g;
insert into public.benefit_correction_operator_rate_events(actor_snapshot,action,idempotency_key)
select 'service_role','benefit_correction.apply','apply-saturated-'||g from generate_series(1,99) g;
set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000003';
select throws_like(format('select public.review_benefit_correction_request_v1(%L,''reviewing'',''approve'',''rate probe'',''d3000000-0000-0000-0000-000000000030'')',(select payload->>'id' from correction_results where name='created')),'%rate_limit_exceeded%','review rate limit is database-backed');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select throws_like(format('select public.mark_benefit_correction_applied_v1(%L,''approved'',''company-benefits-2026-11-02-v3'',''d3000000-0000-0000-0000-000000000031'')',(select payload->>'id' from correction_results where name='created')),'%rate_limit_exceeded%','operator apply rate limit is database-backed');
reset role;

insert into public.rate_limit_events(user_id,action,idempotency_key) select 'd1000000-0000-0000-0000-000000000002','benefit_correction.create','saturated-'||g from generate_series(1,5) g;
set local role authenticated;
set local request.jwt.claim.sub='d1000000-0000-0000-0000-000000000002';
select throws_like($$select public.create_benefit_correction_request_v1('d2000000-0000-0000-0000-000000000099','US-CIK0000320193','leave','old','new','scope','https://example.com/source','company-benefits-2026-10-31-v1')$$,'%rate_limit_exceeded%','correction create rate limit is database-backed');
reset role;

select * from finish();
rollback;
