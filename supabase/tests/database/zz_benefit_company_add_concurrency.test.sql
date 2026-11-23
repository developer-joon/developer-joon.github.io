begin;
select no_plan();
create extension if not exists dblink with schema extensions;

create temporary table company_add_race_fixture(
 requester_id uuid,admin_one_id uuid,admin_two_id uuid,request_id uuid,merge_request_id uuid,
 same_key uuid,kill_key uuid,digest text,destination text,connection_string text,second_pid integer
);
insert into company_add_race_fixture
select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('c',64),null,
 format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=8000 -c lock_timeout=5000'),null;

create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '3 seconds') returns boolean language plpgsql as $$
declare v_deadline timestamptz:=clock_timestamp()+p_timeout;
begin loop
 if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true; end if;
 if clock_timestamp()>=v_deadline then return false; end if;
 perform pg_catalog.pg_sleep(0.01);
end loop; end $$;

select extensions.dblink_connect('ca_setup',connection_string) from company_add_race_fixture;
select extensions.dblink_exec('ca_setup',format($setup$
 create temporary table ca_feature_original(setting_key text primary key,enabled boolean not null);
 insert into ca_feature_original select setting_key,enabled from private.benefit_feature_settings where setting_key in ('company_add_write_enabled','nts_verification_enabled');
 create temporary table ca_actor_ids(id uuid primary key);
 insert into ca_actor_ids values (%L),(%L),(%L);
 insert into auth.users(id,aud,role,email) values (%L,'authenticated','authenticated',%L),(%L,'authenticated','authenticated',%L),(%L,'authenticated','authenticated',%L);
 insert into public.profiles(id,github_user_id,login) values (%L,995000001,%L),(%L,995000002,%L),(%L,995000003,%L);
 insert into public.user_roles(user_id,role) values (%L,'member'),(%L,'admin'),(%L,'admin');
 insert into auth.identities(provider_id,user_id,identity_data,provider) values (%L,%L,'{}','google');
 update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key in ('company_add_write_enabled','nts_verification_enabled');
 insert into public.benefit_company_add_requests(request_id,requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,verification_method,verification_status,status)
 values (%L,%L,gen_random_uuid(),repeat('a',64),'Approve Race','approve race','manual','pending','pending_review'),
        (%L,%L,gen_random_uuid(),repeat('b',64),'Approve Merge Race','approve merge race','manual','pending','pending_review');
 insert into public.benefit_company_add_events(request_id,actor_kind,actor_id,action,to_status,metadata) values
   (%L,'requester',%L,'requested','pending_review','{}'),(%L,'requester',%L,'requested','pending_review','{}')
$setup$,requester_id,admin_one_id,admin_two_id,
 requester_id,requester_id::text||'@company-add-race.test',admin_one_id,admin_one_id::text||'@company-add-race.test',admin_two_id,admin_two_id::text||'@company-add-race.test',
 requester_id,'ca-race-requester',admin_one_id,'ca-race-admin-one',admin_two_id,'ca-race-admin-two',requester_id,admin_one_id,admin_two_id,
 'ca-google-'||requester_id::text,requester_id,request_id,requester_id,merge_request_id,requester_id,request_id,requester_id,merge_request_id,requester_id
)) from company_add_race_fixture;

select extensions.dblink_connect('ca_one',connection_string),extensions.dblink_connect('ca_two',connection_string) from company_add_race_fixture;
select extensions.dblink_exec('ca_two',$fn$
 create or replace function pg_temp.try_review(p_request uuid,p_action text,p_destination text default null)
 returns text language plpgsql as $body$ begin
  perform public.review_benefit_company_request_v1(p_request,'pending_review',1,p_action,'race review',p_destination);
  return 'ok'; exception when others then return sqlstate; end $body$;
 grant execute on function pg_temp.try_review(uuid,text,text) to authenticated;
 create or replace function pg_temp.try_finalize(p_request uuid,p_fingerprint text,p_digest text)
 returns text language plpgsql as $body$ begin
  perform public.finalize_benefit_company_nts_request_v1(p_request,'pending',p_fingerprint,p_digest,clock_timestamp());
  return 'ok'; exception when others then return sqlstate; end $body$;
 grant execute on function pg_temp.try_finalize(uuid,text,text) to service_role;
 create or replace function pg_temp.try_create(p_key uuid,p_name text)
 returns text language plpgsql as $body$ begin
  perform public.create_manual_benefit_company_request_v1(p_key,p_name,null,null,null);
  return 'ok'; exception when others then return sqlstate; end $body$;
 grant execute on function pg_temp.try_create(uuid,text) to authenticated
$fn$);
select extensions.dblink_exec('ca_one',$fn$
 create or replace function pg_temp.try_review(p_request uuid,p_action text,p_destination text default null)
 returns text language plpgsql as $body$ begin
  perform public.review_benefit_company_request_v1(p_request,'pending_review',1,p_action,'race review',p_destination);
  return 'ok'; exception when others then return sqlstate; end $body$;
 grant execute on function pg_temp.try_review(uuid,text,text) to authenticated;
 create or replace function pg_temp.try_create(p_key uuid,p_name text)
 returns text language plpgsql as $body$ begin
  perform public.create_manual_benefit_company_request_v1(p_key,p_name,null,null,null);
  return 'ok'; exception when others then return sqlstate; end $body$;
 grant execute on function pg_temp.try_create(uuid,text) to authenticated
$fn$);

