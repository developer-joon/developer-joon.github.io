begin;
select no_plan();
create extension if not exists dblink with schema extensions;

create temporary table reaction_race_fixture(connection_string text,owner_id uuid,u2 uuid,u3 uuid,u4 uuid,u5 uuid,u6 uuid,u7 uuid,second_pid integer);
insert into reaction_race_fixture
select format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=10000 -c lock_timeout=6000'),
 'b7100000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000002','b7100000-0000-4000-8000-000000000003','b7100000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-000000000005','b7100000-0000-4000-8000-000000000006','b7100000-0000-4000-8000-000000000007',null;

create function pg_temp.wait_for_lock(p_pid integer,p_timeout interval default interval '4 seconds') returns boolean language plpgsql as $$
declare v_deadline timestamptz:=clock_timestamp()+p_timeout;
begin loop
 if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_pid and wait_event_type='Lock') then return true; end if;
 if clock_timestamp()>=v_deadline then return false; end if;
 perform pg_catalog.pg_sleep(0.01);
end loop; end $$;

create function pg_temp.wait_for_result(p_connection text,p_timeout interval default interval '4 seconds') returns boolean language plpgsql as $$
declare v_deadline timestamptz:=clock_timestamp()+p_timeout;
begin loop
 if extensions.dblink_is_busy(p_connection)=0 then return true; end if;
 if clock_timestamp()>=v_deadline then return false; end if;
 perform pg_catalog.pg_sleep(0.01);
end loop; end $$;

select extensions.dblink_connect('br_setup',connection_string),extensions.dblink_connect('br_one',connection_string),extensions.dblink_connect('br_two',connection_string) from reaction_race_fixture;
select extensions.dblink_exec('br_setup',$cleanup$
 set session_replication_role=replica;
 delete from public.rate_limit_events where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from public.benefit_claim_reaction_requests where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claim_events where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claim_reactions where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claims where company_id='KR-BIZ-9971000001';
 delete from public.benefit_publications where company_id='KR-BIZ-9971000001';
 delete from public.benefit_companies where company_id='KR-BIZ-9971000001';
 delete from public.user_roles where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from auth.identities where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from public.profiles where login like 'br-race-%';
 delete from auth.users where email like '%@br-race.test';
 update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key in ('claims_write_enabled','claim_reactions_write_enabled');
 set session_replication_role=origin
$cleanup$);
select extensions.dblink_exec('br_setup',$setup$
 insert into auth.users(id,aud,role,email)
 select ('b7100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'authenticated','authenticated','br-race-'||g||'@br-race.test' from generate_series(1,7) g;
 insert into public.profiles(id,github_user_id,login)
 select ('b7100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,99710000+g,'br-race-'||g from generate_series(1,7) g;
 insert into public.user_roles(user_id,role) select id,'member' from public.profiles where login like 'br-race-%';
 insert into auth.identities(provider_id,user_id,identity_data,provider) select login,id,'{}','google' from public.profiles where login like 'br-race-%';
 insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values ('KR-BIZ-9971000001','registered_business','Reaction Race Company','reaction race company',true,'race-test');
 update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key in ('claims_write_enabled','claim_reactions_write_enabled');
 insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on) values
 ('b7200000-0000-4000-8000-000000000001','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('1',64),'health','Third confirmer race','third confirmer race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000002','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('2',64),'leave','Confirm dispute race','confirm dispute race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000003','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('3',64),'remote','Same actor race','same actor race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000004','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('4',64),'family','Dispute replacement race','dispute replacement race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000005','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('5',64),'growth','Hide race','hide race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000006','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('6',64),'housing','Switch race','switch race','Race fixture','',date '2026-01-01'),
 ('b7200000-0000-4000-8000-000000000007','KR-BIZ-9971000001','b7100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('7',64),'commute','Late failure race','late failure race','Race fixture','',date '2026-01-01');
 insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values
 ('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000002','confirm'),
 ('b7200000-0000-4000-8000-000000000001','b7100000-0000-4000-8000-000000000003','confirm'),
 ('b7200000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-000000000002','dispute'),
 ('b7200000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-000000000003','confirm'),
 ('b7200000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-000000000004','confirm'),
 ('b7200000-0000-4000-8000-000000000004','b7100000-0000-4000-8000-000000000005','confirm');
 update public.benefit_claims set status='disputed',revision=2,updated_at=clock_timestamp() where claim_id='b7200000-0000-4000-8000-000000000004';
$setup$);

select extensions.dblink_exec(c,$fn$
 create or replace function pg_temp.try_react(p_claim uuid,p_reaction text,p_key uuid)
 returns text language plpgsql as $body$
 begin return public.set_benefit_claim_reaction_v1(p_claim,p_reaction,p_key)::text;
 exception when others then return 'ERR:'||sqlstate; end $body$;
 grant execute on function pg_temp.try_react(uuid,text,uuid) to authenticated
$fn$) from unnest(array['br_one','br_two']) c;

-- Two distinct users both observe the two-confirm baseline and race to promote.
select extensions.dblink_exec('br_one','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000004''');
create temporary table race_one(value text);
insert into race_one select value from extensions.dblink('br_one',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000001','confirm','b7300000-0000-4000-8000-000000000001')$q$) r(value text);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000005''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000001','confirm','b7300000-0000-4000-8000-000000000002')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'second would-be third confirmer waits on claim lock');
select extensions.dblink_exec('br_one','commit');
create temporary table race_two(value text); insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text);
select extensions.dblink_exec('br_two','commit');
select ok((select value not like 'ERR:%' from race_one) and (select value not like 'ERR:%' from race_two),'both confirmer results complete without deadlock');
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)::integer from public.benefit_claim_reactions where claim_id='b7200000-0000-4000-8000-000000000001' and reaction='confirm'$$) r(n integer)),4,'third-confirmer race preserves all four real confirmations');
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)::integer from public.benefit_publications where provenance->>'claim_id'='b7200000-0000-4000-8000-000000000001' and status='active'$$) r(n integer)),1,'third-confirmer race creates one active publication');
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)::integer from public.benefit_claim_events where claim_id='b7200000-0000-4000-8000-000000000001' and event_type in ('promoted','repromoted')$$) r(n integer)),1,'third-confirmer race emits one promotion event');

