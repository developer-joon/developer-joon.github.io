begin;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('e1000000-0000-0000-0000-000000000001','authenticated','authenticated','submission-owner@example.test'),
 ('e1000000-0000-0000-0000-000000000002','authenticated','authenticated','submission-other@example.test'),
 ('e1000000-0000-0000-0000-000000000003','authenticated','authenticated','submission-admin@example.test'),
 ('e1000000-0000-0000-0000-000000000004','authenticated','authenticated','submission-forged@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('e1000000-0000-0000-0000-000000000001',99801,'submission-owner','Submission Owner'),
 ('e1000000-0000-0000-0000-000000000002',99802,'submission-other','Submission Other'),
 ('e1000000-0000-0000-0000-000000000003',99803,'submission-admin','Submission Admin'),
 ('e1000000-0000-0000-0000-000000000004',99804,'submission-forged','Submission Forged');
insert into public.user_roles(user_id,role) values
 ('e1000000-0000-0000-0000-000000000001','member'),
 ('e1000000-0000-0000-0000-000000000002','member'),
 ('e1000000-0000-0000-0000-000000000003','admin'),
 ('e1000000-0000-0000-0000-000000000004','member');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition)
values ('KR-BIZ-9980000001','registered_business','Submission Company','submission company','test');

select has_table('public','benefit_submissions','benefit submissions table exists');
select has_table('public','benefit_submission_events','append-only submission events table exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_submissions'::regclass,'public.benefit_submission_events'::regclass])),'submission tables enable RLS');
select ok((select bool_and(not has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class where oid=any(array['public.benefit_submissions'::regclass,'public.benefit_submission_events'::regclass])),'all API roles lack direct table rights');
select has_function('public','create_benefit_submission_v1',array['uuid','text','text','text','text','text','text'],'create submission RPC exists');
select has_function('public','list_my_benefit_submissions_v1',array['integer','timestamp with time zone','uuid'],'owner list RPC exists');
select has_function('public','list_benefit_submission_queue_v1',array['text','integer','timestamp with time zone','uuid'],'admin queue RPC exists');
select has_function('public','list_benefit_submission_audit_v1',array['uuid','integer','timestamp with time zone','uuid'],'admin audit RPC exists');
select has_function('public','review_benefit_submission_v1',array['uuid','text','text','text','uuid','text','text','text','text','uuid'],'review RPC exists');
select has_function('private','canonical_benefit_publication_title',array['text'],'private canonical public-title function exists');
select ok((select p.provolatile='i' and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres' from pg_proc p where p.oid='private.canonical_benefit_publication_title(text)'::regprocedure),'canonical public-title function is immutable, fixed-path, and postgres-owned');
select ok(not has_function_privilege('public','private.canonical_benefit_publication_title(text)','EXECUTE') and not has_function_privilege('anon','private.canonical_benefit_publication_title(text)','EXECUTE') and not has_function_privilege('authenticated','private.canonical_benefit_publication_title(text)','EXECUTE') and not has_function_privilege('service_role','private.canonical_benefit_publication_title(text)','EXECUTE'),'canonical public-title function is private');
select is(private.canonical_benefit_publication_title(E'\t Health\r\n  Plan \v'),'Health Plan','canonical public-title function normalizes only enumerated ASCII whitespace');
select is(private.canonical_benefit_publication_title('Health'||chr(160)||'  Plan'),'Health'||chr(160)||' Plan','canonical public-title function preserves non-ASCII whitespace');
select throws_ok($$select private.canonical_benefit_publication_title(repeat('가',201))$$,'22023','invalid public title','canonical public title length uses Unicode characters');
select throws_ok($$insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type) values ('KR-BIZ-9980000001','health','Not  canonical','Description','community_reviewed','withdrawn','invalid-title-fixture',1,'test')$$,'23514','new row for relation "benefit_publications" violates check constraint "benefit_publications_title_check"','publication table rejects noncanonical titles from every writer');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array[
 'public.create_benefit_submission_v1(uuid,text,text,text,text,text,text)'::regprocedure,
 'public.list_my_benefit_submissions_v1(integer,timestamptz,uuid)'::regprocedure,
 'public.list_benefit_submission_queue_v1(text,integer,timestamptz,uuid)'::regprocedure,
 'public.list_benefit_submission_audit_v1(uuid,integer,timestamptz,uuid)'::regprocedure,
 'public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid)'::regprocedure
])),'all submission RPCs are fixed-owner SECURITY DEFINER with empty search path');
select ok(has_function_privilege('authenticated','public.create_benefit_submission_v1(uuid,text,text,text,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.create_benefit_submission_v1(uuid,text,text,text,text,text,text)','EXECUTE'),'create is authenticated only');
select is((select max_requests from public.rate_limit_rules where action='benefit_submission.create' and window_seconds=3600 and is_enabled),5,'create rate limit is installed');
select is((select max_requests from public.rate_limit_rules where action='benefit_submission.review' and window_seconds=3600 and is_enabled),100,'review rate limit is installed');