-- 1: two admins approve one request: one winner and one 40001 loser.
select extensions.dblink_exec('ca_one','begin');
select extensions.dblink_exec('ca_one','set local role authenticated');
select extensions.dblink_exec('ca_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from company_add_race_fixture;
select * from company_add_race_fixture f cross join lateral extensions.dblink('ca_one',format('select public.review_benefit_company_request_v1(%L,''pending_review'',1,''approve'',''winner'',null)::text',f.request_id)) r(value text);
select extensions.dblink_exec('ca_two','begin');
select extensions.dblink_exec('ca_two','set local role authenticated');
select extensions.dblink_exec('ca_two',format('set local request.jwt.claim.sub=%L',admin_two_id)) from company_add_race_fixture;
update company_add_race_fixture set second_pid=(select pid from extensions.dblink('ca_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('ca_two',format('select pg_temp.try_review(%L,''approve'',null)',request_id)) from company_add_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from company_add_race_fixture),'two-admin approval contender waits without deadlock');
select extensions.dblink_exec('ca_one','commit');
create temporary table approve_loser(value text);
insert into approve_loser select * from extensions.dblink_get_result('ca_two') r(value text);
select count(*) from extensions.dblink_get_result('ca_two') r(value text);
select extensions.dblink_exec('ca_two','commit');
select is((select value from approve_loser),'40001','two admins approving one request has a 40001 loser');
select is((select revision from extensions.dblink((select connection_string from company_add_race_fixture),format('select revision from public.benefit_company_add_requests where request_id=%L',(select request_id from company_add_race_fixture))) r(revision bigint)),2::bigint,'two-admin race leaves the exact current revision');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),format('select company_id from public.benefit_companies where company_id=(select resolved_company_id from public.benefit_company_add_requests where request_id=%L)',(select request_id from company_add_race_fixture))) r(company_id text)),1,'two-admin approval creates one company');

