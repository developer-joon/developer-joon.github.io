begin;
select no_plan();
create extension if not exists dblink with schema extensions;

-- Clean committed dblink residue from an interrupted previous run before the
-- surrounding pgTAP transaction starts creating new race fixtures.
select extensions.dblink_connect(
  'storage_restart_cleanup',
  format(
    'hostaddr=%s port=%s dbname=%L user=%L password=postgres',
    coalesce(host(inet_server_addr()),'127.0.0.1'),
    inet_server_port(),
    current_database(),
    current_user
  )
);
select extensions.dblink_exec('storage_restart_cleanup',$sql$
  set storage.allow_delete_query = 'true';
  delete from storage.objects
   where bucket_id='community-images'
     and name in (
       select a.storage_path
         from public.attachments a
         join auth.users u on u.id=a.owner_id
        where u.email like '%@race.test'
     );
  reset storage.allow_delete_query;
  delete from public.attachments
   where owner_id in (select id from auth.users where email like '%@race.test');
  delete from public.posts
   where author_id in (select id from auth.users where email like '%@race.test');
  delete from auth.users where email like '%@race.test'
$sql$);
select extensions.dblink_disconnect('storage_restart_cleanup');

-- Restart-safe fixed fixtures: remove residue from interrupted prior runs.
delete from auth.users where id in (
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002'
);
insert into auth.users (id,aud,role,email) values
 ('b1000000-0000-0000-0000-000000000001','authenticated','authenticated','storage-a@example.test'),
 ('b1000000-0000-0000-0000-000000000002','authenticated','authenticated','storage-b@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('b1000000-0000-0000-0000-000000000001',93001,'storage-a'),
 ('b1000000-0000-0000-0000-000000000002',93002,'storage-b');
insert into public.posts(id,author_id,title,body_markdown,status,created_at,updated_at,deleted_at) values
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Published','body','published',now(),now(),null),
 ('b2000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','Hidden','body','hidden',now(),now(),null),
 ('b2000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','Deleted','body','deleted',now()-interval '40 days',now(),now()-interval '31 days'),
 ('b2000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000002','Other','body','published',now(),now(),null);

select is((select public from storage.buckets where id='community-images'),false,'bucket is private');
select is((select file_size_limit from storage.buckets where id='community-images'),5242880::bigint,'bucket limit is 5 MiB');
select is((select allowed_mime_types from storage.buckets where id='community-images'),array['image/jpeg','image/png','image/webp']::text[],'bucket MIME allow-list is exact');
select is((select count(*)::integer from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'community_images_%'),1,'only owner SELECT storage policy exists');
select is((select array_agg(cmd) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'community_images_%'),array['SELECT']::text[],'browser has no storage mutation policy');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename='attachments' and policyname='attachments_select_own_attached_legacy'),1,'named legacy attachment read policy supports Storage RLS');

select has_function('public','reserve_attachment_upload',array['uuid'],'authenticated pre-decode upload-rate reservation RPC exists');
select has_function('public','refund_attachment_upload_replay',array['uuid','uuid','text','text','bigint'],'validated replay refund RPC exists');
select has_function('public','create_attachment_upload_intent',array['uuid','text','text','bigint'],'intent-first upload RPC accepts client key and payload fingerprint');
select has_function('public','fail_attachment_upload',array['uuid','text'],'upload failure RPC exists');
select has_function('public','attach_attachments',array['uuid','uuid[]','integer'],'attachment linking RPC requires an expected total');
select ok(not has_function_privilege('public','public.attach_attachments_legacy(uuid,uuid[])','EXECUTE') and not has_function_privilege('authenticated','public.attach_attachments_legacy(uuid,uuid[])','EXECUTE') and not has_function_privilege('service_role','public.attach_attachments_legacy(uuid,uuid[])','EXECUTE'),'legacy attachment implementation is not client executable');
select has_function('public','claim_attachment_cleanup',array['integer'],'cleanup claim RPC exists');
select has_function('public','prepare_attachment_cleanup',array['uuid','text','uuid'],'cleanup prepare RPC exists');
select has_function('public','complete_attachment_cleanup',array['uuid','text','uuid'],'token-bound cleanup completion exists');
select has_function('public','release_attachment_cleanup',array['uuid','text','uuid','text'],'cleanup failure release exists');
select ok(not exists(select 1 from pg_proc where oid=to_regprocedure('public.register_attachment(text,text,bigint)')),'object-first registration RPC is removed');

