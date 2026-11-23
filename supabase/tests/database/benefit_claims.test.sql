begin;
select no_plan();

select has_table('public','benefit_claims','structured benefit claims table exists');
select has_table('public','benefit_claim_events','append-only claim events table exists');
select has_function('public','create_benefit_claim_v1',array['uuid','text','text','text','text','text','text','date','text'],'create claim RPC exists');
select has_function('public','withdraw_benefit_claim_v1',array['uuid','uuid','text','bigint'],'withdraw claim RPC exists');
select has_function('public','list_my_benefit_claims_v1',array['integer','timestamp with time zone','uuid'],'owner claim list RPC exists');
select has_function('public','get_benefit_company_v2',array['text'],'bounded public v2 detail RPC exists');

select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='benefit_claims'),array['claim_id','company_id','submitter_id','client_key','payload_fingerprint','category_id','title','normalized_title','description','eligibility_text','normalized_eligibility','condition_text','observed_on','source_url','status','revision','active_publication_id','created_at','updated_at','withdrawn_at','official_publication_id']::text[],'claim columns are exact and ordered');
select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_claims'::regclass,'public.benefit_claim_events'::regclass])),'claim tables enable RLS');
select ok((select bool_and(not has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class where oid=any(array['public.benefit_claims'::regclass,'public.benefit_claim_events'::regclass])),'all API roles lack raw claim/event rights');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array['public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure,'public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint)'::regprocedure,'public.list_my_benefit_claims_v1(integer,timestamptz,uuid)'::regprocedure,'public.get_benefit_company_v2(text)'::regprocedure])),'claim RPCs are postgres-owned SECURITY DEFINER with empty search path');
select ok(has_function_privilege('authenticated','public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)','EXECUTE') and not has_function_privilege('anon','public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)','EXECUTE'),'create is authenticated only');
select ok(has_function_privilege('authenticated','public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint)','EXECUTE') and not has_function_privilege('anon','public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint)','EXECUTE'),'withdraw is authenticated only');
select ok(has_function_privilege('anon','public.get_benefit_company_v2(text)','EXECUTE') and has_function_privilege('authenticated','public.get_benefit_company_v2(text)','EXECUTE') and not has_function_privilege('public','public.get_benefit_company_v2(text)','EXECUTE') and not has_function_privilege('service_role','public.get_benefit_company_v2(text)','EXECUTE'),'public v2 grants are exact browser read roles');
select ok((select confdeltype='n' from pg_constraint where conrelid='public.benefit_claims'::regclass and conname='benefit_claims_submitter_id_fkey'),'claim survives profile deletion with SET NULL');
select ok((select count(*)=0 from pg_constraint where conrelid='public.benefit_claim_events'::regclass and contype='f' and pg_get_constraintdef(oid) like '%actor%'),'event actor snapshot has no mutable profile FK');
select ok((select exists(select 1 from pg_indexes where schemaname='public' and tablename='benefit_claims' and indexdef like 'CREATE UNIQUE INDEX%company_id, category_id, normalized_title, normalized_eligibility)%WHERE (status = ANY%')),'active exact duplicate authority is a partial unique index');
select ok(not exists(select 1 from pg_constraint where conrelid='public.benefit_claims'::regclass and conname='benefit_claims_task5_no_active_publication_check'),'Task 6 explicitly removes the phase-only publication constraint');
select is((select count(*)::integer from pg_trigger where tgrelid=any(array['public.benefit_claims'::regclass,'public.benefit_publications'::regclass]) and tgname in ('benefit_claims_publication_lineage','benefit_publications_claim_lineage')),2,'Task 6 installs both deferred publication-lineage triggers');
select ok(to_regprocedure('private.enforce_benefit_claim_publication()') is not null and to_regprocedure('private.enforce_benefit_publication_claim_lineage()') is not null,'Task 6 installs robust publication-lineage functions');
select ok((select pg_get_functiondef('public.get_benefit_company_v2(text)'::regprocedure) ~ 'limit 201' and pg_get_functiondef('public.get_benefit_company_v2(text)'::regprocedure) !~ 'source_url'),'public v2 bounds before aggregation and omits source URL');
select is((select max_requests from public.rate_limit_rules where action='benefit_claim.create' and window_seconds=3600 and is_enabled),5,'claim create rate limit installed');
select is((select max_requests from public.rate_limit_rules where action='benefit_claim.withdraw' and window_seconds=3600 and is_enabled),20,'claim withdraw rate limit installed');

insert into auth.users(id,aud,role,email) values
 ('b5100000-0000-4000-8000-000000000001','authenticated','authenticated','claim-one@example.test'),
 ('b5100000-0000-4000-8000-000000000002','authenticated','authenticated','claim-two@example.test'),
 ('b5100000-0000-4000-8000-000000000003','authenticated','authenticated','claim-nongoogle@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('b5100000-0000-4000-8000-000000000001',99510001,'claim-one','제보자 하나'),
 ('b5100000-0000-4000-8000-000000000002',99510002,'claim-two','제보자 둘'),
 ('b5100000-0000-4000-8000-000000000003',99510003,'claim-nongoogle','비구글');
insert into public.user_roles(user_id,role) values
 ('b5100000-0000-4000-8000-000000000001','member'),('b5100000-0000-4000-8000-000000000002','member'),('b5100000-0000-4000-8000-000000000003','member');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('claim-google-one','b5100000-0000-4000-8000-000000000001','{}','google'),
 ('claim-google-two','b5100000-0000-4000-8000-000000000002','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values
 ('KR-BIZ-9951000001','registered_business','Claim Company','claim company',true,'claim-test'),
 ('KR-BIZ-9951000002','registered_business','Hidden Claim Company','hidden claim company',false,'claim-test');
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type)
values ('b5300000-0000-4000-8000-000000000001','KR-BIZ-9951000001','health','Existing publication','Existing publication remains untouched','community_reviewed','active','claim-phase-fixture',1,'seed');

select throws_ok($$insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on,status,active_publication_id) values ('b5400000-0000-4000-8000-000000000001','KR-BIZ-9951000001',gen_random_uuid(),repeat('a',64),'health','Unsupported direct link','unsupported direct link','Direct link fixture','',date '2026-01-01','community_confirmed','b5300000-0000-4000-8000-000000000001'); set constraints benefit_claims_publication_lineage immediate$$,'23514','claim active publication must be its active community reaction publication','direct insert cannot bind an unrelated publication');
delete from public.benefit_claims where claim_id='b5400000-0000-4000-8000-000000000001';
insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on,status)
values ('b5400000-0000-4000-8000-000000000002','KR-BIZ-9951000001',gen_random_uuid(),repeat('b',64),'health','Unsupported update link','unsupported update link','Update link fixture','',date '2026-01-01','submitted');
select throws_ok($$update public.benefit_claims set status='community_confirmed',revision=2,active_publication_id='b5300000-0000-4000-8000-000000000001' where claim_id='b5400000-0000-4000-8000-000000000002'; set constraints benefit_claims_publication_lineage immediate$$,'23514','claim active publication must be its active community reaction publication','direct update cannot bind an unrelated publication');
delete from public.benefit_claims where claim_id='b5400000-0000-4000-8000-000000000002';
select ok((select status='active' and title='Existing publication' from public.benefit_publications where publication_id='b5300000-0000-4000-8000-000000000001'),'Task 5 phase guard leaves existing publications untouched');

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Health stipend','Monthly health support',null,null,current_date,null)$$,'55000','benefit writes are disabled','kill switch fails closed before write');
reset role;
select is((select count(*)::integer from public.benefit_claims),0,'disabled create leaves no claim');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claims_write_enabled';

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000003';
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','No Google','Description',null,null,current_date,null)$$,'42501','trusted Google identity required','non-Google authenticated user denied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000002','health','Hidden company','Description',null,null,current_date,null)$$,'22023','benefit company not searchable','non-searchable company rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','unknown','Bad category','Description',null,null,current_date,null)$$,'22023','invalid category id','unknown category rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health',' ', 'Description',null,null,current_date,null)$$,'22023','invalid claim title','empty title rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health',repeat('가',201),'Description',null,null,current_date,null)$$,'22023','invalid claim title','title character bound enforced');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid',repeat('x',1001),null,null,current_date,null)$$,'22023','invalid claim description','description bound enforced');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',repeat('x',501),null,current_date,null)$$,'22023','invalid claim eligibility','eligibility bound enforced');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,date '1999-12-31',null)$$,'22023','invalid observed date','earliest observed date enforced');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,current_date+1,null)$$,'22023','invalid observed date','future observed date rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,current_date,'http://example.com')$$,'22023','invalid claim source URL','HTTP source rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,current_date,'https://user:pass@example.com')$$,'22023','invalid claim source URL','userinfo rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,current_date,'https://example.com/path#fragment')$$,'22023','invalid claim source URL','fragment rejected');
select throws_ok($$select public.create_benefit_claim_v1(gen_random_uuid(),'KR-BIZ-9951000001','health','Valid','Description',null,null,current_date,'https://example.com/path?token=secret')$$,'22023','invalid claim source URL','credential-like query rejected');
set local role postgres;
select lives_ok($$select private.benefit_claim_source_url('https://3m.com/evidence')$$,'DNS labels may start with a digit');
select lives_ok($$select private.benefit_claim_source_url('https://1password.com/evidence')$$,'digit-leading DNS product domains remain valid');
select lives_ok($$select private.benefit_claim_source_url('https://example.com/evidence?page=2&lang=ko')$$,'ordinary query keys remain valid');
select lives_ok($$select private.benefit_claim_source_url('https://example.com/evidence?note=token&return=https%3A%2F%2Fdocs.example.com%2Fguide')$$,'credential words and percent escapes remain valid in values');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?foo=1;token=secret')$$,'22023','invalid claim source URL','semicolon query separator rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?foo[token]=secret')$$,'22023','invalid claim source URL','nested bracket query key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?%74oken=secret')$$,'22023','invalid claim source URL','percent-encoded query key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?=secret')$$,'22023','invalid claim source URL','empty query key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?foo=1&')$$,'22023','invalid claim source URL','empty trailing query pair rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?foo=1&&bar=2')$$,'22023','invalid claim source URL','repeated query separators rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?Access-Token=secret')$$,'22023','invalid claim source URL','case-insensitive segmented credential key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?ApiKey=secret')$$,'22023','invalid claim source URL','case-insensitive concatenated credential key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?client_secret=secret')$$,'22023','invalid claim source URL','credential key segment rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?bad%20key=value')$$,'22023','invalid claim source URL','encoded ambiguous query key rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?note=bad%0Dvalue')$$,'22023','invalid claim source URL','encoded control in query value rejected');
select throws_ok($$select private.benefit_claim_source_url('https://example.com/evidence?next=page%23fragment')$$,'22023','invalid claim source URL','encoded fragment delimiter in query value rejected');
select throws_ok($$select private.benefit_claim_source_url('https://127.0.0.1/evidence')$$,'22023','invalid claim source URL','IPv4 literal rejected');
select throws_ok($$select private.benefit_claim_source_url('https://12345/evidence')$$,'22023','invalid claim source URL','numeric-only host rejected');
select throws_ok($$select private.benefit_claim_source_url('https://[2001:db8::1]/evidence')$$,'22023','invalid claim source URL','IPv6 literal rejected');
select throws_ok($$select private.benefit_claim_source_url('https://user@example.com/evidence')$$,'22023','invalid claim source URL','plain userinfo rejected');
select throws_ok($$select private.benefit_claim_source_url('https://localhost/evidence')$$,'22023','invalid claim source URL','localhost rejected');
select throws_ok($$select private.benefit_claim_source_url('https://intranet/evidence')$$,'22023','invalid claim source URL','non-FQDN host rejected');
set local role authenticated;

