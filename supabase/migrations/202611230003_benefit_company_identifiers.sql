-- Canonical benefit-company IDs, private strong identifiers, and merge lineage.
begin;

create function private.is_benefit_company_id(p_value text)
returns boolean
language sql immutable strict
set search_path=''
as $$
  select p_value ~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10}|KR-CAN-[0-9a-f]{32})$'
$$;
alter function private.is_benefit_company_id(text) owner to postgres;
revoke all on function private.is_benefit_company_id(text) from public,anon,authenticated,service_role;

alter table public.benefit_companies
  drop constraint benefit_companies_id_check,
  add constraint benefit_companies_id_check check (private.is_benefit_company_id(company_id));

create table public.benefit_company_identifiers (
  identifier_id uuid primary key default gen_random_uuid(),
  company_id text not null references public.benefit_companies(company_id) on delete restrict,
  identifier_type text not null,
  identifier_digest_or_value text not null,
  source_edition text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(identifier_type,identifier_digest_or_value),
  constraint benefit_company_identifiers_type_check check (identifier_type in ('legacy_company_id','opendart_corp_code','business_number_hmac_v1')),
  constraint benefit_company_identifiers_value_check check (
    (identifier_type='legacy_company_id' and identifier_digest_or_value ~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$')
    or (identifier_type='opendart_corp_code' and identifier_digest_or_value ~ '^[0-9]{8}$')
    or (identifier_type='business_number_hmac_v1' and identifier_digest_or_value ~ '^[0-9a-f]{64}$')
  ),
  constraint benefit_company_identifiers_source_check check (pg_catalog.char_length(source_edition) between 1 and 100 and pg_catalog.octet_length(source_edition)<=400 and source_edition=pg_catalog.btrim(source_edition)),
  constraint benefit_company_identifiers_verified_check check (pg_catalog.isfinite(verified_at)),
  constraint benefit_company_identifiers_timestamps_check check (pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at)
);
create index benefit_company_identifiers_company_idx on public.benefit_company_identifiers(company_id,identifier_type,identifier_id);

create table public.benefit_company_merge_events (
  merge_event_id uuid primary key default gen_random_uuid(),
  source_company_id text not null references public.benefit_companies(company_id) on delete restrict,
  destination_company_id text not null references public.benefit_companies(company_id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint benefit_company_merge_events_distinct_check check (source_company_id<>destination_company_id),
  constraint benefit_company_merge_events_reason_check check (pg_catalog.char_length(reason) between 1 and 1000 and pg_catalog.octet_length(reason)<=4000 and reason=pg_catalog.btrim(reason)),
  constraint benefit_company_merge_events_created_check check (pg_catalog.isfinite(created_at))
);
create index benefit_company_merge_events_source_idx on public.benefit_company_merge_events(source_company_id,created_at,merge_event_id);
create index benefit_company_merge_events_destination_idx on public.benefit_company_merge_events(destination_company_id,created_at,merge_event_id);
create index benefit_company_merge_events_actor_idx on public.benefit_company_merge_events(actor_id,created_at,merge_event_id);

create function private.reject_benefit_company_merge_event_change()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'benefit company merge events are append-only' using errcode='23514';
end $$;
alter function private.reject_benefit_company_merge_event_change() owner to postgres;
revoke all on function private.reject_benefit_company_merge_event_change() from public,anon,authenticated,service_role;
create trigger benefit_company_merge_events_append_only_row
  before update or delete on public.benefit_company_merge_events
  for each row execute function private.reject_benefit_company_merge_event_change();
create trigger benefit_company_merge_events_append_only_truncate
  before truncate on public.benefit_company_merge_events
  for each statement execute function private.reject_benefit_company_merge_event_change();

alter table public.benefit_company_identifiers owner to postgres;
alter table public.benefit_company_merge_events owner to postgres;
alter table public.benefit_company_identifiers enable row level security;
alter table public.benefit_company_merge_events enable row level security;
revoke all on table public.benefit_company_identifiers,public.benefit_company_merge_events from public,anon,authenticated,service_role;

-- The correction ledger also retains frozen US-CIK artifact IDs. Extend it
-- additively for dynamic directory IDs without rewriting those historical IDs.
alter table public.benefit_correction_requests
  drop constraint benefit_correction_requests_company_check,
  add constraint benefit_correction_requests_company_check check (
    private.is_benefit_company_id(company_id) or company_id ~ '^US-CIK[0-9]{10}$'
  );

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

create or replace function public.get_benefit_company_v1(p_company_id text)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
declare
  v_company jsonb;
  v_publication_count integer;
  v_publications jsonb;
begin
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or pg_catalog.octet_length(p_company_id)>256 then
    raise exception 'invalid company id' using errcode='22023';
  end if;
  if not private.is_benefit_company_id(p_company_id) then
    raise exception 'invalid company id' using errcode='22023';
  end if;

  select pg_catalog.jsonb_build_object(
    'company_id',c.company_id,
    'display_name',c.display_name,
    'identity_label',case c.identity_class when 'legal_corporation' then '법인' when 'registered_business' then '등록 사업자' when 'recruitment_observation' then '채용 관찰 사업자' when 'group_affiliate' then '공시대상기업집단 소속 법인' end,
    'industry',c.industry,
    'size_label',case c.size_class when 'large' then '대기업' when 'medium' then '중견기업' when 'small' then '중소기업' when 'large_affiliate' then '대규모기업집단 소속' else '분류 미확인' end,
    'region',c.region,
    'summary',c.summary
  )
  into v_company
  from public.benefit_companies c
  where c.company_id=p_company_id and c.is_searchable;

  if v_company is null then
    return 'null'::jsonb;
  end if;

  select pg_catalog.count(*)::integer
  into v_publication_count
  from (
    select 1
    from public.benefit_publications bp
    where bp.company_id=p_company_id and bp.status='active'
    limit 201
  ) bounded;

  if v_publication_count>200 then
    raise exception 'benefit publication limit exceeded' using errcode='P0001';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'publication_id',bounded.publication_id,
    'category_id',bounded.category_id,
    'title',bounded.title,
    'description',bounded.description,
    'eligibility_text',bounded.eligibility_text,
    'condition_text',bounded.condition_text,
    'trust_label',case bounded.trust_tier when 'official_verified' then '공식 확인' else '사용자 제보' end,
    'revision',bounded.revision
  ) order by bounded.category_id,bounded.title,bounded.publication_id),'[]'::jsonb)
  into v_publications
  from (
    select bp.publication_id,bp.category_id,bp.title,bp.description,bp.eligibility_text,
      bp.condition_text,bp.trust_tier,bp.revision
    from public.benefit_publications bp
    where bp.company_id=p_company_id and bp.status='active'
    order by bp.category_id,bp.title,bp.publication_id
    limit 200
  ) bounded;

  return pg_catalog.jsonb_build_object('company',v_company,'publications',v_publications);