select ok(p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres', signature||' is fixed-owner SECURITY DEFINER with empty search_path')
from unnest(array[
 'public.reserve_attachment_upload(uuid)','public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint)',
 'public.create_attachment_upload_intent(uuid,text,text,bigint)',
 'public.fail_attachment_upload(uuid,text)',
 'public.attach_attachments(uuid,uuid[],integer)',
 'public.claim_attachment_cleanup(integer)',
 'public.prepare_attachment_cleanup(uuid,text,uuid)',
 'public.complete_attachment_cleanup(uuid,text,uuid)',
 'public.release_attachment_cleanup(uuid,text,uuid,text)'
]) signature join pg_proc p on p.oid=signature::regprocedure;
select ok(not has_function_privilege('public',signature,'EXECUTE') and not has_function_privilege('anon',signature,'EXECUTE'),signature||' denies PUBLIC and anon')
from unnest(array[
 'public.reserve_attachment_upload(uuid)','public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint)',
 'public.create_attachment_upload_intent(uuid,text,text,bigint)',
 'public.fail_attachment_upload(uuid,text)',
 'public.attach_attachments(uuid,uuid[],integer)',
 'public.claim_attachment_cleanup(integer)',
 'public.prepare_attachment_cleanup(uuid,text,uuid)',
 'public.complete_attachment_cleanup(uuid,text,uuid)',
 'public.release_attachment_cleanup(uuid,text,uuid,text)'
]) signature;
select ok(has_function_privilege('authenticated',signature,'EXECUTE') and not has_function_privilege('service_role',signature,'EXECUTE'),signature||' is authenticated-only')
from unnest(array['public.reserve_attachment_upload(uuid)','public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint)','public.create_attachment_upload_intent(uuid,text,text,bigint)','public.fail_attachment_upload(uuid,text)','public.attach_attachments(uuid,uuid[],integer)']) signature;
select ok(has_function_privilege('service_role',signature,'EXECUTE') and not has_function_privilege('authenticated',signature,'EXECUTE'),signature||' is service-only')
from unnest(array['public.claim_attachment_cleanup(integer)','public.prepare_attachment_cleanup(uuid,text,uuid)','public.complete_attachment_cleanup(uuid,text,uuid)','public.release_attachment_cleanup(uuid,text,uuid,text)']) signature;

select is((select max_requests from public.rate_limit_rules where action='attachment.upload' and window_seconds=600 and is_enabled),20,'upload request rate is 20 per 10 minutes');
select col_type_is('public','attachments','client_key','uuid','attachment stores canonical client UUID key');
select col_type_is('public','attachments','payload_sha256','text','attachment stores SHA-256 payload fingerprint');
select is((select a.atttypid::regtype::text from pg_attribute a where a.attrelid='public.attachment_upload_intent'::regclass and a.attname='is_replay'),'boolean','intent result exposes replay state');
select is((select a.atttypid::regtype::text from pg_attribute a where a.attrelid='public.attachment_upload_intent'::regclass and a.attname='object_exists'),'boolean','intent result exposes matching Storage object state');
select ok(not has_table_privilege('authenticated','public.attachments','INSERT') and not has_table_privilege('authenticated','public.attachments','UPDATE') and not has_table_privilege('authenticated','public.attachments','DELETE'),'browser cannot mutate attachments directly');

-- Managed reads require a correlated attached intent. Legacy reads additionally
-- require every populated Storage owner field to agree with the attachment.
-- Exercise the policy as real authenticated/anon roles under RLS.
insert into public.posts(id,author_id,title,body_markdown,status) values
 ('b2000000-0000-0000-0000-000000000041','b1000000-0000-0000-0000-000000000001','Legacy read fixtures','body','published'),
 ('b2000000-0000-0000-0000-000000000042','b1000000-0000-0000-0000-000000000002','Foreign legacy read fixture','body','published');
insert into public.attachments(id,owner_id,post_id,storage_path,mime_type,byte_size,status,attached_at) values
 ('b4000000-0000-0000-0000-000000000041','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-owned-uuid.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000042','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-owned-text.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000043','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-foreign-object.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000044','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-unowned-object.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000045','b1000000-0000-0000-0000-000000000001',null,'legacy/read-pending.png','image/png',10,'pending',null),
 ('b4000000-0000-0000-0000-000000000046','b1000000-0000-0000-0000-000000000001',null,'legacy/read-quarantined.png','image/png',10,'quarantined',null),
 ('b4000000-0000-0000-0000-000000000047','b1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000042','legacy/read-foreign-row.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000048','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-owner-conflict.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000049','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','legacy/read-owner-id-conflict.png','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000061','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000061','image/png',10,'attached',now()),
 ('b4000000-0000-0000-0000-000000000062','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000062','image/png',10,'attached',now());
insert into public.attachments(id,owner_id,post_id,client_key,payload_sha256,storage_path,mime_type,byte_size,status,attached_at) values
 ('b4000000-0000-0000-0000-000000000060','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000041','06000000-0000-4000-8000-000000000060','6060606060606060606060606060606060606060606060606060606060606060','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000060','image/png',10,'attached',now());
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('community-images','legacy/read-owned-uuid.png','b1000000-0000-0000-0000-000000000001',null),
 ('community-images','legacy/read-owned-text.png',null,'b1000000-0000-0000-0000-000000000001'),
 ('community-images','legacy/read-foreign-object.png','b1000000-0000-0000-0000-000000000002',null),
 ('community-images','legacy/read-unowned-object.png',null,null),
 ('community-images','legacy/read-pending.png','b1000000-0000-0000-0000-000000000001',null),
 ('community-images','legacy/read-quarantined.png','b1000000-0000-0000-0000-000000000001',null),
 ('community-images','legacy/read-foreign-row.png','b1000000-0000-0000-0000-000000000001',null),
 ('community-images','legacy/read-owner-conflict.png','b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002'),
 ('community-images','legacy/read-owner-id-conflict.png','b1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001'),
 ('community-images','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000060',null,null),
 ('community-images','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000061',null,null),
 ('community-images','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000062','b1000000-0000-0000-0000-000000000002',null),
 ('community-images','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000063',null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select is((select count(*)::integer from storage.objects where bucket_id='community-images' and name in ('legacy/read-owned-uuid.png','legacy/read-owned-text.png')),2,'legacy owner can read attached objects owned through owner or owner_id');
select is((select count(*)::integer from storage.objects where bucket_id='community-images' and name='b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000060'),1,'ownerless service-uploaded managed object remains readable through its exact attached intent');
select is((select count(*)::integer from storage.objects where bucket_id='community-images' and name in ('legacy/read-foreign-object.png','legacy/read-unowned-object.png','legacy/read-pending.png','legacy/read-quarantined.png','legacy/read-foreign-row.png','legacy/read-owner-conflict.png','legacy/read-owner-id-conflict.png')),0,'legacy read hides foreign, unowned, conflicting-owner, ineligible, or foreign attachment rows');
select is((select count(*)::integer from storage.objects where bucket_id='community-images' and name in ('b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000061','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000062','b1000000-0000-0000-0000-000000000001/06000000-0000-4000-8000-000000000063')),0,'UUID prefix alone cannot expose legacy, foreign-owned, or untracked objects');
reset role;
set local role anon;
select is((select count(*)::integer from storage.objects where bucket_id='community-images' and name like 'legacy/read-%'),0,'public readers cannot read legacy objects');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$insert into storage.objects(bucket_id,name,metadata) values('community-images','b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000001','{"size":77,"mimetype":"image/png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')$$,'%row-level security%','direct browser storage INSERT is denied');
create temporary table upload_reservations(name text primary key,id uuid);
insert into upload_reservations values
 ('malformed-one',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001')),
 ('malformed-two',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001'));
select is((select count(*)::integer from upload_reservations where id is not null),2,'each pre-decode request receives its own rate reservation');
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='b1000000-0000-0000-0000-000000000001' and action='attachment.upload' and idempotency_key='01000000-0000-4000-8000-000000000001'),2,'two malformed or pre-intent requests with one key consume two events');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
create temporary table intent_results as
select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77);
select is((select count(*)::integer from intent_results),1,'authenticated RPC creates intent before object exists');
select matches((select storage_path from intent_results),'^b1000000-0000-0000-0000-000000000001/','path derives owner from auth context');
select is((select is_replay from intent_results),false,'first intent result is not a replay');
select is((select object_exists from intent_results),false,'first intent preserves intent-before-object ordering');
select is(
  (select x.id from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77) x),
  (select id from intent_results),
  'same client key returns same intent'
);
select is((select x.is_replay from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77) x),true,'same client key is exposed as replay');
insert into upload_reservations values
 ('missing-object',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001'));
select ok((select id is not null from upload_reservations where name='missing-object'),'intent without a matching object remains precharged');
select throws_like($$select * from public.create_attachment_upload_intent(null,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77)$$,'%client key is required%','null client UUID key is rejected');
select throws_like($$select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','image/png',77)$$,'%client key reused with different payload metadata%','client key cannot change payload fingerprint');
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='b1000000-0000-0000-0000-000000000001' and action='attachment.upload' and idempotency_key='01000000-0000-4000-8000-000000000001'),3,'intent creation does not double-count reservations but a missing-object retry is charged');
select is((select owner_id from public.attachments where id=(select id from intent_results)),'b1000000-0000-0000-0000-000000000001'::uuid,'intent owner cannot be supplied');
select is((select status from public.attachments where id=(select id from intent_results)),'pending','intent is cleanup-visible pending row');

