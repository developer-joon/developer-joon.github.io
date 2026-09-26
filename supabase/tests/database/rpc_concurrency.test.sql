begin;

select plan(26);

create extension if not exists dblink with schema extensions;

create temporary table rpc_fixture (
  user_id uuid not null,
  user_two_id uuid not null,
  post_id uuid not null,
  parent_id uuid not null,
  github_user_id bigint not null,
  github_user_two_id bigint not null,
  connection_string text not null
);
create temporary table rpc_remote_errors (
  connection_name text primary key,
  sqlstate text not null,
  message text not null
);

create function pg_temp.collect_rpc_error(p_connection_name text)
returns void language plpgsql as $$
declare remote_sqlstate text; remote_message text;
begin
  perform * from extensions.dblink_get_result(p_connection_name, true) as result(value text);
  perform * from extensions.dblink_get_result(p_connection_name, false) as result(value text);
  insert into rpc_remote_errors values (p_connection_name, '00000', 'remote statement succeeded');
exception when others then
  get stacked diagnostics remote_sqlstate=returned_sqlstate, remote_message=message_text;
  perform * from extensions.dblink_get_result(p_connection_name, false) as result(value text);
  insert into rpc_remote_errors values (p_connection_name, remote_sqlstate, remote_message);
end;
$$;

insert into rpc_fixture
with random_prefixes as materialized (
  select
    substring(replace(gen_random_uuid()::text,'-','') for 28) as user_one_prefix,
    substring(replace(gen_random_uuid()::text,'-','') for 28) as user_two_prefix
)
select (user_one_prefix||'0001')::uuid, (user_two_prefix||'0002')::uuid, gen_random_uuid(), gen_random_uuid(),
       2000000000 + floor(random()*500000000)::bigint,
       2500000000 + floor(random()*500000000)::bigint,
       format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',
              coalesce(host(inet_server_addr()),'127.0.0.1'), inet_server_port(),
              current_database(), current_user,
              '-c statement_timeout=5000 -c lock_timeout=3000')
from random_prefixes;

select isnt(
  (get_byte(uuid_send(user_id),15)%64)::integer,
  (get_byte(uuid_send(user_two_id),15)%64)::integer,
  'parallel reaction fixture uses distinct counter shards'
)
from rpc_fixture;

select extensions.dblink_connect('rpc_setup', connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_setup', format($sql$
  insert into auth.users(id,aud,role,email) values
    (%L,'authenticated','authenticated',%L),
    (%L,'authenticated','authenticated',%L);
  insert into public.profiles(id,github_user_id,login) values
    (%L,%s,%L),
    (%L,%s,%L);
  insert into public.posts(id,author_id,title,body_markdown) values(%L,%L,'RPC race post','RPC race body');
  insert into public.comments(id,post_id,author_id,body_markdown) values(%L,%L,%L,'RPC race parent');
  insert into public.rate_limit_events(user_id,action,idempotency_key)
    select %L,'post.create','saturated-'||g from generate_series(1,5) g
$sql$, user_id, user_id::text||'@rpc-concurrency.example.test',
      user_two_id, user_two_id::text||'@rpc-concurrency.example.test',
      user_id, github_user_id, 'rpc-'||substring(replace(user_id::text,'-','') for 20),
      user_two_id, github_user_two_id, 'rpc-'||substring(replace(user_two_id::text,'-','') for 20), post_id, user_id,
      parent_id, post_id, user_id, user_id)) from rpc_fixture;

-- Every RPC rejects stale transaction snapshots before authentication, rate-limit,
-- or mutation logic. The actor is deliberately already rate-limited.
select extensions.dblink_connect('rpc_rr', connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_rr','begin isolation level repeatable read');
select extensions.dblink_exec('rpc_rr','set local role authenticated');
select extensions.dblink_exec('rpc_rr',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_rr',format($q$select public.create_post('RR blocked','unique rr body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'rr-key')::text$q$));
select pg_temp.collect_rpc_error('rpc_rr');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_rr'),'0A000','rate-limited create rejects REPEATABLE READ with SQLSTATE 0A000');
select is((select message from rpc_remote_errors where connection_name='rpc_rr'),'mutation RPCs require READ COMMITTED isolation','REPEATABLE READ uses the stable isolation message');
select extensions.dblink_exec('rpc_rr','rollback');
select extensions.dblink_disconnect('rpc_rr');