-- Confirm commits before a waiting dispute; final state reflects both rows.
truncate race_one,race_two;
select extensions.dblink_exec('br_one','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
insert into race_one select value from extensions.dblink('br_one',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000002','confirm','b7300000-0000-4000-8000-000000000010')$q$) r(value text);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000003''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000002','dispute','b7300000-0000-4000-8000-000000000011')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'confirm/dispute race serializes on claim');
select extensions.dblink_exec('br_one','commit'); insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text); select extensions.dblink_exec('br_two','commit');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select status||':'||(select count(*) from public.benefit_claim_reactions where claim_id=c.claim_id and reaction='confirm')||':'||(select count(*) from public.benefit_claim_reactions where claim_id=c.claim_id and reaction='dispute') from public.benefit_claims c where claim_id='b7200000-0000-4000-8000-000000000002'$$) r(state text)),'disputed:1:1','confirm/dispute race converges to true counts and disputed state');

-- Same actor sends different intents; one row remains and later serialization wins.
truncate race_one,race_two;
select extensions.dblink_exec('br_one','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
insert into race_one select value from extensions.dblink('br_one',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000003','confirm','b7300000-0000-4000-8000-000000000020')$q$) r(value text);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000003','dispute','b7300000-0000-4000-8000-000000000021')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'same-actor different reactions serialize without deadlock');
select extensions.dblink_exec('br_one','commit'); insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text); select extensions.dblink_exec('br_two','commit');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)||':'||min(reaction) from public.benefit_claim_reactions where claim_id='b7200000-0000-4000-8000-000000000003'$$) r(state text)),'1:dispute','same-actor race leaves one final row with no lost update');
select ok((select value::jsonb->>'reaction'='confirm' from race_one) and (select value::jsonb->>'reaction'='dispute' from race_two),'same-actor responses match their serialized results');

