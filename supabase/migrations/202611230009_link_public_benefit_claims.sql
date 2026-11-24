begin;

create or replace function public.get_benefit_company_v2(p_company_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_count integer; v_claims jsonb; v_publications jsonb;
begin
 v_base:=public.get_benefit_company_v1(p_company_id);
 if v_base='null'::jsonb then return v_base; end if;

 select coalesce(pg_catalog.jsonb_agg(
   publication.item||pg_catalog.jsonb_build_object('origin_claim_id',binding.claim_id)
   order by publication.ordinality
 ),'[]'::jsonb)
 into v_publications
 from pg_catalog.jsonb_array_elements(v_base->'publications') with ordinality publication(item,ordinality)
 left join lateral (
   select c.claim_id
   from public.benefit_publications bp
   join public.benefit_claims c on
     (bp.source_type='claim_reaction' and c.active_publication_id=bp.publication_id)
     or (bp.source_type='claim_official' and c.official_publication_id=bp.publication_id)
   where bp.publication_id=(publication.item->>'publication_id')::uuid
     and bp.status='active'
     and bp.source_type in ('claim_reaction','claim_official')
     and c.status in ('submitted','community_confirmed','disputed')
     and bp.provenance=pg_catalog.jsonb_build_object('claim_id',c.claim_id)
     and bp.company_id=c.company_id
     and bp.category_id=c.category_id
     and bp.dedupe_key='claim-'||c.claim_id::text
 ) binding on true;

 select pg_catalog.count(*)::integer into v_count from (select 1 from public.benefit_claims c where c.company_id=p_company_id and c.status in ('submitted','community_confirmed','disputed') limit 201) bounded;
 if v_count>200 then raise exception 'benefit claim limit exceeded' using errcode='P0001'; end if;
 with bounded as materialized (
   select c.claim_id,c.submitter_id,c.category_id,c.title,c.description,c.eligibility_text,c.condition_text,c.status,c.created_at,c.observed_on
   from public.benefit_claims c where c.company_id=p_company_id and c.status in ('submitted','community_confirmed','disputed')
   order by c.category_id,c.title,c.claim_id limit 200
 ), hydrated as (
   select b.*,p.display_name,
     pg_catalog.count(r.*) filter(where r.reaction='confirm')::integer confirm_count,
     pg_catalog.count(r.*) filter(where r.reaction='dispute')::integer dispute_count,
     pg_catalog.max(r.updated_at) filter(where r.reaction='confirm') last_confirmation_at
   from bounded b left join public.profiles p on p.id=b.submitter_id
   left join public.benefit_claim_reactions r on r.claim_id=b.claim_id
   group by b.claim_id,b.submitter_id,b.category_id,b.title,b.description,b.eligibility_text,b.condition_text,b.status,b.created_at,b.observed_on,p.display_name
 )
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('claim_id',h.claim_id,'category_id',h.category_id,'category_name',case h.category_id when 'leave' then '휴가' when 'family' then '가족' when 'health' then '건강' when 'growth' then '성장' when 'housing' then '주거' when 'commute' then '통근' when 'remote' then '유연근무' when 'retirement' then '퇴직' when 'meals' then '식사' when 'inclusion' then '포용' end,'title',h.title,'description',h.description,'eligibility_text',h.eligibility_text,'condition_text',h.condition_text,'status_code',h.status,'status_label',case h.status when 'submitted' then '제보됨' when 'community_confirmed' then '커뮤니티 확인' when 'disputed' then '재확인 필요' end,'nickname',coalesce(nullif(pg_catalog.btrim(h.display_name),''),'탈퇴한 사용자'),'submitted_at',h.created_at,'observed_on',h.observed_on,'confirm_count',h.confirm_count,'dispute_count',h.dispute_count,'last_confirmation_at',h.last_confirmation_at) order by h.category_id,h.title,h.claim_id),'[]') into v_claims from hydrated h;
 return pg_catalog.jsonb_build_object('company',v_base->'company','publications',v_publications,'claims',v_claims);
end $$;

alter function public.get_benefit_company_v2(text) owner to postgres;
revoke all on function public.get_benefit_company_v2(text) from public,anon,authenticated,service_role;
grant execute on function public.get_benefit_company_v2(text) to anon,authenticated;

commit;