-- A browser-chosen key may already name an untracked object. A new intent must
-- never adopt that object, even when its metadata happens to match.
insert into storage.objects(bucket_id,name,owner,metadata) values (
  'community-images',
  'b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000009',
  'b1000000-0000-0000-0000-000000000002',
  '{"size":77,"mimetype":"image/png","sha256":"9999999999999999999999999999999999999999999999999999999999999999"}'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000009','9999999999999999999999999999999999999999999999999999999999999999','image/png',77)$$,
  '23505',
  'storage path already exists',
  'new intent rejects an existing untracked or foreign object path'
);
reset role;
select is((select count(*)::integer from public.attachments where client_key='01000000-0000-4000-8000-000000000009'),0,'existing object rejection creates no attachment row');
select is((select count(*)::integer from public.rate_limit_events where user_id='b1000000-0000-0000-0000-000000000001' and action='attachment.upload' and idempotency_key='01000000-0000-4000-8000-000000000009'),0,'existing object rejection consumes no intent rate event');

-- Archived versions are historical only: they neither block a new path nor
-- satisfy replay/attach metadata for the current object.
insert into storage.objects(bucket_id,name,version,is_versioned,archived_at,metadata) values (
  'community-images',
  'b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000010',
  'archived-v1',true,clock_timestamp()-interval '1 day',
  '{"size":77,"mimetype":"image/png","sha256":"1010101010101010101010101010101010101010101010101010101010101010"}'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
create temporary table archived_path_intent as
select * from public.create_attachment_upload_intent(
  '01000000-0000-4000-8000-000000000010',
  '1010101010101010101010101010101010101010101010101010101010101010',
  'image/png',77
);
reset role;
select is((select count(*)::integer from archived_path_intent),1,'archived-only object does not block a new tracked intent');
insert into storage.objects(bucket_id,name,metadata) values (
  'community-images',
  'b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000010',
  '{"size":78,"mimetype":"image/png","sha256":"2020202020202020202020202020202020202020202020202020202020202020"}'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like(
  $$select public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from archived_path_intent)],1)$$,
  '%storage object metadata does not match intent%',
  'matching archived metadata cannot authorize a mismatching current object'
);
reset role;

-- A missing object cannot be attached; successful exact metadata can be attached.
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$select public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from intent_results)],1)$$,'%storage object metadata does not match intent%','intent cannot attach before storage upload');
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'community-images',storage_path,'{"size":78,"mimetype":"image/png"}'::jsonb from intent_results;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$select public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from intent_results)],1)$$,'%storage object metadata does not match intent%','wrong uploaded object size cannot attach');
reset role;
update storage.objects set metadata='{"size":77,"mimetype":"image/png","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb where bucket_id='community-images' and name=(select storage_path from intent_results);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select is((select x.object_exists from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77) x),true,'matching existing Storage object tells Edge to skip upload');
insert into upload_reservations values
 ('malformed-success-key',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001')),
 ('validated-replay',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001'));
select is(public.refund_attachment_upload_replay(
  (select id from upload_reservations where name='validated-replay'),
  '01000000-0000-4000-8000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'image/png',77
),true,'validated matching replay refunds only its request-scoped reservation');
reset role;
select is((select count(*)::integer from public.rate_limit_events where user_id='b1000000-0000-0000-0000-000000000001' and action='attachment.upload' and idempotency_key='01000000-0000-4000-8000-000000000001'),4,'malformed successful-key reuse stays charged while validated replay is refunded');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select is(public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from intent_results)],1),1,'exact uploaded object attaches to own published post');
select is(public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from intent_results)],1),1,'lost attach response can be retried idempotently with the same expected total');
insert into upload_reservations values
 ('attached-reuse',public.reserve_attachment_upload('01000000-0000-4000-8000-000000000001'));
select is(public.refund_attachment_upload_replay(
  (select id from upload_reservations where name='attached-reuse'),
  '01000000-0000-4000-8000-000000000001',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'image/png',77
),false,'an attached non-retryable intent cannot refund pre-decode rate accounting');
select throws_like($$select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000001','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','image/png',77)$$,'%no longer retryable%','attached intent cannot be replayed as an upload');
select throws_like($$select public.attach_attachments('b2000000-0000-0000-0000-000000000002',array[(select id from intent_results)],1)$$,'%post not found or not attachable%','hidden post is not attachable');
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002',true);
select throws_like($$select public.attach_attachments('b2000000-0000-0000-0000-000000000004',array[(select id from intent_results)],1)$$,'%attachment not found or not linkable%','other owner cannot attach intent');
reset role;

-- The sixth real attachment is rejected after five are already attached.
insert into public.attachments(owner_id,post_id,storage_path,mime_type,byte_size,status,created_at,attached_at)
select 'b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001',
       format('b1000000-0000-0000-0000-000000000001/%s',gen_random_uuid()),
       'image/png',10,'attached',clock_timestamp(),clock_timestamp()
from generate_series(1,4);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
create temporary table sixth_intent as
select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000006','6666666666666666666666666666666666666666666666666666666666666666','image/png',66);
reset role;
insert into storage.objects(bucket_id,name,metadata)
select 'community-images',storage_path,'{"size":66,"mimetype":"image/png","sha256":"6666666666666666666666666666666666666666666666666666666666666666"}'::jsonb from sixth_intent;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$select public.attach_attachments('b2000000-0000-0000-0000-000000000001',array[(select id from sixth_intent)],5)$$,'%attachment total changed concurrently%','stale expected total rejects a sixth attachment before mutation');
reset role;
select is((select status from public.attachments where id=(select id from sixth_intent)),'pending','stale expected total leaves the attachment pending');
select is((select post_id from public.attachments where id=(select id from sixth_intent)),null::uuid,'stale expected total does not link the attachment');

-- Upload failure immediately becomes cleanup eligible while preserving its tracked path.
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
create temporary table failed_intent as select * from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000002','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','image/png',88);
select is(public.fail_attachment_upload((select id from failed_intent),(select storage_path from failed_intent)),true,'owner marks failed upload for cleanup');
reset role;
select is((select status from public.attachments where id=(select id from failed_intent)),'quarantined','failed upload is immediately cleanup-eligible');

