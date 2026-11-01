begin;
select no_plan();

create extension if not exists dblink with schema extensions;

create temporary table correction_race_fixture (
  submitter_id uuid not null,
  admin_one_id uuid not null,
  admin_two_id uuid not null,
  request_id uuid not null,
  create_key uuid not null,
  review_one_key uuid not null,
  review_two_key uuid not null,
  connection_string text not null,
  second_pid integer
);

insert into correction_race_fixture
select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  format(
    'hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',
    coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,
    '-c statement_timeout=8000 -c lock_timeout=5000'
  ),null;

create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '3 seconds')
returns boolean language plpgsql as $$
declare v_deadline timestamptz:=clock_timestamp()+p_timeout;
begin
  loop
    if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true; end if;
    if clock_timestamp()>=v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end $$;

select extensions.dblink_connect('bc_setup',connection_string) from correction_race_fixture;
select extensions.dblink_exec('bc_setup',$cleanup$
  set session_replication_role=replica;
  delete from public.rate_limit_events where user_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.benefit_correction_events where request_id in (
    select r.id from public.benefit_correction_requests r join public.profiles p on p.id=r.submitter_id
    where p.login like 'bc-owner-%'
  ) or actor_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.benefit_correction_requests where submitter_id in (
    select id from public.profiles where login like 'bc-owner-%'
  );
  delete from public.user_roles where user_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%';
  delete from auth.users where email like '%@race.test';
  set session_replication_role=origin
$cleanup$);
select extensions.dblink_exec('bc_setup',format($setup$
  insert into auth.users(id,aud,role,email) values
    (%L,'authenticated','authenticated',%L),
    (%L,'authenticated','authenticated',%L),
    (%L,'authenticated','authenticated',%L);
  insert into public.profiles(id,github_user_id,login) values
    (%L,970000000+floor(random()*1000000)::bigint,%L),
    (%L,971000000+floor(random()*1000000)::bigint,%L),
    (%L,972000000+floor(random()*1000000)::bigint,%L);
  insert into public.user_roles(user_id,role) values (%L,'member'),(%L,'admin'),(%L,'admin')
$setup$,
  submitter_id,submitter_id::text||'@race.test',
  admin_one_id,admin_one_id::text||'@race.test',
  admin_two_id,admin_two_id::text||'@race.test',
  submitter_id,'bc-owner-'||substring(replace(submitter_id::text,'-','') for 20),
  admin_one_id,'bc-admin1-'||substring(replace(admin_one_id::text,'-','') for 20),
  admin_two_id,'bc-admin2-'||substring(replace(admin_two_id::text,'-','') for 20),
  submitter_id,admin_one_id,admin_two_id
)) from correction_race_fixture;

select extensions.dblink_connect('bc_one',connection_string),extensions.dblink_connect('bc_two',connection_string) from correction_race_fixture;
select extensions.dblink_exec('bc_one','begin');
select extensions.dblink_exec('bc_one','set local role authenticated');
select extensions.dblink_exec('bc_one',format('set local request.jwt.claim.sub=%L',submitter_id)) from correction_race_fixture;
create temporary table create_one(value jsonb);
insert into create_one
select r.value::jsonb from correction_race_fixture f cross join lateral extensions.dblink(
  'bc_one',
  format($q$select public.create_benefit_correction_request_v1(%L,'KR-CRN-1101112948086','health','Race old','Race new','Race scope','https://example.com/race','company-benefits-2026-10-31-v1')::text$q$,f.create_key)
) as r(value text);
select extensions.dblink_exec('bc_two','begin');
select extensions.dblink_exec('bc_two','set local role authenticated');
select extensions.dblink_exec('bc_two',format('set local request.jwt.claim.sub=%L',submitter_id)) from correction_race_fixture;
update correction_race_fixture set second_pid=(select pid from extensions.dblink('bc_two','select pg_backend_pid()') as r(pid integer));
select extensions.dblink_send_query(
  'bc_two',
  format($q$select public.create_benefit_correction_request_v1(%L,'KR-CRN-1101112948086','health','Race old','Race new','Race scope','https://example.com/race','company-benefits-2026-10-31-v1')::text$q$,create_key)
) from correction_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from correction_race_fixture),'same-key create contender actually waits on the advisory lock');
select extensions.dblink_exec('bc_one','commit');
create temporary table create_two(value jsonb);
insert into create_two select value::jsonb from extensions.dblink_get_result('bc_two') as r(value text);
select count(*) from extensions.dblink_get_result('bc_two') as r(value text);
select extensions.dblink_exec('bc_two','commit');
select is((select value->>'id' from create_two),(select value->>'id' from create_one),'concurrent same-key create returns the winner request');
select is((select count(*)::integer from extensions.dblink((select connection_string from correction_race_fixture),format('select id from public.benefit_correction_requests where submitter_id=%L and client_key=%L',(select submitter_id from correction_race_fixture),(select create_key from correction_race_fixture))) as r(id uuid)),1,'concurrent same-key create persists one request');
select is((select count(*)::integer from extensions.dblink((select connection_string from correction_race_fixture),format('select id from public.benefit_correction_events where actor_id=%L and operation=''create'' and client_key=%L',(select submitter_id from correction_race_fixture),(select create_key from correction_race_fixture))) as r(id uuid)),1,'concurrent same-key create emits one audit event');
select is((select count(*)::integer from extensions.dblink((select connection_string from correction_race_fixture),format('select id from public.rate_limit_events where user_id=%L and action=''benefit_correction.create'' and idempotency_key=%L',(select submitter_id from correction_race_fixture),(select create_key from correction_race_fixture)::text)) as r(id uuid)),1,'concurrent same-key create consumes one rate event');

