-- Atomic claim reactions, community publication lineage, and durable replay.
begin;

insert into public.rate_limit_rules(id,action,window_seconds,max_requests,is_enabled)
values ('b6000000-0000-4000-8000-000000000001','benefit_claim.react',3600,60,true)
on conflict(action,window_seconds) do update set max_requests=excluded.max_requests,is_enabled=excluded.is_enabled,updated_at=pg_catalog.clock_timestamp();

alter table public.benefit_claims drop constraint benefit_claims_task5_no_active_publication_check;

create table public.benefit_claim_reactions (
  claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
  user_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(claim_id,user_id),
  constraint benefit_claim_reactions_reaction_check check (reaction in ('confirm','dispute')),
  constraint benefit_claim_reactions_timestamps_check check (pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at)
);
comment on column public.benefit_claim_reactions.user_id is
  'Immutable authenticated actor UUID snapshot; intentionally no profile FK so profile deletion cannot silently change reaction counts.';

create table public.benefit_claim_reaction_requests (
  actor_snapshot uuid not null,
  client_key uuid not null,
  claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
  payload_fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(actor_snapshot,client_key),
  constraint benefit_claim_reaction_requests_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_claim_reaction_requests_response_check check (pg_catalog.jsonb_typeof(response)='object' and pg_catalog.octet_length(response::text)<=2000),
  constraint benefit_claim_reaction_requests_created_check check (pg_catalog.isfinite(created_at))
);

create index benefit_claim_reactions_claim_reaction_idx on public.benefit_claim_reactions(claim_id,reaction,updated_at desc);
create index benefit_claim_reaction_requests_claim_idx on public.benefit_claim_reaction_requests(claim_id,created_at);
create unique index benefit_publications_one_active_claim_community_idx
  on public.benefit_publications((provenance->>'claim_id'))
  where status='active' and trust_tier='community_reviewed' and source_type='claim_reaction';