-- Retrying either retryable state must not race an active cleanup worker, and a
-- successful retry reserves enough time for the Edge upload to finish.
insert into public.attachments(
  id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,status,
  created_at,next_attempt_at,cleanup_claim_token,cleanup_lease_until
) values
 ('b4000000-0000-0000-0000-000000000011','b1000000-0000-0000-0000-000000000001','04000000-0000-4000-8000-000000000011','1111111111111111111111111111111111111111111111111111111111111111','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000011','image/png',100,'pending',now()-interval '25 hours',now()-interval '1 hour',gen_random_uuid(),now()+interval '5 minutes'),
 ('b4000000-0000-0000-0000-000000000012','b1000000-0000-0000-0000-000000000001','04000000-0000-4000-8000-000000000012','2222222222222222222222222222222222222222222222222222222222222222','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000012','image/png',100,'quarantined',now()-interval '25 hours',now()-interval '1 hour',gen_random_uuid(),now()+interval '5 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$select * from public.create_attachment_upload_intent('04000000-0000-4000-8000-000000000011','1111111111111111111111111111111111111111111111111111111111111111','image/png',100)$$,'%active cleanup lease%','pending retry rejects an active cleanup lease');
select throws_like($$select * from public.create_attachment_upload_intent('04000000-0000-4000-8000-000000000012','2222222222222222222222222222222222222222222222222222222222222222','image/png',100)$$,'%active cleanup lease%','quarantined retry rejects an active cleanup lease');
reset role;
update public.attachments set cleanup_claim_token=null,cleanup_lease_until=null where id in ('b4000000-0000-0000-0000-000000000011','b4000000-0000-0000-0000-000000000012');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select lives_ok($$select * from public.create_attachment_upload_intent('04000000-0000-4000-8000-000000000011','1111111111111111111111111111111111111111111111111111111111111111','image/png',100)$$,'old pending intent resumes');
select lives_ok($$select * from public.create_attachment_upload_intent('04000000-0000-4000-8000-000000000012','2222222222222222222222222222222222222222222222222222222222222222','image/png',100)$$,'quarantined intent resumes');
reset role;
select ok((select next_attempt_at >= clock_timestamp()+interval '14 minutes' from public.attachments where id='b4000000-0000-0000-0000-000000000011'),'pending retry postpones cleanup for the documented 15-minute upload grace');
select ok((select next_attempt_at >= clock_timestamp()+interval '14 minutes' from public.attachments where id='b4000000-0000-0000-0000-000000000012'),'quarantined retry postpones cleanup for the documented 15-minute upload grace');

-- Pending abuse limits are atomic: max 10 objects and 25 MiB total.
insert into public.attachments(owner_id,storage_path,mime_type,byte_size,status)
select 'b1000000-0000-0000-0000-000000000002',format('b1000000-0000-0000-0000-000000000002/%s',gen_random_uuid()),'image/png',2621440,'pending' from generate_series(1,9);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002',true);
select lives_ok($$select * from public.create_attachment_upload_intent('02000000-0000-4000-8000-000000000001','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','image/png',1)$$,'tenth pending object is allowed');
select throws_like($$select * from public.create_attachment_upload_intent('02000000-0000-4000-8000-000000000002','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','image/png',1)$$,'%pending attachment count limit exceeded%','eleventh pending object is rejected');
reset role;
delete from public.attachments where owner_id='b1000000-0000-0000-0000-000000000002';
insert into public.attachments(owner_id,storage_path,mime_type,byte_size,status)
select 'b1000000-0000-0000-0000-000000000002',format('b1000000-0000-0000-0000-000000000002/%s',gen_random_uuid()),'image/png',5242880,'pending'
from generate_series(1,5);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002',true);
select throws_like($$select * from public.create_attachment_upload_intent('02000000-0000-4000-8000-000000000003','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','image/png',1)$$,'%pending attachment byte limit exceeded%','pending byte budget is 25 MiB');
reset role;
delete from public.attachments where owner_id='b1000000-0000-0000-0000-000000000002';
delete from public.rate_limit_events where user_id='b1000000-0000-0000-0000-000000000002';
insert into public.rate_limit_events(user_id,action,occurred_at) select 'b1000000-0000-0000-0000-000000000002','attachment.upload',clock_timestamp() from generate_series(1,20);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000002',true);
select throws_like($$select * from public.create_attachment_upload_intent('02000000-0000-4000-8000-000000000004','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','image/png',1)$$,'%attachment upload rate limit exceeded%','request rate rule is consumed atomically');
reset role;
insert into public.rate_limit_events(user_id,action,occurred_at)
select 'b1000000-0000-0000-0000-000000000001','attachment.upload',clock_timestamp() from generate_series(1,20);
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select is(
  (select x.id from public.create_attachment_upload_intent('01000000-0000-4000-8000-000000000006','6666666666666666666666666666666666666666666666666666666666666666','image/png',66) x),
  (select id from sixth_intent),
  'retryable idempotent replay precedes rate and pending quota checks'
);
reset role;

-- Lease/token cleanup supports backoff, terminal visibility, and cannot be completed by stale workers.
insert into public.attachments(id,owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at) values
 ('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001','image/png',100,'pending',now()-interval '25 hours',now()),
 ('b4000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000002','image/png',100,'pending',now()-interval '23 hours',now());
insert into public.attachments(id,owner_id,post_id,storage_path,mime_type,byte_size,status,created_at,attached_at,next_attempt_at) values
 ('b4000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000003','image/png',100,'attached',now()-interval '40 days',now()-interval '39 days',now());
set local role service_role;
create temporary table cleanup_claim as select * from public.claim_attachment_cleanup(10);
reset role;
select is((select count(*)::integer from cleanup_claim where id=(select id from failed_intent)),1,'failed upload is claimed immediately without a 24h wait');
set local role service_role;
select is((select count(*)::integer from cleanup_claim where id='b4000000-0000-0000-0000-000000000001'),1,'24h pending row is claimed');
select is((select count(*)::integer from cleanup_claim where id='b4000000-0000-0000-0000-000000000002'),0,'recent pending row is not claimed');
select is((select count(*)::integer from cleanup_claim where id='b4000000-0000-0000-0000-000000000003'),1,'attachment of a 30d deleted post is claimed');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000001'),'pending','claim preserves pending status while leasing');
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000003'),'attached','claim preserves attached status while leasing');
set local role service_role;
select ok((select claim_token is not null from cleanup_claim where id='b4000000-0000-0000-0000-000000000001'),'claim returns unique token');
select is((select count(*)::integer from public.claim_attachment_cleanup(10) where id='b4000000-0000-0000-0000-000000000001'),0,'active lease prevents duplicate claim');
select is(public.complete_attachment_cleanup('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001',gen_random_uuid()),false,'wrong token cannot complete');
reset role;
update public.posts set status='published',deleted_at=null where id='b2000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000003',(select claim_token from cleanup_claim where id='b4000000-0000-0000-0000-000000000003')),false,'prepare revalidates that linked post is still 30d deleted');
select is(public.release_attachment_cleanup('b4000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000003',(select claim_token from cleanup_claim where id='b4000000-0000-0000-0000-000000000003'),'eligibility_changed'),true,'eligibility change releases the untouched attachment');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000003'),'attached','failed prepare leaves restored attachment attached');
select is((select cleanup_attempt_count from public.attachments where id='b4000000-0000-0000-0000-000000000003'),0,'eligibility change does not consume a cleanup attempt');
update public.posts set status='deleted',deleted_at=clock_timestamp()-interval '31 days' where id='b2000000-0000-0000-0000-000000000003';
update public.attachments set next_attempt_at=clock_timestamp()-interval '1 second' where id='b4000000-0000-0000-0000-000000000003';
set local role service_role;
create temporary table restored_claim as select * from public.claim_attachment_cleanup(10);
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000003',(select claim_token from restored_claim where id='b4000000-0000-0000-0000-000000000003')),true,'eligible claimed attachment prepares deletion');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000003'),'deleting','prepare marks irreversible deletion before storage remove');
update public.posts set status='published',deleted_at=null where id='b2000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.complete_attachment_cleanup('b4000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000003',(select claim_token from restored_claim where id='b4000000-0000-0000-0000-000000000003')),true,'completion accepts prepared deleting row even if post is later restored');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000003'),'deleted','completed cleanup is terminally deleted');
update public.attachments set cleanup_lease_until=clock_timestamp()-interval '1 second' where id='b4000000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.complete_attachment_cleanup('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001',(select claim_token from cleanup_claim where id='b4000000-0000-0000-0000-000000000001')),false,'expired token cannot complete cleanup');
reset role;
update public.attachments set cleanup_lease_until=clock_timestamp()+interval '5 minutes' where id='b4000000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001',(select claim_token from cleanup_claim where id='b4000000-0000-0000-0000-000000000001')),true,'pending cleanup is prepared before external removal');
select is(public.release_attachment_cleanup('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001',(select claim_token from cleanup_claim where id='b4000000-0000-0000-0000-000000000001'),'storage_remove_failed'),true,'matching token releases failed claim');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000001'),'deleting','release preserves irreversible deleting status');
update public.attachments set client_key='04000000-0000-4000-8000-000000000001',payload_sha256='1111111111111111111111111111111111111111111111111111111111111111' where id='b4000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-0000-0000-000000000001',true);
select throws_like($$select * from public.create_attachment_upload_intent('04000000-0000-4000-8000-000000000001','1111111111111111111111111111111111111111111111111111111111111111','image/png',100)$$,'%no longer retryable%','deleting intent path cannot be replayed or reused after remove timeout');
reset role;
select is((select cleanup_attempt_count from public.attachments where id='b4000000-0000-0000-0000-000000000001'),1,'release increments attempt count');
select ok((select next_attempt_at>clock_timestamp() from public.attachments where id='b4000000-0000-0000-0000-000000000001'),'release applies retry backoff');
update public.attachments set cleanup_attempt_count=4,next_attempt_at=clock_timestamp()-interval '1 second' where id='b4000000-0000-0000-0000-000000000001';
set local role service_role;
create temporary table final_claim as select * from public.claim_attachment_cleanup(10);
select is(public.release_attachment_cleanup('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000001',(select claim_token from final_claim where id='b4000000-0000-0000-0000-000000000001'),'still_failing'),true,'fifth failure is recorded');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000001'),'cleanup_failed','max attempts become terminal and visible');
select is((select next_attempt_at from public.attachments where id='b4000000-0000-0000-0000-000000000001'),null::timestamptz,'terminal failure is not immediately reclaimed');

