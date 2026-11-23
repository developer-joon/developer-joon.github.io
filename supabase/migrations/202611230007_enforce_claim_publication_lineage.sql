-- Enforce claim-owned publication lineage from both sides of the pointer.
begin;

create or replace function private.assert_benefit_claim_publication(p_claim_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_claim public.benefit_claims%rowtype;
  v_publication public.benefit_publications%rowtype;
begin
  select * into v_claim from public.benefit_claims where claim_id=p_claim_id;
  if not found then return; end if;

  if v_claim.active_publication_id is null then
    if v_claim.status is not distinct from 'community_confirmed' then
      raise exception 'community confirmed claim requires active community publication' using errcode='23514';
    end if;
    return;
  end if;

  select * into v_publication from public.benefit_publications
  where publication_id=v_claim.active_publication_id;
  if not found
     or v_claim.status is distinct from 'community_confirmed'
     or v_publication.status is distinct from 'active'
     or v_publication.trust_tier is distinct from 'community_reviewed'
     or v_publication.source_type is distinct from 'claim_reaction'
     or v_publication.provenance is distinct from pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id)
     or v_publication.company_id is distinct from v_claim.company_id
     or v_publication.category_id is distinct from v_claim.category_id
     or v_publication.dedupe_key is distinct from 'claim-'||v_claim.claim_id::text then
    raise exception 'claim active publication must be its active community reaction publication' using errcode='23514';
  end if;
end $$;

create or replace function private.require_active_benefit_claim_publication(p_claim_id uuid,p_publication_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_claim public.benefit_claims%rowtype;
begin
  select * into v_claim from public.benefit_claims where claim_id=p_claim_id;
  if not found or v_claim.active_publication_id is distinct from p_publication_id then
    raise exception 'claim publication lineage is invalid' using errcode='23514';
  end if;
  perform private.assert_benefit_claim_publication(p_claim_id);
end $$;

create or replace function private.enforce_benefit_claim_publication()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_benefit_claim_publication(new.claim_id);
  return null;
end $$;

create or replace function private.enforce_benefit_publication_claim_lineage()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_claim public.benefit_claims%rowtype;
  v_publication public.benefit_publications%rowtype;
  v_claim_id uuid;
  v_pointer_count integer;
begin
  if tg_op='UPDATE' and old.source_type is not distinct from 'claim_reaction' and (
       new.source_type is distinct from old.source_type
       or new.provenance is distinct from old.provenance
       or new.company_id is distinct from old.company_id
       or new.category_id is distinct from old.category_id
       or new.dedupe_key is distinct from old.dedupe_key
     ) then
    raise exception 'claim publication must preserve its immutable claim binding' using errcode='23514';
  end if;

  for v_claim_id in
    select claim_id from public.benefit_claims
    where active_publication_id=new.publication_id
       or (tg_op='UPDATE' and active_publication_id=old.publication_id)
  loop
    perform private.assert_benefit_claim_publication(v_claim_id);
  end loop;

  select * into v_publication from public.benefit_publications
  where publication_id=new.publication_id;
  if not found or v_publication.source_type is distinct from 'claim_reaction' then return null; end if;

  select * into v_claim from public.benefit_claims
  where claim_id::text=v_publication.provenance->>'claim_id';
  if not found
     or v_publication.trust_tier is distinct from 'community_reviewed'
     or v_publication.provenance is distinct from pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id)
     or v_publication.company_id is distinct from v_claim.company_id
     or v_publication.category_id is distinct from v_claim.category_id
     or v_publication.dedupe_key is distinct from 'claim-'||v_claim.claim_id::text then
    raise exception 'claim publication must bind exactly to its immutable claim' using errcode='23514';
  end if;

  select pg_catalog.count(*)::integer into v_pointer_count
  from public.benefit_claims where active_publication_id=v_publication.publication_id;
  if v_publication.status is not distinct from 'active' then
    if v_pointer_count is distinct from 1
       or v_claim.status is distinct from 'community_confirmed'
       or v_claim.active_publication_id is distinct from v_publication.publication_id then
      raise exception 'active claim publication must be selected by its confirmed claim' using errcode='23514';
    end if;
  elsif v_pointer_count is distinct from 0 then
    raise exception 'claim active publication must be its active community reaction publication' using errcode='23514';
  end if;
  return null;
end $$;

create or replace function public.set_benefit_claim_reaction_v1(p_claim_id uuid,p_reaction text,p_client_key uuid)
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
    if not found then
      raise exception 'claim publication lineage is invalid' using errcode='23514';
    end if;
    perform private.require_active_benefit_claim_publication(p_claim_id,v_claim.active_publication_id);
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
   if not found then raise exception 'claim publication lineage is invalid' using errcode='23514'; end if;
   perform private.require_active_benefit_claim_publication(p_claim_id,v_claim.active_publication_id);
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

alter function private.assert_benefit_claim_publication(uuid) owner to postgres;
alter function private.require_active_benefit_claim_publication(uuid,uuid) owner to postgres;
alter function private.enforce_benefit_claim_publication() owner to postgres;
alter function private.enforce_benefit_publication_claim_lineage() owner to postgres;
alter function public.set_benefit_claim_reaction_v1(uuid,text,uuid) owner to postgres;
alter function public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint) owner to postgres;
revoke all on function private.assert_benefit_claim_publication(uuid),private.require_active_benefit_claim_publication(uuid,uuid),private.enforce_benefit_claim_publication(),private.enforce_benefit_publication_claim_lineage() from public,anon,authenticated,service_role;

commit;