-- 2: approve versus merge has one terminal winner and a 40001 loser.
update company_add_race_fixture set destination=(select company_id from extensions.dblink(connection_string,format('select resolved_company_id from public.benefit_company_add_requests where request_id=%L',request_id)) r(company_id text));
select extensions.dblink_exec('ca_one','begin');
select extensions.dblink_exec('ca_one','set local role authenticated');
select extensions.dblink_exec('ca_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from company_add_race_fixture;
select * from company_add_race_fixture f cross join lateral extensions.dblink('ca_one',format('select public.review_benefit_company_request_v1(%L,''pending_review'',1,''approve'',''winner'',null)::text',f.merge_request_id)) r(value text);
select extensions.dblink_exec('ca_two','begin');
select extensions.dblink_exec('ca_two','set local role authenticated');
select extensions.dblink_exec('ca_two',format('set local request.jwt.claim.sub=%L',admin_two_id)) from company_add_race_fixture;
update company_add_race_fixture set second_pid=(select pid from extensions.dblink('ca_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('ca_two',format('select pg_temp.try_review(%L,''merge'',%L)',merge_request_id,destination)) from company_add_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from company_add_race_fixture),'approve-versus-merge contender waits without deadlock');
select extensions.dblink_exec('ca_one','commit');
create temporary table merge_loser(value text);
insert into merge_loser select * from extensions.dblink_get_result('ca_two') r(value text);
select count(*) from extensions.dblink_get_result('ca_two') r(value text);
select extensions.dblink_exec('ca_two','commit');
select is((select value from merge_loser),'40001','approve versus merge has a 40001 loser');
select is((select revision from extensions.dblink((select connection_string from company_add_race_fixture),format('select revision from public.benefit_company_add_requests where request_id=%L',(select merge_request_id from company_add_race_fixture))) r(revision bigint)),2::bigint,'approve-versus-merge race increments revision once');

-- 3: two NTS finalizers with one strong digest converge on one canonical company.
select extensions.dblink_exec('ca_setup',format($q$
 insert into public.benefit_company_add_requests(request_id,requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,verification_method,verification_status,status)
 values (%L,%L,gen_random_uuid(),repeat('d',64),'NTS Race One','nts race one','nts_full','pending','pending_review'),
        (%L,%L,gen_random_uuid(),repeat('e',64),'NTS Race Two','nts race two','nts_full','pending','pending_review')
$q$,gen_random_uuid(),requester_id,gen_random_uuid(),requester_id)) from company_add_race_fixture;
create temporary table nts_ids as select * from extensions.dblink((select connection_string from company_add_race_fixture),$$select request_id,payload_fingerprint from public.benefit_company_add_requests where proposed_name like 'NTS Race %' order by proposed_name$$) r(request_id uuid,payload_fingerprint text);
select extensions.dblink_exec('ca_one','begin'); select extensions.dblink_exec('ca_one','set local role service_role');
select * from nts_ids n cross join lateral extensions.dblink('ca_one',format('select public.finalize_benefit_company_nts_request_v1(%L,''pending'',%L,%L,clock_timestamp())::text',n.request_id,n.payload_fingerprint,(select digest from company_add_race_fixture))) r(value text) limit 1;
select extensions.dblink_exec('ca_two','begin'); select extensions.dblink_exec('ca_two','set local role service_role');
update company_add_race_fixture set second_pid=(select pid from extensions.dblink('ca_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('ca_two',format('select pg_temp.try_finalize(%L,%L,%L)',(select request_id from nts_ids offset 1 limit 1),(select payload_fingerprint from nts_ids offset 1 limit 1),(select digest from company_add_race_fixture)));
select ok((select pg_temp.wait_for_lock(second_pid) from company_add_race_fixture),'same-digest NTS finalizer waits on strong identifier boundary');
select extensions.dblink_exec('ca_one','commit');
create temporary table nts_second(value text); insert into nts_second select * from extensions.dblink_get_result('ca_two') r(value text); select count(*) from extensions.dblink_get_result('ca_two') r(value text); select extensions.dblink_exec('ca_two','commit');
select is((select value from nts_second),'ok','same-digest second finalizer completes successfully');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),format('select company_id from public.benefit_company_identifiers where identifier_type=''business_number_hmac_v1'' and identifier_digest_or_value=%L',(select digest from company_add_race_fixture))) r(company_id text)),1,'same digest has one identifier and canonical company');
select is((select count(distinct company_id)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select resolved_company_id company_id from public.benefit_company_add_requests where proposed_name like 'NTS Race %'$$) r(company_id text)),1,'duplicate digest requests resolve to one company');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select request_id from public.benefit_company_add_requests where proposed_name like 'NTS Race %' and verification_status='matched' and revision=2$$) r(request_id uuid)),2,'both same-digest requests are matched at exact revision two');
select is((select array_agg(status order by status) from extensions.dblink((select connection_string from company_add_race_fixture),$$select status from public.benefit_company_add_requests where proposed_name like 'NTS Race %'$$) r(status text)),array['approved','merged']::text[],'same-digest requests end as exactly one approved and one merged');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select e.event_id from public.benefit_company_add_events e join public.benefit_company_add_requests r using(request_id) where r.proposed_name like 'NTS Race %' and ((r.status='approved' and e.action='approved') or (r.status='merged' and e.action='merged'))$$) r(event_id uuid)),2,'each same-digest request has one matching safe terminal event');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select r.request_id from public.benefit_company_add_requests r where r.proposed_name like 'NTS Race %' and (r.status='pending_review' or r.verification_status='pending' or r.resolved_company_id is null or (select count(*) from public.benefit_company_add_events e where e.request_id=r.request_id and e.action in ('approved','merged'))<>1)$$) r(request_id uuid)),0,'same-digest race leaves no pending or terminal-event orphan');