-- Removing the only dispute races a new dispute: promotion is immediately and atomically demoted.
truncate race_one,race_two;
select extensions.dblink_exec('br_one','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
select extensions.dblink_send_query('br_one',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000004',null,'b7300000-0000-4000-8000-000000000030')$q$);
select ok(pg_temp.wait_for_result('br_one'),'dispute remover returns before the competing worker starts');
insert into race_one select value from extensions.dblink_get_result('br_one') r(value text); select count(*) from extensions.dblink_get_result('br_one') r(value text);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000006''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000004','dispute','b7300000-0000-4000-8000-000000000031')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'dispute removal/new dispute serialize on claim');
select extensions.dblink_exec('br_one','commit'); insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text); select extensions.dblink_exec('br_two','commit');
select ok((select pg_catalog.count(*)=1 and pg_catalog.bool_and(value not like 'ERR:%' and (case when value like 'ERR:%' then null else value::jsonb end)->>'reaction' is null and (case when value like 'ERR:%' then null else value::jsonb end)->>'status'='community_confirmed') from race_one),'dispute remover executed successfully and returned its promotion');
select ok((select pg_catalog.count(*)=1 and pg_catalog.bool_and(value not like 'ERR:%' and (case when value like 'ERR:%' then null else value::jsonb end)->>'reaction'='dispute' and (case when value like 'ERR:%' then null else value::jsonb end)->>'status' in ('community_confirmed','disputed')) from race_two),'new dispute worker executed successfully and returned a valid dispute response');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select status||':'||revision||':'||coalesce(active_publication_id::text,'null')||':'||(select count(*) from public.benefit_claim_reactions where claim_id=c.claim_id and reaction='confirm')||':'||(select count(*) from public.benefit_claim_reactions where claim_id=c.claim_id and reaction='dispute') from public.benefit_claims c where claim_id='b7200000-0000-4000-8000-000000000004'$$) r(state text)),'disputed:4:null:3:1','dispute race converges to exact reactions and claim state');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*) filter(where status='active')||':'||count(*) filter(where status='withdrawn') from public.benefit_publications where provenance->>'claim_id'='b7200000-0000-4000-8000-000000000004'$$) r(state text)),'0:1','dispute race leaves one retired publication and no active lineage');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)||':'||count(*) filter(where event_type in ('promoted','repromoted'))||':'||count(*) filter(where event_type='demoted') from public.benefit_claim_events where claim_id='b7200000-0000-4000-8000-000000000004'$$) r(state text)),'2:1:1','dispute race records exactly one promotion and one demotion transition');

-- A moderator-style hide owns the claim row; a queued reaction rechecks visibility.
select extensions.dblink_exec('br_one',$q$begin; update public.benefit_claims set status='hidden',revision=revision+1,updated_at=clock_timestamp() where claim_id='b7200000-0000-4000-8000-000000000005'$q$);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000005','confirm','b7300000-0000-4000-8000-000000000040')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'reaction waits behind moderator claim lock');
select extensions.dblink_exec('br_one','commit'); truncate race_two; insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text); select extensions.dblink_exec('br_two','commit');
select is((select value from race_two),'ERR:22023','reaction cannot commit after claim becomes hidden');
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select count(*)::integer from public.benefit_claim_reactions where claim_id='b7200000-0000-4000-8000-000000000005'$$) r(n integer)),0,'hidden race has no reaction side effect');

