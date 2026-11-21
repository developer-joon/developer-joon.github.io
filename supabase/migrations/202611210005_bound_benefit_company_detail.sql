begin;

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
  if p_company_id !~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$' then
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

alter function public.get_benefit_company_v1(text) owner to postgres;
revoke all on function public.get_benefit_company_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.get_benefit_company_v1(text) to anon,authenticated;

commit;