-- 4/5: same actor/key same payload converges; changed payload rejects without a second mutation.
select extensions.dblink_exec('ca_one','begin'); select extensions.dblink_exec('ca_one','set local role authenticated'); select extensions.dblink_exec('ca_one',format('set local request.jwt.claim.sub=%L',requester_id)) from company_add_race_fixture;
create temporary table create_one(value jsonb); insert into create_one select r.value::jsonb from company_add_race_fixture f cross join lateral extensions.dblink('ca_one',format('select public.create_manual_benefit_company_request_v1(%L,''Same Key Co'',null,null,null)::text',f.same_key)) r(value text);
select extensions.dblink_exec('ca_two','begin'); select extensions.dblink_exec('ca_two','set local role authenticated'); select extensions.dblink_exec('ca_two',format('set local request.jwt.claim.sub=%L',requester_id)) from company_add_race_fixture;
update company_add_race_fixture set second_pid=(select pid from extensions.dblink('ca_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('ca_two',format('select public.create_manual_benefit_company_request_v1(%L,''Same Key Co'',null,null,null)::text',same_key)) from company_add_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from company_add_race_fixture),'same-key create waits for winner');
select extensions.dblink_exec('ca_one','commit'); create temporary table create_two(value jsonb); insert into create_two select value::jsonb from extensions.dblink_get_result('ca_two') r(value text); select count(*) from extensions.dblink_get_result('ca_two') r(value text); select extensions.dblink_exec('ca_two','commit');
select is((select value->>'request_id' from create_one),(select value->>'request_id' from create_two),'concurrent same-key payload returns one request identity');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),format('select request_id from public.benefit_company_add_requests where requester_id=%L and client_key=%L',(select requester_id from company_add_race_fixture),(select same_key from company_add_race_fixture))) r(request_id uuid)),1,'same-key create stores one request');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),format('select id from public.rate_limit_events where user_id=%L and action=''benefit_company_add.create'' and idempotency_key=%L',(select requester_id from company_add_race_fixture),(select same_key::text from company_add_race_fixture))) r(id uuid)),1,'same-key create charges one rate slot');
select extensions.dblink_exec('ca_one','begin'); select extensions.dblink_exec('ca_one','set local role authenticated'); select extensions.dblink_exec('ca_one',format('set local request.jwt.claim.sub=%L',requester_id)) from company_add_race_fixture;
select is((select value from company_add_race_fixture f cross join lateral extensions.dblink('ca_one',format($q$select pg_temp.try_create(%L,'Changed Co')$q$,f.same_key)) r(value text) limit 1),'22023','same key with changed payload rejects deterministically');
select extensions.dblink_exec('ca_one','rollback');

-- 6: committed switch OFF is observed after a waiting mutation acquires the settings row.
select extensions.dblink_exec('ca_one','begin');
select extensions.dblink_exec('ca_one',$$update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key='company_add_write_enabled'$$);
select extensions.dblink_exec('ca_two','begin'); select extensions.dblink_exec('ca_two','set local role authenticated'); select extensions.dblink_exec('ca_two',format('set local request.jwt.claim.sub=%L',requester_id)) from company_add_race_fixture;
update company_add_race_fixture set second_pid=(select pid from extensions.dblink('ca_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('ca_two',format($q$select pg_temp.try_create(%L,'Killed Co')$q$,kill_key)) from company_add_race_fixture;
select ok((select pg_temp.wait_for_lock(second_pid) from company_add_race_fixture),'mutation waits behind feature-setting update');
select extensions.dblink_exec('ca_one','commit');
create temporary table kill_result(value text); insert into kill_result select * from extensions.dblink_get_result('ca_two') r(value text); select count(*) from extensions.dblink_get_result('ca_two') r(value text); select extensions.dblink_exec('ca_two','commit');
select is((select value from kill_result),'55000','waiting mutation fails closed with exact switch-off SQLSTATE');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select request_id from public.benefit_company_add_requests where proposed_name='Killed Co'$$) r(request_id uuid)),0,'no write occurs after switch-off commit');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select e.event_id from public.benefit_company_add_events e join public.benefit_company_add_requests r using(request_id) where r.proposed_name='Killed Co'$$) r(event_id uuid)),0,'switch-off loser leaves no request event');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),format($q$select id from public.rate_limit_events where user_id=%L and action='benefit_company_add.create' and idempotency_key=%L$q$,(select requester_id from company_add_race_fixture),(select kill_key::text from company_add_race_fixture))) r(id uuid)),0,'switch-off loser consumes no rate slot');
select extensions.dblink_exec('ca_setup',$q$update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='company_add_write_enabled'$q$);

