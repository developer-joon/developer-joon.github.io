begin;

select plan(97);

insert into auth.users (id, aud, role, email) values
  ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mut-a@example.test'),
  ('a1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mut-b@example.test'),
  ('a1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mut-admin@example.test');
insert into public.profiles (id, github_user_id, login, display_name) values
  ('a1000000-0000-0000-0000-000000000001', 92001, 'mut-a', 'Mutation A'),
  ('a1000000-0000-0000-0000-000000000002', 92002, 'mut-b', 'Mutation B'),
  ('a1000000-0000-0000-0000-000000000003', 92003, 'mut-admin', 'Mutation Admin');
insert into public.user_roles(user_id, role) values ('a1000000-0000-0000-0000-000000000003', 'admin');
insert into public.tags(id, slug, label, is_active, sort_order) values
  ('a3000000-0000-0000-0000-000000000001', 'mut-one', 'Mutation One', true, 911),
  ('a3000000-0000-0000-0000-000000000002', 'mut-two', 'Mutation Two', true, 912),
  ('a3000000-0000-0000-0000-000000000003', 'mut-three', 'Mutation Three', true, 913),
  ('a3000000-0000-0000-0000-000000000004', 'mut-four', 'Mutation Four', true, 914),
  ('a3000000-0000-0000-0000-000000000005', 'mut-off', 'Mutation Off', false, 915);