create temporary table claim_results(name text primary key,payload jsonb);
insert into claim_results values ('created',public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000001','KR-BIZ-9951000001','health','  Health   stipend  ',' Monthly   health support ','   ',' Employees only ',date '2026-01-02','https://example.com/source?id=1'));
select is((select jsonb_object_agg(key,true order by key) from claim_results,jsonb_object_keys(payload) key where name='created'),'{"claim_id":true,"outcome":true}'::jsonb,'create response has exact keys');
select is((select payload->>'outcome' from claim_results where name='created'),'created','create response outcome is created');
select is(public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000001','KR-BIZ-9951000001','health','Health stipend','Monthly health support',null,'Employees only',date '2026-01-02','https://example.com/source?id=1')->>'claim_id',(select payload->>'claim_id' from claim_results where name='created'),'same canonical payload replays same claim');
select throws_ok($$select public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000001','KR-BIZ-9951000001','health','Changed','Monthly health support',null,'Employees only',date '2026-01-02','https://example.com/source?id=1')$$,'22023','client key reused with different payload','changed payload rejects');
reset role;
select ok((select title='Health stipend' and normalized_title='health stipend' and description='Monthly health support' and eligibility_text is null and normalized_eligibility='' and condition_text='Employees only' and revision=1 and status='submitted' and payload_fingerprint ~ '^[0-9a-f]{64}$' from public.benefit_claims where claim_id=((select payload->>'claim_id' from claim_results where name='created')::uuid)),'created claim stores canonical complete payload');
select is((select count(*)::integer from public.benefit_claim_events where claim_id=((select payload->>'claim_id' from claim_results where name='created')::uuid) and event_type='submitted'),1,'create replay emits one submitted event');
select is((select count(*)::integer from public.rate_limit_events where user_id='b5100000-0000-4000-8000-000000000001' and action='benefit_claim.create'),1,'create replay charges one rate slot');

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000002';
insert into claim_results values ('duplicate',public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000002','KR-BIZ-9951000001','health','health stipend','Different duplicate description',null,'Employees only',date '2026-02-02',null));
select is((select payload->>'outcome' from claim_results where name='duplicate'),'duplicate','exact duplicate returns duplicate outcome');
select is((select payload->>'claim_id' from claim_results where name='duplicate'),(select payload->>'claim_id' from claim_results where name='created'),'duplicate directs to existing claim');
select is(public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000002','KR-BIZ-9951000001','health','health stipend','Different duplicate description',null,'Employees only',date '2026-02-02',null)->>'outcome','duplicate','duplicate intent replays');
reset role;
select is((select count(*)::integer from public.benefit_claims),1,'duplicate creates no second claim or reaction');
select is((select count(*)::integer from public.benefit_claim_events where event_type='duplicate_directed'),1,'duplicate replay emits at most one safe event');
select is((select count(*)::integer from public.rate_limit_events where user_id='b5100000-0000-4000-8000-000000000002' and action='benefit_claim.create'),1,'non-replay duplicate intent charges one rate slot');

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000002';
insert into claim_results values
 ('near-prefix',public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000007','KR-BIZ-9951000001','health','Health stipend plus','Similar prefix claim',null,'Employees only',date '2026-02-03',null)),
 ('near-edit',public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000008','KR-BIZ-9951000001','health','Health stipned','Edit-distance-like claim',null,'Employees only',date '2026-02-04',null));
reset role;
select is((select jsonb_agg(payload->>'outcome' order by name) from claim_results where name in ('near-prefix','near-edit')),'["created", "created"]'::jsonb,'similar but non-equal normalized titles are both created');
select isnt((select payload->>'claim_id' from claim_results where name='near-prefix'),(select payload->>'claim_id' from claim_results where name='near-edit'),'near-title claims have distinct identities');
select is((select count(*)::integer from public.benefit_claims where claim_id in ((select (payload->>'claim_id')::uuid from claim_results where name='near-prefix'),(select (payload->>'claim_id')::uuid from claim_results where name='near-edit')) and status in ('submitted','community_confirmed','disputed')),2,'both near-title claims remain active');
select is((select count(distinct normalized_title)::integer from public.benefit_claims where claim_id in ((select (payload->>'claim_id')::uuid from claim_results where name='near-prefix'),(select (payload->>'claim_id')::uuid from claim_results where name='near-edit'))),2,'near-title fixtures normalize to distinct exact keys');

-- A late audit failure rolls back the claim and its rate charge atomically.
create function pg_temp.reject_claim_event() returns trigger language plpgsql as $$begin raise exception 'injected claim event failure'; end$$;
create trigger injected_claim_event_failure before insert on public.benefit_claim_events for each row execute function pg_temp.reject_claim_event();
set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000001';
select throws_like($$select public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000099','KR-BIZ-9951000001','leave','Rollback claim','Rollback description',null,null,date '2026-01-03',null)$$,'%injected claim event failure%','late event failure surfaces');
reset role;
drop trigger injected_claim_event_failure on public.benefit_claim_events;
select is((select count(*)::integer from public.benefit_claims where title='Rollback claim'),0,'late event failure rolls back claim');
select is((select count(*)::integer from public.rate_limit_events where user_id='b5100000-0000-4000-8000-000000000001' and action='benefit_claim.create'),1,'late event failure rolls back rate charge');

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000001';
insert into claim_results values ('mine',public.list_my_benefit_claims_v1(20));
select is((select jsonb_object_agg(key,true order by key) from claim_results,jsonb_object_keys(payload) key where name='mine'),'{"has_more":true,"items":true,"next_cursor":true}'::jsonb,'owner list envelope exact keys');
select is((select jsonb_object_agg(key,true order by key) from claim_results,jsonb_object_keys(payload->'items'->0) key where name='mine'),'{"category_id":true,"claim_id":true,"company_id":true,"company_name":true,"condition_text":true,"created_at":true,"description":true,"eligibility_text":true,"observed_on":true,"revision":true,"status":true,"title":true,"updated_at":true,"withdrawn_at":true}'::jsonb,'owner item exact safe keys');
select ok((select payload::text not like '%fingerprint%' and payload::text not like '%client_key%' and payload::text not like '%source_url%' and payload::text not like '%submitter%' from claim_results where name='mine'),'owner list omits internal identity and provenance');
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000002';
select throws_ok(format('select public.withdraw_benefit_claim_v1(%L,%L,''submitted'',1)','b5200000-0000-4000-8000-000000000003',(select payload->>'claim_id' from claim_results where name='created')),'42501','claim submitter required','non-owner cannot withdraw');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000001';
select throws_ok(format('select public.withdraw_benefit_claim_v1(%L,%L,''submitted'',2)','b5200000-0000-4000-8000-000000000004',(select payload->>'claim_id' from claim_results where name='created')),'40001','benefit claim state changed','withdraw enforces revision CAS');
insert into claim_results values ('withdrawn',public.withdraw_benefit_claim_v1('b5200000-0000-4000-8000-000000000005',((select payload->>'claim_id' from claim_results where name='created')::uuid),'submitted',1));
select is(public.withdraw_benefit_claim_v1('b5200000-0000-4000-8000-000000000005',((select payload->>'claim_id' from claim_results where name='created')::uuid),'submitted',1)->>'claim_id',(select payload->>'claim_id' from claim_results where name='created'),'withdraw intent replays after transition');
select throws_ok(format('select public.withdraw_benefit_claim_v1(%L,%L,''submitted'',2)','b5200000-0000-4000-8000-000000000005',(select payload->>'claim_id' from claim_results where name='duplicate')),'22023','client key reused with different payload','withdraw key fingerprint is immutable');
reset role;
select ok((select status='withdrawn' and revision=2 and withdrawn_at is not null and updated_at=withdrawn_at from public.benefit_claims where claim_id=((select payload->>'claim_id' from claim_results where name='created')::uuid)),'withdraw transitions once with chronology');
select is((select count(*)::integer from public.benefit_claim_events where claim_id=((select payload->>'claim_id' from claim_results where name='created')::uuid) and event_type='withdrawn'),1,'withdraw replay emits one event');
select is((select count(*)::integer from public.rate_limit_events where user_id='b5100000-0000-4000-8000-000000000001' and action='benefit_claim.withdraw'),1,'withdraw replay charges one rate slot');

-- Hidden and withdrawn claims relinquish duplicate authority; active statuses retain it.
set local role authenticated;
set local request.jwt.claim.sub='b5100000-0000-4000-8000-000000000002';
insert into claim_results values ('recreated',public.create_benefit_claim_v1('b5200000-0000-4000-8000-000000000006','KR-BIZ-9951000001','health','HEALTH STIPEND','Replacement after withdrawal',null,'Employees only',date '2026-03-02',null));
reset role;
select is((select payload->>'outcome' from claim_results where name='recreated'),'created','withdrawn claim no longer owns exact duplicate key');

select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.get_benefit_company_v2('KR-BIZ-9951000001')) key),'{"claims":true,"company":true,"publications":true}'::jsonb,'public v2 preserves v1 keys and adds claims');
select is(public.get_benefit_company_v2('KR-BIZ-9951000001')->'company',public.get_benefit_company_v1('KR-BIZ-9951000001')->'company','public v2 preserves company projection exactly');
select is(public.get_benefit_company_v2('KR-BIZ-9951000001')->'publications',public.get_benefit_company_v1('KR-BIZ-9951000001')->'publications','public v2 preserves publication projection and cap semantics');
select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims'->0) key),'{"category_id":true,"category_name":true,"claim_id":true,"condition_text":true,"confirm_count":true,"description":true,"dispute_count":true,"eligibility_text":true,"last_confirmation_at":true,"nickname":true,"observed_on":true,"status_code":true,"status_label":true,"submitted_at":true,"title":true}'::jsonb,'public claim has exact safe future-compatible keys');
select ok((public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims'->0)::text not like '%source_url%' and (public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims'->0)::text not like '%submitter%' and (public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims'->0)::text not like '%fingerprint%' and (public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims'->0)::text not like '%client_key%','public claim leaks no internal identity or provenance');
select ok((select bool_and(item->>'status_code'='submitted' and item->>'status_label'='제보됨' and item->>'nickname'='제보자 둘' and (item->>'confirm_count')::integer=0 and (item->>'dispute_count')::integer=0 and item->'last_confirmation_at'='null'::jsonb) from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims') item),'public status label, nickname and reaction placeholders are exact');
select is((select count(*)::integer from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims') item where item->>'status_code' in ('hidden','withdrawn')),0,'hidden and withdrawn claims are not public');
select is(public.get_benefit_company_v2('KR-BIZ-9951000002'),'null'::jsonb,'non-searchable company is not disclosed by v2');

delete from public.user_roles where user_id='b5100000-0000-4000-8000-000000000002';
delete from auth.identities where user_id='b5100000-0000-4000-8000-000000000002';
delete from public.profiles where id='b5100000-0000-4000-8000-000000000002';
select is((select item->>'nickname' from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9951000001')->'claims') item limit 1),'탈퇴한 사용자','profile deletion preserves claim with public fallback nickname');
select ok((select actor_snapshot='b5100000-0000-4000-8000-000000000002'::uuid from public.benefit_claim_events where event_type='submitted' and claim_id=((select payload->>'claim_id' from claim_results where name='recreated')::uuid)),'profile deletion cannot mutate event actor snapshot');

insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values ('KR-BIZ-9951000003','registered_business','Overflow Claim Company','overflow claim company',true,'claim-test');
insert into public.benefit_claims(company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on,status)
select 'KR-BIZ-9951000003',extensions.gen_random_uuid(),repeat('c',64),'health','Overflow '||lpad(g::text,3,'0'),'overflow '||lpad(g::text,3,'0'),'Bounded overflow fixture','',date '2026-01-01','submitted' from generate_series(1,201) g;
select throws_ok($$select public.get_benefit_company_v2('KR-BIZ-9951000003')$$,'P0001','benefit claim limit exceeded','public v2 fails closed rather than silently truncating 201 visible claims');

select throws_ok($$update public.benefit_claim_events set metadata='{"tampered":true}'$$,'23514','benefit claim events are append-only','event update rejected');
select throws_ok($$delete from public.benefit_claim_events$$,'23514','benefit claim events are append-only','event delete rejected');
select throws_ok($$truncate public.benefit_claim_events$$,'23514','benefit claim events are append-only','event truncate rejected');

select * from finish();
rollback;
