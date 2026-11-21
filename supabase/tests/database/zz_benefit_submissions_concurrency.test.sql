begin;
select no_plan();
create extension if not exists dblink with schema extensions;

create temporary table submission_race_fixture(
  owner_id uuid,admin_one_id uuid,admin_two_id uuid,same_submission_id uuid,equiv_one_id uuid,equiv_two_id uuid,
  connection_string text,second_pid integer
);
insert into submission_race_fixture
select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
 format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=8000 -c lock_timeout=5000'),null;

create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '3 seconds') returns boolean language plpgsql as $$
declare v_deadline timestamptz:=clock_timestamp()+p_timeout;
begin
 loop
  if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true; end if;
  if clock_timestamp()>=v_deadline then return false; end if;
  perform pg_catalog.pg_sleep(0.01);
 end loop;
end $$;

select extensions.dblink_connect('bs_setup',connection_string) from submission_race_fixture;
select extensions.dblink_exec('bs_setup',$cleanup$
 set session_replication_role=replica;
 delete from public.rate_limit_events where user_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.benefit_submission_events where submission_id in (select id from public.benefit_submissions where company_id='KR-BIZ-9980000002') or actor_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.benefit_submissions where company_id='KR-BIZ-9980000002';
 delete from public.benefit_publications where company_id='KR-BIZ-9980000002';
 delete from public.benefit_companies where company_id='KR-BIZ-9980000002';
 delete from public.user_roles where user_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.profiles where login like 'bs-race-%';
 delete from auth.users where email like '%@bs-race.test';
 set session_replication_role=origin
$cleanup$);
select extensions.dblink_exec('bs_setup',format($setup$
 insert into auth.users(id,aud,role,email) values (%L,'authenticated','authenticated',%L),(%L,'authenticated','authenticated',%L),(%L,'authenticated','authenticated',%L);
 insert into public.profiles(id,github_user_id,login) values (%L,981000001,%L),(%L,981000002,%L),(%L,981000003,%L);
 insert into public.user_roles(user_id,role) values (%L,'member'),(%L,'admin'),(%L,'admin');
 insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition) values ('KR-BIZ-9980000002','registered_business','Race Company','race company','test');
 insert into public.benefit_submissions(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text,status,admin_response,reviewer_id,reviewed_at,created_at,updated_at) values
  (%L,%L,gen_random_uuid(),repeat('a',64),'KR-BIZ-9980000002','health','Same approval','reviewing','Reviewing',%L,pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  (%L,%L,gen_random_uuid(),repeat('b',64),'KR-BIZ-9980000002','leave','Equivalent one','reviewing','Reviewing',%L,pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  (%L,%L,gen_random_uuid(),repeat('c',64),'KR-BIZ-9980000002','leave','Equivalent two','reviewing','Reviewing',%L,pg_catalog.now(),pg_catalog.now(),pg_catalog.now())
$setup$,
 owner_id,owner_id::text||'@bs-race.test',admin_one_id,admin_one_id::text||'@bs-race.test',admin_two_id,admin_two_id::text||'@bs-race.test',
 owner_id,'bs-race-owner',admin_one_id,'bs-race-admin-one',admin_two_id,'bs-race-admin-two',owner_id,admin_one_id,admin_two_id,
 same_submission_id,owner_id,admin_one_id,equiv_one_id,owner_id,admin_one_id,equiv_two_id,owner_id,admin_one_id
)) from submission_race_fixture;

select extensions.dblink_connect('bs_one',connection_string),extensions.dblink_connect('bs_two',connection_string) from submission_race_fixture;
select extensions.dblink_exec('bs_two',$fn$
 create or replace function pg_temp.try_approve(p_submission uuid,p_key uuid,p_title text)
 returns text language plpgsql as $body$
 begin
  perform public.review_benefit_submission_v1(p_submission,'reviewing','approve','Approved',p_key,p_title,'Race description',null,null,null);
  set constraints all immediate;
  return 'ok';
 exception when others then return sqlstate; end
 $body$;
 grant execute on function pg_temp.try_approve(uuid,uuid,text) to authenticated
$fn$);

-- Two admins approve the same submission: one wins and the loser observes stale CAS.
select extensions.dblink_exec('bs_one','begin');
select extensions.dblink_exec('bs_one','set local role authenticated');
select extensions.dblink_exec('bs_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from submission_race_fixture;
create temporary table same_winner(value jsonb);
insert into same_winner select r.value::jsonb from submission_race_fixture f cross join lateral extensions.dblink('bs_one',format($q$select public.review_benefit_submission_v1(%L,'reviewing','approve','Approved',gen_random_uuid(),'Same title','Same description',null,null,null)::text$q$,f.same_submission_id)) r(value text);
select extensions.dblink_exec('bs_two','begin');
select extensions.dblink_exec('bs_two','set local role authenticated');
select extensions.dblink_exec('bs_two',format('set local request.jwt.claim.sub=%L',admin_two_id)) from submission_race_fixture;
update submission_race_fixture set second_pid=(select pid from extensions.dblink('bs_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('bs_two',format('select pg_temp.try_approve(%L,gen_random_uuid(),''Same title'')',same_submission_id)) from submission_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from submission_race_fixture),'concurrent same-submission approval waits on row lock without deadlock');
select extensions.dblink_exec('bs_one','commit');
create temporary table same_loser(value text);
insert into same_loser select * from extensions.dblink_get_result('bs_two') r(value text);
select count(*) from extensions.dblink_get_result('bs_two') r(value text);
select extensions.dblink_exec('bs_two','commit');
select is((select value from same_loser),'40001','concurrent same-submission approval has one stale CAS loser');
select is((select count(*)::integer from extensions.dblink((select connection_string from submission_race_fixture),format('select publication_id from public.benefit_submissions where id=%L and status=''approved''',(select same_submission_id from submission_race_fixture))) r(publication_id uuid)),1,'same submission ends approved once');
select is((select count(*)::integer from extensions.dblink((select connection_string from submission_race_fixture),format('select id from public.benefit_submission_events where submission_id=%L and action=''approved''',(select same_submission_id from submission_race_fixture))) r(id uuid)),1,'same submission emits one approval event');

-- Equivalent new approvals serialize at the deterministic active lineage boundary.
select extensions.dblink_exec('bs_one','begin');
select extensions.dblink_exec('bs_one','set local role authenticated');
select extensions.dblink_exec('bs_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from submission_race_fixture;
select * from submission_race_fixture f cross join lateral extensions.dblink('bs_one',format($q$select public.review_benefit_submission_v1(%L,'reviewing','approve','Approved',gen_random_uuid(),'Equivalent Title','Equivalent Description',null,null,null)::text$q$,f.equiv_one_id)) r(value text);
select extensions.dblink_exec('bs_two','begin');
select extensions.dblink_exec('bs_two','set local role authenticated');
select extensions.dblink_exec('bs_two',format('set local request.jwt.claim.sub=%L',admin_two_id)) from submission_race_fixture;
update submission_race_fixture set second_pid=(select pid from extensions.dblink('bs_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('bs_two',format('select pg_temp.try_approve(%L,gen_random_uuid(),''Equivalent Title'')',equiv_two_id)) from submission_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from submission_race_fixture),'equivalent approvals serialize on active publication lineage');
select extensions.dblink_exec('bs_one','set constraints all immediate');
select extensions.dblink_exec('bs_one','commit');
create temporary table equivalent_loser(value text);
insert into equivalent_loser select * from extensions.dblink_get_result('bs_two') r(value text);
select count(*) from extensions.dblink_get_result('bs_two') r(value text);
select extensions.dblink_exec('bs_two','commit');
select ok((select value in ('23505','23514') from equivalent_loser),'equivalent concurrent approval loser fails uniqueness or active-lineage invariant');
select is((select count(*)::integer from extensions.dblink((select connection_string from submission_race_fixture),$$select publication_id from public.benefit_publications where company_id='KR-BIZ-9980000002' and category_id='leave' and status='active'$$) r(publication_id uuid)),1,'equivalent approvals leave one active publication');
select is((select count(*)::integer from extensions.dblink((select connection_string from submission_race_fixture),format('select id from public.benefit_submission_events where submission_id in (%L,%L) and action=''approved''',(select equiv_one_id from submission_race_fixture),(select equiv_two_id from submission_race_fixture))) r(id uuid)),1,'equivalent approvals leave one approval event');

select extensions.dblink_exec('bs_setup',$cleanup$
 set session_replication_role=replica;
 delete from public.rate_limit_events where user_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.benefit_submission_events where submission_id in (select id from public.benefit_submissions where company_id='KR-BIZ-9980000002') or actor_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.benefit_submissions where company_id='KR-BIZ-9980000002';
 delete from public.benefit_publications where company_id='KR-BIZ-9980000002';
 delete from public.benefit_companies where company_id='KR-BIZ-9980000002';
 delete from public.user_roles where user_id in (select id from public.profiles where login like 'bs-race-%');
 delete from public.profiles where login like 'bs-race-%';
 delete from auth.users where email like '%@bs-race.test';
 set session_replication_role=origin
$cleanup$);
select is((select residue from submission_race_fixture f cross join lateral extensions.dblink(f.connection_string,$q$select ((select count(*) from public.benefit_companies where company_id='KR-BIZ-9980000002')+(select count(*) from public.benefit_publications where company_id='KR-BIZ-9980000002')+(select count(*) from public.profiles where login like 'bs-race-%'))::integer$q$) r(residue integer)),0,'concurrency fixtures are removed');
select extensions.dblink_disconnect('bs_one');
select extensions.dblink_disconnect('bs_two');
select extensions.dblink_disconnect('bs_setup');
select * from finish();
rollback;