set local role anon;
select throws_like($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,null)$$,'%permission denied%','anonymous create is denied');
reset role;
set local role authenticated;
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,null)$$,'42501','authentication required','missing authenticated identity is denied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
create temporary table submission_results(name text primary key,payload jsonb);
insert into submission_results values ('created',public.create_benefit_submission_v1(
 'e2000000-0000-0000-0000-000000000001',' KR-BIZ-9980000001 ',' health ',' Health benefit ',null,' Employees only ',null));
reset role;
insert into public.benefit_submissions(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text) values
 ('e2100000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002',repeat('b',64),'KR-BIZ-9980000001','growth','Blank title fixture'),
 ('e2100000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000003',repeat('c',64),'KR-BIZ-9980000001','family','Canonical title fixture'),
 ('e2100000-0000-0000-0000-000000000004','e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000004',repeat('d',64),'KR-BIZ-9980000001','family','Equivalent title fixture');
insert into submission_results values
 ('title-blank-create',pg_catalog.jsonb_build_object('id','e2100000-0000-0000-0000-000000000002')),
 ('title-canonical-create',pg_catalog.jsonb_build_object('id','e2100000-0000-0000-0000-000000000003')),
 ('title-equivalent-create',pg_catalog.jsonb_build_object('id','e2100000-0000-0000-0000-000000000004'));
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
select is(public.create_benefit_submission_v1('e2000000-0000-0000-0000-000000000001','KR-BIZ-9980000001','health','Health benefit',null,'Employees only',null)->>'id',(select payload->>'id' from submission_results where name='created'),'same key and payload replays');
select throws_ok($$select public.create_benefit_submission_v1('e2000000-0000-0000-0000-000000000001','KR-BIZ-9980000001','health','Changed',null,'Employees only',null)$$,'22023','client key reused with different payload','same key changed payload is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'http://example.com')$$,'22023','invalid public source URL','non-HTTPS source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://user:secret@example.com/a')$$,'22023','invalid public source URL','credential source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://127.0.0.1/a')$$,'22023','invalid public source URL','private source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://0x7f.0x0.0x0.0x1/private')$$,'22023','invalid public source URL','mixed hexadecimal numeric loopback source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://0X7F.0.0x0.1/private')$$,'22023','invalid public source URL','mixed-case hexadecimal and decimal numeric source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://0x7f.1/private')$$,'22023','invalid public source URL','shorthand hexadecimal numeric source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Benefit',null,null,'https://0x7f000001/private')$$,'22023','invalid public source URL','single hexadecimal numeric source is rejected');
select throws_ok($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health',repeat('x',5001),null,null,null)$$,'22023','invalid benefit text','benefit text is bounded');
insert into submission_results values ('mine',public.list_my_benefit_submissions_v1(20));
select is(jsonb_array_length((select payload->'items' from submission_results where name='mine')),4,'owner sees own submissions');
select is((select jsonb_object_agg(key,true order by key) from submission_results,jsonb_object_keys(payload->'items'->0) key where name='mine'),'{"admin_response":true,"benefit_text":true,"category_id":true,"company_id":true,"condition_text":true,"created_at":true,"eligibility_text":true,"id":true,"publication_id":true,"reviewed_at":true,"source_url":true,"status":true,"updated_at":true}'::jsonb,'owner projection has exact safe keys');
select ok((select payload::text not like '%reviewer%' and payload::text not like '%submitter%' and payload::text not like '%fingerprint%' and payload::text not like '%example.test%' from submission_results where name='mine'),'owner projection excludes internal identities and fingerprint');
select throws_ok($$select public.list_my_benefit_submissions_v1(0)$$,'22023','invalid page limit','owner list is bounded');
reset role;
select is(private.benefit_submission_source_url('https://0x7f.example.com/evidence'),'https://0x7f.example.com/evidence','ordinary DNS names containing a hexadecimal-looking label remain valid');

select ok((select submitter_id='e1000000-0000-0000-0000-000000000001' and source_url is null and payload_fingerprint ~ '^[0-9a-f]{64}$' from public.benefit_submissions where id=((select payload->>'id' from submission_results where name='created')::uuid)),'actor derived and nullable source stored');
select is((select count(*)::integer from public.benefit_submission_events where submission_id=((select payload->>'id' from submission_results where name='created')::uuid) and action='submitted'),1,'create emits one event');
select is((select count(*)::integer from public.rate_limit_events where user_id='e1000000-0000-0000-0000-000000000001' and action='benefit_submission.create'),1,'replay consumes no extra rate slot');

set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000002';
select is(jsonb_array_length(public.list_my_benefit_submissions_v1()->'items'),0,'other user cannot read owner submission');
select throws_like($$insert into public.benefit_submissions(submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text) values (auth.uid(),gen_random_uuid(),repeat('a',64),'KR-BIZ-9980000001','health','forged')$$,'%permission denied%','direct insert denied');
select throws_ok($$select public.list_benefit_submission_queue_v1()$$,'42501','admin required','member cannot list queue');
reset role;

set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000004","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.list_benefit_submission_queue_v1()$$,'42501','admin required','forged JWT admin denied');
select set_config('request.jwt.claims','',true);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
insert into submission_results values ('queue',public.list_benefit_submission_queue_v1('active',20));
select is((select jsonb_object_agg(key,true order by key) from submission_results,jsonb_object_keys(payload->'items'->0) key where name='queue'),'{"admin_response":true,"benefit_text":true,"category_id":true,"company_id":true,"condition_text":true,"created_at":true,"eligibility_text":true,"id":true,"publication_id":true,"reviewed_at":true,"source_url":true,"status":true,"updated_at":true}'::jsonb,'admin queue exact projection has no identities');
select ok((select payload::text not like '%submitter%' and payload::text not like '%reviewer%' and payload::text not like '%token%' from submission_results where name='queue'),'queue is privacy safe');
select is(public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='created')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000001',null,null,null,null,null)->>'status','reviewing','submitted starts review');
select is(public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='created')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000001',null,null,null,null,null)->>'status','reviewing','review replay ignores stale expected status');
select is(public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='created')::uuid),'reviewing','additional_material_requested','More evidence','e3000000-0000-0000-0000-000000000002',null,null,null,null,null)->>'status','reviewing','additional material stays reviewing');
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='title-blank-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000040',null,null,null,null,null);
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='title-canonical-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000041',null,null,null,null,null);
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='title-equivalent-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000042',null,null,null,null,null);
select throws_ok(format($q$select public.review_benefit_submission_v1(%L,'reviewing','approve','Approved','e3000000-0000-0000-0000-000000000043',E'\t\n\v\f\r ','Description',null,null,null)$q$,(select payload->>'id' from submission_results where name='title-blank-create')),'22023','invalid public title','ASCII whitespace-only public title is rejected');
insert into submission_results values ('title-canonical-approved',public.review_benefit_submission_v1(
 ((select payload->>'id' from submission_results where name='title-canonical-create')::uuid),'reviewing','approve','Approved','e3000000-0000-0000-0000-000000000044',E'\t Health\r\n  Plan \v',E'Line one\nLine two',E'Eligible one\nEligible two',E'Condition one\nCondition two',null));