-- Safe skips may repeat indefinitely without turning an attachment into a
-- terminal cleanup failure or applying retry backoff.
insert into public.attachments(
  id,owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at
) values (
  'b4000000-0000-0000-0000-000000000098',
  'b1000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000098',
  'image/png',100,'pending',now()-interval '25 hours',now()-interval '1 hour'
);
create function pg_temp.release_five_safe_skips(p_attachment_id uuid,p_storage_path text)
returns boolean language plpgsql as $$
declare
  iteration integer;
  token uuid;
begin
  for iteration in 1..5 loop
    select c.claim_token into token
      from public.claim_attachment_cleanup(100) c
     where c.id=p_attachment_id;
    if token is null or not public.release_attachment_cleanup(
      p_attachment_id,p_storage_path,token,'eligibility_changed'
    ) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
grant execute on function pg_temp.release_five_safe_skips(uuid,text) to service_role;
set local role service_role;
select ok(pg_temp.release_five_safe_skips(
  'b4000000-0000-0000-0000-000000000098',
  'b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000098'
),'five eligibility-change releases all clear their exact active leases');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000098'),'pending','five safe skips preserve attachment status');
select is((select cleanup_attempt_count from public.attachments where id='b4000000-0000-0000-0000-000000000098'),0,'five safe skips do not consume attempts');
select is((select next_attempt_at from public.attachments where id='b4000000-0000-0000-0000-000000000098') < clock_timestamp()-interval '30 minutes',true,'five safe skips do not apply retry backoff');
select is((select cleanup_last_error from public.attachments where id='b4000000-0000-0000-0000-000000000098'),null::text,'five safe skips do not record a failure');
update public.attachments
   set next_attempt_at=clock_timestamp()+interval '1 hour'
 where id='b4000000-0000-0000-0000-000000000098';

-- Legacy arbitrary paths enter the queue only when the object is missing or
-- every populated Storage owner field consistently identifies the attachment owner.
insert into public.attachments(id,owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at) values
 ('b4000000-0000-0000-0000-000000000051','b1000000-0000-0000-0000-000000000001','legacy/cleanup-owned.png','image/png',10,'pending',now()-interval '25 hours',now()),
 ('b4000000-0000-0000-0000-000000000052','b1000000-0000-0000-0000-000000000001','legacy/cleanup-missing.png','image/png',10,'pending',now()-interval '25 hours',now()),
 ('b4000000-0000-0000-0000-000000000053','b1000000-0000-0000-0000-000000000001','legacy/cleanup-foreign.png','image/png',10,'pending',now()-interval '25 hours',now()),
 ('b4000000-0000-0000-0000-000000000054','b1000000-0000-0000-0000-000000000001','legacy/cleanup-unowned.png','image/png',10,'pending',now()-interval '25 hours',now()),
 ('b4000000-0000-0000-0000-000000000055','b1000000-0000-0000-0000-000000000001','legacy/cleanup-conflict.png','image/png',10,'pending',now()-interval '25 hours',now());
insert into storage.objects(bucket_id,name,owner,owner_id) values
 ('community-images','legacy/cleanup-owned.png','b1000000-0000-0000-0000-000000000001',null),
 ('community-images','legacy/cleanup-foreign.png','b1000000-0000-0000-0000-000000000002',null),
 ('community-images','legacy/cleanup-unowned.png',null,null),
 ('community-images','legacy/cleanup-conflict.png','b1000000-0000-0000-0000-000000000001',null);
