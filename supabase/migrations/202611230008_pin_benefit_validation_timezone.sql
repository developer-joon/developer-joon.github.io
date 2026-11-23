-- Pin calendar-date validators to the public UTC contract.
begin;

alter function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) set timezone to 'UTC';
alter function private.validate_benefit_claim_official_review() set timezone to 'UTC';
alter function public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid) set timezone to 'UTC';
alter function public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text) set timezone to 'UTC';

commit;
