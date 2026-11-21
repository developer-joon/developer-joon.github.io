-- Public company-benefit directory read model and bounded read RPCs.
begin;

create table public.benefit_companies (
  company_id text primary key,
  identity_class text not null,
  display_name text not null,
  normalized_name text not null,
  industry text,
  size_class text,
  region text,
  summary text,
  is_searchable boolean not null default true,
  source_edition text not null,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint benefit_companies_id_check check (company_id ~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$'),
  constraint benefit_companies_identity_check check (identity_class in ('legal_corporation','registered_business','recruitment_observation','group_affiliate')),
  constraint benefit_companies_display_name_check check (char_length(display_name) between 1 and 200 and display_name=btrim(display_name)),
  constraint benefit_companies_normalized_name_check check (char_length(normalized_name) between 1 and 200 and normalized_name=btrim(normalized_name) and normalized_name=lower(normalized_name)),
  constraint benefit_companies_industry_check check (industry is null or (char_length(industry) between 1 and 100 and industry=btrim(industry))),
  constraint benefit_companies_size_check check (size_class is null or size_class in ('large','medium','small','large_affiliate','unclassified')),
  constraint benefit_companies_region_check check (region is null or (char_length(region) between 1 and 100 and region=btrim(region))),
  constraint benefit_companies_summary_check check (summary is null or (char_length(summary) between 1 and 500 and summary=btrim(summary))),
  constraint benefit_companies_source_edition_check check (char_length(source_edition) between 1 and 100 and source_edition=btrim(source_edition)),
  constraint benefit_companies_provenance_check check (jsonb_typeof(provenance)='object'),
  constraint benefit_companies_timestamps_check check (updated_at>=created_at)
);

create table public.benefit_publications (
  publication_id uuid primary key default gen_random_uuid(),
  company_id text not null references public.benefit_companies(company_id) on delete restrict,
  category_id text not null,
  title text not null,
  description text not null,
  eligibility_text text,
  condition_text text,
  trust_tier text not null,
  status text not null default 'active',
  dedupe_key text not null,
  revision integer not null,
  supersedes_publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
  source_url text,
  source_type text not null,
  observed_at timestamptz,
  verified_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  reviewer_id text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(company_id,dedupe_key,revision),
  constraint benefit_publications_category_check check (category_id in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion')),
  constraint benefit_publications_title_check check (char_length(title) between 1 and 200 and title=btrim(title)),
  constraint benefit_publications_description_check check (char_length(description) between 1 and 5000 and description=btrim(description)),
  constraint benefit_publications_eligibility_check check (eligibility_text is null or (char_length(eligibility_text) between 1 and 2000 and eligibility_text=btrim(eligibility_text))),
  constraint benefit_publications_condition_check check (condition_text is null or (char_length(condition_text) between 1 and 2000 and condition_text=btrim(condition_text))),
  constraint benefit_publications_trust_check check (trust_tier in ('official_verified','community_reviewed')),
  constraint benefit_publications_status_check check (status in ('active','withdrawn','superseded')),
  constraint benefit_publications_dedupe_check check (char_length(dedupe_key) between 1 and 200 and dedupe_key=btrim(dedupe_key)),
  constraint benefit_publications_revision_check check (revision>=0),
  constraint benefit_publications_source_url_check check (source_url is null or (char_length(source_url) between 9 and 2048 and source_url=btrim(source_url))),
  constraint benefit_publications_source_type_check check (char_length(source_type) between 1 and 100 and source_type=btrim(source_type)),
  constraint benefit_publications_provenance_check check (jsonb_typeof(provenance)='object'),
  constraint benefit_publications_reviewer_check check (reviewer_id is null or (char_length(reviewer_id) between 1 and 200 and reviewer_id=btrim(reviewer_id))),
  constraint benefit_publications_observation_check check (verified_at is null or observed_at is null or verified_at>=observed_at),
  constraint benefit_publications_timestamps_check check (updated_at>=created_at),
  constraint benefit_publications_supersedes_self_check check (supersedes_publication_id is null or supersedes_publication_id<>publication_id)
);

create index benefit_publications_active_lineage_idx
  on public.benefit_publications(company_id,dedupe_key) where status='active';
create index benefit_companies_search_order_idx
  on public.benefit_companies(normalized_name,company_id) where is_searchable;
create index benefit_companies_filter_order_idx
  on public.benefit_companies(industry,size_class,region,normalized_name,company_id) where is_searchable;
create index benefit_publications_active_company_idx
  on public.benefit_publications(company_id,trust_tier,category_id,publication_id) where status='active';
create index benefit_publications_active_category_company_idx
  on public.benefit_publications(category_id,company_id) where status='active';
create index benefit_publications_supersedes_idx
  on public.benefit_publications(supersedes_publication_id) where supersedes_publication_id is not null;

-- A successor may have any publication status, but its predecessor must finish as
-- superseded or withdrawn in the same transaction. Deferral permits either write order.
create function private.enforce_benefit_publication_lineage()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_publication public.benefit_publications%rowtype;
  v_predecessor public.benefit_publications%rowtype;
begin
  select * into v_publication
  from public.benefit_publications
  where publication_id=new.publication_id;

  if not found then
    return null;
  end if;

  if v_publication.supersedes_publication_id is not null then
    select * into v_predecessor
    from public.benefit_publications
    where publication_id=v_publication.supersedes_publication_id
    for no key update;

    if not found then
      raise exception 'benefit publication predecessor does not exist' using errcode='23503';
    end if;
    if v_predecessor.company_id<>v_publication.company_id
       or v_predecessor.dedupe_key<>v_publication.dedupe_key then
      raise exception 'benefit publication predecessor must have the same company and dedupe key' using errcode='23514';
    end if;
    if v_predecessor.revision>=v_publication.revision then
      raise exception 'benefit publication predecessor revision must be lower' using errcode='23514';
    end if;
    if v_predecessor.status not in ('superseded','withdrawn') then
      raise exception 'benefit publication predecessor must be superseded or withdrawn' using errcode='23514';
    end if;
  end if;

  if exists(
    select 1 from public.benefit_publications successor
    where successor.supersedes_publication_id=v_publication.publication_id
      and (successor.company_id<>v_publication.company_id or successor.dedupe_key<>v_publication.dedupe_key)
  ) then
    raise exception 'benefit publication predecessor must have the same company and dedupe key' using errcode='23514';
  end if;
  if exists(
    select 1 from public.benefit_publications successor
    where successor.supersedes_publication_id=v_publication.publication_id
      and successor.revision<=v_publication.revision
  ) then
    raise exception 'benefit publication predecessor revision must be lower' using errcode='23514';
  end if;
  if v_publication.status not in ('superseded','withdrawn') and exists(
    select 1 from public.benefit_publications successor
    where successor.supersedes_publication_id=v_publication.publication_id
  ) then
    raise exception 'benefit publication predecessor must be superseded or withdrawn' using errcode='23514';
  end if;

  return null;
end $$;

alter function private.enforce_benefit_publication_lineage() owner to postgres;
revoke all on function private.enforce_benefit_publication_lineage() from public,anon,authenticated,service_role;

create constraint trigger benefit_publications_lineage_check
  after insert or update on public.benefit_publications
  deferrable initially deferred
  for each row execute function private.enforce_benefit_publication_lineage();

-- Active-lineage uniqueness must be checked at the transaction boundary so an
-- active successor can be written before or after its predecessor is retired.
-- The transaction advisory lock serializes READ COMMITTED writers that affect
-- the same lineage; old and new keys are locked in lexical order for moves.
create function private.enforce_benefit_publication_active_lineage()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_lineages jsonb:='[]'::jsonb;
  v_lineage record;
begin
  if tg_op<>'INSERT' then
    v_lineages:=v_lineages||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('company_id',old.company_id,'dedupe_key',old.dedupe_key)
    );
  end if;
  if tg_op<>'DELETE' then
    v_lineages:=v_lineages||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('company_id',new.company_id,'dedupe_key',new.dedupe_key)
    );
  end if;

  for v_lineage in
    select distinct value->>'company_id' company_id,value->>'dedupe_key' dedupe_key
    from pg_catalog.jsonb_array_elements(v_lineages)
    order by company_id,dedupe_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'benefit-publication-active-lineage:'||pg_catalog.jsonb_build_array(v_lineage.company_id,v_lineage.dedupe_key)::text,
        0
      )
    );
  end loop;

  for v_lineage in
    select distinct value->>'company_id' company_id,value->>'dedupe_key' dedupe_key
    from pg_catalog.jsonb_array_elements(v_lineages)
    order by company_id,dedupe_key
  loop
    if (select pg_catalog.count(*)
        from public.benefit_publications publication
        where publication.company_id=v_lineage.company_id
          and publication.dedupe_key=v_lineage.dedupe_key
          and publication.status='active')>1 then
      raise exception 'benefit publication lineage may have at most one active publication'
        using errcode='23514';
    end if;
  end loop;

  return null;