reset role;
select is((select title from public.benefit_publications where publication_id=((select payload->>'publication_id' from submission_results where name='title-canonical-approved')::uuid)),'Health Plan','public title canonicalizes leading, trailing, and repeated ASCII whitespace');
select is((select description from public.benefit_publications where publication_id=((select payload->>'publication_id' from submission_results where name='title-canonical-approved')::uuid)),E'Line one\nLine two','public description preserves line breaks');
select is((select eligibility_text from public.benefit_publications where publication_id=((select payload->>'publication_id' from submission_results where name='title-canonical-approved')::uuid)),E'Eligible one\nEligible two','public eligibility preserves line breaks');
select is((select condition_text from public.benefit_publications where publication_id=((select payload->>'publication_id' from submission_results where name='title-canonical-approved')::uuid)),E'Condition one\nCondition two','public condition preserves line breaks');
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select throws_ok(format($q$select public.review_benefit_submission_v1(%L,'reviewing','approve','Approved','e3000000-0000-0000-0000-000000000045','Health Plan','Equivalent description',null,null,null)$q$,(select payload->>'id' from submission_results where name='title-equivalent-create')),'23505','duplicate key value violates unique constraint "benefit_publications_company_id_dedupe_key_revision_key"','equivalent canonical title resolves to the same deterministic dedupe lineage');
reset role;
select is((select count(*)::integer from public.benefit_publications where company_id='KR-BIZ-9980000001' and category_id='family' and status='active'),1,'equivalent canonical titles leave one active publication');
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select throws_ok(format('select public.review_benefit_submission_v1(%L,''submitted'',''approve'',''stale'',gen_random_uuid(),''Title'',''Description'',null,null,null)',(select payload->>'id' from submission_results where name='created')),'40001','benefit submission state changed','CAS mismatch fails');
select throws_ok(format('select public.review_benefit_submission_v1(%L,''reviewing'',''start_review'',''cycle'',gen_random_uuid(),null,null,null,null,null)',(select payload->>'id' from submission_results where name='created')),'22023','benefit submission review action not allowed','invalid transition rejected');
insert into submission_results values ('approved',public.review_benefit_submission_v1(
 ((select payload->>'id' from submission_results where name='created')::uuid),'reviewing','approve','Approved','e3000000-0000-0000-0000-000000000003','Health allowance','Annual health allowance',null,'Full time',null));
