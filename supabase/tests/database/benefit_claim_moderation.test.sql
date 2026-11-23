begin;
select no_plan();

select has_table('public','benefit_claim_official_reviews','private official evidence ledger exists');
select has_table('public','benefit_claim_moderation_requests','moderation idempotency ledger exists');
select has_table('public','benefit_claim_merges','immutable merge ledger exists');
select has_function('public','list_benefit_claim_moderation_queue_v1',array['text','integer','timestamptz','uuid'],'bounded moderation queue exists');
select has_function('public','list_benefit_claim_audit_v1',array['uuid','integer','timestamptz','text','uuid'],'bounded audit exists');
select has_function('public','moderate_benefit_claim_v1',array['uuid','uuid','bigint','text','text','uuid','text','text','date','text'],'moderation mutation exists');
select has_function('public','officially_verify_benefit_claim_v1',array['uuid','text','bigint','text','text','text','text','text','text','date','text','uuid'],'official verification mutation exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='benefit_claims' and column_name='official_publication_id'),'claim has separate official authority pointer');
select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_claim_official_reviews'::regclass,'public.benefit_claim_moderation_requests'::regclass,'public.benefit_claim_merges'::regclass])),'private ledgers enable RLS');
select ok((select bool_and(not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class where oid=any(array['public.benefit_claim_official_reviews'::regclass,'public.benefit_claim_moderation_requests'::regclass,'public.benefit_claim_merges'::regclass])),'browser roles cannot read private evidence or raw ledgers');
select ok(has_function_privilege('authenticated','public.list_benefit_claim_moderation_queue_v1(text,integer,timestamptz,uuid)','EXECUTE') and not has_function_privilege('anon','public.list_benefit_claim_moderation_queue_v1(text,integer,timestamptz,uuid)','EXECUTE'),'queue is authenticated only');
select ok(has_function_privilege('authenticated','public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid)','EXECUTE'),'official mutation is authenticated only');

insert into auth.users(id,aud,role,email) values
 ('b8100000-0000-4000-8000-000000000001','authenticated','authenticated','claim-admin@example.test'),
 ('b8100000-0000-4000-8000-000000000002','authenticated','authenticated','claim-member@example.test'),
 ('b8100000-0000-4000-8000-000000000003','authenticated','authenticated','claim-forged@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('b8100000-0000-4000-8000-000000000001',99810001,'claim-admin'),
 ('b8100000-0000-4000-8000-000000000002',99810002,'claim-member'),
 ('b8100000-0000-4000-8000-000000000003',99810003,'claim-forged');
insert into public.user_roles values ('b8100000-0000-4000-8000-000000000001','admin'),('b8100000-0000-4000-8000-000000000002','member'),('b8100000-0000-4000-8000-000000000003','member');
insert into auth.identities(provider_id,user_id,identity_data,provider) values ('claim-admin','b8100000-0000-4000-8000-000000000001','{}','google'),('claim-member','b8100000-0000-4000-8000-000000000002','{}','google'),('claim-forged','b8100000-0000-4000-8000-000000000003','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values ('KR-BIZ-9981000001','registered_business','Moderation Co','moderation co',true,'moderation-test');
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on) values ('b8200000-0000-4000-8000-000000000001','KR-BIZ-9981000001','b8100000-0000-4000-8000-000000000003',gen_random_uuid(),repeat('8',64),'health','Health support','health support','Health support description','',date '2026-01-01');

set local role authenticated;
set local request.jwt.claim.sub='b8100000-0000-4000-8000-000000000003';
set local request.jwt.claims='{"sub":"b8100000-0000-4000-8000-000000000003","app_metadata":{"role":"admin"}}';
select throws_ok($$select public.list_benefit_claim_moderation_queue_v1()$$,'42501','admin required','forged JWT admin metadata is ignored');
set local request.jwt.claim.sub='b8100000-0000-4000-8000-000000000001';
select throws_ok($$select public.officially_verify_benefit_claim_v1('b8200000-0000-4000-8000-000000000001','submitted',1,'Official title','Official description',null,null,'official_website',null,date '2026-01-01','review note',gen_random_uuid())$$,'22023','invalid official evidence','evidence-less verification is rejected');
select lives_ok($$select public.officially_verify_benefit_claim_v1('b8200000-0000-4000-8000-000000000001','submitted',1,'Official title','Official description',null,null,'official_website','https://example.com/policy',date '2026-01-01','review note','b8300000-0000-4000-8000-000000000001')$$,'zero-confirm official verification succeeds with evidence');
reset role;
select ok((select c.status='submitted' and c.active_publication_id is null and c.official_publication_id=p.publication_id and p.trust_tier='official_verified' and p.status='active' from public.benefit_claims c join public.benefit_publications p on p.publication_id=c.official_publication_id where c.claim_id='b8200000-0000-4000-8000-000000000001'),'official authority is separate and count-independent');
select is((select count(*)::integer from public.benefit_claim_official_reviews where claim_id='b8200000-0000-4000-8000-000000000001'),1,'official evidence review is append-only ledgered once');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claim_reactions_write_enabled';
set local role authenticated; set local request.jwt.claim.sub='b8100000-0000-4000-8000-000000000002';
select lives_ok($$select public.set_benefit_claim_reaction_v1('b8200000-0000-4000-8000-000000000001','dispute','b8300000-0000-4000-8000-000000000002')$$,'dispute after official verification succeeds');
reset role;
select ok((select c.status='disputed' and c.active_publication_id is null and p.status='active' and p.trust_tier='official_verified' from public.benefit_claims c join public.benefit_publications p on p.publication_id=c.official_publication_id where c.claim_id='b8200000-0000-4000-8000-000000000001'),'dispute flags claim without retiring official authority');
set local role authenticated; set local request.jwt.claim.sub='b8100000-0000-4000-8000-000000000001';
select lives_ok($$select public.moderate_benefit_claim_v1('b8300000-0000-4000-8000-000000000003','b8200000-0000-4000-8000-000000000001',3,'disputed','hide',null,'policy concern')$$,'hide leaves official authority independent');
reset role;
select ok((select c.status='hidden' and p.status='active' from public.benefit_claims c join public.benefit_publications p on p.publication_id=c.official_publication_id where c.claim_id='b8200000-0000-4000-8000-000000000001'),'hidden claim retains active official publication');

select * from finish();
rollback;
