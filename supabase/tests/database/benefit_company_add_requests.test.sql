begin;
select no_plan();

select has_table('public','benefit_company_add_requests','company add request table exists');
select has_table('public','benefit_company_add_events','append-only company add event table exists');
select has_table('private','benefit_feature_settings','private feature settings exist');
select has_function('public','create_manual_benefit_company_request_v1',array['uuid','text','text','text','text'],'manual create RPC exists');
select has_function('public','reserve_benefit_company_nts_request_v1',array['uuid','text','text','text','text'],'authenticated NTS reserve RPC exists');
select has_function('public','list_my_benefit_company_requests_v1',array['integer','timestamp with time zone','uuid'],'owner list RPC exists');
select has_function('public','list_benefit_company_request_queue_v1',array['text','integer','timestamp with time zone','uuid'],'admin queue RPC exists');
select has_function('public','review_benefit_company_request_v1',array['uuid','text','bigint','text','text','text'],'admin review RPC requires revision CAS');
select has_function('public','finalize_benefit_company_nts_request_v1',array['uuid','text','text','text','timestamp with time zone'],'service finalize RPC exists');
select has_function('public','fail_benefit_company_nts_request_v1',array['uuid','text','text','text'],'service failure RPC requires immutable fingerprint binding');

select is((select array_agg(setting_key order by setting_key) from private.benefit_feature_settings),array['claim_reactions_write_enabled','claims_write_enabled','company_add_write_enabled','nts_verification_enabled']::text[],'exact independent feature keys are installed');
select ok((select bool_and(not enabled) from private.benefit_feature_settings),'rollout feature switches default fail closed');
select ok((select relrowsecurity from pg_class where oid='public.benefit_company_add_requests'::regclass),'requests enable RLS');
select ok((select relrowsecurity from pg_class where oid='public.benefit_company_add_events'::regclass),'events enable RLS');
select ok((select bool_and(not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class where oid=any(array['public.benefit_company_add_requests'::regclass,'public.benefit_company_add_events'::regclass])),'browser roles have no raw request/event table privileges');
select ok(not has_table_privilege('anon','private.benefit_feature_settings','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated','private.benefit_feature_settings','SELECT,INSERT,UPDATE,DELETE'),'feature settings are not browser readable or writable');
select is((select count(*)::integer from information_schema.columns where table_schema='public' and table_name='benefit_company_add_requests' and column_name in ('business_number','representative','opening_date')),0,'raw NTS values have no storage columns');
select ok((select bool_and(confdeltype='r') from pg_constraint where conrelid=any(array['public.benefit_company_add_requests'::regclass,'public.benefit_company_add_events'::regclass]) and contype='f'),'request and event history uses explicit RESTRICT deletion');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array[
 'public.create_manual_benefit_company_request_v1(uuid,text,text,text,text)'::regprocedure,
 'public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text)'::regprocedure,
 'public.list_my_benefit_company_requests_v1(integer,timestamptz,uuid)'::regprocedure,
 'public.list_benefit_company_request_queue_v1(text,integer,timestamptz,uuid)'::regprocedure,
 'public.review_benefit_company_request_v1(uuid,text,bigint,text,text,text)'::regprocedure,
 'public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz)'::regprocedure,
 'public.fail_benefit_company_nts_request_v1(uuid,text,text,text)'::regprocedure
])),'all company-add RPCs are fixed-path postgres-owned SECURITY DEFINER');
select ok(has_function_privilege('authenticated','public.create_manual_benefit_company_request_v1(uuid,text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.create_manual_benefit_company_request_v1(uuid,text,text,text,text)','EXECUTE'),'manual create is authenticated only');
select ok(has_function_privilege('authenticated','public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text)','EXECUTE'),'NTS reserve is authenticated only');
select ok(not has_function_privilege('public','public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz)','EXECUTE') and not has_function_privilege('authenticated','public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz)','EXECUTE') and has_function_privilege('service_role','public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz)','EXECUTE'),'NTS finalize is service only');
select ok(not has_function_privilege('authenticated','public.fail_benefit_company_nts_request_v1(uuid,text,text,text)','EXECUTE') and has_function_privilege('service_role','public.fail_benefit_company_nts_request_v1(uuid,text,text,text)','EXECUTE'),'NTS failure is service only');

