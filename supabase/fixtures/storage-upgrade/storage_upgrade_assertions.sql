create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

select is(
  (select storage_path from public.attachments where id = 'c3000000-0000-0000-0000-000000000001'),
  'legacy/path.png',
  'arbitrary legacy storage path is preserved'
);
select is(
  (select status from public.attachments where id = 'c3000000-0000-0000-0000-000000000001'),
  'pending',
  'valid unlinked legacy pending row is preserved'
);

select throws_like(
  $$insert into public.attachments (
      owner_id, client_key, payload_sha256, storage_path, mime_type, byte_size, status
    ) values (
      'c1000000-0000-0000-0000-000000000001',
      'c4000000-0000-4000-8000-000000000001',
      repeat('a', 64),
      'legacy/managed.png',
      'image/png', 10, 'pending'
    )$$,
  '%attachments_owner_storage_path_check%',
  'managed identity rejects a noncanonical storage path'
);

select is(
  (select status from public.attachments where id = 'c3000000-0000-0000-0000-000000000002'),
  'attached',
  'valid linked legacy attachment remains attached'
);
select is(
  (select post_id from public.attachments where id = 'c3000000-0000-0000-0000-000000000002'),
  'c2000000-0000-0000-0000-000000000001'::uuid,
  'valid linked legacy attachment keeps its post'
);
select is(
  (select storage_path from public.attachments where id = 'c3000000-0000-0000-0000-000000000002'),
  'legacy/attached.png',
  'valid linked legacy attachment keeps its object path'
);

select is(
  (select status from public.attachments where id = 'c3000000-0000-0000-0000-000000000003'),
  'quarantined',
  'invalid unlinked attached legacy row is quarantined'
);
select ok(
  (select post_id is null and attached_at is null and deleted_at is null
     from public.attachments where id = 'c3000000-0000-0000-0000-000000000003'),
  'quarantined attached legacy row is unlinked and cleanup-safe'
);
select ok(
  (select cleanup_last_error = 'legacy_invalid_attachment_state' and next_attempt_at is not null
     from public.attachments where id = 'c3000000-0000-0000-0000-000000000003'),
  'quarantined attached legacy row records a bounded reason and cleanup time'
);

select is(
  (select status from public.attachments where id = 'c3000000-0000-0000-0000-000000000004'),
  'quarantined',
  'invalid linked pending legacy row is quarantined'
);
select ok(
  (select post_id is null and attached_at is null and deleted_at is null
     from public.attachments where id = 'c3000000-0000-0000-0000-000000000004'),
  'quarantined pending legacy row is unlinked and cleanup-safe'
);
select ok(
  (select cleanup_last_error = 'legacy_invalid_attachment_state' and next_attempt_at is not null
     from public.attachments where id = 'c3000000-0000-0000-0000-000000000004'),
  'quarantined pending legacy row records a bounded reason and cleanup time'
);

select is(
  (select count(*)::integer
     from public.claim_attachment_cleanup(100)
    where id in (
      'c3000000-0000-0000-0000-000000000003',
      'c3000000-0000-0000-0000-000000000004'
    )),
  2,
  'normalized recent legacy rows are immediately cleanup-claimable'
);

select * from finish();