insert into public.posts(id, author_id, title, body_markdown, status, is_locked) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Mutation visible', 'visible body', 'published', false),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Mutation hidden', 'hidden body', 'hidden', false),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Mutation locked', 'locked body', 'published', true);
insert into public.comments(id, post_id, author_id, body_markdown, status) values
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'reaction visible', 'published'),
  ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'reaction hidden', 'hidden'),
  ('a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'locked post comment', 'published');

-- Function shape, hardening, and exact grants.
select has_function('public', 'create_post', array['text','text','uuid[]','text'], 'create_post RPC exists');
select has_function('public', 'update_post', array['uuid','text','text','uuid[]'], 'update_post RPC exists');
select has_function('public', 'soft_delete_post', array['uuid'], 'soft_delete_post RPC exists');
select has_function('public', 'create_comment', array['uuid','uuid','text','text'], 'create_comment RPC exists');
select has_function('public', 'update_comment', array['uuid','text'], 'update_comment RPC exists');
select has_function('public', 'soft_delete_comment', array['uuid'], 'soft_delete_comment RPC exists');
select has_function('public', 'toggle_post_reaction', array['uuid'], 'toggle_post_reaction RPC exists');
select has_function('public', 'toggle_comment_reaction', array['uuid'], 'toggle_comment_reaction RPC exists');
select has_function('public', 'create_report', array['text','uuid','text','text','text'], 'create_report RPC exists');
select has_function('private', 'require_read_committed', array[]::text[], 'private isolation guard exists');
select has_function('private', 'normalize_duplicate_body', array['text'], 'private duplicate-body normalizer exists');
select is((select provolatile from pg_proc where oid='private.normalize_duplicate_body(text)'::regprocedure), 'i'::"char", 'duplicate-body normalizer is immutable');
select ok(not has_function_privilege('public','private.normalize_duplicate_body(text)','EXECUTE'), 'PUBLIC cannot execute duplicate-body normalizer');
select ok((p.prosecdef and p.proconfig=array['search_path=""']), signature || ' is hardened')
from unnest(array['public.create_post(text,text,uuid[],text)','public.update_post(uuid,text,text,uuid[])','public.soft_delete_post(uuid)','public.create_comment(uuid,uuid,text,text)','public.update_comment(uuid,text)','public.soft_delete_comment(uuid)','public.toggle_post_reaction(uuid)','public.toggle_comment_reaction(uuid)','public.create_report(text,uuid,text,text,text)']) signature
join pg_proc p on p.oid=signature::regprocedure;
select ok(not has_function_privilege('public', signature, 'EXECUTE') and not has_function_privilege('anon', signature, 'EXECUTE') and has_function_privilege('authenticated', signature, 'EXECUTE')=(signature not like 'public.toggle_%' and signature not like 'public.create_report(%'), signature || ' has exact execution grants')
from unnest(array['public.create_post(text,text,uuid[],text)','public.update_post(uuid,text,text,uuid[])','public.soft_delete_post(uuid)','public.create_comment(uuid,uuid,text,text)','public.update_comment(uuid,text)','public.soft_delete_comment(uuid)','public.toggle_post_reaction(uuid)','public.toggle_comment_reaction(uuid)','public.create_report(text,uuid,text,text,text)']) signature;
select ok(p.prosrc ~ 'begin[[:space:]]+perform private.require_read_committed\(\);', signature || ' starts with the READ COMMITTED guard')
from unnest(array['public.create_post(text,text,uuid[],text)','public.update_post(uuid,text,text,uuid[])','public.soft_delete_post(uuid)','public.create_comment(uuid,uuid,text,text)','public.update_comment(uuid,text)','public.soft_delete_comment(uuid)','public.toggle_post_reaction(uuid)','public.toggle_comment_reaction(uuid)','public.create_report(text,uuid,text,text,text)']) signature
join pg_proc p on p.oid=signature::regprocedure;

set local role anon;
select throws_like($$select public.create_post('No auth', 'body', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'anon-key')$$, '%permission denied%', 'anon cannot invoke create_post');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
create temporary table mutation_results(name text primary key, id uuid, flag boolean);
insert into mutation_results(name,id) select 'post-first', public.create_post('Created safely', 'created body', array['a3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002']::uuid[], 'post-key-1');
insert into mutation_results(name,id) select 'post-replay', public.create_post('Created safely', 'created body', array['a3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002']::uuid[], 'post-key-1');
select is((select id from mutation_results where name='post-replay'), (select id from mutation_results where name='post-first'), 'same create-post key and request replays same resource');
select is(public.create_post('Created safely', 'created body', array['a3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001']::uuid[], '  post-key-1  '), (select id from mutation_results where name='post-first'), 'trimmed key and reordered tags replay the post');
select is((select count(*)::integer from public.posts where id=(select id from mutation_results where name='post-first')), 1, 'idempotent replay creates one post');
select is((select author_id from public.posts where id=(select id from mutation_results where name='post-first')), 'a1000000-0000-0000-0000-000000000001'::uuid, 'post author derives from auth.uid');
select is((select count(*)::integer from public.post_tags where post_id=(select id from mutation_results where name='post-first')), 2, 'post create atomically stores requested tags');
select throws_like($$select public.create_post('Changed request', 'created body', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'post-key-1')$$, '%idempotency key reused with different request%', 'same key with different create-post request is rejected');
select throws_like($$select public.create_post('No tags', 'body', array[]::uuid[], 'post-no-tags')$$, '%between 1 and 3 active tags%', 'post create requires at least one tag');
select throws_like($$select public.create_post('Inactive tag', 'body', array['a3000000-0000-0000-0000-000000000005']::uuid[], 'post-off-tag')$$, '%between 1 and 3 active tags%', 'post create rejects inactive tag');
select throws_like($$select public.create_post('Duplicate tags', 'body', array['a3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001']::uuid[], 'post-dupe-tags')$$, '%between 1 and 3 active tags%', 'post create rejects duplicate tags');
select throws_ok($$select public.create_post('Long key', 'body', array['a3000000-0000-0000-0000-000000000001']::uuid[], repeat('x',201)||'   ')$$, '22023', 'invalid idempotency key', 'post validates canonical key length');
reset role;
update public.tags set is_active=false where id='a3000000-0000-0000-0000-000000000002';
set local role authenticated;
select is(public.create_post('Created safely', 'created body', array['a3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001']::uuid[], 'post-key-1'), (select id from mutation_results where name='post-first'), 'post replay precedes current active-tag validation');
reset role;
update public.tags set is_active=true where id='a3000000-0000-0000-0000-000000000002';
set local role authenticated;
insert into mutation_results(name,id) select 'post-canonical-key', public.create_post('Canonical key', 'canonical key body', array['a3000000-0000-0000-0000-000000000001']::uuid[], '  canonical-post-key  ');
select ok((select id from mutation_results where name='post-canonical-key') is not null, 'padded valid idempotency key creates a post');
reset role;
select is((select key from public.idempotency_keys where resource_id=(select id from mutation_results where name='post-canonical-key')), 'canonical-post-key', 'canonical key is stored once without padding');
select is((select idempotency_key from public.rate_limit_events where user_id='a1000000-0000-0000-0000-000000000001' and idempotency_key='canonical-post-key'), 'canonical-post-key', 'canonical key is used by rate-limit events');
set local role authenticated;
insert into mutation_results(name,id) select 'post-distinct', public.create_post('Different title', 'meaningfully different body', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'post-distinct-key');
select ok((select id from mutation_results where name='post-distinct') is not null, 'different post body is allowed');
select throws_ok($$select public.create_post('Whitespace duplicate', E'  created\n\t body  ', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'post-whitespace-duplicate')$$, '23505', 'duplicate post body within 10 minutes', 'whitespace-normalized duplicate post body is rejected across keys');
select lives_ok($$select public.update_post((select id from mutation_results where name='post-first'), 'Updated safely', 'updated body', array['a3000000-0000-0000-0000-000000000003']::uuid[])$$, 'owner updates post through RPC');
select is((select array_agg(tag_id order by tag_id) from public.post_tags where post_id=(select id from mutation_results where name='post-first')), array['a3000000-0000-0000-0000-000000000003']::uuid[], 'post update replaces tags using delete and insert');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select throws_like($$select public.update_post((select id from mutation_results where name='post-first'), 'Stolen title', 'stolen', array['a3000000-0000-0000-0000-000000000001']::uuid[])$$, '%post not found or not editable%', 'other user cannot update post');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select throws_like($$select public.update_post((select id from mutation_results where name='post-first'), 'Admin title', 'admin', array['a3000000-0000-0000-0000-000000000001']::uuid[])$$, '%post not found or not editable%', 'admin cannot use owner RPC as undeclared moderation');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.update_post('a2000000-0000-0000-0000-000000000003', 'Locked edit', 'allowed', array['a3000000-0000-0000-0000-000000000001']::uuid[])$$, 'locked post still allows owner edit');
select lives_ok($$select public.soft_delete_post('a2000000-0000-0000-0000-000000000003')$$, 'locked post still allows owner soft-delete');
select lives_ok($$select public.soft_delete_post((select id from mutation_results where name='post-first'))$$, 'owner soft-deletes unlocked post');
select throws_ok($$select public.create_post('Deleted duplicate', E' updated\n body ', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'post-deleted-duplicate')$$, '23505', 'duplicate post body within 10 minutes', 'deleted post rows still prevent duplicate-body bypass');
reset role;
select is((select status from public.posts where id=(select id from mutation_results where name='post-first')), 'deleted', 'post soft-delete sets deleted state');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

