begin;
select no_plan();

select has_table('public','benefit_claim_reactions','claim reactions table exists');
select has_table('public','benefit_claim_reaction_requests','durable reaction request audit exists');
select has_function('public','set_benefit_claim_reaction_v1',array['uuid','text','uuid'],'reaction RPC exists');
select ok((select count(*)=0 from pg_constraint where conrelid='public.benefit_claims'::regclass and conname='benefit_claims_task5_no_active_publication_check'),'Task 5 phase constraint is explicitly removed');
select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_claim_reactions'::regclass,'public.benefit_claim_reaction_requests'::regclass])),'reaction tables enable RLS');
select ok((select bool_and(not has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class where oid=any(array['public.benefit_claim_reactions'::regclass,'public.benefit_claim_reaction_requests'::regclass])),'browser and service roles have no raw reaction/audit rights');
select ok((select count(*)=0 from pg_constraint where conrelid='public.benefit_claim_reactions'::regclass and contype='f' and pg_get_constraintdef(oid) like '%user_id%'),'reaction actor UUID survives profile deletion without mutable FK');
select ok(has_function_privilege('authenticated','public.set_benefit_claim_reaction_v1(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.set_benefit_claim_reaction_v1(uuid,text,uuid)','EXECUTE'),'reaction RPC is authenticated only');

insert into auth.users(id,aud,role,email) values
 ('b6100000-0000-4000-8000-000000000001','authenticated','authenticated','reaction-owner@example.test'),
 ('b6100000-0000-4000-8000-000000000002','authenticated','authenticated','reaction-two@example.test'),
 ('b6100000-0000-4000-8000-000000000003','authenticated','authenticated','reaction-three@example.test'),
 ('b6100000-0000-4000-8000-000000000004','authenticated','authenticated','reaction-four@example.test'),
 ('b6100000-0000-4000-8000-000000000005','authenticated','authenticated','reaction-nongoogle@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('b6100000-0000-4000-8000-000000000001',99610001,'reaction-owner','Owner'),
 ('b6100000-0000-4000-8000-000000000002',99610002,'reaction-two','Two'),
 ('b6100000-0000-4000-8000-000000000003',99610003,'reaction-three','Three'),
 ('b6100000-0000-4000-8000-000000000004',99610004,'reaction-four','Four'),
 ('b6100000-0000-4000-8000-000000000005',99610005,'reaction-nongoogle','No Google');
insert into public.user_roles(user_id,role) select id,'member' from public.profiles where login like 'reaction-%';
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('reaction-owner','b6100000-0000-4000-8000-000000000001','{}','google'),
 ('reaction-two','b6100000-0000-4000-8000-000000000002','{}','google'),
 ('reaction-three','b6100000-0000-4000-8000-000000000003','{}','google'),
 ('reaction-four','b6100000-0000-4000-8000-000000000004','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition)
values ('KR-BIZ-9961000001','registered_business','Reaction Company','reaction company',true,'reaction-test');
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
values
 ('b6200000-0000-4000-8000-000000000001','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('a',64),'health','Health reaction','health reaction','Health description','',date '2026-01-01'),
 ('b6200000-0000-4000-8000-000000000002','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('b',64),'leave','Hidden reaction','hidden reaction','Hidden description','',date '2026-01-01'),
 ('b6200000-0000-4000-8000-000000000003','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('c',64),'remote','Withdrawn reaction','withdrawn reaction','Withdrawn description','',date '2026-01-01'),
 ('b6200000-0000-4000-8000-000000000004','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('e',64),'growth','Self reaction','self reaction','Self reaction description','',date '2026-01-01');
update public.benefit_claims set status='hidden',revision=2,updated_at=clock_timestamp() where claim_id='b6200000-0000-4000-8000-000000000002';
update public.benefit_claims set status='withdrawn',revision=2,updated_at=statement_timestamp(),withdrawn_at=statement_timestamp() where claim_id='b6200000-0000-4000-8000-000000000003';

set local role anon;
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm',gen_random_uuid())$$,'42501','permission denied for function set_benefit_claim_reaction_v1','anonymous mutation rejected at the grant boundary');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000005';
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm',gen_random_uuid())$$,'42501','trusted Google identity required','non-Google mutation rejected');
reset role;

update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claim_reactions_write_enabled';
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000001';
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000004','confirm',gen_random_uuid())$$,'42501','claim submitter cannot confirm own claim','self confirmation rejected');
select lives_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000004','dispute','b6300000-0000-4000-8000-000000000001')$$,'submitter may dispute own claim');
select lives_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000004',null,'b6300000-0000-4000-8000-000000000002')$$,'submitter may clear own dispute');
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000002','dispute',gen_random_uuid())$$,'22023','benefit claim is not visible','hidden claim rejected');
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000003','dispute',gen_random_uuid())$$,'22023','benefit claim is not visible','withdrawn claim rejected');
reset role;

create temporary table reaction_results(name text primary key,payload jsonb);
grant select,insert on reaction_results to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000002';
insert into reaction_results values ('first',public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000010'));
insert into reaction_results values ('repeat',public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000011'));
select is(public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000010'),(select payload from reaction_results where name='first'),'same client key replays exact response');
select throws_ok($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','dispute','b6300000-0000-4000-8000-000000000010')$$,'22023','client key reused with different payload','changed intent rejects reused key');
reset role;
select is((select payload->>'outcome' from reaction_results where name='repeat'),'unchanged','same desired reaction is an audited real no-op');
select is((select jsonb_object_agg(key,true order by key) from reaction_results,jsonb_object_keys(payload) key where name='first'),'{"active_publication_id":true,"claim_id":true,"confirm_count":true,"dispute_count":true,"outcome":true,"reaction":true,"revision":true,"status":true}'::jsonb,'reaction response keys are exact');
select is((select count(*)::integer from public.benefit_claim_reactions where claim_id='b6200000-0000-4000-8000-000000000001' and reaction='confirm'),1,'repeat does not duplicate reaction');
select is((select count(*)::integer from public.rate_limit_events where user_id='b6100000-0000-4000-8000-000000000002' and action='benefit_claim.react'),2,'replay is free but distinct no-op request is charged');
select is((select pg_catalog.jsonb_build_object('window_seconds',window_seconds,'max_requests',max_requests,'is_enabled',is_enabled) from public.rate_limit_rules where action='benefit_claim.react'),'{"is_enabled": true, "max_requests": 60, "window_seconds": 3600}'::jsonb,'reaction rate rule has the exact configured window and limit');

set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000003';
select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000020');
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000004';
insert into reaction_results values ('promoted',public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000030'));
reset role;
select ok((select status='community_confirmed' and revision=2 and active_publication_id is not null from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001'),'third confirmation promotes claim once');
select is((select count(*)::integer from public.benefit_publications where provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001' and trust_tier='community_reviewed' and status='active'),1,'promotion creates one active community publication');
select is((select count(*)::integer from public.benefit_claim_events where claim_id='b6200000-0000-4000-8000-000000000001' and event_type='promoted'),1,'promotion emits one transition event');

set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000002';
insert into reaction_results values ('disputed',public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','dispute','b6300000-0000-4000-8000-000000000040'));
reset role;
select ok((select status='disputed' and revision=3 and active_publication_id is null from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001'),'first dispute demotes and clears active pointer');
select is((select count(*)::integer from public.benefit_publications where provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001' and status='active'),0,'demotion retires community publication');

set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000002';
insert into reaction_results values ('repromoted',public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001','confirm','b6300000-0000-4000-8000-000000000041'));
reset role;
select ok((select status='community_confirmed' and revision=4 and active_publication_id is not null from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001'),'dispute removal by change repromotes');
select is((select count(*)::integer from public.benefit_publications where provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001'),2,'repromotion creates a new publication row');
select ok((select bool_and(p.trust_tier='community_reviewed' and p.source_type='claim_reaction') from public.benefit_publications p where p.provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001'),'claim lineage never creates official publication');
select is((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'dedupe_key',p.dedupe_key,'provenance',p.provenance,'revision',p.revision,
  'supersedes_publication_id',p.supersedes_publication_id,'status',p.status,
  'is_pointer',p.publication_id=c.active_publication_id
) order by p.revision)
from public.benefit_publications p cross join public.benefit_claims c
where c.claim_id='b6200000-0000-4000-8000-000000000001'
  and p.provenance->>'claim_id'=c.claim_id::text),
pg_catalog.jsonb_build_array(
  pg_catalog.jsonb_build_object('dedupe_key','claim-b6200000-0000-4000-8000-000000000001','provenance',pg_catalog.jsonb_build_object('claim_id','b6200000-0000-4000-8000-000000000001'),'revision',1,'supersedes_publication_id',null,'status','withdrawn','is_pointer',false),
  pg_catalog.jsonb_build_object('dedupe_key','claim-b6200000-0000-4000-8000-000000000001','provenance',pg_catalog.jsonb_build_object('claim_id','b6200000-0000-4000-8000-000000000001'),'revision',2,'supersedes_publication_id',(select publication_id from public.benefit_publications where provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001' and revision=1),'status','active','is_pointer',true)
),'claim publication lineage has exact private binding, revisions, predecessor, status, and pointer');
select is((select count(*)::integer from public.benefit_publications p join public.benefit_claims c on c.active_publication_id=p.publication_id where c.claim_id='b6200000-0000-4000-8000-000000000001' and p.status='active'),1,'only the exact pointed successor is active');

-- Publication-side enforcement must inspect both OLD and NEW rows and reject any
-- mutation that leaves a claim pointer inconsistent at the constraint boundary.
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set status='withdrawn' where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim active publication must be its active community reaction publication','direct active publication retirement is rejected while pointed');
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set source_type='user_submission' where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim publication must preserve its immutable claim binding','changing a pointed publication away from claim_reaction is rejected via OLD-row lookup');
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set provenance=pg_catalog.jsonb_build_object('claim_id','b6200000-0000-4000-8000-000000000004') where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim publication must preserve its immutable claim binding','changing pointed publication provenance is rejected');
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set category_id='leave' where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim publication must preserve its immutable claim binding','changing pointed publication category is rejected');
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set dedupe_key='claim-wrong' where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim publication must preserve its immutable claim binding','changing pointed publication dedupe key is rejected');
select throws_ok($lineage$do $test$begin
  update public.benefit_claims set active_publication_id=(select publication_id from public.benefit_publications where provenance->>'claim_id'='b6200000-0000-4000-8000-000000000001' and revision=1),revision=revision+1,updated_at=pg_catalog.clock_timestamp() where claim_id='b6200000-0000-4000-8000-000000000001';
  set constraints all immediate;
end$test$$lineage$,'23514','claim active publication must be its active community reaction publication','pointer-only mismatch is rejected');

insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition)
values ('KR-BIZ-9961000002','registered_business','Other Reaction Company','other reaction company',true,'reaction-test');
select throws_ok($lineage$do $test$begin
  update public.benefit_publications set company_id='KR-BIZ-9961000002' where publication_id=(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001');
  set constraints all immediate;
end$test$$lineage$,'23514','claim publication must preserve its immutable claim binding','changing pointed publication company is rejected');

-- The legacy submission review RPC cannot take over claim-owned publication lineage.
update public.user_roles set role='admin' where user_id='b6100000-0000-4000-8000-000000000004';
insert into public.benefit_submissions(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text,status,admin_response,reviewer_id,reviewed_at,created_at,updated_at)
values ('b6500000-0000-4000-8000-000000000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('9',64),'KR-BIZ-9961000001','health','Takeover fixture','reviewing','Reviewing','b6100000-0000-4000-8000-000000000004',statement_timestamp(),statement_timestamp(),statement_timestamp());
insert into reaction_results values ('takeover-publication',pg_catalog.jsonb_build_object('publication_id',(select active_publication_id from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001')));
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000004';
select throws_ok($lineage$do $test$begin
  perform public.review_benefit_submission_v1('b6500000-0000-4000-8000-000000000001','reviewing','approve','Approved','b6500000-0000-4000-8000-000000000002','Takeover','Must fail atomically',null,null,(select (payload->>'publication_id')::uuid from reaction_results where name='takeover-publication'));
  set constraints all immediate;
end$test$$lineage$,'23514','claim active publication must be its active community reaction publication','submission approval cannot take over a claim publication');
reset role;
select is((select status||':'||coalesce(publication_id::text,'null') from public.benefit_submissions where id='b6500000-0000-4000-8000-000000000001'),'reviewing:null','failed takeover leaves submission unchanged');
select ok((select c.status='community_confirmed' and p.status='active' and c.active_publication_id=p.publication_id from public.benefit_claims c join public.benefit_publications p on p.publication_id=c.active_publication_id where c.claim_id='b6200000-0000-4000-8000-000000000001'),'failed takeover leaves claim status, pointer, and old publication unchanged');

-- Clearing one confirmation below threshold demotes even without a dispute.
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000004';
select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000001',null,'b6300000-0000-4000-8000-000000000050');
reset role;
select ok((select status='submitted' and active_publication_id is null and revision=5 from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000001'),'confirmation clear below threshold demotes');

select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.get_benefit_company_v2('KR-BIZ-9961000001')) key),'{"claims":true,"company":true,"publications":true}'::jsonb,'v2 preserves Task 5 top-level keys');
select is(public.get_benefit_company_v2('KR-BIZ-9961000001')->'company',public.get_benefit_company_v1('KR-BIZ-9961000001')->'company','v2 preserves company projection');
select is((select (item->>'confirm_count')::integer from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9961000001')->'claims') item where item->>'claim_id'='b6200000-0000-4000-8000-000000000001'),2,'public count comes from current rows');
select ok((select item->>'last_confirmation_at' is not null from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9961000001')->'claims') item where item->>'claim_id'='b6200000-0000-4000-8000-000000000001'),'public last confirmation comes from current confirms');
select ok(public.get_benefit_company_v2('KR-BIZ-9961000001')::text not like '%b6100000%' and public.get_benefit_company_v2('KR-BIZ-9961000001')::text not like '%client_key%' and public.get_benefit_company_v2('KR-BIZ-9961000001')::text not like '%provenance%','public projection leaks no actor, client key, or provenance');

-- An unrelated official publication is never retired by claim reactions or withdrawal.
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type)
values ('b6400000-0000-4000-8000-000000000001','KR-BIZ-9961000001','health','Official fixture','Official remains active','official_verified','active','official-reaction-fixture',1,'official');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claims_write_enabled';
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000001';
select public.withdraw_benefit_claim_v1('b6300000-0000-4000-8000-000000000060','b6200000-0000-4000-8000-000000000001','submitted',5);
reset role;
select is((select status from public.benefit_publications where publication_id='b6400000-0000-4000-8000-000000000001'),'active','official publication remains active');

-- Late publication failure rolls back the reaction, claim, request, rate event and transition event.
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
values ('b6200000-0000-4000-8000-000000000010','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('d',64),'family','Rollback reaction','rollback reaction','Rollback description','',date '2026-01-01');
insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values
 ('b6200000-0000-4000-8000-000000000010','b6100000-0000-4000-8000-000000000002','confirm'),
 ('b6200000-0000-4000-8000-000000000010','b6100000-0000-4000-8000-000000000003','confirm');
create function pg_temp.reject_claim_publication() returns trigger language plpgsql as $$begin if new.source_type='claim_reaction' then raise exception 'injected publication failure'; end if; return new; end$$;
create trigger injected_claim_publication_failure before insert on public.benefit_publications for each row execute function pg_temp.reject_claim_publication();
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000004';
select throws_like($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000010','confirm','b6300000-0000-4000-8000-000000000099')$$,'%injected publication failure%','late publication failure surfaces');
reset role;
drop trigger injected_claim_publication_failure on public.benefit_publications;
select is((select count(*)::integer from public.benefit_claim_reactions where claim_id='b6200000-0000-4000-8000-000000000010'),2,'late failure rolls back third reaction');
select ok((select status='submitted' and revision=1 from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000010'),'late failure rolls back status');
select is((select count(*)::integer from public.benefit_claim_reaction_requests where client_key='b6300000-0000-4000-8000-000000000099'),0,'late failure rolls back request audit');
select is((select count(*)::integer from public.rate_limit_events where idempotency_key='b6300000-0000-4000-8000-000000000099'),0,'late failure rolls back rate charge');

-- Event and request-audit failures are also late atomic rollback boundaries.
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
values
 ('b6200000-0000-4000-8000-000000000011','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('f',64),'meals','Event rollback','event rollback','Event rollback description','',date '2026-01-01'),
 ('b6200000-0000-4000-8000-000000000012','KR-BIZ-9961000001','b6100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('0',64),'inclusion','Request rollback','request rollback','Request rollback description','',date '2026-01-01');
create function pg_temp.reject_reaction_event() returns trigger language plpgsql as $$begin if new.claim_id='b6200000-0000-4000-8000-000000000011' then raise exception 'injected reaction event failure'; end if; return new; end$$;
create trigger injected_reaction_event_failure before insert on public.benefit_claim_events for each row execute function pg_temp.reject_reaction_event();
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000002';
select throws_like($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000011','dispute','b6300000-0000-4000-8000-000000000097')$$,'%injected reaction event failure%','late transition event failure surfaces');
reset role;
drop trigger injected_reaction_event_failure on public.benefit_claim_events;
select ok((select status='submitted' and revision=1 from public.benefit_claims where claim_id='b6200000-0000-4000-8000-000000000011') and not exists(select 1 from public.benefit_claim_reactions where claim_id='b6200000-0000-4000-8000-000000000011'),'event failure rolls back reaction and state');
select is((select count(*)::integer from public.rate_limit_events where idempotency_key='b6300000-0000-4000-8000-000000000097'),0,'event failure rolls back rate charge');

create function pg_temp.reject_reaction_request() returns trigger language plpgsql as $$begin if new.client_key='b6300000-0000-4000-8000-000000000098' then raise exception 'injected reaction request failure'; end if; return new; end$$;
create trigger injected_reaction_request_failure before insert on public.benefit_claim_reaction_requests for each row execute function pg_temp.reject_reaction_request();
set local role authenticated;
set local request.jwt.claim.sub='b6100000-0000-4000-8000-000000000002';
select throws_like($$select public.set_benefit_claim_reaction_v1('b6200000-0000-4000-8000-000000000012','confirm','b6300000-0000-4000-8000-000000000098')$$,'%injected reaction request failure%','late request-audit failure surfaces');
reset role;
drop trigger injected_reaction_request_failure on public.benefit_claim_reaction_requests;
select is((select count(*)::integer from public.benefit_claim_reactions where claim_id='b6200000-0000-4000-8000-000000000012'),0,'request failure rolls back reaction');
select is((select count(*)::integer from public.rate_limit_events where idempotency_key='b6300000-0000-4000-8000-000000000098'),0,'request failure rolls back rate charge');

-- Profile deletion cannot erase a current reaction or alter its public count.
insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values ('b6200000-0000-4000-8000-000000000012','b6100000-0000-4000-8000-000000000003','confirm');
delete from public.user_roles where user_id='b6100000-0000-4000-8000-000000000003';
delete from auth.identities where user_id='b6100000-0000-4000-8000-000000000003';
delete from public.profiles where id='b6100000-0000-4000-8000-000000000003';
select ok(exists(select 1 from public.benefit_claim_reactions where claim_id='b6200000-0000-4000-8000-000000000012' and user_id='b6100000-0000-4000-8000-000000000003' and reaction='confirm'),'profile deletion preserves immutable reaction actor UUID');
select is((select (item->>'confirm_count')::integer from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-9961000001')->'claims') item where item->>'claim_id'='b6200000-0000-4000-8000-000000000012'),1,'profile deletion leaves public reaction counts consistent');

select throws_ok($$update public.benefit_claim_reaction_requests set response='{}'$$,'23514','benefit claim reaction requests are append-only','request update rejected');
select throws_ok($$delete from public.benefit_claim_reaction_requests$$,'23514','benefit claim reaction requests are append-only','request delete rejected');
select throws_ok($$truncate public.benefit_claim_reaction_requests$$,'23514','benefit claim reaction requests are append-only','request truncate rejected');

select * from finish();
rollback;