end $$;

alter function private.enforce_benefit_publication_active_lineage() owner to postgres;
revoke all on function private.enforce_benefit_publication_active_lineage() from public,anon,authenticated,service_role;

create constraint trigger benefit_publications_unique_active_lineage_check
  after insert or update or delete on public.benefit_publications
  deferrable initially deferred
  for each row execute function private.enforce_benefit_publication_active_lineage();

alter table public.benefit_companies enable row level security;
alter table public.benefit_publications enable row level security;
revoke all on table public.benefit_companies,public.benefit_publications from public,anon,authenticated;

create function public.search_benefit_companies_v1(
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
       or v_cursor_company !~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$' then
      raise exception 'invalid cursor' using errcode='22023';
    end if;
  end if;

  select pg_catalog.count(*)
  into v_total
  from public.benefit_companies c
  where c.is_searchable
    and (v_query is null or pg_catalog.starts_with(c.normalized_name,v_query) or pg_catalog.starts_with(pg_catalog.lower(c.company_id),v_query))
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
      and (v_query is null or pg_catalog.starts_with(c.normalized_name,v_query) or pg_catalog.starts_with(pg_catalog.lower(c.company_id),v_query))
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

create function public.get_benefit_company_v1(p_company_id text)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or pg_catalog.octet_length(p_company_id)>256 then
    raise exception 'invalid company id' using errcode='22023';
  end if;
  if p_company_id !~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$' then
    raise exception 'invalid company id' using errcode='22023';
  end if;
  select pg_catalog.jsonb_build_object(
    'company',pg_catalog.jsonb_build_object(
      'company_id',c.company_id,
      'display_name',c.display_name,
      'identity_label',case c.identity_class when 'legal_corporation' then '법인' when 'registered_business' then '등록 사업자' when 'recruitment_observation' then '채용 관찰 사업자' when 'group_affiliate' then '공시대상기업집단 소속 법인' end,
      'industry',c.industry,
      'size_label',case c.size_class when 'large' then '대기업' when 'medium' then '중견기업' when 'small' then '중소기업' when 'large_affiliate' then '대규모기업집단 소속' else '분류 미확인' end,
      'region',c.region,
      'summary',c.summary
    ),
    'publications',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'publication_id',bp.publication_id,
        'category_id',bp.category_id,
        'title',bp.title,
        'description',bp.description,
        'eligibility_text',bp.eligibility_text,
        'condition_text',bp.condition_text,
        'trust_label',case bp.trust_tier when 'official_verified' then '공식 확인' else '사용자 제보' end,
        'revision',bp.revision
      ) order by bp.category_id,bp.title,bp.publication_id)
      from public.benefit_publications bp where bp.company_id=c.company_id and bp.status='active'
    ),'[]'::jsonb)
  ) into v_result
  from public.benefit_companies c
  where c.company_id=p_company_id and c.is_searchable;
  return coalesce(v_result,'null'::jsonb);
end $$;

alter function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) owner to postgres;
alter function public.get_benefit_company_v1(text) owner to postgres;
revoke all on function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.get_benefit_company_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) to anon,authenticated;
grant execute on function public.get_benefit_company_v1(text) to anon,authenticated;

commit;
