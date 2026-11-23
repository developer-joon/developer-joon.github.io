begin;
select no_plan();
create extension if not exists dblink with schema extensions;

-- Structural concurrency contract: all four public writers are READ COMMITTED
-- only, serialize on the claim row, and preserve a single active authority.
select ok(pg_get_functiondef('public.set_benefit_claim_reaction_v1(uuid,text,uuid)'::regprocedure) like '%require_read_committed%','reaction writer keeps the shared isolation gate');
select ok(pg_get_functiondef('public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text)'::regprocedure) like '%for update%','moderation locks claims');
select ok(pg_get_functiondef('public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid)'::regprocedure) like '%for update%','verification locks claims');
select ok(pg_get_functiondef('public.set_benefit_claim_reaction_v1(uuid,text,uuid)'::regprocedure) like '%official_publication_id%','reaction path distinguishes official authority');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='benefit_publications_one_active_claim_authority_idx'),'one active claim authority index exists');

select * from finish();
rollback;
