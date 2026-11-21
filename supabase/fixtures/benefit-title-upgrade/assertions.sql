do $$
declare
  v_standalone_key text;
  v_revision_key text;
  v_detail jsonb;
  v_expected_publications integer;
begin
  select dedupe_key into v_standalone_key
  from public.benefit_publications
  where publication_id='e7000000-0000-4000-8000-000000000001';

  if (select title from public.benefit_publications
      where publication_id='e7000000-0000-4000-8000-000000000001') <> 'Legacy title' then
    raise exception 'standalone legacy title was not canonicalized';
  end if;
  if v_standalone_key <> 'user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'KR-BIZ-9970000001'||E'\n'||'health'||E'\n'||'legacy title','UTF8'),'sha256'),'hex') then
    raise exception 'standalone lineage did not receive its canonical dedupe key';
  end if;

  select dedupe_key into v_revision_key
  from public.benefit_publications
  where publication_id='e7000000-0000-4000-8000-000000000010';

  if v_revision_key <> 'user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'KR-BIZ-9970000001'||E'\n'||'leave'||E'\n'||'legacy leave','UTF8'),'sha256'),'hex') then
    raise exception 'revision lineage did not derive its key from the lowest revision title';
  end if;
  if exists (
    select 1 from public.benefit_publications
    where publication_id in (
      'e7000000-0000-4000-8000-000000000010',
      'e7000000-0000-4000-8000-000000000011'
    ) and dedupe_key<>v_revision_key
  ) then
    raise exception 'revision lineage did not retain one coherent dedupe key';
  end if;
  if (select title from public.benefit_publications
      where publication_id='e7000000-0000-4000-8000-000000000010') <> 'Legacy leave'
     or (select title from public.benefit_publications
      where publication_id='e7000000-0000-4000-8000-000000000011') <> 'Updated leave' then
    raise exception 'revision titles were not canonicalized';
  end if;
  if not exists (
    select 1
    from public.benefit_publications predecessor
    join public.benefit_publications successor
      on successor.supersedes_publication_id=predecessor.publication_id
    where predecessor.publication_id='e7000000-0000-4000-8000-000000000010'
      and predecessor.status='superseded'
      and successor.publication_id='e7000000-0000-4000-8000-000000000011'
      and successor.status='active'
      and predecessor.company_id=successor.company_id
      and predecessor.dedupe_key=successor.dedupe_key
      and predecessor.revision<successor.revision
  ) then
    raise exception 'Task 1 supersession invariants did not survive upgrade';
  end if;
  if exists (
    select 1 from public.benefit_publications
    where status='active'
    group by company_id,dedupe_key
    having count(*)>1
  ) then
    raise exception 'upgrade left more than one active publication in a lineage';
  end if;

  set constraints public.benefit_publications_lineage_check,
    public.benefit_publications_unique_active_lineage_check immediate;
  set constraints public.benefit_publications_lineage_check,
    public.benefit_publications_unique_active_lineage_check deferred;

  v_detail:=public.get_benefit_company_v1('KR-BIZ-9970000001');
  v_expected_publications:=2+case when exists (
    select 1 from public.benefit_publications
    where publication_id='e7000000-0000-4000-8000-000000000030'
  ) then 1 else 0 end;
  if v_detail is null
     or pg_catalog.jsonb_array_length(v_detail->'publications')<>v_expected_publications
     or not exists (
       select 1 from pg_catalog.jsonb_array_elements(v_detail->'publications') item
       where item->>'title'='Legacy title'
     )
     or not exists (
       select 1 from pg_catalog.jsonb_array_elements(v_detail->'publications') item
       where item->>'title'='Updated leave'
     )
     or (v_expected_publications=3 and not exists (
       select 1 from pg_catalog.jsonb_array_elements(v_detail->'publications') item
       where item->>'title'='Concurrent legacy writer'
     )) then
    raise exception 'public detail did not expose canonical active publications';
  end if;
end $$;