select is((select payload->>'status' from submission_results where name='approved'),'approved','reviewing approves');
select throws_ok(format('select public.review_benefit_submission_v1(%L,''approved'',''reject'',''rewrite'',gen_random_uuid(),null,null,null,null,null)',(select payload->>'id' from submission_results where name='created')),'22023','invalid expected benefit submission status','approved terminal');
insert into submission_results values ('audit',public.list_benefit_submission_audit_v1(((select payload->>'id' from submission_results where name='created')::uuid),20));
select is((select jsonb_array_length(payload->'items') from submission_results where name='audit'),4,'admin audit lists append-only events');
select is((select jsonb_object_agg(key,true order by key) from submission_results,jsonb_object_keys(payload->'items'->0) key where name='audit'),'{"action":true,"admin_response":true,"created_at":true,"from_status":true,"sequence":true,"to_status":true}'::jsonb,'audit projection exact keys are privacy safe');
reset role;

select ok((select s.status='approved' and s.publication_id=p.publication_id and p.trust_tier='community_reviewed' and p.source_type='user_submission' and p.status='active' and p.source_url is null and p.reviewer_id='e1000000-0000-0000-0000-000000000003'::text from public.benefit_submissions s join public.benefit_publications p using(publication_id) where s.id=((select payload->>'id' from submission_results where name='created')::uuid)),'approval atomically binds one community publication');
select is((select count(*)::integer from public.benefit_publications where publication_id=((select payload->>'publication_id' from submission_results where name='approved')::uuid) and trust_tier='official_verified'),0,'admin cannot create official tier');
select is((public.get_benefit_company_v1('KR-BIZ-9980000001')->'publications'->0 ? 'source_url'),false,'public detail omits private source URL');
select ok((public.search_benefit_companies_v1('submission')->'items'->0)::text not like '%source_url%','public search omits private source URL');
select throws_ok(format('update public.benefit_submissions set benefit_text=''tampered'' where id=%L',(select payload->>'id' from submission_results where name='created')),'23514','benefit submitted payload is immutable','submitted payload immutable');
select throws_ok(format('update public.benefit_submission_events set action=''tampered'' where submission_id=%L',(select payload->>'id' from submission_results where name='created')),'23514','benefit submission events are append-only','event update denied');
select throws_ok(format('delete from public.benefit_submission_events where submission_id=%L',(select payload->>'id' from submission_results where name='created')),'23514','benefit submission events are append-only','event delete denied');
select throws_ok($$truncate public.benefit_submission_events$$,'23514','benefit submission events are append-only','event truncate denied');

-- Existing publication approval creates a successor and retires the predecessor.
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type)
values ('e4000000-0000-0000-0000-000000000001','KR-BIZ-9980000001','leave','Old leave','Old description','community_reviewed','active','old-leave',1,'seed');
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
insert into submission_results values ('revision-create',public.create_benefit_submission_v1('e2000000-0000-0000-0000-000000000010','KR-BIZ-9980000001','leave','Updated leave',null,null,'https://example.com/private-evidence'));
reset role;
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='revision-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000010',null,null,null,null,null);
insert into submission_results values ('revision-approved',public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='revision-create')::uuid),'reviewing','approve','Approved','e3000000-0000-0000-0000-000000000011','Updated leave','Updated description',null,null,'e4000000-0000-0000-0000-000000000001'));
reset role;
select ok((select old.status='superseded' and successor.revision=2 and successor.dedupe_key=old.dedupe_key and successor.supersedes_publication_id=old.publication_id and successor.source_url='https://example.com/private-evidence' from public.benefit_publications old join public.benefit_publications successor on successor.supersedes_publication_id=old.publication_id where old.publication_id='e4000000-0000-0000-0000-000000000001'),'existing publication approval creates next revision and supersession');

