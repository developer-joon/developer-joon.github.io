begin;
select no_plan();

select has_table('private','benefit_company_review_requests','private durable company review request ledger exists');
select has_function('public','list_benefit_company_request_queue_v2',array['text','integer','timestamp with time zone','uuid'],'safe admin queue v2 exists');
select has_function('public','review_benefit_company_request_v2',array['uuid','uuid','text','bigint','text','text','text'],'idempotent company review v2 exists');
select has_function('public','get_benefit_company_request_detail_v2',array['uuid'],'safe exact company request detail exists');
select has_function('public','get_benefit_claim_moderation_detail_v1',array['uuid'],'safe exact claim moderation detail exists');
select ok((select relrowsecurity from pg_class where oid='private.benefit_company_review_requests'::regclass),'review ledger enables RLS');
select ok(not has_table_privilege('public','private.benefit_company_review_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('anon','private.benefit_company_review_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated','private.benefit_company_review_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','private.benefit_company_review_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'review ledger has no browser or service table grants');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres' from pg_proc p where p.oid='public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text)'::regprocedure),'review v2 is postgres-owned fixed-path SECURITY DEFINER');
select ok(has_function_privilege('authenticated','public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text)','EXECUTE'),'review v2 is authenticated only');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid in ('public.get_benefit_company_request_detail_v2(uuid)'::regprocedure,'public.get_benefit_claim_moderation_detail_v1(uuid)'::regprocedure)),'exact detail RPCs are postgres-owned fixed-path SECURITY DEFINER');
select ok(has_function_privilege('authenticated','public.get_benefit_company_request_detail_v2(uuid)','EXECUTE') and has_function_privilege('authenticated','public.get_benefit_claim_moderation_detail_v1(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_benefit_company_request_detail_v2(uuid)','EXECUTE') and not has_function_privilege('anon','public.get_benefit_claim_moderation_detail_v1(uuid)','EXECUTE'),'exact detail RPCs are authenticated only');

insert into auth.users(id,aud,role,email) values
 ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','company-v2-requester@example.test'),
 ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','company-v2-admin@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('b1000000-0000-4000-8000-000000000001',99701,'company-v2-requester'),
 ('b1000000-0000-4000-8000-000000000002',99702,'company-v2-admin');
