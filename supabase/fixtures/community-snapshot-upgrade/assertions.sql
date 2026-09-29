do $$
declare
  export_document jsonb;
  expected_slug text;
  expected_second_slug text;
  expected_second_label text;
begin
  if (select login <> 'snapshot-upgrade' or display_name <> 'Snapshot Upgrade'
        from public.profiles
       where id = 'e6100000-0000-4000-8000-000000000001') then
    raise exception 'legacy profile text was not deterministically trimmed';
  end if;

  if (select title <> 'Padded legacy title'
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000001') then
    raise exception 'legacy post title was not deterministically trimmed';
  end if;

  expected_slug := rtrim(left(repeat('legacy-', 14) || 'tag', 45), '-')
    || '-'
    || md5('e6300000-0000-4000-8000-000000000001:' || repeat('legacy-', 14) || 'tag')
    || '-1';
  expected_second_slug := rtrim(left(repeat('a', 46) || '-' || repeat('b', 40), 47), '-')
    || '-'
    || md5('e6300000-0000-4000-8000-000000000002:' || repeat('a', 46) || '-' || repeat('b', 40));
  expected_second_label := left('Legacy Label', 11)
    || '-'
    || replace('e6300000-0000-4000-8000-000000000002', '-', '')
    || '-1';

  if (select label <> 'Legacy Label'
          or slug <> expected_slug
          or char_length(slug) > 80
          or slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        from public.tags
       where id = 'e6300000-0000-4000-8000-000000000001') then
    raise exception 'legacy tag was not deterministically canonicalized';
  end if;

  if (select label <> expected_second_label
          or char_length(label) > 50
          or slug <> expected_second_slug
          or char_length(slug) > 80
          or slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
        from public.tags
       where id = 'e6300000-0000-4000-8000-000000000002') then
    raise exception 'colliding legacy tag was not deterministically canonicalized';
  end if;

  if (select slug <> 'legacy-legacy-legacy-legacy-legacy-legacy-legac-9426498bd850cb590987bf296a071a33'
        from public.tags
       where id = 'e6300000-0000-4000-8000-000000000004') then
    raise exception 'prior canonical slug collision owner changed unexpectedly';
  end if;

  if (select count(distinct label) <> count(*) or count(distinct slug) <> count(*) from public.tags) then
    raise exception 'tag canonicalization introduced a uniqueness collision';
  end if;

  if exists (
    select 1
      from public.posts
     where id in (
       'e6200000-0000-4000-8000-000000000001',
       'e6200000-0000-4000-8000-000000000002',
       'e6200000-0000-4000-8000-000000000003',
       'e6200000-0000-4000-8000-000000000004'
     )
       and (
         not isfinite(created_at)
         or not isfinite(updated_at)
         or updated_at < created_at
         or (deleted_at is not null and (not isfinite(deleted_at) or deleted_at < created_at))
       )
  ) then
    raise exception 'legacy post timestamps were not normalized to finite ordered values';
  end if;

  if (select created_at <> '1970-01-01 00:00:00+00'::timestamptz
          or updated_at <> '1970-01-01 00:00:00+00'::timestamptz
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000001') then
    raise exception 'negative infinity normalization changed unexpectedly';
  end if;

  if (select created_at <> '9999-12-31 23:59:59.999999+00'::timestamptz
          or updated_at <> '9999-12-31 23:59:59.999999+00'::timestamptz
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000002') then
    raise exception 'positive infinity normalization changed unexpectedly';
  end if;

  if (select created_at <> '1970-01-01 00:00:00+00'::timestamptz
          or updated_at <> '1970-01-01 00:00:00+00'::timestamptz
          or deleted_at <> '1970-01-01 00:00:00+00'::timestamptz
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000004') then
    raise exception 'deleted legacy timestamp normalization changed unexpectedly';
  end if;

  if (select created_at <> '1000-01-01 00:00:00+00'::timestamptz
          or updated_at <> '1000-01-01 00:00:00+00'::timestamptz
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000005') then
    raise exception 'early finite timestamp was not clamped to the wire minimum';
  end if;

  if (select created_at <> '9999-12-31 23:59:59.999999+00'::timestamptz
          or updated_at <> '9999-12-31 23:59:59.999999+00'::timestamptz
        from public.posts
       where id = 'e6200000-0000-4000-8000-000000000006') then
    raise exception 'late finite timestamp was not clamped to the wire maximum';
  end if;

  select public.list_public_community_snapshots_v1(
    100,
    '9999-12-31 23:59:59.999999+00'::timestamptz,
    null,
    null
  ) into export_document;

  if jsonb_array_length(export_document -> 'items') <> 5 then
    raise exception 'normalized legacy rows are not exportable: %', export_document;
  end if;
end
$$;