set local role service_role;
create temporary table legacy_cleanup_claim as
select * from public.claim_attachment_cleanup(100)
where id in (
 'b4000000-0000-0000-0000-000000000051',
 'b4000000-0000-0000-0000-000000000052',
 'b4000000-0000-0000-0000-000000000053',
 'b4000000-0000-0000-0000-000000000054',
 'b4000000-0000-0000-0000-000000000055'
);
select is((select count(*)::integer from legacy_cleanup_claim where id in (
 'b4000000-0000-0000-0000-000000000051',
 'b4000000-0000-0000-0000-000000000052',
 'b4000000-0000-0000-0000-000000000053',
 'b4000000-0000-0000-0000-000000000054'
)),2,'claim keeps only the missing and consistently owned rows from the original four legacy fixtures');
select is((select count(*)::integer from legacy_cleanup_claim where id='b4000000-0000-0000-0000-000000000055'),1,'claim accepts a currently consistent legacy object for prepare-time revalidation');
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000051','legacy/cleanup-owned.png',(select claim_token from legacy_cleanup_claim where id='b4000000-0000-0000-0000-000000000051')),true,'prepare accepts a legacy object owned by the attachment owner');
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000052','legacy/cleanup-missing.png',(select claim_token from legacy_cleanup_claim where id='b4000000-0000-0000-0000-000000000052')),true,'prepare accepts a missing legacy object as idempotent completion');
select is((select count(*)::integer from legacy_cleanup_claim where id in ('b4000000-0000-0000-0000-000000000053','b4000000-0000-0000-0000-000000000054')),0,'foreign and ownerless legacy objects are not leased');
update storage.objects
   set version='archived-cleanup-v1',is_versioned=true,
       archived_at=clock_timestamp()-interval '1 minute'
 where bucket_id='community-images' and name='legacy/cleanup-conflict.png';
insert into storage.objects(bucket_id,name,owner) values
 ('community-images','legacy/cleanup-conflict.png','b1000000-0000-0000-0000-000000000002');
select is(public.prepare_attachment_cleanup('b4000000-0000-0000-0000-000000000055','legacy/cleanup-conflict.png',(select claim_token from legacy_cleanup_claim where id='b4000000-0000-0000-0000-000000000055')),false,'prepare ignores matching archived ownership and rejects a foreign current replacement');
reset role;
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000051'),'deleting','owned legacy object crosses the irreversible deletion boundary');
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000052'),'deleting','missing legacy object crosses the irreversible deletion boundary');
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000053'),'pending','foreign-owned legacy object remains non-deleting');
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000054'),'pending','unowned legacy object remains non-deleting');
select is((select status from public.attachments where id='b4000000-0000-0000-0000-000000000055'),'pending','owner-conflicted legacy object remains non-deleting');

-- Existing unverifiable legacy objects must be filtered before LIMIT, otherwise
-- a full page of them can indefinitely starve later safe work.
insert into public.attachments(owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at)
select 'b1000000-0000-0000-0000-000000000001',format('legacy/starvation-%s.png',n),'image/png',10,'pending',now()-interval '4 days',now()-interval '3 hours'
from generate_series(1,100) n;
insert into storage.objects(bucket_id,name,owner)
select 'community-images',format('legacy/starvation-%s.png',n),'b1000000-0000-0000-0000-000000000002'
from generate_series(1,100) n;
insert into public.attachments(id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,status,created_at,next_attempt_at) values
 ('b4000000-0000-0000-0000-000000000097','b1000000-0000-0000-0000-000000000001','04000000-0000-4000-8000-000000000097','9797979797979797979797979797979797979797979797979797979797979797','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000097','image/png',10,'pending',now()-interval '2 days',now()-interval '2 hours');
insert into storage.objects(bucket_id,name) values
 ('community-images','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000097');
select is((select count(*)::integer from public.claim_attachment_cleanup(1) where id='b4000000-0000-0000-0000-000000000097'),1,'more than one claim page of blocked legacy objects cannot starve later managed work');

create function pg_temp.cleanup_lookup_plan()
returns text language plpgsql as $$
declare plan_line text; plan_text text := '';
begin
  set local enable_seqscan = off;
  for plan_line in execute $plan$
    explain (costs off)
    select a.id
      from public.attachments a
      left join lateral (
        select true as object_exists, o.owner, o.owner_id
          from storage.objects o
         where o.bucket_id = 'community-images'
           and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
         limit 1
      ) o on true
     where a.client_key is null
       and (
         o.object_exists is null
         or (
           (o.owner is not null or o.owner_id is not null)
           and (o.owner is null or o.owner = a.owner_id)
           and (o.owner_id is null or o.owner_id = a.owner_id::text)
         )
       )
     order by a.next_attempt_at, a.created_at, a.id
     for update of a skip locked
     limit 100
  $plan$ loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  return plan_text;
end;
$$;
select matches(
  pg_temp.cleanup_lookup_plan(),
  'Index (Only )?Scan using idx_objects_current_version on objects',
  'claim candidate lookup uses the current-object composite index'
);
select matches(
  pg_temp.cleanup_lookup_plan(),
  'Index Cond:.*bucket_id.*name',
  'claim Storage lookup constrains both bucket and exact name in the index'
);

-- 100 terminal failures cannot starve a later eligible row.
insert into public.attachments(owner_id,storage_path,mime_type,byte_size,status,created_at,cleanup_attempt_count,next_attempt_at)
select 'b1000000-0000-0000-0000-000000000001',format('b1000000-0000-0000-0000-000000000001/%s',gen_random_uuid()),'image/png',100,'cleanup_failed',now()-interval '30 hours',5,null from generate_series(1,100);
insert into public.attachments(id,owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at) values
 ('b4000000-0000-0000-0000-000000000099','b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001/04000000-0000-4000-8000-000000000099','image/png',100,'pending',now()-interval '25 hours',now());
set local role service_role;
select is((select count(*)::integer from public.claim_attachment_cleanup(1) where id='b4000000-0000-0000-0000-000000000099'),1,'terminal failures do not starve later eligible work');
reset role;

-- Real dblink race: the same idempotency key returns one intent/path, and the per-user lock serializes pending limits.
create function pg_temp.wait_dblink_state(p_connection text, p_expected integer, p_timeout interval default interval '3 seconds')
returns boolean language plpgsql as $$
declare deadline timestamptz := clock_timestamp() + p_timeout;
begin
  loop
    if extensions.dblink_is_busy(p_connection) = p_expected then return true; end if;
    if clock_timestamp() >= deadline then return false; end if;
    perform pg_sleep(0.01);
  end loop;