insert into auth.users(id,aud,role,email) values
 ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','company-add-google@example.test'),
 ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','company-add-nongoogle@example.test'),
 ('a1000000-0000-4000-8000-000000000003','authenticated','authenticated','company-add-admin@example.test'),
 ('a1000000-0000-4000-8000-000000000004','authenticated','authenticated','company-add-forged@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('a1000000-0000-4000-8000-000000000001',99601,'company-add-google','Google Requester'),
 ('a1000000-0000-4000-8000-000000000002',99602,'company-add-nongoogle','Non Google'),
 ('a1000000-0000-4000-8000-000000000003',99603,'company-add-admin','Company Add Admin'),
 ('a1000000-0000-4000-8000-000000000004',99604,'company-add-forged','Forged Admin');
insert into public.user_roles(user_id,role) values
 ('a1000000-0000-4000-8000-000000000001','member'),('a1000000-0000-4000-8000-000000000002','member'),
 ('a1000000-0000-4000-8000-000000000003','admin'),('a1000000-0000-4000-8000-000000000004','member');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('company-add-google-1','a1000000-0000-4000-8000-000000000001','{"full_name":"Google Requester"}'::jsonb,'google'),
 ('company-add-google-admin','a1000000-0000-4000-8000-000000000003','{"full_name":"Company Add Admin"}'::jsonb,'google');

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_manual_benefit_company_request_v1(gen_random_uuid(),'Off Company',null,null,null)$$,'55000','company add writes are disabled','company-add switch off causes no write');
reset role;
select is((select count(*)::integer from public.benefit_company_add_requests),0,'disabled create leaves no request');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000002';
select throws_ok($$select public.create_manual_benefit_company_request_v1(gen_random_uuid(),'No Google',null,null,null)$$,'42501','trusted Google identity required','JWT subject without auth.identities Google row is denied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000006','(주)',null,null,null)$$,'22023','invalid proposed name','manual legal-form-only name fails as invalid argument');
select throws_ok($$select public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000007','   ',null,null,null)$$,'22023','invalid proposed name','manual whitespace-only name fails as invalid argument');
reset role;
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='nts_verification_enabled';
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
select throws_ok($$select public.reserve_benefit_company_nts_request_v1('a2000000-0000-4000-8000-000000000008','  주식회사  ',null,null,null)$$,'22023','invalid proposed name','NTS legal-form-only name fails as invalid argument');
reset role;
update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key='nts_verification_enabled';
select is((select count(*)::integer from public.benefit_company_add_requests where client_key in ('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000008')),0,'normalized-empty names leave no request');
select is((select count(*)::integer from public.benefit_company_add_events e join public.benefit_company_add_requests r using(request_id) where r.client_key in ('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000008')),0,'normalized-empty names leave no event');
select is((select count(*)::integer from public.rate_limit_events where user_id='a1000000-0000-4000-8000-000000000001' and action='benefit_company_add.create' and idempotency_key in ('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000008')),0,'normalized-empty names consume no rate slot');

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
create temporary table company_add_results(name text primary key,payload jsonb);
insert into company_add_results values ('manual',public.create_manual_benefit_company_request_v1(
 'a2000000-0000-4000-8000-000000000001','  Example   Company  ',' Seoul ',' Software ','https://example.com'));
select is(public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000001','Example Company','Seoul','Software','https://example.com')->>'request_id',(select payload->>'request_id' from company_add_results where name='manual'),'same actor/key/canonical payload replays same request');
select throws_ok($$select public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000001','Changed Company','Seoul','Software','https://example.com')$$,'22023','client key reused with different payload','same key changed payload rejects');
select throws_ok($$select public.create_manual_benefit_company_request_v1(gen_random_uuid(),repeat('x',201),null,null,null)$$,'22023','invalid proposed name','name is bounded');
select throws_ok($$select public.create_manual_benefit_company_request_v1(gen_random_uuid(),'Bad URL',null,null,'http://example.com')$$,'22023','invalid company website','website must be safe HTTPS');
insert into company_add_results values ('mine',public.list_my_benefit_company_requests_v1(20));
select is((select jsonb_object_agg(key,true order by key) from company_add_results,jsonb_object_keys(payload->'items'->0) key where name='mine'),'{"created_at":true,"industry":true,"proposed_name":true,"region":true,"request_id":true,"resolved_company_id":true,"revision":true,"status":true,"updated_at":true,"verification_status":true,"website":true}'::jsonb,'owner projection exact keys include revision and omit private identifiers');
select is((select (payload->'items'->0->>'revision')::integer from company_add_results where name='mine'),1,'new request projection starts at revision one');
select ok((select payload::text not like '%requester%' and payload::text not like '%digest%' and payload::text not like '%fingerprint%' and payload::text not like '%reviewer%' from company_add_results where name='mine'),'owner projection excludes internal identities and digests');
reset role;
select ok((select requester_id='a1000000-0000-4000-8000-000000000001' and verification_method='manual' and verification_status='pending' and status='pending_review' and payload_fingerprint ~ '^[0-9a-f]{64}$' and normalized_name='examplecompany' from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='manual')::uuid)),'manual request derives actor and stores canonical non-sensitive payload');
select is((select count(*)::integer from public.benefit_company_add_events where request_id=((select payload->>'request_id' from company_add_results where name='manual')::uuid) and action='requested'),1,'manual replay emits one event');
select is((select count(*)::integer from public.rate_limit_events where user_id='a1000000-0000-4000-8000-000000000001' and action='benefit_company_add.create'),1,'manual replay consumes one rate slot');
select is((public.search_benefit_companies_v1('Example Company')->>'total')::integer,0,'pending manual request is absent from anonymous search');

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000004","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.list_benefit_company_request_queue_v1()$$,'42501','admin required','forged metadata cannot list queue');
select set_config('request.jwt.claims','',true);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000003';
insert into company_add_results values ('queue',public.list_benefit_company_request_queue_v1('pending_review',20));
select is((select jsonb_object_agg(key,true order by key) from company_add_results,jsonb_object_keys(payload->'items'->0) key where name='queue'),'{"created_at":true,"industry":true,"proposed_name":true,"region":true,"request_id":true,"resolved_company_id":true,"revision":true,"status":true,"updated_at":true,"verification_method":true,"verification_status":true,"website":true}'::jsonb,'admin queue is exact-key, revisioned, and privacy safe');
select throws_ok(format('select public.review_benefit_company_request_v1(%L,''pending_review'',null,''approve'',''missing revision'',null)',(select payload->>'request_id' from company_add_results where name='manual')),'22023','invalid expected company request revision','admin review requires a non-null expected revision');
select throws_ok(format('select public.review_benefit_company_request_v1(%L,''pending_review'',2,''approve'',''stale snapshot'',null)',(select payload->>'request_id' from company_add_results where name='manual')),'40001','benefit company request state changed','pending admin review rejects a stale revision');
select throws_ok(format('select public.review_benefit_company_request_v1(%L,''pending_review'',1,''noop'',''no-op'',null)',(select payload->>'request_id' from company_add_results where name='manual')),'22023','company request review action not allowed','admin no-op is rejected rather than silently consuming intent');
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='a1000000-0000-4000-8000-000000000003' and action='benefit_company_add.review'),0,'failed CAS and rejected no-op consume no admin rate slot');
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000003';
insert into company_add_results values ('approved',public.review_benefit_company_request_v1(
 ((select payload->>'request_id' from company_add_results where name='manual')::uuid),'pending_review',1,'approve','Reviewed company',null));