-- A successor insertion failure rolls predecessor supersession and approval state back.
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type)
values ('e4000000-0000-0000-0000-000000000020','KR-BIZ-9980000001','remote','Rollback predecessor','Rollback predecessor description','community_reviewed','active','rollback-lineage',1,'seed');
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
insert into submission_results values ('rollback-create',public.create_benefit_submission_v1('e2000000-0000-0000-0000-000000000020','KR-BIZ-9980000001','remote','Rollback benefit',null,null,null));
reset role;
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='rollback-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000020',null,null,null,null,null);
reset role;
create function pg_temp.fail_successor_after_supersession()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.supersedes_publication_id='e4000000-0000-0000-0000-000000000020'::uuid
     and (select status from public.benefit_publications where publication_id=new.supersedes_publication_id)='superseded' then
    raise exception 'test successor insertion failure' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger test_fail_successor_after_supersession before insert on public.benefit_publications
for each row execute function pg_temp.fail_successor_after_supersession();
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select throws_ok(format('select public.review_benefit_submission_v1(%L,''reviewing'',''approve'',''Approved'',''e3000000-0000-0000-0000-000000000021'',''Rollback successor'',''Rollback successor description'',null,null,''e4000000-0000-0000-0000-000000000020'')',(select payload->>'id' from submission_results where name='rollback-create')),'P0001','test successor insertion failure','successor insertion failure is surfaced after predecessor supersession');
reset role;
drop trigger test_fail_successor_after_supersession on public.benefit_publications;
drop function pg_temp.fail_successor_after_supersession();
select is((select status from public.benefit_publications where publication_id='e4000000-0000-0000-0000-000000000020'),'active','failed successor insertion restores predecessor active');
select is((select count(*)::integer from public.benefit_publications where supersedes_publication_id='e4000000-0000-0000-0000-000000000020'),0,'failed successor insertion leaves no successor');
select ok((select status='reviewing' and publication_id is null from public.benefit_submissions where id=((select payload->>'id' from submission_results where name='rollback-create')::uuid)),'failed approval leaves submission reviewing');
select is((select count(*)::integer from public.benefit_submission_events where submission_id=((select payload->>'id' from submission_results where name='rollback-create')::uuid) and action='approved'),0,'failed approval emits no approval event');

-- Reviewing submissions can be rejected exactly once without publication.
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
insert into submission_results values ('reject-create',public.create_benefit_submission_v1('e2000000-0000-0000-0000-000000000030','KR-BIZ-9980000001','meals','Reject benefit',null,null,null));
reset role;
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000003';
select public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='reject-create')::uuid),'submitted','start_review','Reviewing','e3000000-0000-0000-0000-000000000030',null,null,null,null,null);
insert into submission_results values ('rejected',public.review_benefit_submission_v1(((select payload->>'id' from submission_results where name='reject-create')::uuid),'reviewing','reject','Insufficient evidence','e3000000-0000-0000-0000-000000000031',null,null,null,null,null));
select is((select payload->>'status' from submission_results where name='rejected'),'rejected','reviewing submission rejects');
select throws_ok(format('select public.review_benefit_submission_v1(%L,''reviewing'',''reject'',''Reject again'',gen_random_uuid(),null,null,null,null,null)',(select payload->>'id' from submission_results where name='reject-create')),'40001','benefit submission state changed','rejected submission refuses further review action');
reset role;
select ok((select status='rejected' and admin_response='Insufficient evidence' and reviewer_id='e1000000-0000-0000-0000-000000000003' and reviewed_at is not null and publication_id is null from public.benefit_submissions where id=((select payload->>'id' from submission_results where name='reject-create')::uuid)),'rejection stores terminal reviewer fields without publication');
select is((select count(*)::integer from public.benefit_submission_events where submission_id=((select payload->>'id' from submission_results where name='reject-create')::uuid) and action='rejected' and from_status='reviewing' and to_status='rejected' and publication_id is null),1,'rejection emits one terminal event');
select is((select count(*)::integer from public.benefit_publications where provenance->>'submission_id'=(select payload->>'id' from submission_results where name='reject-create')),0,'rejection creates no publication');

-- Rate limit is bounded.
insert into public.rate_limit_events(user_id,action,idempotency_key)
select 'e1000000-0000-0000-0000-000000000002','benefit_submission.create','saturated-'||g from generate_series(1,5) g;
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000002';
select throws_like($$select public.create_benefit_submission_v1(gen_random_uuid(),'KR-BIZ-9980000001','health','Rate limited',null,null,null)$$,'%rate_limit_exceeded%','create rate limit enforced');
reset role;

select * from finish();
rollback;