-- Comment hierarchy, ownership, locks, idempotency, and configured rate limit.
insert into mutation_results(name,id) select 'comment-top', public.create_comment('a2000000-0000-0000-0000-000000000001', null, 'top comment', 'comment-key-1');
insert into mutation_results(name,id) select 'comment-replay', public.create_comment('a2000000-0000-0000-0000-000000000001', null, 'top comment', 'comment-key-1');
select is((select id from mutation_results where name='comment-replay'), (select id from mutation_results where name='comment-top'), 'same comment key and request replays same resource');
select is(public.create_comment('a2000000-0000-0000-0000-000000000001', null, 'top comment', '  comment-key-1 '), (select id from mutation_results where name='comment-top'), 'trimmed comment key replays same resource');
reset role;
update public.posts set status='hidden' where id='a2000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.create_comment('a2000000-0000-0000-0000-000000000001', null, 'top comment', 'comment-key-1'), (select id from mutation_results where name='comment-top'), 'comment replay precedes changed post visibility validation');
reset role;
update public.posts set status='published' where id='a2000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.create_comment('a2000000-0000-0000-0000-000000000001', null, E' top\n comment ', 'comment-key-whitespace')$$, '23505', 'duplicate comment body within 10 minutes', 'whitespace-normalized duplicate comment body is rejected across keys');
insert into mutation_results(name,id) select 'comment-distinct', public.create_comment('a2000000-0000-0000-0000-000000000001', null, 'different comment body', 'comment-key-distinct');
select ok((select id from mutation_results where name='comment-distinct') is not null, 'different comment body is allowed');
insert into mutation_results(name,id) select 'comment-reply', public.create_comment('a2000000-0000-0000-0000-000000000001', (select id from mutation_results where name='comment-top'), 'reply comment', 'comment-key-2');
select throws_like($$select public.create_comment('a2000000-0000-0000-0000-000000000001', (select id from mutation_results where name='comment-reply'), 'nested', 'comment-key-nested')$$, '%parent must be a visible top-level comment on the same post%', 'nested replies are rejected');
select throws_like($$select public.create_comment('a2000000-0000-0000-0000-000000000003', null, 'locked', 'comment-key-locked')$$, '%post not found, visible, or unlocked%', 'locked post rejects ordinary comments');
select lives_ok($$select public.update_comment((select id from mutation_results where name='comment-top'), 'top edited')$$, 'comment owner updates own comment');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select throws_like($$select public.update_comment((select id from mutation_results where name='comment-top'), 'stolen')$$, '%comment not found or not editable%', 'other user cannot update comment');
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.soft_delete_comment((select id from mutation_results where name='comment-reply'))$$, 'comment owner soft-deletes own reply');
select throws_ok($$select public.create_comment('a2000000-0000-0000-0000-000000000001', null, E' reply\n comment ', 'comment-deleted-duplicate')$$, '23505', 'duplicate comment body within 10 minutes', 'deleted comment rows still prevent duplicate-body bypass');
select lives_ok($$select public.update_comment('a4000000-0000-0000-0000-000000000003', 'locked edit')$$, 'locked post still allows existing comment owner edit');
select lives_ok($$select public.soft_delete_comment('a4000000-0000-0000-0000-000000000003')$$, 'locked post still allows existing comment owner delete');
reset role;
select is((select status from public.comments where id=(select id from mutation_results where name='comment-reply')), 'deleted', 'comment soft-delete sets deleted state');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

