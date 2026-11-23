-- Pin calendar-date validators to UTC and remove the caller-evaluated date default.
begin;

alter function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) set schema private;
alter function private.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) rename to create_benefit_claim_impl_v1;
alter function private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text) set timezone to 'UTC';
alter function private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text) owner to postgres;
revoke all on function private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text) from public,anon,authenticated,service_role;

create function public.create_benefit_claim_v1(
  p_client_key uuid,
  p_company_id text,
  p_category_id text,
  p_title text,
  p_description text,
  p_eligibility_text text,
  p_condition_text text,
  p_observed_on date,
  p_source_url text
) returns jsonb
language sql volatile security definer
set search_path=''
set timezone='UTC'
as $wrapper$
  select private.create_benefit_claim_impl_v1(
    p_client_key,p_company_id,p_category_id,p_title,p_description,
    p_eligibility_text,p_condition_text,p_observed_on,p_source_url
  )
$wrapper$;

alter function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) owner to postgres;
revoke all on function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) to authenticated;

alter function private.validate_benefit_claim_official_review() set timezone to 'UTC';
alter function public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid) set timezone to 'UTC';
alter function public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text) set timezone to 'UTC';

commit;