select extensions.dblink_connect('rpc_ser', connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_ser','begin isolation level serializable');
select extensions.dblink_exec('rpc_ser','set local role authenticated');
select extensions.dblink_exec('rpc_ser',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_ser',format($q$select public.create_post('SER blocked','unique ser body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'ser-key')::text$q$));
select pg_temp.collect_rpc_error('rpc_ser');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_ser'),'0A000','rate-limited create rejects SERIALIZABLE with SQLSTATE 0A000');
select is((select message from rpc_remote_errors where connection_name='rpc_ser'),'mutation RPCs require READ COMMITTED isolation','SERIALIZABLE uses the stable isolation message');
select extensions.dblink_exec('rpc_ser','rollback');
select extensions.dblink_disconnect('rpc_ser');

select extensions.dblink_exec('rpc_setup',format($sql$delete from public.rate_limit_events where user_id=%L and action='post.create'$sql$,user_id)) from rpc_fixture;
select ok(result.value::uuid is not null, 'READ COMMITTED remains supported')
from rpc_fixture f
cross join lateral extensions.dblink(f.connection_string, format($q$
  set role authenticated;
  set request.jwt.claim.sub=%L;
  select public.create_post('RC works','unique rc body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'rc-key')::text
$q$,f.user_id)) as result(value text);

-- The namespaced body lock serializes different idempotency keys so only one
-- whitespace-equivalent post can commit for the same caller.
select extensions.dblink_connect('rpc_dup_one',connection_string) from rpc_fixture;
select extensions.dblink_connect('rpc_dup_two',connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_dup_one','begin');
select extensions.dblink_exec('rpc_dup_one','set local role authenticated');
select extensions.dblink_exec('rpc_dup_one',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_dup_one',$sql$do $do$ begin perform public.create_post('Duplicate winner','concurrent duplicate body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'dup-one'); end $do$$sql$);
select extensions.dblink_exec('rpc_dup_two','begin');
select extensions.dblink_exec('rpc_dup_two','set local role authenticated');
select extensions.dblink_exec('rpc_dup_two',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_dup_two',$sql$select public.create_post('Duplicate loser',E' concurrent\n duplicate\tbody ',array['a1000000-0000-0000-0000-000000000001']::uuid[],'dup-two')::text$sql$);
select is(extensions.dblink_is_busy('rpc_dup_two'),1,'duplicate-body loser waits behind winner transaction');
select extensions.dblink_exec('rpc_dup_one','commit');
select pg_temp.collect_rpc_error('rpc_dup_two');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_dup_two'),'23505','concurrent duplicate loses with stable SQLSTATE');
select is((select message from rpc_remote_errors where connection_name='rpc_dup_two'),'duplicate post body within 10 minutes','concurrent duplicate loses with stable message');
select extensions.dblink_exec('rpc_dup_two','rollback');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format($sql$select id from public.posts where author_id=%L and private.normalize_duplicate_body(body_markdown)='concurrent duplicate body'$sql$,(select user_id from rpc_fixture))) as result(id uuid)),1,'concurrent duplicate defense commits exactly one post');
select extensions.dblink_disconnect('rpc_dup_one');
select extensions.dblink_disconnect('rpc_dup_two');