alter table public.benefit_publications add constraint benefit_publications_claim_reaction_shape_check check (
  source_type<>'claim_reaction' or (
    trust_tier='community_reviewed'
    and provenance ? 'claim_id'
    and pg_catalog.jsonb_typeof(provenance->'claim_id')='string'
    and (provenance->>'claim_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and source_url is null
    and reviewer_id is null
  )
);

alter table public.benefit_claim_reactions owner to postgres;
alter table public.benefit_claim_reaction_requests owner to postgres;
alter table public.benefit_claim_reactions enable row level security;
alter table public.benefit_claim_reaction_requests enable row level security;
revoke all on table public.benefit_claim_reactions,public.benefit_claim_reaction_requests from public,anon,authenticated,service_role;

create function private.reject_benefit_claim_reaction_request_change()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'benefit claim reaction requests are append-only' using errcode='23514'; end $$;
create trigger benefit_claim_reaction_requests_append_only_row before update or delete on public.benefit_claim_reaction_requests for each row execute function private.reject_benefit_claim_reaction_request_change();
create trigger benefit_claim_reaction_requests_append_only_truncate before truncate on public.benefit_claim_reaction_requests for each statement execute function private.reject_benefit_claim_reaction_request_change();

-- Deferred cross-table checks make claim.status, its community-only pointer, and
-- the active claim publication one transaction-bound invariant.
create function private.enforce_benefit_claim_publication()
returns trigger language plpgsql set search_path='' as $$
declare v_claim public.benefit_claims%rowtype; v_publication public.benefit_publications%rowtype;
begin
  select * into v_claim from public.benefit_claims where claim_id=new.claim_id;
  if not found then return null; end if;
  if v_claim.active_publication_id is not null then
    select * into v_publication from public.benefit_publications where publication_id=v_claim.active_publication_id;
    if not found or v_claim.status<>'community_confirmed'
       or v_publication.status<>'active' or v_publication.trust_tier<>'community_reviewed'
       or v_publication.source_type<>'claim_reaction'
       or v_publication.provenance->>'claim_id'<>v_claim.claim_id::text
       or v_publication.company_id<>v_claim.company_id or v_publication.category_id<>v_claim.category_id then
      raise exception 'claim active publication must be its active community reaction publication' using errcode='23514';
    end if;
  elsif v_claim.status='community_confirmed' then
    raise exception 'community confirmed claim requires active community publication' using errcode='23514';
  end if;
  return null;
end $$;

create function private.enforce_benefit_publication_claim_lineage()
returns trigger language plpgsql set search_path='' as $$
declare v_claim public.benefit_claims%rowtype;
begin
  if new.source_type<>'claim_reaction' then return null; end if;
  select * into v_claim from public.benefit_claims where claim_id=(new.provenance->>'claim_id')::uuid;
  if not found or v_claim.company_id<>new.company_id or v_claim.category_id<>new.category_id then
    raise exception 'claim publication must bind to its immutable claim' using errcode='23514';
  end if;
  if new.status='active' and (v_claim.status<>'community_confirmed' or v_claim.active_publication_id<>new.publication_id) then
    raise exception 'active claim publication must be selected by its confirmed claim' using errcode='23514';
  end if;
  return null;
end $$;

create constraint trigger benefit_claims_publication_lineage after insert or update on public.benefit_claims deferrable initially deferred for each row execute function private.enforce_benefit_claim_publication();
create constraint trigger benefit_publications_claim_lineage after insert or update on public.benefit_publications deferrable initially deferred for each row execute function private.enforce_benefit_publication_claim_lineage();

create function public.set_benefit_claim_reaction_v1(p_claim_id uuid,p_reaction text,p_client_key uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_reaction text; v_fingerprint text; v_request public.benefit_claim_reaction_requests%rowtype;
  v_claim public.benefit_claims%rowtype; v_old_status text; v_old_reaction text; v_confirm_count integer; v_dispute_count integer;
  v_new_status text; v_outcome text; v_now timestamptz; v_response jsonb; v_active public.benefit_publications%rowtype;
  v_previous public.benefit_publications%rowtype; v_publication_id uuid; v_publication_revision integer; v_event_type text;
begin
  perform private.require_read_committed();
  v_actor:=private.require_google_user();
  if p_claim_id is null or p_client_key is null then raise exception 'claim and client key are required' using errcode='22023'; end if;
  if p_reaction is not null then
    v_reaction:=pg_catalog.lower(pg_catalog.btrim(p_reaction));
    if pg_catalog.char_length(p_reaction)>20 or v_reaction not in ('confirm','dispute') then raise exception 'invalid claim reaction' using errcode='22023'; end if;
  end if;
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('claim_id',p_claim_id,'reaction',v_reaction)::text,'UTF8'),'sha256'),'hex');

  -- Global order: actor profile -> intent -> feature setting -> claim -> actor
  -- reaction -> claim reaction recount -> community lineage -> event/request.
  perform 1 from public.profiles where id=v_actor for key share;
  if not found then raise exception 'profile required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-claim-reaction:intent:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_request from public.benefit_claim_reaction_requests where actor_snapshot=v_actor and client_key=p_client_key;
  if found then
    if v_request.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return v_request.response;
  end if;

  perform private.require_benefit_features(array['claim_reactions_write_enabled']);
  select * into v_claim from public.benefit_claims where claim_id=p_claim_id for update;
  if not found or v_claim.status not in ('submitted','community_confirmed','disputed') then raise exception 'benefit claim is not visible' using errcode='22023'; end if;
  v_old_status:=v_claim.status;
  if v_reaction='confirm' and v_claim.submitter_id=v_actor then raise exception 'claim submitter cannot confirm own claim' using errcode='42501'; end if;

  select reaction into v_old_reaction from public.benefit_claim_reactions where claim_id=p_claim_id and user_id=v_actor for update;
  perform private.consume_rate_limit(v_actor,'benefit_claim.react',p_client_key::text);
  v_now:=pg_catalog.clock_timestamp();
  if v_reaction is null then
    if v_old_reaction is null then v_outcome:='unchanged';
    else delete from public.benefit_claim_reactions where claim_id=p_claim_id and user_id=v_actor; v_outcome:='cleared'; end if;
  elsif v_old_reaction is null then
    insert into public.benefit_claim_reactions(claim_id,user_id,reaction,created_at,updated_at) values(p_claim_id,v_actor,v_reaction,v_now,v_now);
    v_outcome:='set';
  elsif v_old_reaction=v_reaction then
    v_outcome:='unchanged';
  else
    update public.benefit_claim_reactions set reaction=v_reaction,updated_at=v_now where claim_id=p_claim_id and user_id=v_actor;
    v_outcome:='changed';
  end if;

  select pg_catalog.count(*) filter(where reaction='confirm')::integer,
         pg_catalog.count(*) filter(where reaction='dispute')::integer
    into v_confirm_count,v_dispute_count
  from public.benefit_claim_reactions where claim_id=p_claim_id;
  v_new_status:=case when v_dispute_count>=1 then 'disputed' when v_confirm_count>=3 then 'community_confirmed' else 'submitted' end;

  if v_claim.active_publication_id is not null then
    select * into v_active from public.benefit_publications where publication_id=v_claim.active_publication_id for update;
    if not found or v_active.source_type<>'claim_reaction' or v_active.trust_tier<>'community_reviewed' or v_active.provenance->>'claim_id'<>p_claim_id::text then
      raise exception 'claim publication lineage is invalid' using errcode='23514';
    end if;
  end if;

  if v_new_status='community_confirmed' and v_claim.active_publication_id is null then
    select * into v_previous from public.benefit_publications
      where source_type='claim_reaction' and trust_tier='community_reviewed' and provenance->>'claim_id'=p_claim_id::text
      order by revision desc,publication_id desc limit 1 for update;
    v_publication_revision:=coalesce(v_previous.revision,0)+1;
    insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,observed_at,verified_at,provenance,reviewer_id,created_at,updated_at)
    values(v_claim.company_id,v_claim.category_id,v_claim.title,v_claim.description,v_claim.eligibility_text,v_claim.condition_text,'community_reviewed','active','claim-'||p_claim_id::text,v_publication_revision,v_previous.publication_id,null,'claim_reaction',v_claim.observed_on::timestamptz,v_now,pg_catalog.jsonb_build_object('claim_id',p_claim_id),null,v_now,v_now)
    returning publication_id into v_publication_id;
  elsif v_new_status<>'community_confirmed' and v_claim.active_publication_id is not null then
    update public.benefit_publications set status='withdrawn',updated_at=v_now where publication_id=v_claim.active_publication_id;
    v_publication_id:=null;
  else
    v_publication_id:=v_claim.active_publication_id;
  end if;

  if v_new_status<>v_claim.status then
    v_event_type:=case when v_new_status='community_confirmed' then case when v_previous.publication_id is null then 'promoted' else 'repromoted' end else 'demoted' end;
    update public.benefit_claims set status=v_new_status,active_publication_id=v_publication_id,revision=revision+1,updated_at=v_now where claim_id=p_claim_id returning * into v_claim;
    insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata)
    values(p_claim_id,v_actor,'promote',p_client_key,v_fingerprint,v_event_type,v_old_status,v_new_status,pg_catalog.jsonb_build_object('confirm_count',v_confirm_count,'dispute_count',v_dispute_count));
  else
    v_claim.active_publication_id:=v_publication_id;
  end if;

  set constraints public.benefit_publications_lineage_check,public.benefit_publications_unique_active_lineage_check,public.benefit_claims_publication_lineage,public.benefit_publications_claim_lineage immediate;
  set constraints public.benefit_publications_lineage_check,public.benefit_publications_unique_active_lineage_check,public.benefit_claims_publication_lineage,public.benefit_publications_claim_lineage deferred;

  v_response:=pg_catalog.jsonb_build_object('claim_id',p_claim_id,'reaction',v_reaction,'status',v_new_status,'revision',v_claim.revision,'confirm_count',v_confirm_count,'dispute_count',v_dispute_count,'active_publication_id',v_publication_id,'outcome',v_outcome);
  insert into public.benefit_claim_reaction_requests(actor_snapshot,client_key,claim_id,payload_fingerprint,response) values(v_actor,p_client_key,p_claim_id,v_fingerprint,v_response);
  return v_response;
