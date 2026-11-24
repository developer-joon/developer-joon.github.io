begin;
select no_plan();
create extension if not exists dblink with schema extensions;
create temporary table company_review_v2_race(actor uuid,requester uuid,request_id uuid,client_key uuid,connection_string text,second_pid integer);
insert into company_review_v2_race values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=8000 -c lock_timeout=5000'),null);
create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '3 seconds') returns boolean language plpgsql as $$declare deadline timestamptz:=clock_timestamp()+p_timeout;begin loop if exists(select 1 from pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true;end if;if clock_timestamp()>=deadline then return false;end if;perform pg_sleep(0.01);end loop;end$$;
select extensions.dblink_connect('cr_setup',connection_string),extensions.dblink_connect('cr_one',connection_string),extensions.dblink_connect('cr_two',connection_string) from company_review_v2_race;
select extensions.dblink_exec('cr_setup',format($q$
 create temporary table cr_ids(id uuid primary key);
 insert into cr_ids values(%L),(%L);
 create temporary table cr_feature as select enabled from private.benefit_feature_settings where setting_key='company_add_write_enabled';
 insert into auth.users(id,aud,role,email) values(%L,'authenticated','authenticated',%L),(%L,'authenticated','authenticated',%L);
 insert into public.profiles(id,github_user_id,login) values(%L,99801,%L),(%L,99802,%L);
 insert into public.user_roles(user_id,role) values(%L,'admin'),(%L,'member');
 insert into auth.identities(provider_id,user_id,identity_data,provider) values(%L,%L,'{}','google');
 update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='company_add_write_enabled';
 insert into public.benefit_company_add_requests(request_id,requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,verification_method,verification_status,status)
 values(%L,%L,gen_random_uuid(),repeat('a',64),'Concurrent Review','concurrentreview','manual','pending','pending_review');
 insert into public.benefit_company_add_events(request_id,actor_kind,actor_id,action,to_status,metadata) values(%L,'requester',%L,'requested','pending_review','{}')
$q$,actor,requester,actor,actor::text||'@race.test',requester,requester::text||'@race.test',actor,'cr-admin',requester,'cr-requester',actor,requester,'cr-google-'||actor::text,actor,request_id,requester,request_id,requester)) from company_review_v2_race;
select extensions.dblink_exec('cr_two',$fn$create function pg_temp.review(p_key uuid,p_request uuid) returns text language plpgsql as $$begin return public.review_benefit_company_request_v2(p_key,p_request,'pending_review',1,'reject','same payload',null)::text;exception when others then return sqlstate;end$$;grant execute on function pg_temp.review(uuid,uuid) to authenticated$fn$);
select extensions.dblink_exec('cr_one','begin');select extensions.dblink_exec('cr_one','set local role authenticated');select extensions.dblink_exec('cr_one',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
create temporary table cr_first(value jsonb);insert into cr_first select value::jsonb from company_review_v2_race f cross join lateral extensions.dblink('cr_one',format($fmt$select public.review_benefit_company_request_v2(%L,%L,'pending_review',1,'reject','same payload',null)::text$fmt$,f.client_key,f.request_id)) r(value text);
select extensions.dblink_exec('cr_two','begin');select extensions.dblink_exec('cr_two','set local role authenticated');select extensions.dblink_exec('cr_two',format('set local request.jwt.claim.sub=%L',actor)) from company_review_v2_race;
update company_review_v2_race set second_pid=(select pid from extensions.dblink('cr_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('cr_two',format('select pg_temp.review(%L,%L)',client_key,request_id)) from company_review_v2_race;
select ok((select pg_temp.wait_for_lock(second_pid) from company_review_v2_race),'same actor/key review contender waits on deterministic advisory lock');
select extensions.dblink_exec('cr_one','commit');
create temporary table cr_second(value text);insert into cr_second select * from extensions.dblink_get_result('cr_two') r(value text);select count(*) from extensions.dblink_get_result('cr_two') r(value text);select extensions.dblink_exec('cr_two','commit');
select is((select value::jsonb from cr_second),(select value from cr_first),'concurrent same-key workers return identical stored response');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_review_v2_race),format('select client_key from private.benefit_company_review_requests where actor_snapshot=%L and client_key=%L',(select actor from company_review_v2_race),(select client_key from company_review_v2_race))) r(client_key uuid)),1,'concurrent replay stores one durable ledger row');
select is((select revision from extensions.dblink((select connection_string from company_review_v2_race),format('select revision from public.benefit_company_add_requests where request_id=%L',(select request_id from company_review_v2_race))) r(revision bigint)),2::bigint,'concurrent replay performs one transition');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_review_v2_race),format($fmt$select event_id from public.benefit_company_add_events where request_id=%L and action='rejected'$fmt$,(select request_id from company_review_v2_race))) r(event_id uuid)),1,'concurrent replay emits one audit event');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_review_v2_race),format($fmt$select id from public.rate_limit_events where user_id=%L and action='benefit_company_add.review'$fmt$,(select actor from company_review_v2_race))) r(id uuid)),1,'concurrent replay consumes one rate event');
select extensions.dblink_exec('cr_setup',$q$set session_replication_role=replica;delete from public.rate_limit_events where user_id in(select id from cr_ids);delete from private.benefit_company_review_requests where actor_snapshot in(select id from cr_ids);delete from public.benefit_company_add_events where request_id in(select request_id from public.benefit_company_add_requests where requester_id in(select id from cr_ids));delete from public.benefit_company_add_requests where requester_id in(select id from cr_ids);delete from auth.identities where user_id in(select id from cr_ids);delete from public.user_roles where user_id in(select id from cr_ids);delete from public.profiles where id in(select id from cr_ids);delete from auth.users where id in(select id from cr_ids);update private.benefit_feature_settings set enabled=(select enabled from cr_feature),updated_at=clock_timestamp() where setting_key='company_add_write_enabled';set session_replication_role=origin$q$);
select extensions.dblink_disconnect('cr_one');select extensions.dblink_disconnect('cr_two');select extensions.dblink_disconnect('cr_setup');
select is(cardinality(coalesce(extensions.dblink_get_connections(),array[]::text[])),0,'all concurrency connections close');
select * from finish();
rollback;
