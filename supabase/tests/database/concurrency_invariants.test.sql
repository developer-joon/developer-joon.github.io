begin;

select plan(9);

create extension if not exists dblink with schema extensions;

create temporary table concurrency_fixture (
  user_id uuid not null,
  post_id uuid not null,
  github_user_id bigint not null,
  connection_string text not null
);

create temporary table remote_errors (
  connection_name text primary key,
  sqlstate text not null,
  message text not null
);

create function pg_temp.collect_dblink_error(p_connection_name text)
returns void
language plpgsql
as $$
declare
  remote_sqlstate text;
  remote_message text;
begin
  perform *
    from extensions.dblink_get_result(p_connection_name, true) as result(status text);

  insert into remote_errors values (p_connection_name, '00000', 'remote statement succeeded');
exception
  when others then
    get stacked diagnostics
      remote_sqlstate = returned_sqlstate,
      remote_message = message_text;
    perform *
      from extensions.dblink_get_result(p_connection_name, false) as result(status text);
    insert into remote_errors values (p_connection_name, remote_sqlstate, remote_message);
end;
$$;

insert into concurrency_fixture
select
  gen_random_uuid(),
  gen_random_uuid(),
  1000000000 + floor(random() * 1000000000)::bigint,
  format(
    'hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',
    coalesce(host(inet_server_addr()), '127.0.0.1'),
    inet_server_port(),
    current_database(),
    current_user,
    '-c statement_timeout=5000 -c lock_timeout=3000'
  );

select extensions.dblink_connect('tag_setup', connection_string)
from concurrency_fixture;
select extensions.dblink_exec(
  'tag_setup',
  format(
    $setup$
      insert into auth.users (id, aud, role, email)
      values (%L, 'authenticated', 'authenticated', %L);
      insert into public.profiles (id, github_user_id, login)
      values (%L, %s, %L);
      insert into public.posts (id, author_id, title, body_markdown)
      values (%L, %L, 'Concurrent tag post', 'Concurrent tag post');
      insert into public.post_tags (post_id, tag_id) values
        (%L, 'a1000000-0000-0000-0000-000000000001'),
        (%L, 'a1000000-0000-0000-0000-000000000002')
    $setup$,
    user_id,
    user_id::text || '@concurrency.example.test',
    user_id,
    github_user_id,
    'concurrency-' || substring(replace(user_id::text, '-', '') for 20),
    post_id,
    user_id,
    post_id,
    post_id
  )
)
from concurrency_fixture;

-- READ COMMITTED: the per-post advisory transaction lock makes the second
-- writer wait, then lets it count the first writer's committed third tag.
select extensions.dblink_connect('tag_rc_one', connection_string)
from concurrency_fixture;
select extensions.dblink_connect('tag_rc_two', connection_string)
from concurrency_fixture;
select extensions.dblink_exec('tag_rc_one', 'begin isolation level read committed');
select extensions.dblink_exec('tag_rc_two', 'begin isolation level read committed');
select is(
  extensions.dblink_exec(
    'tag_rc_one',
    format(
      $$insert into public.post_tags (post_id, tag_id)
        values (%L, 'a1000000-0000-0000-0000-000000000003')$$,
      post_id
    )
  ),
  'INSERT 0 1',
  'one READ COMMITTED insert claims the third tag slot'
)
from concurrency_fixture;
select extensions.dblink_send_query(
  'tag_rc_two',
  format(
    $$insert into public.post_tags (post_id, tag_id)
      values (%L, 'a1000000-0000-0000-0000-000000000004')$$,
    post_id
  )
)
from concurrency_fixture;
select is(
  extensions.dblink_is_busy('tag_rc_two'),
  1,
  'the competing READ COMMITTED insert is blocked before the winner commits'
);
select extensions.dblink_exec('tag_rc_one', 'commit');
select pg_temp.collect_dblink_error('tag_rc_two');
select is(
  (select sqlstate from remote_errors where connection_name = 'tag_rc_two'),
  '23514',
  'the competing READ COMMITTED insert fails with the tag-limit SQLSTATE'
);
select is(
  (select message from remote_errors where connection_name = 'tag_rc_two'),
  'a post may have at most 3 tags',
  'the competing READ COMMITTED insert fails with the stable tag-limit message'
);
select extensions.dblink_exec('tag_rc_two', 'rollback');
select is(
  (select count(*)::integer from public.post_tags where post_id = (select post_id from concurrency_fixture)),
  3,
  'READ COMMITTED concurrent inserts preserve the three-tag invariant'
);
select extensions.dblink_disconnect('tag_rc_one');
select extensions.dblink_disconnect('tag_rc_two');

-- Stronger snapshots are rejected explicitly instead of depending on stale
-- snapshot or serialization timing.
select extensions.dblink_connect('tag_rr', connection_string)
from concurrency_fixture;
select extensions.dblink_exec('tag_rr', 'begin isolation level repeatable read');
select extensions.dblink_send_query(
  'tag_rr',
  format(
    $$insert into public.post_tags (post_id, tag_id)
      values (%L, 'a1000000-0000-0000-0000-000000000004')$$,
    post_id
  )
)
from concurrency_fixture;
select pg_temp.collect_dblink_error('tag_rr');
select is((select sqlstate from remote_errors where connection_name = 'tag_rr'), '0A000', 'REPEATABLE READ insert is rejected with SQLSTATE 0A000');
select is((select message from remote_errors where connection_name = 'tag_rr'), 'post_tags INSERT requires READ COMMITTED isolation', 'REPEATABLE READ insert is rejected with the stable isolation message');
select extensions.dblink_exec('tag_rr', 'rollback');
select extensions.dblink_disconnect('tag_rr');

select extensions.dblink_connect('tag_serializable', connection_string)
from concurrency_fixture;
select extensions.dblink_exec('tag_serializable', 'begin isolation level serializable');
select extensions.dblink_send_query(
  'tag_serializable',
  format(
    $$insert into public.post_tags (post_id, tag_id)
      values (%L, 'a1000000-0000-0000-0000-000000000004')$$,
    post_id
  )
)
from concurrency_fixture;
select pg_temp.collect_dblink_error('tag_serializable');
select is((select sqlstate from remote_errors where connection_name = 'tag_serializable'), '0A000', 'SERIALIZABLE insert is rejected with SQLSTATE 0A000');
select is((select message from remote_errors where connection_name = 'tag_serializable'), 'post_tags INSERT requires READ COMMITTED isolation', 'SERIALIZABLE insert is rejected with the stable isolation message');
select extensions.dblink_exec('tag_serializable', 'rollback');
select extensions.dblink_disconnect('tag_serializable');

-- Explicit cleanup makes successful repeated runs leave no fixture residue;
-- randomized identifiers prevent collisions after an interrupted run.
select extensions.dblink_exec(
  'tag_setup',
  format(
    $cleanup$
      delete from public.post_tags where post_id = %L;
      delete from public.posts where id = %L;
      delete from public.profiles where id = %L;
      delete from auth.users where id = %L
    $cleanup$,
    post_id,
    post_id,
    user_id,
    user_id
  )
)
from concurrency_fixture;
select extensions.dblink_disconnect('tag_setup');

select * from finish();
rollback;