select ok((select payload->>'resolved_company_id' from company_add_results where name='approved') ~ '^KR-CAN-[0-9a-f]{32}$','approval ID is random lowercase hex');
select is((select (payload->>'revision')::integer from company_add_results where name='approved'),2,'successful admin transition increments revision exactly once');
reset role;
insert into public.rate_limit_events(user_id,action,idempotency_key,occurred_at)
select 'a1000000-0000-4000-8000-000000000003','benefit_company_add.review','saturated-'||g::text,clock_timestamp() from generate_series(1,99) g;
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000003';
select throws_ok(format('select public.review_benefit_company_request_v1(%L,''pending_review'',1,''reject'',''stale'',null)',(select payload->>'request_id' from company_add_results where name='manual')),'40001','benefit company request state changed','terminal review has status/revision CAS loser');
reset role;
delete from public.rate_limit_events where user_id='a1000000-0000-4000-8000-000000000003' and action='benefit_company_add.review' and idempotency_key like 'saturated-%';
select is((select count(*)::integer from public.rate_limit_events where user_id='a1000000-0000-4000-8000-000000000003' and action='benefit_company_add.review'),1,'stale review loses CAS before consuming another rate slot');
select is((select revision from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='manual')::uuid)),2::bigint,'failed terminal replay does not increment revision again');
select ok((select c.is_searchable and c.identity_class='registered_business' and c.source_edition='community-reviewed' from public.benefit_companies c where c.company_id=(select payload->>'resolved_company_id' from company_add_results where name='approved')),'approval atomically creates searchable community company');
select is((select count(*)::integer from public.benefit_company_add_events where request_id=((select payload->>'request_id' from company_add_results where name='manual')::uuid) and action='approved'),1,'approval emits one terminal event');

