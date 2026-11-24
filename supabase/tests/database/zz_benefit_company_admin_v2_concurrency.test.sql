begin;
select no_plan();
create extension if not exists dblink with schema extensions;

-- Durable dblink fixtures reserve c31/c32/c33/c34/c35 for recovery.
create temporary table company_review_v2_race(actor uuid,requester uuid,same_request uuid,changed_request uuid,same_key uuid,changed_key uuid,connection_string text,second_pid integer);
insert into company_review_v2_race values(
 'c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002',
 'c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002',
 'c3300000-0000-4000-8000-000000000001','c3300000-0000-4000-8000-000000000002',
 format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=8000 -c lock_timeout=5000'),null);
create temporary table cr_observations(name text primary key,value text not null);
create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '3 seconds') returns boolean language plpgsql as $$declare deadline timestamptz:=clock_timestamp()+p_timeout;begin loop if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true;end if;if clock_timestamp()>=deadline then return false;end if;perform pg_catalog.pg_sleep(0.01);end loop;end$$;
select extensions.dblink_connect('cr_setup',connection_string) from company_review_v2_race;

-- Recover a killed prior run. SET LOCAL restores trigger behavior when an
-- ON_ERROR_STOP caller receives a cleanup error and this transaction aborts.
select extensions.dblink_exec('cr_setup',$cleanup$
begin;
set local session_replication_role=replica;
delete from public.rate_limit_events where user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from private.benefit_company_review_requests where actor_snapshot in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002') or request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002');
delete from public.benefit_company_add_events where request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002');
delete from public.benefit_company_add_requests where request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002') or requester_id='c3100000-0000-4000-8000-000000000002';
delete from auth.identities where id in ('c3500000-0000-4000-8000-000000000001','c3500000-0000-4000-8000-000000000002') or user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from public.user_roles where user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from public.profiles where id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from auth.users where id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';
commit
$cleanup$);
insert into cr_observations select 'startup_residue',value from extensions.dblink('cr_setup',$q$
select (select count(*) from public.rate_limit_events where user_id::text like 'c3100000-%')::text||':'||(select count(*) from private.benefit_company_review_requests where actor_snapshot::text like 'c3100000-%' or request_id::text like 'c3200000-%')::text||':'||(select count(*) from public.benefit_company_add_events where request_id::text like 'c3200000-%')::text||':'||(select count(*) from public.benefit_company_add_requests where request_id::text like 'c3200000-%' or requester_id::text like 'c3100000-%')::text||':'||(select count(*) from auth.identities where id::text like 'c3500000-%' or user_id::text like 'c3100000-%')::text||':'||(select count(*) from public.user_roles where user_id::text like 'c3100000-%')::text||':'||(select count(*) from public.profiles where id::text like 'c3100000-%')::text||':'||(select count(*) from auth.users where id::text like 'c3100000-%')::text
$q$) r(value text);
insert into cr_observations select 'startup_feature',value from extensions.dblink('cr_setup',$q$select enabled::text from private.benefit_feature_settings where setting_key='company_add_write_enabled'$q$) r(value text);

select extensions.dblink_exec('cr_setup',$setup$
begin;
insert into auth.users(id,aud,role,email) values ('c3100000-0000-4000-8000-000000000001','authenticated','authenticated','c31-admin@company-review-v2-race.test'),('c3100000-0000-4000-8000-000000000002','authenticated','authenticated','c31-requester@company-review-v2-race.test');
insert into public.profiles(id,github_user_id,login) values ('c3100000-0000-4000-8000-000000000001',998310001,'cr-v2-admin'),('c3100000-0000-4000-8000-000000000002',998310002,'cr-v2-requester');
insert into public.user_roles(user_id,role) values ('c3100000-0000-4000-8000-000000000001','admin'),('c3100000-0000-4000-8000-000000000002','member');
insert into auth.identities(id,provider_id,user_id,identity_data,provider) values ('c3500000-0000-4000-8000-000000000001','cr-v2-admin-google','c3100000-0000-4000-8000-000000000001','{}','google'),('c3500000-0000-4000-8000-000000000002','cr-v2-requester-google','c3100000-0000-4000-8000-000000000002','{}','google');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';
insert into public.benefit_company_add_requests(request_id,requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,verification_method,verification_status,status) values
 ('c3200000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002','c3300000-0000-4000-8000-000000000011',repeat('a',64),'Concurrent Same Review','concurrent same review','manual','pending','pending_review'),
 ('c3200000-0000-4000-8000-000000000002','c3100000-0000-4000-8000-000000000002','c3300000-0000-4000-8000-000000000012',repeat('b',64),'Concurrent Changed Review','concurrent changed review','manual','pending','pending_review');
insert into public.benefit_company_add_events(event_id,request_id,actor_kind,actor_id,action,to_status,metadata) values
 ('c3400000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000001','requester','c3100000-0000-4000-8000-000000000002','requested','pending_review','{}'),
 ('c3400000-0000-4000-8000-000000000002','c3200000-0000-4000-8000-000000000002','requester','c3100000-0000-4000-8000-000000000002','requested','pending_review','{}');
commit
$setup$);
select extensions.dblink_connect('cr_one',connection_string),extensions.dblink_connect('cr_two',connection_string) from company_review_v2_race;
select extensions.dblink_exec('cr_one',$fn$create function pg_temp.review(p_key uuid,p_request uuid,p_reason text) returns text language plpgsql as $$begin return 'OK:'||public.review_benefit_company_request_v2(p_key,p_request,'pending_review',1,'reject',p_reason,null)::text;exception when others then return 'ERR:'||sqlstate;end$$;grant execute on function pg_temp.review(uuid,uuid,text) to authenticated$fn$);
select extensions.dblink_exec('cr_two',$fn$create function pg_temp.review(p_key uuid,p_request uuid,p_reason text) returns text language plpgsql as $$begin return 'OK:'||public.review_benefit_company_request_v2(p_key,p_request,'pending_review',1,'reject',p_reason,null)::text;exception when others then return 'ERR:'||sqlstate;end$$;grant execute on function pg_temp.review(uuid,uuid,text) to authenticated$fn$);