-- Future moderation must lock post then comment. The RPC follows that order,
-- waits behind the transition, and revalidates the parent after commit.
select extensions.dblink_connect('rpc_mod_parent',connection_string) from rpc_fixture;
select extensions.dblink_connect('rpc_reply',connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_mod_parent','begin');
select extensions.dblink_exec('rpc_mod_parent',format('update public.posts set updated_at=updated_at where id=%L',post_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_mod_parent',format($sql$update public.comments set status='deleted',deleted_at=clock_timestamp() where id=%L$sql$,parent_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_reply','begin');
select extensions.dblink_exec('rpc_reply','set local role authenticated');
select extensions.dblink_exec('rpc_reply',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_reply',format($q$select public.create_comment(%L,%L,'reply after delete','race-reply')::text$q$,post_id,parent_id)) from rpc_fixture;
select is(extensions.dblink_is_busy('rpc_reply'),1,'reply waits behind parent soft-delete transaction');
select extensions.dblink_exec('rpc_mod_parent','commit');
select pg_temp.collect_rpc_error('rpc_reply');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_reply'),'22023','reply loses parent-delete race with stable SQLSTATE');
select is((select message from rpc_remote_errors where connection_name='rpc_reply'),'parent must be a visible top-level comment on the same post','reply loses parent-delete race with stable message');
select extensions.dblink_exec('rpc_reply','rollback');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format('select id from public.comments where parent_id=%L', (select parent_id from rpc_fixture))) as result(id uuid)),0,'parent-delete race inserts no reply');
select extensions.dblink_disconnect('rpc_mod_parent');
select extensions.dblink_disconnect('rpc_reply');