select extensions.dblink_exec('bc_setup',format($setup$
  insert into public.benefit_correction_requests(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version)
  values (%L,%L,gen_random_uuid(),repeat('c',64),'US-CIK0000320193','leave','CAS old','CAS new','CAS scope','https://example.com/cas','company-benefits-2026-10-31-v1');
  insert into public.benefit_correction_events(request_id,actor_kind,actor_id,actor_snapshot,operation,client_key,payload_fingerprint,action,from_status,to_status)
  values (%L,'user',%L,%L,'create',gen_random_uuid(),repeat('c',64),'submitted',null,'submitted')
$setup$,request_id,submitter_id,request_id,submitter_id,submitter_id::text)) from correction_race_fixture;
select extensions.dblink_exec('bc_two',$fn$
  create or replace function pg_temp.try_review(p_request uuid,p_key uuid)
  returns text language plpgsql as $body$
  begin
    perform public.review_benefit_correction_request_v1(p_request,'submitted','start_review','CAS second',p_key);
    return 'ok';
  exception when others then return sqlstate; end
  $body$;
  grant execute on function pg_temp.try_review(uuid,uuid) to authenticated
$fn$);
select extensions.dblink_exec('bc_one','begin');
select extensions.dblink_exec('bc_one','set local role authenticated');
select extensions.dblink_exec('bc_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from correction_race_fixture;
create temporary table cas_one(value jsonb);
insert into cas_one select r.value::jsonb from correction_race_fixture f cross join lateral extensions.dblink(
  'bc_one',format($q$select public.review_benefit_correction_request_v1(%L,'submitted','start_review','CAS first',%L)::text$q$,f.request_id,f.review_one_key)
) as r(value text);
select extensions.dblink_exec('bc_two','begin');
select extensions.dblink_exec('bc_two','set local role authenticated');
select extensions.dblink_exec('bc_two',format('set local request.jwt.claim.sub=%L',admin_two_id)) from correction_race_fixture;
update correction_race_fixture set second_pid=(select pid from extensions.dblink('bc_two','select pg_backend_pid()') as r(pid integer));
select extensions.dblink_send_query('bc_two',format('select pg_temp.try_review(%L,%L)',request_id,review_two_key)) from correction_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from correction_race_fixture),'distinct-key CAS contender actually waits on the request row lock');
select extensions.dblink_exec('bc_one','commit');
create temporary table cas_two(value text);
insert into cas_two select * from extensions.dblink_get_result('bc_two') as r(value text);
select count(*) from extensions.dblink_get_result('bc_two') as r(value text);
select extensions.dblink_exec('bc_two','commit');
select is((select value from cas_two),'40001','concurrent CAS has exactly one winner and one stale-state loser');
select ok((select value->>'status'='reviewing' from cas_one),'CAS winner transitions the request');
select is((select count(*)::integer from extensions.dblink((select connection_string from correction_race_fixture),format('select id from public.benefit_correction_events where request_id=%L and operation=''review''',(select request_id from correction_race_fixture))) as r(id uuid)),1,'concurrent CAS emits one review audit event');

select extensions.dblink_exec('bc_setup',$cleanup$
  set session_replication_role=replica;
  delete from public.rate_limit_events where user_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.benefit_correction_events where request_id in (
    select r.id from public.benefit_correction_requests r join public.profiles p on p.id=r.submitter_id
    where p.login like 'bc-owner-%'
  ) or actor_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.benefit_correction_requests where submitter_id in (
    select id from public.profiles where login like 'bc-owner-%'
  );
  delete from public.user_roles where user_id in (
    select id from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%'
  );
  delete from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%';
  delete from auth.users where email like '%@race.test';
  set session_replication_role=origin
$cleanup$);
select is((select residue_count from extensions.dblink(
  (select connection_string from correction_race_fixture),
  $q$select (
    (select count(*) from auth.users where email like '%@race.test')+
    (select count(*) from public.profiles where login like 'bc-owner-%' or login like 'bc-admin1-%' or login like 'bc-admin2-%')+
    (select count(*) from public.benefit_correction_requests where source_url in ('https://example.com/race','https://example.com/cas'))
  )::integer$q$
) as r(residue_count integer)),0,'concurrency test removes every committed race fixture from the shared database');

select extensions.dblink_disconnect('bc_one');
select extensions.dblink_disconnect('bc_two');
select extensions.dblink_disconnect('bc_setup');

select * from finish();
rollback;
