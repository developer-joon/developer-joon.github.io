-- Authenticated actor projection for the claim reaction page.
begin;

create function public.get_benefit_claim_reaction_v1(p_claim_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_claim public.benefit_claims%rowtype;
  v_reaction text;
begin
  v_actor:=private.require_google_user();
  if p_claim_id is null then
    raise exception 'claim is required' using errcode='22023';
  end if;

  select * into v_claim
  from public.benefit_claims
  where claim_id=p_claim_id
    and status in ('submitted','community_confirmed','disputed');
  if not found then
    raise exception 'benefit claim is not visible' using errcode='22023';
  end if;

  select reaction into v_reaction
  from public.benefit_claim_reactions
  where claim_id=p_claim_id and user_id=v_actor;

  return pg_catalog.jsonb_build_object(
    'claim_id',v_claim.claim_id,
    'reaction',v_reaction,
    'is_submitter',v_claim.submitter_id is not distinct from v_actor
  );
end $$;

alter function public.get_benefit_claim_reaction_v1(uuid) owner to postgres;
revoke all on function public.get_benefit_claim_reaction_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_benefit_claim_reaction_v1(uuid) to authenticated;

commit;