-- A post transition holds the same row lock used by reaction/report RPCs.
select extensions.dblink_connect('rpc_mod_post',connection_string) from rpc_fixture;
select extensions.dblink_connect('rpc_react',connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_mod_post','begin');
select extensions.dblink_exec('rpc_mod_post',format($sql$update public.posts set status='hidden' where id=%L$sql$,post_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_react','begin');
select extensions.dblink_exec('rpc_react','set local role authenticated');
select extensions.dblink_exec('rpc_react',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_react',format($q$select public.toggle_post_reaction(%L)::text$q$,post_id)) from rpc_fixture;
select is(extensions.dblink_is_busy('rpc_react'),1,'reaction waits behind post visibility transition');
select extensions.dblink_exec('rpc_mod_post','commit');
select pg_temp.collect_rpc_error('rpc_react');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_react'),'22023','reaction loses post-hide race with stable SQLSTATE');
select is((select message from rpc_remote_errors where connection_name='rpc_react'),'post not found or visible','reaction loses post-hide race with stable message');
select extensions.dblink_exec('rpc_react','rollback');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format('select id from public.post_reactions where post_id=%L', (select post_id from rpc_fixture))) as result(id uuid)),0,'post-hide race inserts no reaction');
select extensions.dblink_disconnect('rpc_mod_post');
select extensions.dblink_disconnect('rpc_react');

-- Different users must be able to interact with the same visible post in
-- parallel. Shared visibility locks still conflict with moderation UPDATEs.
select extensions.dblink_exec('rpc_setup',format($sql$update public.posts set status='published' where id=%L$sql$,post_id)) from rpc_fixture;
select extensions.dblink_connect('rpc_share_one',connection_string) from rpc_fixture;
select extensions.dblink_connect('rpc_share_two',connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_share_one','begin');
select extensions.dblink_exec('rpc_share_one','set local role authenticated');
select extensions.dblink_exec('rpc_share_one',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_share_one',format($q$do $do$ begin perform public.toggle_post_reaction(%L); end $do$$q$,post_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_share_two','begin');
select extensions.dblink_exec('rpc_share_two','set local role authenticated');
select extensions.dblink_exec('rpc_share_two',format('set local request.jwt.claim.sub=%L',user_two_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_share_two',format($q$select public.toggle_post_reaction(%L)::text$q$,post_id)) from rpc_fixture;
select pg_catalog.pg_sleep(0.05);
select is(extensions.dblink_is_busy('rpc_share_two'),0,'different users do not serialize on the same visible post');
select pg_temp.collect_rpc_error('rpc_share_two');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_share_two'),'00000','parallel post interaction succeeds while another shared lock is held');
select extensions.dblink_exec('rpc_share_two','commit');
select extensions.dblink_exec('rpc_share_one','commit');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format('select id from public.post_reactions where post_id=%L', (select post_id from rpc_fixture))) as result(id uuid)),2,'parallel users persist two independent reactions');
select extensions.dblink_disconnect('rpc_share_one');
select extensions.dblink_disconnect('rpc_share_two');

-- The advisory rate lock makes the final slot atomic. The loser receives the
-- same PostgREST 429 contract used at the Data API boundary.
select extensions.dblink_exec('rpc_setup',format($sql$
  delete from public.rate_limit_events where user_id=%L and action='post.create';
  update public.rate_limit_rules set max_requests=1 where action='post.create' and window_seconds=600
$sql$,user_id)) from rpc_fixture;
select extensions.dblink_connect('rpc_rate_one',connection_string) from rpc_fixture;
select extensions.dblink_connect('rpc_rate_two',connection_string) from rpc_fixture;
select extensions.dblink_exec('rpc_rate_one','begin');
select extensions.dblink_exec('rpc_rate_one','set local role authenticated');
select extensions.dblink_exec('rpc_rate_one',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_exec('rpc_rate_one',$sql$do $do$ begin perform public.create_post('Rate winner','rate winner unique body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'rate-winner'); end $do$$sql$);
select extensions.dblink_exec('rpc_rate_two','begin');
select extensions.dblink_exec('rpc_rate_two','set local role authenticated');
select extensions.dblink_exec('rpc_rate_two',format('set local request.jwt.claim.sub=%L',user_id)) from rpc_fixture;
select extensions.dblink_send_query('rpc_rate_two',$sql$select public.create_post('Rate loser','rate loser unique body',array['a1000000-0000-0000-0000-000000000001']::uuid[],'rate-loser')::text$sql$);
select is(extensions.dblink_is_busy('rpc_rate_two'),1,'last-slot competitor waits behind the rate-limit transaction lock');
select extensions.dblink_exec('rpc_rate_one','commit');
select pg_temp.collect_rpc_error('rpc_rate_two');
select is((select sqlstate from rpc_remote_errors where connection_name='rpc_rate_two'),'PGRST','last-slot loser receives the PostgREST error SQLSTATE');
select is((select message from rpc_remote_errors where connection_name='rpc_rate_two'),'{"code":"rate_limit_exceeded","message":"Rate limit exceeded","details":"post.create","hint":"Retry later"}','last-slot loser receives the stable rate-limit payload');
select extensions.dblink_exec('rpc_rate_two','rollback');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format($sql$select id from public.rate_limit_events where user_id=%L and action='post.create'$sql$,(select user_id from rpc_fixture))) as result(id uuid)),1,'concurrent final-slot requests consume exactly one event');
select is((select count(*)::integer from extensions.dblink((select connection_string from rpc_fixture),format($sql$select id from public.posts where author_id=%L and title in ('Rate winner','Rate loser')$sql$,(select user_id from rpc_fixture))) as result(id uuid)),1,'concurrent final-slot requests create exactly one post');
select extensions.dblink_disconnect('rpc_rate_one');
select extensions.dblink_disconnect('rpc_rate_two');

select extensions.dblink_exec('rpc_setup',format($sql$
  delete from public.rate_limit_events where user_id in (%L,%L);
  update public.rate_limit_rules set max_requests=5 where action='post.create' and window_seconds=600;
  delete from public.idempotency_keys where user_id in (%L,%L);
  delete from public.posts where author_id=%L;
  delete from public.profiles where id in (%L,%L);
  delete from auth.users where id in (%L,%L)
$sql$,user_id,user_two_id,user_id,user_two_id,user_id,user_id,user_two_id,user_id,user_two_id)) from rpc_fixture;
select extensions.dblink_disconnect('rpc_setup');

select * from finish();
rollback;