-- Merge and reject create no source company and never fabricate merge lineage.
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
insert into company_add_results values
 ('merge-request',public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000002','Duplicate Company',null,null,null)),
 ('reject-request',public.create_manual_benefit_company_request_v1('a2000000-0000-4000-8000-000000000003','Rejected Company',null,null,null));
reset role;
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000003';
insert into company_add_results values ('merged',public.review_benefit_company_request_v1(
 ((select payload->>'request_id' from company_add_results where name='merge-request')::uuid),'pending_review',1,'merge','Existing canonical',
 (select payload->>'resolved_company_id' from company_add_results where name='approved')));
insert into company_add_results values ('rejected',public.review_benefit_company_request_v1(
 ((select payload->>'request_id' from company_add_results where name='reject-request')::uuid),'pending_review',1,'reject','Insufficient evidence',null));
reset role;
select is((select count(*)::integer from public.benefit_company_merge_events where destination_company_id=(select payload->>'resolved_company_id' from company_add_results where name='approved')),0,'request merge does not fabricate a source company merge event');
select ok((select resolved_company_id=(select payload->>'resolved_company_id' from company_add_results where name='approved') from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='merge-request')::uuid)),'request merge binds canonical destination');
select is((select count(*)::integer from public.benefit_companies where display_name in ('Duplicate Company','Rejected Company')),0,'merge and reject create no company');

-- NTS reserve binds auth.uid before the external call; service finalize receives only immutable request ID, expected state, complete safe fingerprint and HMAC digest.
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='nts_verification_enabled';
set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
insert into company_add_results values ('nts',public.reserve_benefit_company_nts_request_v1(
 'a2000000-0000-4000-8000-000000000004','Verified Company','Busan','Manufacturing','https://verified.example.com'));
reset role;
select ok((select requester_id='a1000000-0000-4000-8000-000000000001' and verification_method='nts_full' and verification_status='pending' and status='pending_review' from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='nts')::uuid)),'NTS reserve stores original authenticated Google requester without browser-supplied user ID');
create temporary table nts_safe_fingerprint(value text);
insert into nts_safe_fingerprint select payload_fingerprint from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='nts')::uuid);
grant select on company_add_results,nts_safe_fingerprint to authenticated,service_role;
grant insert on company_add_results to service_role;
set local role authenticated;
select throws_like(format('select public.finalize_benefit_company_nts_request_v1(%L,''pending'',repeat(''a'',64),repeat(''b'',64),clock_timestamp())',(select payload->>'request_id' from company_add_results where name='nts')),'%permission denied%','browser cannot finalize NTS');
reset role;
set local role service_role;
insert into company_add_results values ('nts-final',public.finalize_benefit_company_nts_request_v1(
 ((select payload->>'request_id' from company_add_results where name='nts')::uuid),'pending',
 (select value from nts_safe_fingerprint),repeat('b',64),clock_timestamp()));