-- Writer blocks at the actor-profile step; a committed switch-off is observed before any write.
select extensions.dblink_exec('br_one',$q$begin; do $lock$begin perform 1 from public.profiles where id='b7100000-0000-4000-8000-000000000002' for update; end$lock$$q$);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000002''');
update reaction_race_fixture set second_pid=(select pid from extensions.dblink('br_two','select pg_backend_pid()') r(pid integer));
select extensions.dblink_send_query('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000006','confirm','b7300000-0000-4000-8000-000000000050')$q$);
select ok((select pg_temp.wait_for_lock(second_pid) from reaction_race_fixture),'writer waits at documented actor/profile lock');
select extensions.dblink_exec('br_setup',$$update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key='claim_reactions_write_enabled'$$);
select extensions.dblink_exec('br_one','commit'); truncate race_two; insert into race_two select value from extensions.dblink_get_result('br_two') r(value text); select count(*) from extensions.dblink_get_result('br_two') r(value text); select extensions.dblink_exec('br_two','commit');
select is((select value from race_two),'ERR:55000','writer observes committed kill-switch flip');
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select (select count(*) from public.benefit_claim_reactions where claim_id='b7200000-0000-4000-8000-000000000006')+(select count(*) from public.benefit_claim_reaction_requests where claim_id='b7200000-0000-4000-8000-000000000006')+(select count(*) from public.rate_limit_events where idempotency_key='b7300000-0000-4000-8000-000000000050')$$) r(n bigint)),0::bigint,'switch-off leaves no reaction, audit, or rate side effect');
select extensions.dblink_exec('br_setup',$$update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claim_reactions_write_enabled'$$);

-- A deliberately late publication failure commits the caught error transaction and still leaves no partial state.
select extensions.dblink_exec('br_setup',$q$
 insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values
 ('b7200000-0000-4000-8000-000000000007','b7100000-0000-4000-8000-000000000003','confirm'),
 ('b7200000-0000-4000-8000-000000000007','b7100000-0000-4000-8000-000000000004','confirm');
 create or replace function public.br_reject_claim_publication() returns trigger language plpgsql as $$begin raise exception 'late failure'; end$$;
 create trigger br_late_failure before insert on public.benefit_publications for each row when (new.source_type='claim_reaction') execute function public.br_reject_claim_publication()
$q$);
select extensions.dblink_exec('br_two','begin; set local role authenticated; set local request.jwt.claim.sub=''b7100000-0000-4000-8000-000000000005''');
truncate race_two; insert into race_two select value from extensions.dblink('br_two',$q$select pg_temp.try_react('b7200000-0000-4000-8000-000000000007','confirm','b7300000-0000-4000-8000-000000000060')$q$) r(value text); select extensions.dblink_exec('br_two','commit');
select is((select value from race_two),'ERR:P0001','late publication failure is returned after worker commits caught error');
select extensions.dblink_exec('br_setup','drop trigger br_late_failure on public.benefit_publications; drop function public.br_reject_claim_publication()');
select is((select state from extensions.dblink((select connection_string from reaction_race_fixture),$$select status||':'||(select count(*) from public.benefit_claim_reactions where claim_id=c.claim_id)||':'||(select count(*) from public.benefit_claim_reaction_requests where claim_id=c.claim_id) from public.benefit_claims c where claim_id='b7200000-0000-4000-8000-000000000007'$$) r(state text)),'submitted:2:0','late failure rolls back reaction, state, and request audit');

select extensions.dblink_exec('br_setup',$cleanup$
 set session_replication_role=replica;
 delete from public.rate_limit_events where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from public.benefit_claim_reaction_requests where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claim_events where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claim_reactions where claim_id in (select claim_id from public.benefit_claims where company_id='KR-BIZ-9971000001');
 delete from public.benefit_claims where company_id='KR-BIZ-9971000001';
 delete from public.benefit_publications where company_id='KR-BIZ-9971000001';
 delete from public.benefit_companies where company_id='KR-BIZ-9971000001';
 delete from public.user_roles where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from auth.identities where user_id in (select id from public.profiles where login like 'br-race-%');
 delete from public.profiles where login like 'br-race-%';
 delete from auth.users where email like '%@br-race.test';
 update private.benefit_feature_settings set enabled=false,updated_at=clock_timestamp() where setting_key in ('claims_write_enabled','claim_reactions_write_enabled');
 set session_replication_role=origin
$cleanup$);
select is((select n from extensions.dblink((select connection_string from reaction_race_fixture),$$select ((select count(*) from public.benefit_companies where company_id='KR-BIZ-9971000001')+(select count(*) from public.profiles where login like 'br-race-%'))::integer$$) r(n integer)),0,'concurrency fixtures are removed');
select extensions.dblink_disconnect('br_one'); select extensions.dblink_disconnect('br_two'); select extensions.dblink_disconnect('br_setup');
select * from finish();
rollback;