end $$;

create or replace function public.create_benefit_submission_v1(
  p_client_key uuid,p_company_id text,p_category_id text,p_benefit_text text,
  p_eligibility_text text default null,p_condition_text text default null,p_source_url text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_company text:=pg_catalog.btrim(p_company_id); v_category text:=pg_catalog.lower(pg_catalog.btrim(p_category_id));
  v_benefit text; v_eligibility text; v_condition text; v_url text; v_fingerprint text; v_submission public.benefit_submissions%rowtype;
begin
  perform private.require_read_committed(); v_actor:=private.require_user();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or pg_catalog.octet_length(p_company_id)>256 or not private.is_benefit_company_id(v_company) then raise exception 'invalid company id' using errcode='22023'; end if;
  if not exists(select 1 from public.benefit_companies where company_id=v_company) then raise exception 'benefit company not found' using errcode='22023'; end if;
  if p_category_id is null or pg_catalog.char_length(p_category_id)>20 or v_category not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion') then raise exception 'invalid category id' using errcode='22023'; end if;
  v_benefit:=private.benefit_submission_text(p_benefit_text,'benefit text',5000,false);
  v_eligibility:=private.benefit_submission_text(p_eligibility_text,'eligibility text',2000,true);
  v_condition:=private.benefit_submission_text(p_condition_text,'condition text',2000,true);
  v_url:=private.benefit_submission_source_url(p_source_url);
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('company_id',v_company,'category_id',v_category,'benefit_text',v_benefit,'eligibility_text',v_eligibility,'condition_text',v_condition,'source_url',v_url)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-submission:create:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_submission from public.benefit_submissions where submitter_id=v_actor and client_key=p_client_key;
  if found then
    if v_submission.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_submission_owner_item(v_submission.id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_submission.create',p_client_key::text);
  insert into public.benefit_submissions(submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text,eligibility_text,condition_text,source_url)
  values(v_actor,p_client_key,v_fingerprint,v_company,v_category,v_benefit,v_eligibility,v_condition,v_url) returning * into v_submission;
  insert into public.benefit_submission_events(submission_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status)
  values(v_submission.id,v_actor,'create',p_client_key,v_fingerprint,'submitted',null,'submitted');
  return private.benefit_submission_owner_item(v_submission.id);
end $$;

create or replace function public.create_benefit_correction_request_v1(
  p_client_key uuid,p_company_id text,p_category_id text,p_current_text text,
  p_proposed_text text,p_scope_text text,p_source_url text,p_observed_data_version text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_company text:=pg_catalog.btrim(p_company_id); v_category text:=pg_catalog.lower(pg_catalog.btrim(p_category_id));
  v_current text; v_proposed text; v_scope text; v_url text; v_version text; v_fingerprint text;
  v_request public.benefit_correction_requests%rowtype;
begin
  perform private.require_read_committed(); v_actor:=private.require_user();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or not (private.is_benefit_company_id(v_company) or v_company ~ '^US-CIK[0-9]{10}$') then raise exception 'invalid company id' using errcode='22023'; end if;
  if p_category_id is null or pg_catalog.char_length(p_category_id)>20 or v_category not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion') then raise exception 'invalid category id' using errcode='22023'; end if;
  v_current:=private.benefit_correction_text(p_current_text,'current text',5000);
  v_proposed:=private.benefit_correction_text(p_proposed_text,'proposed text',5000);
  v_scope:=private.benefit_correction_text(p_scope_text,'scope text',2000);
  v_url:=private.benefit_correction_source_url(p_source_url);
  v_version:=private.benefit_correction_data_version(p_observed_data_version);
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('company_id',v_company,'category_id',v_category,'current_text',v_current,'proposed_text',v_proposed,'scope_text',v_scope,'source_url',v_url,'observed_data_version',v_version)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-correction:create:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_request from public.benefit_correction_requests where submitter_id=v_actor and client_key=p_client_key;
  if found then
    if v_request.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_correction_owner_item(v_request.id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_correction.create',p_client_key::text);
  insert into public.benefit_correction_requests(submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version)
  values(v_actor,p_client_key,v_fingerprint,v_company,v_category,v_current,v_proposed,v_scope,v_url,v_version) returning * into v_request;
  insert into public.benefit_correction_events(request_id,actor_kind,actor_id,actor_snapshot,operation,client_key,payload_fingerprint,action,from_status,to_status)
  values(v_request.id,'user',v_actor,v_actor::text,'create',p_client_key,v_fingerprint,'submitted',null,'submitted');
  return private.benefit_correction_owner_item(v_request.id);
end $$;

alter function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) owner to postgres;
revoke all on function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text) to anon,authenticated;
alter function public.get_benefit_company_v1(text) owner to postgres;
revoke all on function public.get_benefit_company_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_benefit_company_v1(text) to anon,authenticated;
alter function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) owner to postgres;
revoke all on function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) to authenticated;
alter function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) owner to postgres;
revoke all on function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) to authenticated;

commit;