-- Reactions only target visible rows and toggle deterministically.
insert into mutation_results(name,flag) select 'post-react-on', (public.set_post_reaction('a2000000-0000-0000-0000-000000000001',true)->>'reacted')::boolean;
select is((select flag from mutation_results where name='post-react-on'), true, 'desired post reaction returns true when inserted');
select is(public.set_post_reaction('a2000000-0000-0000-0000-000000000001',false)->>'reacted', 'false', 'desired post reaction returns false when removed');
select throws_like($$select public.set_post_reaction('a2000000-0000-0000-0000-000000000002',true)$$, '%post not found or visible%', 'hidden post reaction is rejected');
select throws_like($$select public.set_post_reaction((select id from mutation_results where name='post-first'),true)$$, '%post not found or visible%', 'deleted post reaction is rejected');
select is(public.set_comment_reaction('a4000000-0000-0000-0000-000000000001',true)->>'reacted', 'true', 'visible comment reaction can be inserted');
select is(public.set_comment_reaction('a4000000-0000-0000-0000-000000000001',false)->>'reacted', 'false', 'visible comment reaction can be removed');
select throws_like($$select public.set_comment_reaction('a4000000-0000-0000-0000-000000000002',true)$$, '%comment not found or visible%', 'hidden comment reaction is rejected');

-- Reports derive reporter identity, validate target visibility, and preserve uniqueness.
insert into mutation_results(name,id) select 'report-first', public.create_report_v2('post', 'a2000000-0000-0000-0000-000000000001', 'spam', 'details', 'report-key-1');
reset role;
select is((select reporter_id from public.reports where id=(select id from mutation_results where name='report-first')), 'a1000000-0000-0000-0000-000000000001'::uuid, 'reporter derives from auth.uid');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select is(public.create_report_v2('post', 'a2000000-0000-0000-0000-000000000001', 'spam', 'details', 'report-key-1'), (select id from mutation_results where name='report-first'), 'report idempotency replay returns same report');
reset role;
update public.posts set status='hidden' where id='a2000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.create_report_v2('post', 'a2000000-0000-0000-0000-000000000001', 'spam', 'details', ' report-key-1 '), (select id from mutation_results where name='report-first'), 'report replay precedes changed target visibility validation');
reset role;
update public.posts set status='published' where id='a2000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_like($$select public.create_report_v2('post', 'a2000000-0000-0000-0000-000000000001', 'spam', null, 'report-key-2')$$, '%open report already exists%', 'duplicate open report is rejected cleanly');
select throws_like($$select public.create_report_v2('post', 'a2000000-0000-0000-0000-000000000002', 'spam', null, 'report-hidden')$$, '%report target not found or visible%', 'hidden report target is rejected');
select throws_like($$insert into public.reports(reporter_id,target_type,target_id,reason_code) values ('a1000000-0000-0000-0000-000000000002','post','a2000000-0000-0000-0000-000000000001','forged')$$, '%permission denied%', 'reporter cannot be supplied through direct insert');

-- Tighten one configured rule and prove successful distinct creates are counted,
-- while the prior idempotent replay did not consume another slot.
reset role;
update public.rate_limit_rules set max_requests=1 where action='post.create' and window_seconds=600;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);
select lives_ok($$select public.create_post('Rate first', 'body', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'rate-post-1')$$, 'first post create within configured rate limit succeeds');
select throws_ok(
  $$select public.create_post('Rate second', 'another body', array['a3000000-0000-0000-0000-000000000001']::uuid[], 'rate-post-2')$$,
  'PGRST',
  '{"code":"rate_limit_exceeded","message":"Rate limit exceeded","details":"post.create","hint":"Retry later"}',
  'configured post-create rate limit exposes the PostgREST 429 contract'
);
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='a1000000-0000-0000-0000-000000000002' and action='post.create'), 1, 'only successful distinct create consumes a rate-limit event');
select ok((select occurred_at > pg_catalog.transaction_timestamp() from public.rate_limit_events where user_id='a1000000-0000-0000-0000-000000000002' and action='post.create'), 'rate event records execution time rather than transaction start time');

select * from finish();
rollback;