end;
$$;
create temporary table race_fixture(user_id uuid,post_id uuid,connection_string text);
insert into race_fixture select gen_random_uuid(),gen_random_uuid(),format('hostaddr=%s port=%s dbname=%L user=%L password=postgres options=%L',coalesce(host(inet_server_addr()),'127.0.0.1'),inet_server_port(),current_database(),current_user,'-c statement_timeout=8000 -c lock_timeout=5000');
select extensions.dblink_connect('s_setup',connection_string) from race_fixture;
select extensions.dblink_exec('s_setup',format($sql$
 delete from auth.users where id=%L;
 insert into auth.users(id,aud,role,email) values(%L,'authenticated','authenticated',%L);
 insert into public.profiles(id,github_user_id,login) values(%L,94000+floor(random()*1000000)::bigint,%L);
 insert into public.posts(id,author_id,title,body_markdown,status) values(%L,%L,'Race post','body','published')
$sql$,user_id,user_id,user_id::text||'@race.test',user_id,'race-'||substring(replace(user_id::text,'-','') for 20),post_id,user_id)) from race_fixture;
select extensions.dblink_connect('s_one',connection_string),extensions.dblink_connect('s_two',connection_string) from race_fixture;
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role authenticated');
select extensions.dblink_exec('s_one',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
create temporary table first_race_result(value text);
insert into first_race_result
select r.value
from extensions.dblink('s_one',$q$select row_to_json(x)::text from public.create_attachment_upload_intent('09000000-0000-4000-8000-000000000001','9999999999999999999999999999999999999999999999999999999999999999','image/png',100) x$q$) as r(value text);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
select extensions.dblink_send_query('s_two',$q$select row_to_json(x)::text from public.create_attachment_upload_intent('09000000-0000-4000-8000-000000000001','9999999999999999999999999999999999999999999999999999999999999999','image/png',100) x$q$);
select ok(pg_temp.wait_dblink_state('s_two',1),'same-key concurrent registration waits on actor lock within deadline');
select extensions.dblink_exec('s_one','commit');
create temporary table second_race_result as select * from extensions.dblink_get_result('s_two') as r(value text);
-- libpq exposes a final empty result after an asynchronous query; drain it
-- before issuing COMMIT on the same named connection.
select count(*) from extensions.dblink_get_result('s_two') as r(value text);
select is((select value::jsonb - 'is_replay' from second_race_result),(select value::jsonb - 'is_replay' from first_race_result),'same-key race returns the exact same intent, path, and object state');
select extensions.dblink_exec('s_two','commit');
select is((select count(*)::integer from extensions.dblink((select connection_string from race_fixture),format('select id from public.attachments where owner_id=%L',(select user_id from race_fixture))) as r(id uuid)),1,'same-key race creates one row');

-- Cleanup lease remains exclusive across committed workers and can be reclaimed only after expiry.
select extensions.dblink_exec('s_setup',format($sql$
 update public.attachments
    set created_at=clock_timestamp()-interval '25 hours',
        next_attempt_at=clock_timestamp()
  where owner_id=%L
$sql$,user_id)) from race_fixture;
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role service_role');
create temporary table lease_one(value text);
insert into lease_one select * from extensions.dblink('s_one','select row_to_json(x)::text from public.claim_attachment_cleanup(1) x') as r(value text);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role service_role');
create temporary table lease_two(value text);
insert into lease_two select * from extensions.dblink('s_two','select row_to_json(x)::text from public.claim_attachment_cleanup(1) x') as r(value text);
select is((select count(*)::integer from lease_one),1,'first worker claims cleanup lease');
select is((select count(*)::integer from lease_two),0,'concurrent worker cannot duplicate claim');
select extensions.dblink_exec('s_one','commit');
select extensions.dblink_exec('s_two','commit');
select is((select count(*)::integer from extensions.dblink((select connection_string from race_fixture),$q$select id from public.claim_attachment_cleanup(1)$q$) as r(id uuid)),0,'committed active lease remains exclusive');
select extensions.dblink_exec('s_setup',format('update public.attachments set cleanup_lease_until=clock_timestamp()-interval ''1 second'' where owner_id=%L',user_id)) from race_fixture;
select is((select count(*)::integer from extensions.dblink((select connection_string from race_fixture),$q$select id from public.claim_attachment_cleanup(1)$q$) as r(id uuid)),1,'expired lease is reclaimable');

-- Different keys compete for the final pending slot under the actor lock.
select extensions.dblink_exec('s_setup',format($sql$
  delete from public.attachments where owner_id=%L;
  insert into public.attachments(owner_id,storage_path,mime_type,byte_size,status)
  select %L, %L || '/' || gen_random_uuid()::text, 'image/png', 100, 'pending'
  from generate_series(1,9)
$sql$,user_id,user_id,user_id::text)) from race_fixture;
select extensions.dblink_exec('s_two',$q$
  create or replace function pg_temp.try_upload_intent(p_key uuid)
  returns text language plpgsql as $f$
  begin
    perform public.create_attachment_upload_intent(
      p_key,
      'abababababababababababababababababababababababababababababababab',
      'image/png',
      100
    );
    return 'ok';
  exception when others then
    return sqlstate;
  end;
  $f$;
  grant execute on function pg_temp.try_upload_intent(uuid) to authenticated
$q$);
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role authenticated');
select extensions.dblink_exec('s_one',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
create temporary table quota_winner(value text);
insert into quota_winner
select * from extensions.dblink(
  's_one',
  $q$select (public.create_attachment_upload_intent(
    '09000000-0000-4000-8000-000000000011',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'image/png',100)).id::text$q$
) as r(value text);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
select extensions.dblink_send_query(
  's_two',
  $q$select pg_temp.try_upload_intent('09000000-0000-4000-8000-000000000012')$q$
);
select ok(pg_temp.wait_dblink_state('s_two',1),'different-key final-slot contender waits on actor lock');
select extensions.dblink_exec('s_one','commit');
create temporary table quota_loser as
select * from extensions.dblink_get_result('s_two') as r(value text);
select count(*) from extensions.dblink_get_result('s_two') as r(value text);
select is((select value from quota_loser),'23514','only one concurrent request can take the final pending slot');
select extensions.dblink_exec('s_two','commit');
select is(
  (select count(*)::integer from extensions.dblink(
    (select connection_string from race_fixture),
    format('select id from public.attachments where owner_id=%L',(select user_id from race_fixture))
  ) as r(id uuid)),
  10,
  'concurrent quota race leaves exactly ten pending attachments'
);

-- A cleanup claim leases the row before releasing its lock, so attach loses.
select extensions.dblink_exec('s_setup',format($sql$
  delete from public.attachments where owner_id=%L;
  insert into public.attachments(
    id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,
    status,created_at,next_attempt_at
  ) values (
    '09000000-0000-4000-8000-000000000021',%L,
    '09000000-0000-4000-8000-000000000021',
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    %L || '/09000000-0000-4000-8000-000000000021','image/png',100,
    'pending',clock_timestamp()-interval '25 hours',clock_timestamp()
  );
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
  values(
    'community-images',
    %L || '/09000000-0000-4000-8000-000000000021',
    '{"mimetype":"image/png","size":100}'::jsonb,
    '{"sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb
  )
$sql$,user_id,user_id,user_id::text,user_id::text)) from race_fixture;
select extensions.dblink_exec('s_two',$q$
  create or replace function pg_temp.try_attach(p_post uuid,p_attachment uuid)
  returns text language plpgsql as $f$
  begin
    perform public.attach_attachments(p_post,array[p_attachment],1);
    return 'ok';
  exception when others then
    return sqlstate;
  end;
  $f$;
  grant execute on function pg_temp.try_attach(uuid,uuid) to authenticated
$q$);
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role service_role');
create temporary table claimed_before_attach(value text);
insert into claimed_before_attach
select * from extensions.dblink(
  's_one',
  $q$select row_to_json(x)::text from public.claim_attachment_cleanup(1) x$q$
) as r(value text);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
select extensions.dblink_send_query(
  's_two',
  format(
    'select pg_temp.try_attach(%L,%L)',
    (select post_id from race_fixture),
    '09000000-0000-4000-8000-000000000021'
  )
);
select ok(pg_temp.wait_dblink_state('s_two',1),'attach waits while cleanup claim holds the attachment row');
select extensions.dblink_exec('s_one','commit');
create temporary table attach_after_claim as
select * from extensions.dblink_get_result('s_two') as r(value text);
select count(*) from extensions.dblink_get_result('s_two') as r(value text);
select is((select value from attach_after_claim),'42501','claimed attachment cannot become published');
select extensions.dblink_exec('s_two','commit');
select is(
  (select status from extensions.dblink(
    (select connection_string from race_fixture),
    $q$select status from public.attachments where id='09000000-0000-4000-8000-000000000021'$q$
  ) as r(status text)),
  'pending',
  'cleanup claim preserves status but active lease blocks attach'
);

-- Claim-before-retry: retry waits for the row lock and then rejects the active
-- lease. Retry-before-claim is covered by the same row lock plus next_attempt_at
-- postponement, so cleanup cannot claim after the retry commits.
select extensions.dblink_exec('s_setup',format($sql$
  delete from public.attachments where owner_id=%L;
  insert into public.attachments(
    id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,
    status,created_at,next_attempt_at
  ) values (
    '09000000-0000-4000-8000-000000000031',%L,
    '09000000-0000-4000-8000-000000000031',
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    %L || '/09000000-0000-4000-8000-000000000031','image/png',100,
    'pending',clock_timestamp()-interval '25 hours',clock_timestamp()
  )
$sql$,user_id,user_id,user_id::text)) from race_fixture;
select extensions.dblink_exec('s_two',$q$
  create or replace function pg_temp.try_retry(p_key uuid,p_hash text)
  returns text language plpgsql as $f$
  begin
    perform public.create_attachment_upload_intent(p_key,p_hash,'image/png',100);
    return 'ok';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
  $f$;
  grant execute on function pg_temp.try_retry(uuid,text) to authenticated
$q$);
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role service_role');
create temporary table claimed_before_retry(value text);
insert into claimed_before_retry
select * from extensions.dblink('s_one','select row_to_json(x)::text from public.claim_attachment_cleanup(1) x') as r(value text);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
select extensions.dblink_send_query('s_two',$q$select pg_temp.try_retry('09000000-0000-4000-8000-000000000031','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')$q$);
select ok(pg_temp.wait_dblink_state('s_two',1),'retry waits while cleanup claim holds the intent row');
select extensions.dblink_exec('s_one','commit');
create temporary table retry_after_claim as select * from extensions.dblink_get_result('s_two') as r(value text);
select count(*) from extensions.dblink_get_result('s_two') as r(value text);
select matches((select value from retry_after_claim),'^55000:upload intent has an active cleanup lease$','claim-before-retry rejects the retry');
select extensions.dblink_exec('s_two','commit');

select extensions.dblink_exec('s_setup',$q$
  update public.attachments
     set cleanup_claim_token=null,cleanup_lease_until=null,
         next_attempt_at=clock_timestamp()-interval '1 second'
   where id='09000000-0000-4000-8000-000000000031'
$q$);
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
create temporary table retried_before_claim(value text);
insert into retried_before_claim
select * from extensions.dblink('s_two',$q$select row_to_json(x)::text from public.create_attachment_upload_intent('09000000-0000-4000-8000-000000000031','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','image/png',100) x$q$) as r(value text);
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role service_role');
create temporary table claim_during_retry(value text);
insert into claim_during_retry select * from extensions.dblink('s_one','select row_to_json(x)::text from public.claim_attachment_cleanup(1) x') as r(value text);
select is((select count(*)::integer from claim_during_retry),0,'cleanup skips an intent locked by an in-flight retry');
select extensions.dblink_exec('s_one','commit');
select extensions.dblink_exec('s_two','commit');
select is((select count(*)::integer from extensions.dblink((select connection_string from race_fixture),$q$select id from public.claim_attachment_cleanup(1)$q$) as r(id uuid)),0,'retry postponement prevents cleanup claim after commit');

-- Conversely, an uncommitted attach lock makes cleanup skip the row.
select extensions.dblink_exec('s_setup',format($sql$
  update public.attachments
     set cleanup_lease_until=clock_timestamp()+interval '5 minutes'
   where id='09000000-0000-4000-8000-000000000021';
  insert into public.attachments(
    id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,
    status,created_at,next_attempt_at
  ) values (
    '09000000-0000-4000-8000-000000000022',%L,
    '09000000-0000-4000-8000-000000000022',
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    %L || '/09000000-0000-4000-8000-000000000022','image/png',100,
    'pending',clock_timestamp()-interval '25 hours',clock_timestamp()
  );
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
  values(
    'community-images',
    %L || '/09000000-0000-4000-8000-000000000022',
    '{"mimetype":"image/png","size":100}'::jsonb,
    '{"sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}'::jsonb
  )
$sql$,user_id,user_id::text,user_id::text)) from race_fixture;
select extensions.dblink_exec('s_two','begin');
select extensions.dblink_exec('s_two','set local role authenticated');
select extensions.dblink_exec('s_two',format('set local request.jwt.claim.sub=%L',user_id)) from race_fixture;
create temporary table attached_before_claim(value text);
insert into attached_before_claim
select * from extensions.dblink(
  's_two',
  format(
    'select public.attach_attachments(%L,array[%L::uuid],1)::text',
    (select post_id from race_fixture),
    '09000000-0000-4000-8000-000000000022'
  )
) as r(value text);
select extensions.dblink_exec('s_one','begin');
select extensions.dblink_exec('s_one','set local role service_role');
create temporary table claim_after_attach(value text);
insert into claim_after_attach
select * from extensions.dblink(
  's_one',
  $q$select row_to_json(x)::text from public.claim_attachment_cleanup(1) x$q$
) as r(value text);
select is((select count(*)::integer from claim_after_attach),0,'cleanup skips an attachment locked by an in-flight publish');
select extensions.dblink_exec('s_one','commit');
select extensions.dblink_exec('s_two','commit');
select is(
  (select status from extensions.dblink(
    (select connection_string from race_fixture),
    $q$select status from public.attachments where id='09000000-0000-4000-8000-000000000022'$q$
  ) as r(status text)),
  'attached',
  'published attachment remains attached after concurrent cleanup scan'
);

select extensions.dblink_disconnect('s_one');
select extensions.dblink_disconnect('s_two');
select extensions.dblink_exec('s_setup',format(
  'set storage.allow_delete_query=''true''; delete from storage.objects where bucket_id=''community-images'' and name like %L; reset storage.allow_delete_query; delete from public.attachments where owner_id=%L; delete from public.posts where author_id=%L; delete from auth.users where id=%L',
  user_id::text || '/%',user_id,user_id,user_id
)) from race_fixture;
select extensions.dblink_disconnect('s_setup');

select * from finish();
rollback;
