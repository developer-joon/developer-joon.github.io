insert into auth.users (id, aud, role, email) values
  ('e6100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'snapshot-upgrade@example.test');

insert into public.profiles (id, github_user_id, login, display_name) values (
  'e6100000-0000-4000-8000-000000000001',
  986101,
  'snapshot-upgrade' || repeat(' ', 40),
  'Snapshot Upgrade' || repeat(' ', 121)
);

insert into public.posts (
  id, author_id, title, body_markdown, status, created_at, updated_at, deleted_at
) values
  (
    'e6200000-0000-4000-8000-000000000001',
    'e6100000-0000-4000-8000-000000000001',
    'Padded legacy title' || repeat(' ', 121),
    'legacy body', 'published', '-infinity', '-infinity', null
  ),
  (
    'e6200000-0000-4000-8000-000000000002',
    'e6100000-0000-4000-8000-000000000001',
    'Positive infinity',
    'legacy body', 'published', 'infinity', 'infinity', null
  ),
  (
    'e6200000-0000-4000-8000-000000000003',
    'e6100000-0000-4000-8000-000000000001',
    'Mixed infinities',
    'legacy body', 'published', '-infinity', 'infinity', null
  ),
  (
    'e6200000-0000-4000-8000-000000000004',
    'e6100000-0000-4000-8000-000000000001',
    'Legacy deleted post',
    'legacy body', 'deleted', '-infinity', '-infinity', '1900-01-01 00:00:00+00'
  ),
  (
    'e6200000-0000-4000-8000-000000000005',
    'e6100000-0000-4000-8000-000000000001',
    'Early finite timestamp',
    'legacy body', 'published', '0001-01-01 00:00:00+00', '0001-01-01 00:00:00+00', null
  ),
  (
    'e6200000-0000-4000-8000-000000000006',
    'e6100000-0000-4000-8000-000000000001',
    'Late finite timestamp',
    'legacy body', 'published', '10000-01-01 00:00:00+00', '10000-01-01 00:00:00+00', null
  );

insert into public.tags (id, slug, label) values
  (
    'e6300000-0000-4000-8000-000000000001',
    repeat('legacy-', 14) || 'tag',
    'Legacy Label' || repeat(' ', 51)
  ),
  (
    'e6300000-0000-4000-8000-000000000002',
    repeat('a', 46) || '-' || repeat('b', 40),
    'Legacy Label'
  ),
  (
    'e6300000-0000-4000-8000-000000000003',
    'label-collision-probe',
    left('Legacy Label', 11)
      || '-'
      || replace('e6300000-0000-4000-8000-000000000002', '-', '')
      || ' '
  ),
  (
    'e6300000-0000-4000-8000-000000000004',
    'legacy-legacy-legacy-legacy-legacy-legacy-legac-9426498bd850cb590987bf296a071a33',
    'Slug Collision'
  );

insert into public.post_tags (post_id, tag_id) values (
  'e6200000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001'
);
