\set ON_ERROR_STOP on
begin;

insert into auth.users (id,aud,role,email)
values ('c1000000-0000-0000-0000-000000000001','authenticated','authenticated','claim-plan@example.test');
insert into public.profiles(id,github_user_id,login)
values ('c1000000-0000-0000-0000-000000000001',99501,'claim-plan');

-- A representative backlog: 5,000 old legacy rows whose exact current objects
-- are foreign-owned, followed by one eligible managed row.
insert into public.attachments(
  owner_id,storage_path,mime_type,byte_size,status,created_at,next_attempt_at
)
select 'c1000000-0000-0000-0000-000000000001',
       format('legacy/claim-plan-%s.png',n),
       'image/png',10,'pending',clock_timestamp()-interval '4 days',
       clock_timestamp()-interval '3 hours'
from generate_series(1,5000) n;
insert into storage.objects(bucket_id,name,owner)
select 'community-images',format('legacy/claim-plan-%s.png',n),
       'b1000000-0000-0000-0000-000000000002'
from generate_series(1,5000) n;
insert into public.attachments(
  id,owner_id,client_key,payload_sha256,storage_path,mime_type,byte_size,
  status,created_at,next_attempt_at
) values (
  'c4000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'c5000000-0000-4000-8000-000000000001',
  repeat('c',64),
  'c1000000-0000-0000-0000-000000000001/c5000000-0000-4000-8000-000000000001',
  'image/png',10,'pending',clock_timestamp()-interval '2 days',
  clock_timestamp()-interval '2 hours'
);

explain (analyze, buffers, costs off, summary on)
select a.id
  from public.attachments a
  left join public.posts p on p.id = a.post_id
  left join lateral (
    select true as object_exists, o.owner, o.owner_id
      from storage.objects o
     where o.bucket_id = 'community-images'
       and o.name collate "C" = a.storage_path collate "C"
       and o.archived_at is null
     limit 1
  ) o on true
 where a.cleanup_attempt_count < 5
   and a.next_attempt_at <= clock_timestamp()
   and (a.cleanup_lease_until is null or a.cleanup_lease_until <= clock_timestamp())
   and (
     (a.client_key is not null and a.payload_sha256 is not null)
     or o.object_exists is null
     or (
       (o.owner is not null or o.owner_id is not null)
       and (o.owner is null or o.owner = a.owner_id)
       and (o.owner_id is null or o.owner_id = a.owner_id::text)
     )
   )
   and a.post_id is null
   and a.status in ('pending','quarantined')
   and (a.cleanup_last_error in ('upload_failed','legacy_invalid_attachment_state')
        or a.created_at < clock_timestamp()-interval '24 hours')
 order by a.next_attempt_at,a.created_at,a.id
 for update of a skip locked
 limit 20;

-- Measured end-to-end claim guard. Five seconds is deliberately loose enough to
-- avoid CI timing flakes while still catching the former repeated-subplan blowup.
do $$
declare started_at timestamptz := clock_timestamp(); claimed_id uuid;
begin
  select id into claimed_id from public.claim_attachment_cleanup(1);
  if claimed_id <> 'c4000000-0000-0000-0000-000000000001' then
    raise exception 'blocked rows were not filtered before LIMIT';
  end if;
  if clock_timestamp()-started_at > interval '5 seconds' then
    raise exception 'claim latency exceeded 5 seconds for 5001 rows';
  end if;
  raise notice 'claim latency: % ms',
    round(extract(epoch from clock_timestamp()-started_at)*1000,2);
end;
$$;

rollback;
