begin;
select no_plan();

create extension if not exists dblink with schema extensions;

create temporary table benefit_directory_race_fixture (
  connection_string text not null,
  first_id uuid not null,
  second_id uuid not null,
  second_pid integer
);

insert into benefit_directory_race_fixture
select format(
    'hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',
    coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,
    '-c statement_timeout=8000 -c lock_timeout=5000'
  ),gen_random_uuid(),gen_random_uuid(),null;

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

select extensions.dblink_connect('bd_setup',connection_string) from benefit_directory_race_fixture;
select extensions.dblink_connect('bd_one',connection_string) from benefit_directory_race_fixture;
select extensions.dblink_connect('bd_two',connection_string) from benefit_directory_race_fixture;

select extensions.dblink_exec('bd_setup',$cleanup$
  delete from public.benefit_publications where company_id='KR-BIZ-9900000001';
  delete from public.benefit_companies where company_id='KR-BIZ-9900000001'
$cleanup$);
select extensions.dblink_exec('bd_setup',$setup$
  insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition,provenance)
  values ('KR-BIZ-9900000001','base_legal_identity','Benefit Directory Race','benefit directory race',false,'race-fixture','{}');
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values ('b9000000-0000-0000-0000-000000000001','KR-BIZ-9900000001','health','Race predecessor','race fixture','official_verified','active','race-lineage',1,'official_ledger','{}')
$setup$);

select extensions.dblink_exec('bd_one','begin');
select extensions.dblink_exec('bd_one',format($q$
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values (%L,'KR-BIZ-9900000001','health','Race successor one','race fixture','official_verified','active','race-lineage',2,'b9000000-0000-0000-0000-000000000001','official_ledger','{}');
  update public.benefit_publications set status='superseded' where publication_id='b9000000-0000-0000-0000-000000000001'
$q$,first_id)) from benefit_directory_race_fixture;
select extensions.dblink_exec('bd_two','begin');
select extensions.dblink_exec('bd_two',format($q$
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values (%L,'KR-BIZ-9900000001','health','Race successor two','race fixture','official_verified','active','race-lineage',3,'official_ledger','{}')
$q$,second_id)) from benefit_directory_race_fixture;
select extensions.dblink_exec('bd_two',$fn$
  create or replace function pg_temp.try_active_lineage_check()
  returns text language plpgsql as $body$
  begin
    set constraints all immediate;
    return 'ok';
  exception when others then return sqlstate||':'||sqlerrm; end
  $body$
$fn$);
update benefit_directory_race_fixture
set second_pid=(select pid from extensions.dblink('bd_two','select pg_backend_pid()') as r(pid integer));

select extensions.dblink_exec('bd_one',$lock$
  do $body$ begin
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('benefit-publication-active-lineage:'||pg_catalog.jsonb_build_array('KR-BIZ-9900000001','race-lineage')::text,0)
    );
  end $body$
$lock$);
select extensions.dblink_send_query('bd_two','select pg_temp.try_active_lineage_check()');
select ok((select pg_temp.wait_for_lock(second_pid) from benefit_directory_race_fixture),'competing active successor commit waits on the lineage advisory lock');
select extensions.dblink_exec('bd_one','commit');
create temporary table loser_result(value text);
insert into loser_result select * from extensions.dblink_get_result('bd_two') as r(value text);
select count(*) from extensions.dblink_get_result('bd_two') as r(value text);
select extensions.dblink_exec('bd_two','rollback');
select is((select value from loser_result),'23514:benefit publication lineage may have at most one active publication','exactly one concurrent successor is rejected by the deferred lineage constraint');

select is((select active_count from benefit_directory_race_fixture f cross join lateral extensions.dblink(
  f.connection_string,
  $$select count(*)::integer from public.benefit_publications where company_id='KR-BIZ-9900000001' and dedupe_key='race-lineage' and status='active'$$
) as r(active_count integer)),1,'concurrent active successors leave exactly one committed active publication');

select extensions.dblink_exec('bd_setup',$cleanup$
  delete from public.benefit_publications where company_id='KR-BIZ-9900000001';
  delete from public.benefit_companies where company_id='KR-BIZ-9900000001'
$cleanup$);
select is((select residue_count from benefit_directory_race_fixture f cross join lateral extensions.dblink(
  f.connection_string,
  $$select ((select count(*) from public.benefit_publications where company_id='KR-BIZ-9900000001')+(select count(*) from public.benefit_companies where company_id='KR-BIZ-9900000001'))::integer$$
) as r(residue_count integer)),0,'concurrency test removes its shared fixtures');

select extensions.dblink_disconnect('bd_one');
select extensions.dblink_disconnect('bd_two');
select extensions.dblink_disconnect('bd_setup');

select * from finish();
rollback;