-- Same-payload replay race.
select extensions.dblink_exec('cr_one','begin');select extensions.dblink_exec('cr_one','set local role authenticated');select extensions.dblink_exec('cr_one',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
insert into cr_observations select 'same_first',value from company_review_v2_race f cross join lateral extensions.dblink('cr_one',format('select pg_temp.review(%L,%L,%L)',f.same_key,f.same_request,'same payload')) r(value text);
select extensions.dblink_exec('cr_two','begin');select extensions.dblink_exec('cr_two','set local role authenticated');select extensions.dblink_exec('cr_two',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
update company_review_v2_race set second_pid=(select pid from extensions.dblink('cr_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('cr_two',format('select pg_temp.review(%L,%L,%L)',same_key,same_request,'same payload')) from company_review_v2_race;
insert into cr_observations select 'same_wait',pg_temp.wait_for_lock(second_pid)::text from company_review_v2_race;
select extensions.dblink_exec('cr_one','commit');insert into cr_observations select 'same_second',value from extensions.dblink_get_result('cr_two') r(value text);select count(*) from extensions.dblink_get_result('cr_two') r(value text);select extensions.dblink_exec('cr_two','commit');

-- Changed payload on one actor/client key: one mutation, one caught 22023.
select extensions.dblink_exec('cr_one','begin');select extensions.dblink_exec('cr_one','set local role authenticated');select extensions.dblink_exec('cr_one',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
insert into cr_observations select 'changed_first',value from company_review_v2_race f cross join lateral extensions.dblink('cr_one',format('select pg_temp.review(%L,%L,%L)',f.changed_key,f.changed_request,'canonical payload')) r(value text);
select extensions.dblink_exec('cr_two','begin');select extensions.dblink_exec('cr_two','set local role authenticated');select extensions.dblink_exec('cr_two',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
update company_review_v2_race set second_pid=(select pid from extensions.dblink('cr_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('cr_two',format('select pg_temp.review(%L,%L,%L)',changed_key,changed_request,'changed payload')) from company_review_v2_race;
insert into cr_observations select 'changed_wait',pg_temp.wait_for_lock(second_pid)::text from company_review_v2_race;
select extensions.dblink_exec('cr_one','commit');insert into cr_observations select 'changed_second',value from extensions.dblink_get_result('cr_two') r(value text);select count(*) from extensions.dblink_get_result('cr_two') r(value text);select extensions.dblink_exec('cr_two','commit');

-- Capture outcomes and aggregates as text before cleanup; defer assertions/JSON casts.
insert into cr_observations select 'same_counts',value from company_review_v2_race f cross join lateral extensions.dblink(f.connection_string,format($q$select (select count(*) from private.benefit_company_review_requests where actor_snapshot=%L and client_key=%L)::text||':'||(select revision from public.benefit_company_add_requests where request_id=%L)::text||':'||(select count(*) from public.benefit_company_add_events where request_id=%L and action='rejected')::text||':'||(select count(*) from public.rate_limit_events where user_id=%L and action='benefit_company_add.review' and idempotency_key=%L)::text$q$,f.actor,f.same_key,f.same_request,f.same_request,f.actor,f.same_key::text)) r(value text);
insert into cr_observations select 'changed_counts',value from company_review_v2_race f cross join lateral extensions.dblink(f.connection_string,format($q$select (select count(*) from private.benefit_company_review_requests where actor_snapshot=%L and client_key=%L)::text||':'||(select revision from public.benefit_company_add_requests where request_id=%L)::text||':'||(select count(*) from public.benefit_company_add_events where request_id=%L and action='rejected')::text||':'||(select count(*) from public.rate_limit_events where user_id=%L and action='benefit_company_add.review' and idempotency_key=%L)::text$q$,f.actor,f.changed_key,f.changed_request,f.changed_request,f.actor,f.changed_key::text)) r(value text);

-- Expected and caught-worker-error paths clean up before reporting failures.
select extensions.dblink_exec('cr_setup',$cleanup$
begin;
set local session_replication_role=replica;
delete from public.rate_limit_events where user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from private.benefit_company_review_requests where actor_snapshot in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002') or request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002');
delete from public.benefit_company_add_events where request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002');
delete from public.benefit_company_add_requests where request_id in ('c3200000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000002') or requester_id='c3100000-0000-4000-8000-000000000002';
delete from auth.identities where id in ('c3500000-0000-4000-8000-000000000001','c3500000-0000-4000-8000-000000000002') or user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from public.user_roles where user_id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from public.profiles where id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
delete from auth.users where id in ('c3100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000002');
update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';
commit
$cleanup$);
insert into cr_observations select 'final_residue',value from extensions.dblink('cr_setup',$q$
select (select count(*) from public.rate_limit_events where user_id::text like 'c3100000-%')::text||':'||(select count(*) from private.benefit_company_review_requests where actor_snapshot::text like 'c3100000-%' or request_id::text like 'c3200000-%')::text||':'||(select count(*) from public.benefit_company_add_events where request_id::text like 'c3200000-%')::text||':'||(select count(*) from public.benefit_company_add_requests where request_id::text like 'c3200000-%' or requester_id::text like 'c3100000-%')::text||':'||(select count(*) from auth.identities where id::text like 'c3500000-%' or user_id::text like 'c3100000-%')::text||':'||(select count(*) from public.user_roles where user_id::text like 'c3100000-%')::text||':'||(select count(*) from public.profiles where id::text like 'c3100000-%')::text||':'||(select count(*) from auth.users where id::text like 'c3100000-%')::text
$q$) r(value text);
insert into cr_observations select 'final_feature',value from extensions.dblink('cr_setup',$q$select enabled::text from private.benefit_feature_settings where setting_key='company_add_write_enabled'$q$) r(value text);
select extensions.dblink_disconnect('cr_one');select extensions.dblink_disconnect('cr_two');select extensions.dblink_disconnect('cr_setup');
insert into cr_observations values('final_connections',pg_catalog.cardinality(coalesce(extensions.dblink_get_connections(),array[]::text[]))::text);

select is((select value from cr_observations where name='final_residue'),'0:0:0:0:0:0:0:0','post-cleanup residue is exactly zero in every fixture table');
select is((select value from cr_observations where name='final_feature'),'false','post-cleanup feature flag equals the known test default');
select is((select value from cr_observations where name='final_connections'),'0','all concurrency connections close before outcome assertions');
select is((select value from cr_observations where name='startup_residue'),'0:0:0:0:0:0:0:0','startup recovery leaves the reserved prefix clean before setup');
select is((select value from cr_observations where name='startup_feature'),'false','startup recovery restores the known test-default feature flag');
select is((select value from cr_observations where name='same_wait'),'true','same-payload contender waits on the deterministic advisory lock');
select ok((select value like 'OK:%' from cr_observations where name='same_first'),'same-payload canonical worker succeeds');
select is((select substring(value from 4)::jsonb from cr_observations where name='same_second'),(select substring(value from 4)::jsonb from cr_observations where name='same_first'),'same-payload contender returns the stored canonical response');
select is((select value from cr_observations where name='same_counts'),'1:2:1:1','same-payload race stores one ledger, transition, audit, and rate side effect');
select is((select value from cr_observations where name='changed_wait'),'true','changed-payload contender waits on the deterministic advisory lock');
select ok((select value like 'OK:%' from cr_observations where name='changed_first'),'changed-payload canonical worker succeeds exactly once');
select is((select value from cr_observations where name='changed_second'),'ERR:22023','changed-payload contender commits the caught 22023 outcome');
select is((select value from cr_observations where name='changed_counts'),'1:2:1:1','changed-payload race stores one ledger, transition, audit, and rate side effect');
select * from finish();
rollback;
