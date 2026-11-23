-- Publish an opaque, bounded key for exact client-side order validation.
begin;

create or replace function public.search_benefit_companies_v1(
  p_query text default null,
  p_categories text[] default null,
  p_industry text default null,
  p_size text default null,
  p_region text default null,
  p_has_benefits_only boolean default false,
  p_page_size integer default 20,
  p_cursor text default null
) returns jsonb
language plpgsql stable security definer
set search_path=''
set plan_cache_mode='force_custom_plan'
as $$
declare
  v_query text;
  v_search_query text;
  v_categories text[];
  v_industry text;
  v_region text;
  v_cursor jsonb;
  v_cursor_name text;
  v_cursor_company text;
  v_items jsonb;
  v_has_more boolean;
  v_next_cursor text;
  v_total bigint;
begin
  if p_page_size is null or p_page_size not between 1 and 50 then
    raise exception 'invalid page size' using errcode='22023';
  end if;
  if p_has_benefits_only is null then
    raise exception 'invalid has benefits filter' using errcode='22023';
  end if;
  if p_query is not null then
    if pg_catalog.char_length(p_query)>200 or pg_catalog.octet_length(p_query)>800 then
      raise exception 'invalid query' using errcode='22023';
    end if;
  end if;
  v_query:=pg_catalog.lower(pg_catalog.btrim(p_query));
  if v_query='' then v_query:=null; end if;
  v_search_query:=private.normalize_benefit_company_search(v_query);

  if p_categories is not null then
    if pg_catalog.cardinality(p_categories) not between 1 and 10 then
      raise exception 'invalid category' using errcode='22023';
    end if;
    if exists(select 1 from pg_catalog.unnest(p_categories) c where c is null) then
      raise exception 'invalid category' using errcode='22023';
    end if;
    if exists(select 1 from pg_catalog.unnest(p_categories) c where pg_catalog.char_length(c)>32 or pg_catalog.octet_length(c)>128) then
      raise exception 'invalid category length' using errcode='22023';
    end if;
    if exists(select 1 from pg_catalog.unnest(p_categories) c where c not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion')) then
      raise exception 'invalid category' using errcode='22023';
    end if;
    select pg_catalog.array_agg(distinct c order by c) into v_categories from pg_catalog.unnest(p_categories) c;
  end if;
  if p_industry is not null then
    if pg_catalog.char_length(p_industry)>100 or pg_catalog.octet_length(p_industry)>400 then
      raise exception 'invalid industry' using errcode='22023';
    end if;
    if pg_catalog.btrim(p_industry)='' then
      raise exception 'invalid industry' using errcode='22023';
    end if;
  end if;
  v_industry:=pg_catalog.btrim(p_industry);
  if p_size is not null then
    if pg_catalog.char_length(p_size)>32 or pg_catalog.octet_length(p_size)>128 then
      raise exception 'invalid size length' using errcode='22023';
    end if;
    if p_size not in ('large','medium','small','large_affiliate','unclassified') then
      raise exception 'invalid size' using errcode='22023';
    end if;
  end if;
  if p_region is not null then
    if pg_catalog.char_length(p_region)>100 or pg_catalog.octet_length(p_region)>400 then
      raise exception 'invalid region' using errcode='22023';
    end if;
    if pg_catalog.btrim(p_region)='' then
      raise exception 'invalid region' using errcode='22023';
    end if;
  end if;
  v_region:=pg_catalog.btrim(p_region);

  if p_cursor is not null then
    if pg_catalog.char_length(p_cursor)>500 or pg_catalog.octet_length(p_cursor)>2000 then
      raise exception 'invalid cursor' using errcode='22023';
    end if;
    begin
      v_cursor:=p_cursor::jsonb;
    exception when others then
      raise exception 'invalid cursor' using errcode='22023';
    end;
    if pg_catalog.jsonb_typeof(v_cursor)<>'object'
       or (select count(*) from pg_catalog.jsonb_object_keys(v_cursor))<>2
       or not (v_cursor ? 'normalized_name' and v_cursor ? 'company_id')
       or pg_catalog.jsonb_typeof(v_cursor->'normalized_name')<>'string'
       or pg_catalog.jsonb_typeof(v_cursor->'company_id')<>'string' then
      raise exception 'invalid cursor' using errcode='22023';
    end if;
    v_cursor_name:=v_cursor->>'normalized_name';
    v_cursor_company:=v_cursor->>'company_id';
    if pg_catalog.char_length(v_cursor_name) not between 1 and 200
       or pg_catalog.octet_length(v_cursor_name)>800
       or pg_catalog.char_length(v_cursor_company)>64
       or pg_catalog.octet_length(v_cursor_company)>256 then
      raise exception 'invalid cursor' using errcode='22023';
    end if;
    if v_cursor_name<>pg_catalog.lower(pg_catalog.btrim(v_cursor_name))
       or not private.is_benefit_company_id(v_cursor_company) then
      raise exception 'invalid cursor' using errcode='22023';
    end if;
  end if;

  select pg_catalog.count(*)
  into v_total
  from public.benefit_companies c
  where c.is_searchable
    and (v_query is null or pg_catalog.starts_with(c.search_name,v_search_query) or pg_catalog.starts_with(pg_catalog.lower(c.company_id),v_query))
    and (v_industry is null or c.industry=v_industry)
    and (p_size is null or c.size_class=p_size)
    and (v_region is null or c.region=v_region)
    and (v_categories is null or exists(
      select 1 from public.benefit_publications bp
      where bp.company_id=c.company_id and bp.status='active' and bp.category_id=any(v_categories)
    ))
    and (not p_has_benefits_only or exists(
      select 1 from public.benefit_publications bp
      where bp.company_id=c.company_id and bp.status='active'
    ));

  with candidates as materialized (
    select c.company_id,c.normalized_name
    from public.benefit_companies c
    where c.is_searchable
      and (v_query is null or pg_catalog.starts_with(c.search_name,v_search_query) or pg_catalog.starts_with(pg_catalog.lower(c.company_id),v_query))
      and (v_industry is null or c.industry=v_industry)
      and (p_size is null or c.size_class=p_size)
      and (v_region is null or c.region=v_region)
      and (v_categories is null or exists(
        select 1 from public.benefit_publications bp
        where bp.company_id=c.company_id and bp.status='active' and bp.category_id=any(v_categories)
      ))
      and (not p_has_benefits_only or exists(
        select 1 from public.benefit_publications bp
        where bp.company_id=c.company_id and bp.status='active'
      ))
      and (v_cursor_name is null or (c.normalized_name,c.company_id)>(v_cursor_name,v_cursor_company))
    order by c.normalized_name,c.company_id
    limit p_page_size+1
  ), page as materialized (
    select * from candidates order by normalized_name,company_id limit p_page_size
  ), publication_aggregates as materialized (
    select bp.company_id,
      pg_catalog.count(*) benefit_count,
      pg_catalog.count(*) filter (where bp.trust_tier='official_verified') official_count,
      pg_catalog.count(*) filter (where bp.trust_tier='community_reviewed') community_count,
      pg_catalog.jsonb_agg(distinct bp.category_id order by bp.category_id) categories
    from page p
    join public.benefit_publications bp on bp.company_id=p.company_id and bp.status='active'
    group by bp.company_id
  ), hydrated as (
    select p.normalized_name,p.company_id,
      pg_catalog.jsonb_build_object(
        'company_id',c.company_id,
        'sort_key',pg_catalog.encode(pg_catalog.convert_to(c.normalized_name,'UTF8'),'hex'),
        'display_name',c.display_name,
        'identity_label',case c.identity_class when 'legal_corporation' then '법인' when 'registered_business' then '등록 사업자' when 'recruitment_observation' then '채용 관찰 사업자' when 'group_affiliate' then '공시대상기업집단 소속 법인' end,
        'industry',c.industry,
        'size_label',case c.size_class when 'large' then '대기업' when 'medium' then '중견기업' when 'small' then '중소기업' when 'large_affiliate' then '대규모기업집단 소속' else '분류 미확인' end,
        'region',c.region,
        'summary',c.summary,
        'benefit_count',coalesce(a.benefit_count,0),
        'official_count',coalesce(a.official_count,0),
        'community_count',coalesce(a.community_count,0),
        'categories',coalesce(a.categories,'[]'::jsonb)
      ) item
    from page p
    join public.benefit_companies c using(company_id)
    left join publication_aggregates a using(company_id)
  )
  select coalesce(pg_catalog.jsonb_agg(item order by normalized_name,company_id),'[]'::jsonb),
    (select count(*)>p_page_size from candidates),
    case when (select count(*)>p_page_size from candidates) then (
      select pg_catalog.jsonb_build_object('normalized_name',normalized_name,'company_id',company_id)::text
      from page order by normalized_name desc,company_id desc limit 1
    ) else null end
  into v_items,v_has_more,v_next_cursor
  from hydrated;

  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next_cursor,'total',v_total);
end $$;

commit;