-- 7: injected late event failure rolls back company and request transition.
select extensions.dblink_exec('ca_setup',format($q$
 insert into public.benefit_company_add_requests(request_id,requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,verification_method,verification_status,status)
 values (%L,%L,gen_random_uuid(),repeat('f',64),'Rollback Co','rollback co','manual','pending','pending_review')
$q$,gen_random_uuid(),requester_id)) from company_add_race_fixture;
create temporary table rollback_request_id as select * from extensions.dblink((select connection_string from company_add_race_fixture),$$select request_id from public.benefit_company_add_requests where proposed_name='Rollback Co'$$) r(request_id uuid);
select extensions.dblink_exec('ca_one',$fn$create function pg_temp.fail_company_add_event() returns trigger language plpgsql as $$begin if new.action='approved' then raise exception 'injected late event failure'; end if; return new; end$$; create trigger fail_company_add_event before insert on public.benefit_company_add_events for each row execute function pg_temp.fail_company_add_event()$fn$);
select extensions.dblink_exec('ca_one','begin'); select extensions.dblink_exec('ca_one','set local role authenticated'); select extensions.dblink_exec('ca_one',format('set local request.jwt.claim.sub=%L',admin_one_id)) from company_add_race_fixture;
create temporary table rollback_result(value text); insert into rollback_result select value from rollback_request_id i cross join lateral extensions.dblink('ca_one',format('select pg_temp.try_review(%L,''approve'',null)',i.request_id)) r(value text); select extensions.dblink_exec('ca_one','rollback');
select is((select value from rollback_result),'P0001','injected late event failure is surfaced');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select request_id from public.benefit_company_add_requests where proposed_name='Rollback Co' and status='pending_review' and revision=1 and resolved_company_id is null$$) r(request_id uuid)),1,'late failure rolls back company, request, and revision writes');
select is((select count(*)::integer from extensions.dblink((select connection_string from company_add_race_fixture),$$select company_id from public.benefit_companies where display_name='Rollback Co'$$) r(company_id text)),0,'late failure leaves no orphan company');

-- 8: explicit cleanup, zero exact fixture residue, and all dblink handles close.
select extensions.dblink_exec('ca_setup',$cleanup$
 set session_replication_role=replica;
 create temporary table ca_company_ids(company_id text primary key);
 insert into ca_company_ids select distinct c.company_id from public.benefit_companies c join public.benefit_company_add_requests r on c.provenance->>'company_add_request_id'=r.request_id::text where r.requester_id in (select id from ca_actor_ids);
 delete from public.rate_limit_events where user_id in (select id from ca_actor_ids);
 delete from public.benefit_company_add_events where request_id in (select request_id from public.benefit_company_add_requests where requester_id in (select id from ca_actor_ids));
 delete from public.benefit_company_add_requests where requester_id in (select id from ca_actor_ids);
 delete from public.benefit_company_identifiers where company_id in (select company_id from ca_company_ids);
 delete from public.benefit_companies where company_id in (select company_id from ca_company_ids);
 delete from auth.identities where user_id in (select id from ca_actor_ids);
 delete from public.user_roles where user_id in (select id from ca_actor_ids);
 delete from public.profiles where id in (select id from ca_actor_ids); delete from auth.users where id in (select id from ca_actor_ids);
 update private.benefit_feature_settings s set enabled=o.enabled,updated_at=clock_timestamp() from ca_feature_original o where s.setting_key=o.setting_key;
 set session_replication_role=origin
$cleanup$);
select is((select residue from extensions.dblink('ca_setup',$q$select ((select count(*) from public.profiles where id in (select id from ca_actor_ids))+(select count(*) from auth.users where id in (select id from ca_actor_ids))+(select count(*) from public.benefit_company_add_requests where requester_id in (select id from ca_actor_ids)))::integer$q$) r(residue integer)),0,'exact concurrency fixture residue is zero');
select is((select residue from extensions.dblink('ca_setup',$q$select ((select count(*) from public.benefit_companies c join ca_company_ids f using(company_id))+(select count(*) from public.benefit_company_identifiers i join ca_company_ids f using(company_id)))::integer$q$) r(residue integer)),0,'exact fixture companies and identifiers are removed');
select ok((select restored from extensions.dblink('ca_setup',$q$select bool_and(s.enabled=o.enabled) from private.benefit_feature_settings s join ca_feature_original o using(setting_key)$q$) r(restored boolean)),'feature switches are restored to their original values');
select extensions.dblink_disconnect('ca_one'); select extensions.dblink_disconnect('ca_two'); select extensions.dblink_disconnect('ca_setup');
select is(pg_catalog.cardinality(coalesce(extensions.dblink_get_connections(),array[]::text[])),0,'all dblink connections close');
select * from finish();
rollback;
