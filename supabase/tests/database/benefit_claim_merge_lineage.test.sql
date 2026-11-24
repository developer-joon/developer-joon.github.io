begin;
select no_plan();

select has_table('public','benefit_claim_merge_reactions','normalized private merge reaction lineage exists');
select has_column('public','benefit_claim_merges','merge_id','merge ledger has an immutable lineage identity');
select hasnt_column('public','benefit_claim_merges','reaction_lineage','merge ledger has no aggregate reaction lineage payload');
select ok((select relowner='postgres'::regrole and relrowsecurity from pg_class where oid='public.benefit_claim_merge_reactions'::regclass),'normalized lineage is postgres-owned with RLS enabled');
select ok((select not has_table_privilege('anon','public.benefit_claim_merge_reactions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated','public.benefit_claim_merge_reactions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','public.benefit_claim_merge_reactions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),'raw normalized lineage is inaccessible to application roles');
select ok(exists(select 1 from pg_trigger where tgrelid='public.benefit_claim_merge_reactions'::regclass and tgname='benefit_claim_merge_reactions_origin_gate'),'lineage origin membership is enforced at the storage boundary');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='benefit_claim_merge_reactions' and indexdef like '%(merge_id, origin_claim_id, user_id)%') and exists(select 1 from pg_indexes where schemaname='public' and tablename='benefit_claim_merge_reactions' and indexdef like '%(origin_claim_id, user_id, merge_id)%'),'lineage is indexed by merge and by origin claim/user');
select ok(position('jsonb_agg' in lower(pg_get_functiondef('public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text)'::regprocedure)))=0,'merge mutation does not aggregate all reactions into JSON');
select ok(not exists(select 1 from pg_constraint where conrelid in ('public.benefit_claim_merges'::regclass,'public.benefit_claim_merge_reactions'::regclass) and lower(pg_get_constraintdef(oid)) like '%200000%'),'merge lineage has no fixed aggregate byte ceiling');

insert into auth.users(id,aud,role,email) values
 ('ba100000-0000-4000-8000-000000000001','authenticated','authenticated','lineage-admin@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('ba100000-0000-4000-8000-000000000001',99100001,'lineage-admin');
insert into public.user_roles values ('ba100000-0000-4000-8000-000000000001','admin');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('lineage-admin','ba100000-0000-4000-8000-000000000001','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values
 ('KR-BIZ-9910000001','registered_business','Lineage Company','lineage company',true,'merge-lineage-test');
insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on) values
 ('ba200000-0000-4000-8000-000000000001','KR-BIZ-9910000001',gen_random_uuid(),repeat('1',64),'health','Volume source','volume source','Volume source description','',date '2026-01-01'),
 ('ba200000-0000-4000-8000-000000000002','KR-BIZ-9910000001',gen_random_uuid(),repeat('2',64),'health','Volume target','volume target','Volume target description','',date '2026-01-01'),
 ('ba200000-0000-4000-8000-000000000003','KR-BIZ-9910000001',gen_random_uuid(),repeat('3',64),'health','Rollback source','rollback source','Rollback source description','',date '2026-01-01'),
 ('ba200000-0000-4000-8000-000000000004','KR-BIZ-9910000001',gen_random_uuid(),repeat('4',64),'health','Rollback target','rollback target','Rollback target description','',date '2026-01-01'),
 ('ba200000-0000-4000-8000-000000000005','KR-BIZ-9910000001',gen_random_uuid(),repeat('5',64),'health','Unrelated claim','unrelated claim','Unrelated description','',date '2026-01-01');

insert into public.benefit_claim_reactions(claim_id,user_id,reaction,created_at,updated_at)
select 'ba200000-0000-4000-8000-000000000001',
       ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       case when g%10=0 then 'dispute' else 'confirm' end,
       timestamptz '2026-01-01 00:00:00+00',timestamptz '2026-01-02 00:00:00+00'
from generate_series(1,1000) g;
insert into public.benefit_claim_reactions(claim_id,user_id,reaction,created_at,updated_at)
select 'ba200000-0000-4000-8000-000000000002',
       ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       'confirm',timestamptz '2026-01-03 00:00:00+00',timestamptz '2026-01-04 00:00:00+00'
from (select generate_series(1,100) g union all select generate_series(1001,1020) g) users;

set local role authenticated;
set local request.jwt.claim.sub='ba100000-0000-4000-8000-000000000001';
select lives_ok($$select public.moderate_benefit_claim_v1('ba300000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000001',1,'submitted','merge','ba200000-0000-4000-8000-000000000002','high volume duplicate')$$,'1,000-source-reaction merge with target overlap succeeds');
reset role;

select is((select count(*)::integer from public.benefit_claim_merge_reactions l join public.benefit_claim_merges m using(merge_id) where m.source_claim_id='ba200000-0000-4000-8000-000000000001' and l.origin_claim_id=m.source_claim_id),1000,'normalized lineage stores every original source reaction');
select is((select count(*)::integer from public.benefit_claim_merge_reactions l join public.benefit_claim_merges m using(merge_id) where m.source_claim_id='ba200000-0000-4000-8000-000000000001' and l.origin_claim_id=m.target_claim_id),120,'normalized lineage stores every original target reaction');
select is((select count(*)::integer from public.benefit_claim_reactions where claim_id='ba200000-0000-4000-8000-000000000002'),1020,'merged target retains one reaction per user');
select is((select reaction from public.benefit_claim_reactions where claim_id='ba200000-0000-4000-8000-000000000002' and user_id='00000000-0000-4000-8000-000000000010'),'dispute','dispute takes precedence over overlapping target confirm');
select ok((select created_at=timestamptz '2026-01-01 00:00:00+00' and updated_at=timestamptz '2026-01-04 00:00:00+00' from public.benefit_claim_reactions where claim_id='ba200000-0000-4000-8000-000000000002' and user_id='00000000-0000-4000-8000-000000000010'),'dedupe preserves the complete reaction time span');
select ok((select count(*) filter(where reaction='confirm')=920 and count(*) filter(where reaction='dispute')=100 from public.benefit_claim_reactions where claim_id='ba200000-0000-4000-8000-000000000002'),'target reaction counts preserve all users and dispute precedence');
select ok((select status='merged' and revision=2 and merged_into_claim_id='ba200000-0000-4000-8000-000000000002' and active_publication_id is null and official_publication_id is null from public.benefit_claims where claim_id='ba200000-0000-4000-8000-000000000001'),'high-volume source is terminal');
select ok((select status='disputed' and revision=2 and active_publication_id is null and official_publication_id is null from public.benefit_claims where claim_id='ba200000-0000-4000-8000-000000000002'),'target status, revision, and publication pointers match merged counts');
select is((select count(*)::integer from public.benefit_publications where provenance->>'claim_id' in ('ba200000-0000-4000-8000-000000000001','ba200000-0000-4000-8000-000000000002') and status='active'),0,'high-volume disputed merge leaves no active community publication');
select ok((select reaction='dispute' and created_at=timestamptz '2026-01-01 00:00:00+00' and updated_at=timestamptz '2026-01-02 00:00:00+00' from public.benefit_claim_merge_reactions l join public.benefit_claim_merges m using(merge_id) where m.source_claim_id='ba200000-0000-4000-8000-000000000001' and l.origin_claim_id=m.source_claim_id and l.user_id='00000000-0000-4000-8000-000000000010'),'source lineage preserves the exact original reaction and timestamps');
select ok((select reaction='confirm' and created_at=timestamptz '2026-01-03 00:00:00+00' and updated_at=timestamptz '2026-01-04 00:00:00+00' from public.benefit_claim_merge_reactions l join public.benefit_claim_merges m using(merge_id) where m.source_claim_id='ba200000-0000-4000-8000-000000000001' and l.origin_claim_id=m.target_claim_id and l.user_id='00000000-0000-4000-8000-000000000010'),'target lineage preserves the exact original reaction and timestamps');

set local role authenticated;
set local request.jwt.claim.sub='ba100000-0000-4000-8000-000000000001';
select ok(octet_length(public.list_benefit_claim_audit_v1('ba200000-0000-4000-8000-000000000002',100)::text)<20000,'admin audit remains bounded after high-volume merge');
select ok(public.list_benefit_claim_audit_v1('ba200000-0000-4000-8000-000000000002',100)::text not like '%00000000-0000-4000-8000-000000000010%','admin audit does not expose per-reaction user lineage');
reset role;

select throws_ok($$update public.benefit_claim_merge_reactions set reaction='confirm'$$,'23514','benefit claim moderation ledgers are append-only','normalized lineage update rejected');
select throws_ok($$delete from public.benefit_claim_merge_reactions$$,'23514','benefit claim moderation ledgers are append-only','normalized lineage delete rejected');
select throws_ok($$truncate public.benefit_claim_merge_reactions$$,'23514','benefit claim moderation ledgers are append-only','normalized lineage truncate rejected');
select throws_ok($$insert into public.benefit_claim_merge_reactions(merge_id,origin_claim_id,user_id,reaction,created_at,updated_at) select merge_id,'ba200000-0000-4000-8000-000000000005',gen_random_uuid(),'confirm',clock_timestamp(),clock_timestamp() from public.benefit_claim_merges where source_claim_id='ba200000-0000-4000-8000-000000000001'$$,'23514','merge reaction origin must be the merge source or target','storage boundary rejects lineage for an unrelated claim');

insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values
 ('ba200000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000002001','confirm'),
 ('ba200000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000002002','dispute');
create function private.test_fail_merge_lineage_insert() returns trigger language plpgsql set search_path='' as $$begin if new.origin_claim_id='ba200000-0000-4000-8000-000000000003' then raise exception 'injected merge lineage failure' using errcode='23514'; end if; return new; end$$;
create trigger test_fail_merge_lineage_insert before insert on public.benefit_claim_merge_reactions for each row execute function private.test_fail_merge_lineage_insert();
set local role authenticated;
set local request.jwt.claim.sub='ba100000-0000-4000-8000-000000000001';
select throws_ok($$select public.moderate_benefit_claim_v1('ba300000-0000-4000-8000-000000000002','ba200000-0000-4000-8000-000000000003',1,'submitted','merge','ba200000-0000-4000-8000-000000000004','rollback fixture')$$,'23514','injected merge lineage failure','lineage insert failure aborts merge');
reset role;
drop trigger test_fail_merge_lineage_insert on public.benefit_claim_merge_reactions;
drop function private.test_fail_merge_lineage_insert();
select ok((select bool_and(status='submitted' and revision=1 and merged_into_claim_id is null) from public.benefit_claims where claim_id in ('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000004')),'lineage failure rolls back both claim states');
select is((select count(*)::integer from public.benefit_claim_reactions where claim_id in ('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000004')),2,'lineage failure rolls back reaction transfer and deletion');
select is((select count(*)::integer from public.benefit_claim_merges where source_claim_id='ba200000-0000-4000-8000-000000000003'),0,'lineage failure rolls back merge ledger');
select is((select count(*)::integer from public.benefit_claim_events where claim_id in ('ba200000-0000-4000-8000-000000000003','ba200000-0000-4000-8000-000000000004')),0,'lineage failure rolls back source and target events');
select is((select count(*)::integer from public.benefit_claim_moderation_requests where client_key='ba300000-0000-4000-8000-000000000002'),0,'lineage failure rolls back idempotency response');

select * from finish();
rollback;