end $$;

-- Withdrawal follows the same actor -> setting -> claim -> publication -> event order
-- and retires only the claim-bound community publication.
create or replace function public.withdraw_benefit_claim_v1(p_client_key uuid,p_claim_id uuid,p_expected_status text,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_fingerprint text; v_event public.benefit_claim_events%rowtype; v_claim public.benefit_claims%rowtype; v_publication public.benefit_publications%rowtype; v_now timestamptz;
begin
 perform private.require_read_committed(); v_actor:=private.require_google_user();
 if p_client_key is null or p_claim_id is null or p_expected_status is null or p_expected_status not in ('submitted','community_confirmed','disputed') or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid claim withdrawal request' using errcode='22023'; end if;
 v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision)::text,'UTF8'),'sha256'),'hex');
 perform 1 from public.profiles where id=v_actor for key share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-claim:intent:'||v_actor::text||':'||p_client_key::text,0));
 select * into v_event from public.benefit_claim_events where actor_snapshot=v_actor and operation='withdraw' and client_key=p_client_key;
 if found then
   if v_event.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
   return pg_catalog.jsonb_build_object('claim_id',v_event.claim_id,'status','withdrawn','revision',(select c.revision from public.benefit_claims c where c.claim_id=v_event.claim_id),'outcome','withdrawn');
 end if;
 perform private.require_benefit_features(array['claims_write_enabled']);
 select * into v_claim from public.benefit_claims c where c.claim_id=p_claim_id for update;
 if not found then raise exception 'benefit claim not found' using errcode='22023'; end if;
 if v_claim.submitter_id is distinct from v_actor then raise exception 'claim submitter required' using errcode='42501'; end if;
 if v_claim.status is distinct from p_expected_status or v_claim.revision is distinct from p_expected_revision then raise exception 'benefit claim state changed' using errcode='40001'; end if;
 if v_claim.active_publication_id is not null then
   select * into v_publication from public.benefit_publications where publication_id=v_claim.active_publication_id for update;
   if not found or v_publication.source_type<>'claim_reaction' or v_publication.trust_tier<>'community_reviewed' or v_publication.provenance->>'claim_id'<>p_claim_id::text then raise exception 'claim publication lineage is invalid' using errcode='23514'; end if;
 end if;
 perform private.consume_rate_limit(v_actor,'benefit_claim.withdraw',p_client_key::text);
 v_now:=pg_catalog.clock_timestamp();
 if v_claim.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=v_now where publication_id=v_claim.active_publication_id; end if;
 update public.benefit_claims set status='withdrawn',active_publication_id=null,revision=revision+1,updated_at=v_now,withdrawn_at=v_now where claim_id=p_claim_id returning * into v_claim;
 insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(v_claim.claim_id,v_actor,'withdraw',p_client_key,v_fingerprint,'withdrawn',p_expected_status,'withdrawn','{}');
 set constraints public.benefit_publications_lineage_check,public.benefit_publications_unique_active_lineage_check,public.benefit_claims_publication_lineage,public.benefit_publications_claim_lineage immediate;
 set constraints public.benefit_publications_lineage_check,public.benefit_publications_unique_active_lineage_check,public.benefit_claims_publication_lineage,public.benefit_publications_claim_lineage deferred;
 return pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id,'status',v_claim.status,'revision',v_claim.revision,'outcome','withdrawn');
end $$;

create or replace function public.get_benefit_company_v2(p_company_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_count integer; v_claims jsonb;
begin
 v_base:=public.get_benefit_company_v1(p_company_id);
 if v_base='null'::jsonb then return v_base; end if;
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
 return v_base||pg_catalog.jsonb_build_object('claims',v_claims);
end $$;

alter function private.reject_benefit_claim_reaction_request_change() owner to postgres;
alter function private.enforce_benefit_claim_publication() owner to postgres;
alter function private.enforce_benefit_publication_claim_lineage() owner to postgres;
alter function public.set_benefit_claim_reaction_v1(uuid,text,uuid) owner to postgres;
alter function public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint) owner to postgres;
alter function public.get_benefit_company_v2(text) owner to postgres;
revoke all on function private.reject_benefit_claim_reaction_request_change(),private.enforce_benefit_claim_publication(),private.enforce_benefit_publication_claim_lineage() from public,anon,authenticated,service_role;
revoke all on function public.set_benefit_claim_reaction_v1(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_benefit_claim_reaction_v1(uuid,text,uuid) to authenticated;

commit;