reset role;
select ok((select r.status='approved' and r.verification_status='matched' and i.identifier_type='business_number_hmac_v1' and i.identifier_digest_or_value=repeat('b',64) from public.benefit_company_add_requests r join public.benefit_company_identifiers i on i.company_id=r.resolved_company_id where r.request_id=((select payload->>'request_id' from company_add_results where name='nts')::uuid)),'NTS matched finalize atomically creates company and HMAC identifier');
select is((select revision from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='nts')::uuid)),2::bigint,'NTS finalize invalidates stale admin snapshots exactly once');
select is((public.search_benefit_companies_v1('Verified Company')->>'total')::integer,1,'NTS finalized company is searchable');

set local role authenticated;
set local request.jwt.claim.sub='a1000000-0000-4000-8000-000000000001';
insert into company_add_results values ('nts-failure',public.reserve_benefit_company_nts_request_v1(
 'a2000000-0000-4000-8000-000000000005','Unavailable Company',null,null,null));
reset role;
create temporary table nts_failure_before as
select r.request_id,r.payload_fingerprint,r.revision,
       (select count(*) from public.benefit_company_add_events e where e.request_id=r.request_id) event_count,
       (select count(*) from public.rate_limit_events l where l.user_id=r.requester_id and l.action='benefit_company_add.create') rate_count
from public.benefit_company_add_requests r where r.request_id=((select payload->>'request_id' from company_add_results where name='nts-failure')::uuid);
grant select on nts_failure_before to service_role;
set local role service_role;
select throws_ok(format('select public.fail_benefit_company_nts_request_v1(%L,''pending'',repeat(''f'',64),''unavailable'')',(select request_id from nts_failure_before)),'22023','safe payload fingerprint mismatch','NTS failure rejects a valid but wrong immutable fingerprint');
select throws_ok(format('select public.fail_benefit_company_nts_request_v1(%L,''pending'',repeat(''F'',64),''unavailable'')',(select request_id from nts_failure_before)),'22023','invalid safe payload fingerprint','NTS failure requires exact lowercase 64-hex fingerprint');
reset role;
select ok((select r.status='pending_review' and r.verification_status='pending' and r.revision=b.revision and (select count(*) from public.benefit_company_add_events e where e.request_id=r.request_id)=b.event_count and (select count(*) from public.rate_limit_events l where l.user_id=r.requester_id and l.action='benefit_company_add.create')=b.rate_count from public.benefit_company_add_requests r join nts_failure_before b using(request_id)),'wrong failure fingerprint has no state, event, revision, or rate side effect');
set local role service_role;
insert into company_add_results values ('nts-failed',public.fail_benefit_company_nts_request_v1(
 ((select payload->>'request_id' from company_add_results where name='nts-failure')::uuid),'pending',(select payload_fingerprint from nts_failure_before),'unavailable'));
reset role;
select ok((select status='rejected' and verification_status='unavailable' and revision=2 and business_number_digest is null and external_verified_at is null and resolved_company_id is null and reviewer_id is null and processed_at is not null from public.benefit_company_add_requests where request_id=((select payload->>'request_id' from company_add_results where name='nts-failure')::uuid)),'NTS unavailable stores only a safe category, increments revision once, and creates no company');
select is((select count(*)::integer from public.benefit_company_add_events where request_id=((select payload->>'request_id' from company_add_results where name='nts-failure')::uuid) and action='verification_failed' and verification_category='unavailable'),1,'NTS failure emits one safe terminal event');

select throws_ok($$update public.benefit_company_add_events set action='tampered'$$,'23514','benefit company add events are append-only','event update rejected');
select throws_ok($$delete from public.benefit_company_add_events$$,'23514','benefit company add events are append-only','event delete rejected');
select throws_ok($$truncate public.benefit_company_add_events$$,'23514','benefit company add events are append-only','event truncate rejected');
select throws_ok($$delete from public.profiles where id='a1000000-0000-4000-8000-000000000001'$$,'23503',null,'requester profile deletion preserves audit by RESTRICT');

select * from finish();
rollback;