insert into public.user_roles(user_id,role) values
 ('b1000000-0000-4000-8000-000000000001','member'),('b1000000-0000-4000-8000-000000000002','admin');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('company-v2-requester-google','b1000000-0000-4000-8000-000000000001','{}','google'),
 ('company-v2-admin-google','b1000000-0000-4000-8000-000000000002','{}','google');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values ('KR-BIZ-9970100001','registered_business','Exact Detail Company','exact detail company',true,'admin-v2-test');
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on,status,revision)
values ('b4000000-0000-4000-8000-000000000001','KR-BIZ-9970100001','b1000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('4',64),'health','Exact hidden claim','exact hidden claim','Exact detail description','',date '2026-01-01','hidden',2);

set local role authenticated;
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001';
select throws_ok($$select public.get_benefit_company_request_detail_v2('b2000000-0000-4000-8000-000000000001')$$,'42501','admin required','non-admin cannot read exact company detail');
select throws_ok($$select public.get_benefit_claim_moderation_detail_v1('b4000000-0000-4000-8000-000000000001')$$,'42501','admin required','non-admin cannot read exact claim detail');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000001';
create temporary table company_v2_results(name text primary key,payload jsonb);
insert into company_v2_results values ('request',public.create_manual_benefit_company_request_v1('b2000000-0000-4000-8000-000000000001','Versioned Review Company',null,null,null));
reset role;

set local role authenticated;
set local request.jwt.claim.sub='b1000000-0000-4000-8000-000000000002';
insert into company_v2_results values ('queue',public.list_benefit_company_request_queue_v2('pending_review',50));
select is((select jsonb_object_agg(key,true order by key) from company_v2_results,jsonb_object_keys(payload->'items'->0) key where name='queue'),'{"created_at":true,"external_verified_at":true,"industry":true,"proposed_name":true,"region":true,"request_id":true,"resolved_company_id":true,"revision":true,"status":true,"updated_at":true,"verification_method":true,"verification_status":true,"website":true}'::jsonb,'queue v2 exposes only nullable external verification time beyond v1');
insert into company_v2_results values ('first',public.review_benefit_company_request_v2(
 'b3000000-0000-4000-8000-000000000001',((select payload->>'request_id' from company_v2_results where name='request')::uuid),'pending_review',1,'reject','policy duplicate',null));
insert into company_v2_results values ('replay',public.review_benefit_company_request_v2(
 'b3000000-0000-4000-8000-000000000001',((select payload->>'request_id' from company_v2_results where name='request')::uuid),'pending_review',1,'reject','policy duplicate',null));
select is((select payload from company_v2_results where name='replay'),(select payload from company_v2_results where name='first'),'response-loss retry returns exact stored response');
insert into company_v2_results values ('empty-pending',public.list_benefit_company_request_queue_v2('pending_review',50));
insert into company_v2_results values ('rejected-detail',public.get_benefit_company_request_detail_v2(((select payload->>'request_id' from company_v2_results where name='request')::uuid)));
insert into company_v2_results values ('hidden-claim-detail',public.get_benefit_claim_moderation_detail_v1('b4000000-0000-4000-8000-000000000001'));
select is((select payload->'items' from company_v2_results where name='empty-pending'),'[]'::jsonb,'rejected company leaves the pending filter');
select is((select payload->>'status' from company_v2_results where name='rejected-detail'),'rejected','exact company detail retrieves rejected out-of-filter row');
select is((select (payload->>'revision')::integer from company_v2_results where name='rejected-detail'),2,'exact company detail returns authoritative revision');
select is((select jsonb_object_agg(key,true order by key) from company_v2_results,jsonb_object_keys(payload) key where name='rejected-detail'),'{"created_at":true,"external_verified_at":true,"industry":true,"proposed_name":true,"region":true,"request_id":true,"resolved_company_id":true,"revision":true,"status":true,"updated_at":true,"verification_method":true,"verification_status":true,"website":true}'::jsonb,'company exact detail exposes the exact safe v2 projection');
select is((select payload->>'status' from company_v2_results where name='hidden-claim-detail'),'hidden','exact claim detail retrieves hidden out-of-filter row');
select is((select jsonb_object_agg(key,true order by key) from company_v2_results,jsonb_object_keys(payload) key where name='hidden-claim-detail'),'{"category_id":true,"claim_id":true,"community_publication_active":true,"company_id":true,"company_name":true,"confirm_count":true,"created_at":true,"dispute_count":true,"official_publication_active":true,"revision":true,"status":true,"title":true,"updated_at":true}'::jsonb,'claim exact detail exposes exactly the queue item key set');
select throws_ok($$select public.get_benefit_company_request_detail_v2(null)$$,'22023','request id is required','company detail rejects null id');
select throws_ok($$select public.get_benefit_claim_moderation_detail_v1(null)$$,'22023','claim id is required','claim detail rejects null id');
select throws_ok($$select public.get_benefit_company_request_detail_v2('b2000000-0000-4000-8000-000000000099')$$,'22023','benefit company request not found','company detail has safe not-found error');
select throws_ok($$select public.get_benefit_claim_moderation_detail_v1('b4000000-0000-4000-8000-000000000099')$$,'22023','benefit claim not found','claim detail has safe not-found error');
select throws_ok(format($q$select public.review_benefit_company_request_v2('b3000000-0000-4000-8000-000000000001',%L,'pending_review',1,'reject','changed reason',null)$q$,(select payload->>'request_id' from company_v2_results where name='request')),'22023','client key reused with different payload','same key changed canonical payload fails closed');
reset role;
select is((select count(*)::integer from private.benefit_company_review_requests where actor_snapshot='b1000000-0000-4000-8000-000000000002' and client_key='b3000000-0000-4000-8000-000000000001'),1,'one durable response ledger row is stored');
select is((select count(*)::integer from public.benefit_company_add_events where request_id=((select payload->>'request_id' from company_v2_results where name='request')::uuid) and action='rejected'),1,'same-key replay emits one terminal audit event');
select is((select count(*)::integer from public.rate_limit_events where user_id='b1000000-0000-4000-8000-000000000002' and action='benefit_company_add.review'),1,'same-key replay consumes one rate side effect');
select is((select revision from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_v2_results where name='request')::uuid)),2::bigint,'same-key replay performs one transition');
select throws_ok($$update private.benefit_company_review_requests set response='{}'$$,'23514','benefit company review requests are append-only','review ledger update rejected');
select throws_ok($$delete from private.benefit_company_review_requests$$,'23514','benefit company review requests are append-only','review ledger delete rejected');
select throws_ok($$truncate private.benefit_company_review_requests$$,'23514','benefit company review requests are append-only','review ledger truncate rejected');

select * from finish();
rollback;
