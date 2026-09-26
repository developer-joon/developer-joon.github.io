-- Legacy rows that are legal through migration 002 but exercise migration 003.
insert into auth.users (id, aud, role, email)
values ('c1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'storage-upgrade@example.test');

insert into public.profiles (id, github_user_id, login)
values ('c1000000-0000-0000-0000-000000000001', 95001, 'storage-upgrade');

insert into public.posts (id, author_id, title, body_markdown, status)
values (
  'c2000000-0000-0000-0000-000000000001',
  'c1000000-0000-0000-0000-000000000001',
  'Legacy attachment post',
  'body',
  'published'
);

insert into public.attachments (
  id, owner_id, post_id, storage_path, mime_type, byte_size, status,
  created_at, attached_at
) values
  (
    'c3000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    null,
    'legacy/path.png',
    'image/png', 10, 'pending', now() - interval '2 days', null
  ),
  (
    'c3000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'legacy/attached.png',
    'image/png', 20, 'attached', now() - interval '2 days', now() - interval '1 day'
  ),
  (
    'c3000000-0000-0000-0000-000000000003',
    'c1000000-0000-0000-0000-000000000001',
    null,
    'legacy/orphan-attached.png',
    'image/png', 30, 'attached', now(), now()
  ),
  (
    'c3000000-0000-0000-0000-000000000004',
    'c1000000-0000-0000-0000-000000000001',
    'c2000000-0000-0000-0000-000000000001',
    'legacy/linked-pending.png',
    'image/png', 40, 'pending', now(), null
  );
