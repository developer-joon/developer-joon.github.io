\set ON_ERROR_STOP on

begin;

delete from auth.users
where id = 'e1000000-0000-4000-8000-000000000001';

insert into auth.users (id, aud, role, email)
values (
  'e1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'public-attachment-integration@example.test'
);

insert into public.profiles (id, github_user_id, login)
values (
  'e1000000-0000-4000-8000-000000000001',
  95001,
  'public-attachment-integration'
);

insert into public.posts (
  id,
  author_id,
  title,
  body_markdown,
  status
)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Public attachment integration',
  '![fixture](e1000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001)',
  'published'
);

insert into public.attachments (
  id,
  owner_id,
  post_id,
  client_key,
  payload_sha256,
  storage_path,
  mime_type,
  byte_size,
  status,
  attached_at
)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  'e1000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001',
  'image/png',
  8,
  'attached',
  pg_catalog.clock_timestamp()
);

commit;
