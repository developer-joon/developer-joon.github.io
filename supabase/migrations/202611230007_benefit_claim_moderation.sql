-- Evidence-gated claim moderation and separate official authority.
begin;

lock table public.benefit_claims in share row exclusive mode;
lock table public.benefit_publications in share row exclusive mode;
lock table public.benefit_claim_reactions in share row exclusive mode;
lock table public.benefit_claim_events in share row exclusive mode;
lock table public.benefit_claim_reaction_requests in share row exclusive mode;

do $$
declare v_claim uuid;
begin
  -- Task 7 starts from the complete Task 6 two-sided invariant.  Reject every
  -- spoofed claim-bound publication, dangling/reversed pointer and reaction on
  -- a terminal claim before changing any constraint.
  for v_claim in select claim_id from public.benefit_claims loop
    perform private.assert_benefit_claim_publication(v_claim);
  end loop;
  if exists(
    select 1
    from public.benefit_publications p
    left join public.benefit_claims c on c.claim_id=case
      when jsonb_typeof(p.provenance->'claim_id')='string'
       and (p.provenance->>'claim_id')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p.provenance->>'claim_id')::uuid end
    where (p.source_type='claim_reaction' or p.source_type='claim_official' or p.provenance ? 'claim_id')
      and (
        p.source_type<>'claim_reaction'
        or p.provenance is distinct from jsonb_build_object('claim_id',c.claim_id)
        or c.claim_id is null
        or p.trust_tier is distinct from 'community_reviewed'
        or p.source_url is not null
        or p.reviewer_id is not null
        or p.company_id is distinct from c.company_id
        or p.category_id is distinct from c.category_id
        or p.dedupe_key is distinct from 'claim-'||c.claim_id::text
        or (p.status='active') is distinct from coalesce(c.active_publication_id=p.publication_id,false)
      )
  ) or exists(
    select 1 from public.benefit_claims c
    where (c.status='community_confirmed') is distinct from (c.active_publication_id is not null)
  ) or exists(
    select 1 from public.benefit_claim_reactions r join public.benefit_claims c using(claim_id)
    where c.status not in ('submitted','community_confirmed','disputed')
  ) or exists(
    select 1 from public.benefit_publications
    where source_type='claim_official' or trust_tier='official_verified' and provenance ? 'claim_id'
  ) then
    raise exception 'benefit claim moderation upgrade blocked: incomplete or spoofed Task 6 claim invariant' using errcode='55000';
  end if;
end $$;

alter table public.benefit_claims add column official_publication_id uuid references public.benefit_publications(publication_id) on delete restrict;
alter table public.benefit_claims add column merged_into_claim_id uuid references public.benefit_claims(claim_id) on delete restrict;
alter table public.benefit_claims add constraint benefit_claims_merged_target_check check ((status='merged')=(merged_into_claim_id is not null) and merged_into_claim_id is distinct from claim_id) not valid;
alter table public.benefit_claims drop constraint benefit_claims_status_check;
alter table public.benefit_claims add constraint benefit_claims_status_check check(status in ('submitted','community_confirmed','disputed','hidden','withdrawn','merged'));
alter table public.benefit_claims drop constraint benefit_claims_withdrawn_check;
alter table public.benefit_claims add constraint benefit_claims_withdrawn_check check ((status='withdrawn')=(withdrawn_at is not null));

alter table public.benefit_claim_events drop constraint benefit_claim_events_from_check;
alter table public.benefit_claim_events drop constraint benefit_claim_events_to_check;
alter table public.benefit_claim_events drop constraint benefit_claim_events_type_check;
alter table public.benefit_claim_events drop constraint benefit_claim_events_shape_check;
alter table public.benefit_claim_events drop constraint benefit_claim_events_operation_check;
alter table public.benefit_claim_events add constraint benefit_claim_events_operation_check check(operation in ('create','withdraw','moderate','promote','review','merge_target'));
alter table public.benefit_claim_events add constraint benefit_claim_events_from_check check(from_status is null or from_status in ('submitted','community_confirmed','disputed','hidden','withdrawn','merged'));
alter table public.benefit_claim_events add constraint benefit_claim_events_to_check check(to_status in ('submitted','community_confirmed','disputed','hidden','withdrawn','merged'));
alter table public.benefit_claim_events add constraint benefit_claim_events_type_check check(event_type in ('submitted','duplicate_directed','withdrawn','hidden','restored','merged','promoted','demoted','repromoted','official_reviewed','official_withdrawn','reaction_recomputed'));
alter table public.benefit_claim_events add constraint benefit_claim_events_shape_check check(
 (event_type='submitted' and operation='create' and from_status is null and to_status='submitted')
 or (event_type='duplicate_directed' and operation='create' and from_status=to_status and to_status in ('submitted','community_confirmed','disputed'))
 or (event_type='withdrawn' and operation in ('withdraw','moderate') and to_status='withdrawn')
 or (event_type='merged' and operation in ('moderate','merge_target'))
 or event_type in ('hidden','restored','promoted','demoted','repromoted','official_reviewed','official_withdrawn','reaction_recomputed')
);

create table public.benefit_claim_official_reviews(
 review_id uuid primary key default extensions.gen_random_uuid(),
 claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
 publication_id uuid not null references public.benefit_publications(publication_id) on delete restrict,
 reviewer_snapshot uuid not null,
 action text not null check(action in ('verify','reverify','withdraw_official')),
 evidence_type text not null check(evidence_type in ('official_website','company_policy','regulatory_filing','employment_document','other_official')),
 evidence_source_url text not null check(char_length(evidence_source_url) between 9 and 2048 and octet_length(evidence_source_url)<=8192 and evidence_source_url=btrim(evidence_source_url)),
 evidence_observed_on date not null check(evidence_observed_on>=date '2000-01-01'),
 verification_note text not null check(char_length(verification_note) between 1 and 1000 and octet_length(verification_note)<=4000 and verification_note=btrim(verification_note)),
 predecessor_publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
 successor_publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
 reviewed_at timestamptz not null default pg_catalog.clock_timestamp() check(pg_catalog.isfinite(reviewed_at)),
 constraint benefit_claim_official_reviews_shape_check check(
   (action in ('verify','reverify') and successor_publication_id=publication_id)
   or (action='withdraw_official' and predecessor_publication_id=publication_id)
 )
);
create unique index benefit_claim_official_reviews_one_verification_idx on public.benefit_claim_official_reviews(publication_id) where action in ('verify','reverify');
create unique index benefit_claim_official_reviews_one_withdrawal_idx on public.benefit_claim_official_reviews(publication_id) where action='withdraw_official';
create table public.benefit_claim_moderation_requests(
 actor_snapshot uuid not null,
 client_key uuid not null,
 claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
 action text not null check(action in ('hide','restore','withdraw','user_withdraw','merge','withdraw_official','verify','reverify')),
 payload_fingerprint text not null check(payload_fingerprint~'^[0-9a-f]{64}$'),
 response jsonb not null check(jsonb_typeof(response)='object' and octet_length(response::text)<=4000),
 created_at timestamptz not null default pg_catalog.clock_timestamp() check(pg_catalog.isfinite(created_at)),
 primary key(actor_snapshot,client_key)
);
create table public.benefit_claim_merges(
 merge_id uuid primary key default extensions.gen_random_uuid(),
 source_claim_id uuid not null unique references public.benefit_claims(claim_id) on delete restrict,
 target_claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
 actor_snapshot uuid not null,
 request_client_key uuid not null,
 merged_at timestamptz not null default pg_catalog.clock_timestamp() check(pg_catalog.isfinite(merged_at)),
 check(source_claim_id<>target_claim_id)
);
create table public.benefit_claim_merge_reactions(
 merge_id uuid not null references public.benefit_claim_merges(merge_id) on delete restrict,
 origin_claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
 user_id uuid not null,
 reaction text not null check(reaction in ('confirm','dispute')),
 created_at timestamptz not null,
 updated_at timestamptz not null,
 primary key(merge_id,origin_claim_id,user_id),
 check(pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at)
);
comment on column public.benefit_claim_merge_reactions.user_id is
 'Immutable authenticated actor UUID snapshot; intentionally no profile FK so profile deletion cannot alter merge lineage.';
-- Task 6 withdrawal events did not store response bytes. Under the write locks
-- above, freeze the compatible terminal response at this migration boundary.
insert into public.benefit_claim_moderation_requests(actor_snapshot,client_key,claim_id,action,payload_fingerprint,response,created_at)
select e.actor_snapshot,e.client_key,e.claim_id,'user_withdraw',e.payload_fingerprint,
       jsonb_build_object('claim_id',e.claim_id,'status','withdrawn','revision',c.revision,'outcome','withdrawn'),e.created_at
from public.benefit_claim_events e join public.benefit_claims c using(claim_id)
where e.operation='withdraw';
create index benefit_claim_moderation_queue_idx on public.benefit_claims(created_at desc,claim_id desc);
create index benefit_claim_events_claim_audit_idx on public.benefit_claim_events(claim_id,created_at desc,event_id desc);
create index benefit_claim_reviews_claim_audit_idx on public.benefit_claim_official_reviews(claim_id,reviewed_at desc,review_id desc);
create index benefit_claim_merges_target_idx on public.benefit_claim_merges(target_claim_id,merged_at desc,source_claim_id desc);
create index benefit_claim_merges_source_audit_idx on public.benefit_claim_merges(source_claim_id,merged_at desc);
create index benefit_claim_merge_reactions_origin_user_idx on public.benefit_claim_merge_reactions(origin_claim_id,user_id,merge_id);
create unique index benefit_publications_one_active_claim_authority_idx on public.benefit_publications((provenance->>'claim_id')) where status='active' and source_type in ('claim_reaction','claim_official');
alter table public.benefit_publications add constraint benefit_publications_claim_official_shape_check check(
 source_type<>'claim_official' or (
   trust_tier='official_verified'
   and provenance ? 'claim_id'
   and jsonb_typeof(provenance->'claim_id')='string'
   and (provenance->>'claim_id')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and source_url is not null and reviewer_id is null and observed_at is not null and verified_at is not null
 )
);

alter table public.benefit_claim_official_reviews owner to postgres;
alter table public.benefit_claim_moderation_requests owner to postgres;
alter table public.benefit_claim_merges owner to postgres;
alter table public.benefit_claim_merge_reactions owner to postgres;
alter table public.benefit_claim_official_reviews enable row level security;
alter table public.benefit_claim_moderation_requests enable row level security;
alter table public.benefit_claim_merges enable row level security;
alter table public.benefit_claim_merge_reactions enable row level security;
revoke all on table public.benefit_claim_official_reviews,public.benefit_claim_moderation_requests,public.benefit_claim_merges,public.benefit_claim_merge_reactions from public,anon,authenticated,service_role;

create function private.reject_benefit_claim_moderation_ledger_change() returns trigger language plpgsql set search_path='' as $$begin raise exception 'benefit claim moderation ledgers are append-only' using errcode='23514'; end$$;
create trigger benefit_claim_official_reviews_append_only before update or delete on public.benefit_claim_official_reviews for each row execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_official_reviews_no_truncate before truncate on public.benefit_claim_official_reviews for each statement execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_moderation_requests_append_only before update or delete on public.benefit_claim_moderation_requests for each row execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_moderation_requests_no_truncate before truncate on public.benefit_claim_moderation_requests for each statement execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_merges_append_only before update or delete on public.benefit_claim_merges for each row execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_merges_no_truncate before truncate on public.benefit_claim_merges for each statement execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_merge_reactions_append_only before update or delete on public.benefit_claim_merge_reactions for each row execute function private.reject_benefit_claim_moderation_ledger_change();
create trigger benefit_claim_merge_reactions_no_truncate before truncate on public.benefit_claim_merge_reactions for each statement execute function private.reject_benefit_claim_moderation_ledger_change();

create function private.validate_benefit_claim_merge_reaction_origin()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(
   select 1 from public.benefit_claim_merges m
   where m.merge_id=new.merge_id and new.origin_claim_id in(m.source_claim_id,m.target_claim_id)
 ) then raise exception 'merge reaction origin must be the merge source or target' using errcode='23514'; end if;
 return new;
end$$;
create trigger benefit_claim_merge_reactions_origin_gate before insert or update on public.benefit_claim_merge_reactions for each row execute function private.validate_benefit_claim_merge_reaction_origin();

create function private.benefit_claim_moderation_fingerprint(p_payload jsonb) returns text language sql immutable set search_path='' as $$select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_payload::text,'UTF8'),'sha256'),'hex')$$;

-- Replace Task 6's two-sided invariant with distinct community and official pointers.
create or replace function private.assert_benefit_claim_publication(p_claim_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.benefit_claims%rowtype; p public.benefit_publications%rowtype; bad_count integer;
begin
 select * into c from public.benefit_claims where claim_id=p_claim_id; if not found then return; end if;
 if c.active_publication_id is not null and c.official_publication_id is not null then raise exception 'claim cannot have community and official authority together' using errcode='23514'; end if;
 if c.status='merged' and (c.merged_into_claim_id is null or c.active_publication_id is not null or c.official_publication_id is not null) then raise exception 'merged claim must be terminal and point to its merge target' using errcode='23514'; end if;
 if c.status<>'merged' and c.merged_into_claim_id is not null then raise exception 'only a merged claim may carry a merge target' using errcode='23514'; end if;
 if c.active_publication_id is not null then
  select * into p from public.benefit_publications where publication_id=c.active_publication_id;
  if not found or c.status<>'community_confirmed' or p.status<>'active' or p.trust_tier<>'community_reviewed' or p.source_type<>'claim_reaction' or p.provenance is distinct from jsonb_build_object('claim_id',c.claim_id) or p.company_id<>c.company_id or p.category_id<>c.category_id or p.dedupe_key<>'claim-'||c.claim_id then raise exception 'claim active publication must be its active community reaction publication' using errcode='23514'; end if;
 elsif c.status='community_confirmed' and c.official_publication_id is null then raise exception 'community confirmed claim requires an authority publication' using errcode='23514'; end if;
 if c.official_publication_id is not null then
  select * into p from public.benefit_publications where publication_id=c.official_publication_id;
  if not found or p.status<>'active' or p.trust_tier<>'official_verified' or p.source_type<>'claim_official' or p.provenance is distinct from jsonb_build_object('claim_id',c.claim_id) or p.company_id<>c.company_id or p.category_id<>c.category_id or p.dedupe_key<>'claim-'||c.claim_id then raise exception 'claim official publication must be its active official authority' using errcode='23514'; end if;
 end if;
 select count(*) into bad_count
 from public.benefit_publications op
 where op.source_type='claim_official' and op.provenance->>'claim_id'=c.claim_id::text and (
   op.trust_tier is distinct from 'official_verified'
   or op.provenance is distinct from jsonb_build_object('claim_id',c.claim_id)
   or op.company_id is distinct from c.company_id or op.category_id is distinct from c.category_id
   or op.dedupe_key is distinct from 'claim-'||c.claim_id::text
   or (op.status='active') is distinct from coalesce(c.official_publication_id=op.publication_id,false)
   or (select count(*) from public.benefit_claim_official_reviews r where r.publication_id=op.publication_id and r.action in ('verify','reverify'))<>1
   or not exists(
     select 1 from public.benefit_claim_official_reviews r
     where r.publication_id=op.publication_id and r.claim_id=c.claim_id
       and r.action in ('verify','reverify') and r.successor_publication_id=op.publication_id
       and r.predecessor_publication_id is not distinct from op.supersedes_publication_id
       and r.evidence_source_url is not distinct from op.source_url
       and r.evidence_observed_on is not distinct from op.observed_at::date
       and r.reviewed_at is not distinct from op.verified_at
   )
 );
 if bad_count<>0 then raise exception 'official claim publication requires one immutable verification review' using errcode='23514'; end if;
 if exists(
   select 1 from public.benefit_publications op
   where op.source_type='claim_official' and op.provenance->>'claim_id'=c.claim_id::text
     and ((op.status='withdrawn') is distinct from ((select count(*) from public.benefit_claim_official_reviews r where r.publication_id=op.publication_id and r.action='withdraw_official')=1)
       or (op.status='withdrawn' and not exists(
         select 1
         from public.benefit_claim_official_reviews r
         join public.benefit_claim_events e on e.event_id=r.review_id
         where r.publication_id=op.publication_id and r.claim_id=c.claim_id and r.action='withdraw_official'
           and r.predecessor_publication_id=op.publication_id
           and e.claim_id=c.claim_id and e.actor_snapshot=r.reviewer_snapshot
           and e.operation='review' and e.event_type='official_withdrawn'
           and e.metadata->>'action'='withdraw_official'
           and e.metadata->>'publication_id'=op.publication_id::text
           and e.metadata->>'reason'=r.verification_note
           and e.metadata->>'evidence_type'=r.evidence_type
           and e.metadata->>'evidence_source_url'=r.evidence_source_url
           and e.metadata->>'evidence_observed_on'=r.evidence_observed_on::text
           and (e.metadata->>'successor_publication_id') is not distinct from r.successor_publication_id::text
           and e.created_at=r.reviewed_at
       )))
 ) then raise exception 'explicit official withdrawal requires one immutable withdrawal review' using errcode='23514'; end if;
 if exists(select 1 from public.benefit_claim_official_reviews r where r.claim_id=c.claim_id and not exists(select 1 from public.benefit_publications op where op.publication_id=r.publication_id and op.source_type='claim_official' and op.provenance->>'claim_id'=c.claim_id::text)) then
   raise exception 'official review must bind exactly to its claim publication' using errcode='23514';
 end if;
end$$;

create or replace function private.enforce_benefit_publication_claim_lineage() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; c public.benefit_claims%rowtype; pointers integer;
begin
 if tg_op='UPDATE' and old.source_type in ('claim_reaction','claim_official') and (new.source_type is distinct from old.source_type or new.provenance is distinct from old.provenance or new.company_id is distinct from old.company_id or new.category_id is distinct from old.category_id or new.dedupe_key is distinct from old.dedupe_key) then raise exception 'claim publication must preserve its immutable claim binding' using errcode='23514'; end if;
 for cid in select claim_id from public.benefit_claims where active_publication_id=new.publication_id or official_publication_id=new.publication_id or (tg_op='UPDATE' and (active_publication_id=old.publication_id or official_publication_id=old.publication_id)) loop perform private.assert_benefit_claim_publication(cid); end loop;
 if new.source_type not in ('claim_reaction','claim_official') then return null; end if;
 begin cid:=(new.provenance->>'claim_id')::uuid; exception when others then raise exception 'claim publication must bind exactly to its immutable claim' using errcode='23514'; end;
 select * into c from public.benefit_claims where claim_id=cid;
 if not found or new.provenance is distinct from jsonb_build_object('claim_id',cid) or new.company_id<>c.company_id or new.category_id<>c.category_id or new.dedupe_key<>'claim-'||cid then raise exception 'claim publication must bind exactly to its immutable claim' using errcode='23514'; end if;
 select count(*) into pointers from public.benefit_claims where active_publication_id=new.publication_id or official_publication_id=new.publication_id;
 if new.status='active' then
  if pointers<>1 or (new.source_type='claim_reaction' and c.active_publication_id is distinct from new.publication_id) or (new.source_type='claim_official' and c.official_publication_id is distinct from new.publication_id) then raise exception 'active claim publication must be selected by its claim' using errcode='23514'; end if;
 elsif pointers<>0 then raise exception 'inactive claim publication cannot be selected' using errcode='23514'; end if;
 return null;
end$$;

create function private.validate_benefit_claim_official_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.benefit_publications%rowtype;
begin
 new.evidence_source_url:=private.benefit_claim_source_url(new.evidence_source_url);
 if new.evidence_source_url is null or new.evidence_observed_on<date '2000-01-01' or new.evidence_observed_on>current_date then
   raise exception 'invalid official evidence' using errcode='22023';
 end if;
 select * into p from public.benefit_publications where publication_id=new.publication_id;
 if not found or p.source_type<>'claim_official' or p.provenance is distinct from jsonb_build_object('claim_id',new.claim_id)
    or (new.action in ('verify','reverify') and (
       new.evidence_source_url is distinct from p.source_url
       or new.evidence_observed_on is distinct from p.observed_at::date
       or new.successor_publication_id is distinct from p.publication_id
       or new.predecessor_publication_id is distinct from p.supersedes_publication_id
       or new.reviewed_at is distinct from p.verified_at
    ))
    or (new.action='withdraw_official' and (
       p.status<>'withdrawn'
       or new.predecessor_publication_id is distinct from p.publication_id
       or new.successor_publication_id is not distinct from p.publication_id
    )) then
   raise exception 'official review must bind exactly to its claim publication' using errcode='23514';
 end if;
 return new;
end$$;
create trigger benefit_claim_official_reviews_evidence_gate before insert or update on public.benefit_claim_official_reviews for each row execute function private.validate_benefit_claim_official_review();

create function private.enforce_benefit_official_evidence_invariant()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if tg_table_name='benefit_claims' then
   perform private.assert_benefit_claim_publication(case when tg_op='DELETE' then old.claim_id else new.claim_id end);
 elsif tg_table_name='benefit_claim_official_reviews' then
   perform private.assert_benefit_claim_publication(case when tg_op='DELETE' then old.claim_id else new.claim_id end);
   if tg_op='UPDATE' and old.claim_id is distinct from new.claim_id then perform private.assert_benefit_claim_publication(old.claim_id); end if;
 else
   for cid in select claim_id from public.benefit_claims where active_publication_id=case when tg_op='DELETE' then old.publication_id else new.publication_id end or official_publication_id=case when tg_op='DELETE' then old.publication_id else new.publication_id end
     union select (new.provenance->>'claim_id')::uuid where tg_op<>'DELETE' and new.source_type in ('claim_reaction','claim_official')
     union select (old.provenance->>'claim_id')::uuid where tg_op in ('UPDATE','DELETE') and old.source_type in ('claim_reaction','claim_official')
   loop perform private.assert_benefit_claim_publication(cid); end loop;
 end if;
 return null;
end$$;
create constraint trigger benefit_claims_official_evidence_invariant after insert or update or delete on public.benefit_claims deferrable initially deferred for each row execute function private.enforce_benefit_official_evidence_invariant();
create constraint trigger benefit_publications_official_evidence_invariant after insert or update or delete on public.benefit_publications deferrable initially deferred for each row execute function private.enforce_benefit_official_evidence_invariant();
create constraint trigger benefit_claim_reviews_official_evidence_invariant after insert or update or delete on public.benefit_claim_official_reviews deferrable initially deferred for each row execute function private.enforce_benefit_official_evidence_invariant();

create or replace function private.enforce_benefit_claim_update() returns trigger language plpgsql set search_path='' as $$begin
 if new.claim_id is distinct from old.claim_id or new.company_id is distinct from old.company_id or (new.submitter_id is distinct from old.submitter_id and not(old.submitter_id is not null and new.submitter_id is null)) or new.client_key is distinct from old.client_key or new.payload_fingerprint is distinct from old.payload_fingerprint or new.category_id is distinct from old.category_id or new.title is distinct from old.title or new.normalized_title is distinct from old.normalized_title or new.description is distinct from old.description or new.eligibility_text is distinct from old.eligibility_text or new.normalized_eligibility is distinct from old.normalized_eligibility or new.condition_text is distinct from old.condition_text or new.observed_on is distinct from old.observed_on or new.source_url is distinct from old.source_url or new.created_at is distinct from old.created_at then raise exception 'benefit claim payload is immutable' using errcode='23514'; end if;
 if old.status='merged' and new.merged_into_claim_id is distinct from old.merged_into_claim_id then raise exception 'merged claim target is immutable' using errcode='23514'; end if;
 if new.status is distinct from old.status or new.active_publication_id is distinct from old.active_publication_id or new.official_publication_id is distinct from old.official_publication_id or new.merged_into_claim_id is distinct from old.merged_into_claim_id then if new.revision<>old.revision+1 then raise exception 'benefit claim revision must increment once' using errcode='23514'; end if; elsif new.revision is distinct from old.revision then raise exception 'benefit claim revision changes only on transition' using errcode='23514'; end if; return new;
end$$;

create function private.benefit_claim_counts(p_claim uuid,out confirms integer,out disputes integer) language sql stable security definer set search_path='' as $$select count(*) filter(where reaction='confirm')::integer,count(*) filter(where reaction='dispute')::integer from public.benefit_claim_reactions where claim_id=p_claim$$;

create function public.list_benefit_claim_moderation_queue_v1(p_status text default 'active',p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare items jsonb; more boolean; nxt jsonb;
begin perform private.require_google_user(); perform private.require_admin(); if p_status is null or p_status not in ('active','submitted','community_confirmed','disputed','hidden','withdrawn','merged','all') then raise exception 'invalid claim status filter' using errcode='22023'; end if; if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if; if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with base as materialized(select c.*,bc.display_name from public.benefit_claims c join public.benefit_companies bc using(company_id) where (p_status='all' or (p_status='active' and c.status in ('submitted','community_confirmed','disputed')) or c.status=p_status) and (p_cursor_created_at is null or (c.created_at,c.claim_id)<(p_cursor_created_at,p_cursor_id)) order by c.created_at desc,c.claim_id desc limit p_limit+1), candidates as materialized(select b.*,(select count(*) from public.benefit_claim_reactions r where r.claim_id=b.claim_id and reaction='confirm') confirms,(select count(*) from public.benefit_claim_reactions r where r.claim_id=b.claim_id and reaction='dispute') disputes from base b), page as(select * from candidates order by created_at desc,claim_id desc limit p_limit)
 select coalesce(jsonb_agg(jsonb_build_object('claim_id',claim_id,'company_id',company_id,'company_name',display_name,'category_id',category_id,'title',title,'status',status,'revision',revision,'confirm_count',confirms,'dispute_count',disputes,'community_publication_active',active_publication_id is not null,'official_publication_active',official_publication_id is not null,'created_at',created_at,'updated_at',updated_at) order by created_at desc,claim_id desc),'[]'),(select count(*)>p_limit from candidates),case when (select count(*)>p_limit from candidates) then (select jsonb_build_object('created_at',created_at,'claim_id',claim_id) from page order by created_at,claim_id limit 1) else 'null'::jsonb end into items,more,nxt from page;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',nxt); end$$;

create function public.list_benefit_claim_audit_v1(p_claim_id uuid,p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_kind text default null,p_cursor_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare items jsonb; more boolean; nxt jsonb;
begin
 perform private.require_google_user(); perform private.require_admin();
 if p_claim_id is null then raise exception 'claim id required' using errcode='22023'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
 if (p_cursor_created_at is null)<>(p_cursor_kind is null) or (p_cursor_created_at is null)<>(p_cursor_id is null)
    or (p_cursor_created_at is not null and (not isfinite(p_cursor_created_at) or p_cursor_kind not in ('claim_event','official_review','merge'))) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with
 event_branch as materialized(
   select event_id id,created_at,'claim_event'::text kind,event_type action,from_status,to_status,null::text evidence_type,null::date evidence_observed_on,
          case when event_type='merged' and operation='moderate' then (metadata->>'target_claim_id')::uuid when event_type='merged' and operation='merge_target' then (metadata->>'source_claim_id')::uuid else null::uuid end related_claim_id,
          case when metadata ? 'publication_id' then (metadata->>'publication_id')::uuid else null::uuid end publication_id
   from public.benefit_claim_events where claim_id=p_claim_id
     and (p_cursor_created_at is null or (created_at,'claim_event'::text,event_id)<(p_cursor_created_at,p_cursor_kind,p_cursor_id))
   order by created_at desc,event_id desc limit p_limit+1
 ), review_branch as materialized(
   select review_id id,reviewed_at created_at,'official_review'::text kind,action,null::text from_status,null::text to_status,evidence_type,evidence_observed_on,null::uuid related_claim_id,publication_id
   from public.benefit_claim_official_reviews where claim_id=p_claim_id
     and (p_cursor_created_at is null or (reviewed_at,'official_review'::text,review_id)<(p_cursor_created_at,p_cursor_kind,p_cursor_id))
   order by reviewed_at desc,review_id desc limit p_limit+1
 ), merge_branch as materialized(
   select source_claim_id id,merged_at created_at,'merge'::text kind,'merged'::text action,null::text from_status,'merged'::text to_status,null::text evidence_type,null::date evidence_observed_on,
          case when source_claim_id=p_claim_id then target_claim_id else source_claim_id end related_claim_id,null::uuid publication_id
   from public.benefit_claim_merges where (source_claim_id=p_claim_id or target_claim_id=p_claim_id)
     and (p_cursor_created_at is null or (merged_at,'merge'::text,source_claim_id)<(p_cursor_created_at,p_cursor_kind,p_cursor_id))
   order by merged_at desc,source_claim_id desc limit p_limit+1
 ), candidates as materialized(
   select * from (select * from event_branch union all select * from review_branch union all select * from merge_branch) u
   order by created_at desc,kind desc,id desc limit p_limit+1
 ), page as materialized(select * from candidates order by created_at desc,kind desc,id desc limit p_limit)
 select coalesce(jsonb_agg(jsonb_build_object('event_id',id,'event_kind',kind,'action',action,'from_status',from_status,'to_status',to_status,'evidence_type',evidence_type,'evidence_observed_on',evidence_observed_on,'related_claim_id',related_claim_id,'publication_id',publication_id,'created_at',created_at) order by created_at desc,kind desc,id desc),'[]'),
        (select count(*)>p_limit from candidates),
        case when(select count(*)>p_limit from candidates) then(select jsonb_build_object('created_at',created_at,'event_kind',kind,'event_id',id) from page order by created_at,kind,id limit 1) else 'null'::jsonb end
 into items,more,nxt from page;
 return jsonb_build_object('items',items,'has_more',more,'next_cursor',nxt);
end$$;

create function public.officially_verify_benefit_claim_v1(p_claim_id uuid,p_expected_status text,p_expected_revision bigint,p_title text,p_description text,p_eligibility_text text,p_condition_text text,p_evidence_type text,p_evidence_source_url text,p_evidence_observed_on date,p_verification_note text,p_client_key uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c public.benefit_claims%rowtype; oldp public.benefit_publications%rowtype; pubid uuid; rev integer; nowat timestamptz; fp text; req public.benefit_claim_moderation_requests%rowtype; ttl text; des text; elig text; cond text; src text; note text; action text; response jsonb;
begin perform private.require_read_committed(); actor:=private.require_google_user(); if private.require_admin() is distinct from actor then raise exception 'admin required' using errcode='42501'; end if; if p_claim_id is null or p_client_key is null or p_expected_status not in('submitted','community_confirmed','disputed') or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid official verification request' using errcode='22023'; end if;
 ttl:=private.benefit_claim_text(p_title,'official title',200,false); des:=private.benefit_claim_text(p_description,'official description',1000,false); elig:=private.benefit_claim_text(p_eligibility_text,'official eligibility',500,true); cond:=private.benefit_claim_text(p_condition_text,'official condition',500,true); src:=private.benefit_claim_source_url(p_evidence_source_url); note:=private.benefit_claim_text(p_verification_note,'verification note',1000,false);
 if src is null or p_evidence_type not in ('official_website','company_policy','regulatory_filing','employment_document','other_official') or p_evidence_observed_on is null or p_evidence_observed_on<date '2000-01-01' or p_evidence_observed_on>current_date then raise exception 'invalid official evidence' using errcode='22023'; end if;
 fp:=private.benefit_claim_moderation_fingerprint(jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision,'title',ttl,'description',des,'eligibility',elig,'condition',cond,'evidence_type',p_evidence_type,'source',src,'observed',p_evidence_observed_on,'note',note)); perform 1 from public.profiles where id=actor for key share; perform pg_advisory_xact_lock(hashtextextended('benefit-claim-moderation:'||actor||':'||p_client_key,0)); select * into req from public.benefit_claim_moderation_requests where actor_snapshot=actor and client_key=p_client_key; if found then if req.payload_fingerprint<>fp then raise exception 'client key reused with different payload' using errcode='22023'; end if; return req.response; end if;
 select * into c from public.benefit_claims where claim_id=p_claim_id for update; if not found then raise exception 'benefit claim not found' using errcode='22023'; end if; if c.status is distinct from p_expected_status or c.revision is distinct from p_expected_revision then raise exception 'benefit claim state changed' using errcode='40001'; end if; if c.status not in('submitted','community_confirmed','disputed') then raise exception 'claim cannot be officially verified' using errcode='22023'; end if; nowat:=clock_timestamp();
 if c.official_publication_id is not null then select * into oldp from public.benefit_publications where publication_id=c.official_publication_id for update; action:='reverify'; elsif c.active_publication_id is not null then select * into oldp from public.benefit_publications where publication_id=c.active_publication_id for update; action:='verify'; else select * into oldp from public.benefit_publications where provenance->>'claim_id'=p_claim_id::text and source_type in('claim_reaction','claim_official') order by revision desc limit 1 for update; action:='verify'; end if;
 if oldp.publication_id is not null and oldp.status='active' then update public.benefit_publications set status='superseded',updated_at=nowat where publication_id=oldp.publication_id; end if; rev:=coalesce(oldp.revision,0)+1;
 insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,observed_at,verified_at,provenance,reviewer_id,created_at,updated_at) values(c.company_id,c.category_id,ttl,des,elig,cond,'official_verified','active','claim-'||c.claim_id,rev,oldp.publication_id,src,'claim_official',p_evidence_observed_on::timestamptz,nowat,jsonb_build_object('claim_id',c.claim_id),null,nowat,nowat) returning publication_id into pubid;
 update public.benefit_claims set active_publication_id=null,official_publication_id=pubid,revision=revision+1,updated_at=nowat where claim_id=c.claim_id returning * into c;
 insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,predecessor_publication_id,successor_publication_id,reviewed_at) values(c.claim_id,pubid,actor,action,p_evidence_type,src,p_evidence_observed_on,note,oldp.publication_id,pubid,nowat);
 insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(c.claim_id,actor,'review',p_client_key,fp,'official_reviewed',p_expected_status,c.status,jsonb_build_object('action',action,'publication_id',pubid)); response:=jsonb_build_object('claim_id',c.claim_id,'status',c.status,'revision',c.revision,'official_publication_id',pubid,'outcome',action); insert into public.benefit_claim_moderation_requests values(actor,p_client_key,c.claim_id,action,fp,response,nowat); set constraints all immediate; set constraints all deferred; return response; end$$;

create function public.moderate_benefit_claim_v1(p_client_key uuid,p_claim_id uuid,p_expected_revision bigint,p_expected_status text,p_action text,p_target_claim_id uuid default null,p_reason text default null,p_evidence_type text default null,p_evidence_observed_on date default null,p_evidence_source_url text default null) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; c public.benefit_claims%rowtype; t public.benefit_claims%rowtype; p public.benefit_publications%rowtype; prev public.benefit_publications%rowtype; confirms integer; disputes integer; newstatus text; target_old_status text; nowat timestamptz; fp text; req public.benefit_claim_moderation_requests%rowtype; reason text; src text; response jsonb; pubid uuid; reviewid uuid; mergeid uuid;
begin perform private.require_read_committed(); actor:=private.require_google_user(); if private.require_admin() is distinct from actor then raise exception 'admin required' using errcode='42501'; end if; if p_client_key is null or p_claim_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_status is null or p_action not in('hide','restore','withdraw','merge','withdraw_official') then raise exception 'invalid claim moderation request' using errcode='22023'; end if; reason:=private.benefit_claim_text(p_reason,'moderation reason',1000,false); src:=private.benefit_claim_source_url(p_evidence_source_url); if p_action='withdraw_official' and (src is null or p_evidence_type not in('official_website','company_policy','regulatory_filing','employment_document','other_official') or p_evidence_observed_on is null or p_evidence_observed_on<date '2000-01-01' or p_evidence_observed_on>current_date) then raise exception 'official withdrawal requires evidence' using errcode='22023'; end if;
 fp:=private.benefit_claim_moderation_fingerprint(jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision,'action',p_action,'target',p_target_claim_id,'reason',reason,'evidence_type',p_evidence_type,'observed',p_evidence_observed_on,'source',src)); perform 1 from public.profiles where id=actor for key share; perform pg_advisory_xact_lock(hashtextextended('benefit-claim-moderation:'||actor||':'||p_client_key,0)); select * into req from public.benefit_claim_moderation_requests where actor_snapshot=actor and client_key=p_client_key; if found then if req.payload_fingerprint<>fp then raise exception 'client key reused with different payload' using errcode='22023'; end if; return req.response; end if;
 if p_action='merge' then if p_target_claim_id is null or p_target_claim_id=p_claim_id then raise exception 'valid merge target required' using errcode='22023'; end if; perform 1 from public.benefit_claims where claim_id in(p_claim_id,p_target_claim_id) order by claim_id for update; end if;
 select * into c from public.benefit_claims where claim_id=p_claim_id for update; if not found then raise exception 'benefit claim not found' using errcode='22023'; end if; if c.status is distinct from p_expected_status or c.revision is distinct from p_expected_revision then raise exception 'benefit claim state changed' using errcode='40001'; end if; nowat:=clock_timestamp();
 if c.active_publication_id is not null then select * into p from public.benefit_publications where publication_id=c.active_publication_id for update; end if;
 if p_action='hide' then if c.status not in('submitted','community_confirmed','disputed') then raise exception 'claim cannot be hidden' using errcode='22023'; end if; if c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id; end if; update public.benefit_claims set status='hidden',active_publication_id=null,revision=revision+1,updated_at=nowat where claim_id=c.claim_id returning * into c;
 elsif p_action='withdraw' then if c.status not in('submitted','community_confirmed','disputed','hidden') then raise exception 'claim cannot be withdrawn' using errcode='22023'; end if; if c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id; end if; update public.benefit_claims set status='withdrawn',active_publication_id=null,revision=revision+1,updated_at=nowat,withdrawn_at=nowat where claim_id=c.claim_id returning * into c;
 elsif p_action='restore' then if c.status not in('hidden','withdrawn') then raise exception 'claim cannot be restored' using errcode='22023'; end if; select * into confirms,disputes from private.benefit_claim_counts(c.claim_id); newstatus:=case when disputes>0 then 'disputed' when confirms>=3 then 'community_confirmed' else 'submitted' end; pubid:=null; if newstatus='community_confirmed' and c.official_publication_id is null then select * into prev from public.benefit_publications where provenance->>'claim_id'=c.claim_id::text order by revision desc limit 1 for update; insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,observed_at,verified_at,provenance,created_at,updated_at) values(c.company_id,c.category_id,c.title,c.description,c.eligibility_text,c.condition_text,'community_reviewed','active','claim-'||c.claim_id,coalesce(prev.revision,0)+1,prev.publication_id,'claim_reaction',c.observed_on::timestamptz,nowat,jsonb_build_object('claim_id',c.claim_id),nowat,nowat) returning publication_id into pubid; end if; update public.benefit_claims set status=newstatus,active_publication_id=pubid,revision=revision+1,updated_at=nowat,withdrawn_at=null where claim_id=c.claim_id returning * into c;
 elsif p_action='withdraw_official' then if c.official_publication_id is null then raise exception 'claim has no active official publication' using errcode='22023'; end if; select * into p from public.benefit_publications where publication_id=c.official_publication_id for update; update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=p.publication_id; select * into confirms,disputes from private.benefit_claim_counts(c.claim_id); newstatus:=case when disputes>0 then 'disputed' when confirms>=3 then 'community_confirmed' else 'submitted' end; pubid:=null; if newstatus='community_confirmed' and c.status not in('hidden','withdrawn') then insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,observed_at,verified_at,provenance,created_at,updated_at) values(c.company_id,c.category_id,c.title,c.description,c.eligibility_text,c.condition_text,'community_reviewed','active','claim-'||c.claim_id,p.revision+1,p.publication_id,'claim_reaction',c.observed_on::timestamptz,nowat,jsonb_build_object('claim_id',c.claim_id),nowat,nowat) returning publication_id into pubid; else newstatus:=c.status; end if; update public.benefit_claims set official_publication_id=null,active_publication_id=pubid,status=newstatus,revision=revision+1,updated_at=case when c.status='withdrawn' then c.updated_at else nowat end where claim_id=c.claim_id returning * into c; insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,predecessor_publication_id,successor_publication_id,reviewed_at) values(c.claim_id,p.publication_id,actor,'withdraw_official',p_evidence_type,src,p_evidence_observed_on,reason,p.publication_id,pubid,nowat) returning review_id into reviewid;
 else select * into t from public.benefit_claims where claim_id=p_target_claim_id; target_old_status:=t.status; if not found or t.status not in('submitted','community_confirmed','disputed') or t.company_id<>c.company_id or t.category_id<>c.category_id then raise exception 'merge target must be active with same company and category' using errcode='22023'; end if; if c.official_publication_id is not null then raise exception 'withdraw source official authority before merge' using errcode='55000'; end if; perform 1 from public.benefit_claim_reactions where claim_id in(c.claim_id,t.claim_id) order by claim_id,user_id for update; insert into public.benefit_claim_merges(source_claim_id,target_claim_id,actor_snapshot,request_client_key,merged_at) values(c.claim_id,t.claim_id,actor,p_client_key,nowat) returning merge_id into mergeid; insert into public.benefit_claim_merge_reactions(merge_id,origin_claim_id,user_id,reaction,created_at,updated_at) select mergeid,claim_id,user_id,reaction,created_at,updated_at from public.benefit_claim_reactions where claim_id in(c.claim_id,t.claim_id) order by claim_id,user_id; if t.official_publication_id is not null and c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id; end if; insert into public.benefit_claim_reactions(claim_id,user_id,reaction,created_at,updated_at) select t.claim_id,r.user_id,case when r.reaction='dispute' or x.reaction='dispute' then 'dispute' else 'confirm' end,least(r.created_at,coalesce(x.created_at,r.created_at)),greatest(r.updated_at,coalesce(x.updated_at,r.updated_at)) from public.benefit_claim_reactions r left join public.benefit_claim_reactions x on x.claim_id=t.claim_id and x.user_id=r.user_id where r.claim_id=c.claim_id on conflict(claim_id,user_id) do update set reaction=excluded.reaction,created_at=least(public.benefit_claim_reactions.created_at,excluded.created_at),updated_at=greatest(public.benefit_claim_reactions.updated_at,excluded.updated_at); delete from public.benefit_claim_reactions where claim_id=c.claim_id; if c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id; end if; select * into confirms,disputes from private.benefit_claim_counts(t.claim_id); newstatus:=case when disputes>0 then 'disputed' when confirms>=3 then 'community_confirmed' else 'submitted' end; pubid:=t.active_publication_id; if t.official_publication_id is not null then pubid:=null; elsif newstatus='community_confirmed' and pubid is null then select * into prev from public.benefit_publications where provenance->>'claim_id'=t.claim_id::text order by revision desc limit 1 for update; insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,observed_at,verified_at,provenance,created_at,updated_at) values(t.company_id,t.category_id,t.title,t.description,t.eligibility_text,t.condition_text,'community_reviewed','active','claim-'||t.claim_id,coalesce(prev.revision,0)+1,prev.publication_id,'claim_reaction',t.observed_on::timestamptz,nowat,jsonb_build_object('claim_id',t.claim_id),nowat,nowat) returning publication_id into pubid; elsif newstatus<>'community_confirmed' and pubid is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=pubid; pubid:=null; end if; if newstatus is distinct from t.status or pubid is distinct from t.active_publication_id then update public.benefit_claims set status=newstatus,active_publication_id=pubid,revision=revision+1,updated_at=nowat where claim_id=t.claim_id returning * into t; end if; update public.benefit_claims set status='merged',active_publication_id=null,official_publication_id=null,merged_into_claim_id=t.claim_id,revision=revision+1,updated_at=nowat,withdrawn_at=null where claim_id=c.claim_id returning * into c; insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(t.claim_id,actor,'merge_target',p_client_key,fp,'merged',target_old_status,t.status,jsonb_build_object('reason',reason,'source_claim_id',c.claim_id,'target_status',t.status,'confirm_count',confirms,'dispute_count',disputes,'community_publication_id',t.active_publication_id,'official_publication_id',t.official_publication_id)); end if;
 if p_action='withdraw_official' then insert into public.benefit_claim_events(event_id,claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata,created_at) values(reviewid,c.claim_id,actor,'review',p_client_key,fp,'official_withdrawn',p_expected_status,c.status,jsonb_build_object('action','withdraw_official','reason',reason,'publication_id',p.publication_id,'successor_publication_id',pubid,'evidence_type',p_evidence_type,'evidence_source_url',src,'evidence_observed_on',p_evidence_observed_on),nowat); else insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(c.claim_id,actor,'moderate',p_client_key,fp,case p_action when 'hide' then 'hidden' when 'restore' then 'restored' when 'merge' then 'merged' else 'withdrawn' end,p_expected_status,c.status,jsonb_build_object('reason',reason,'target_claim_id',p_target_claim_id)); end if; response:=jsonb_build_object('claim_id',c.claim_id,'status',c.status,'revision',c.revision,'community_publication_id',c.active_publication_id,'official_publication_id',c.official_publication_id,'outcome',p_action,'target_claim_id',p_target_claim_id); insert into public.benefit_claim_moderation_requests values(actor,p_client_key,c.claim_id,p_action,fp,response,nowat); set constraints all immediate; set constraints all deferred; return response; end$$;

-- Reactions recompute community state but never retire or duplicate official authority.
create or replace function public.set_benefit_claim_reaction_v1(p_claim_id uuid,p_reaction text,p_client_key uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; v_reaction text; fp text; req public.benefit_claim_reaction_requests%rowtype; c public.benefit_claims%rowtype; oldreaction text; oldstatus text; confirms integer; disputes integer; newstatus text; nowat timestamptz; outcome text; pub public.benefit_publications%rowtype; prev public.benefit_publications%rowtype; pubid uuid; response jsonb;
begin perform private.require_read_committed(); actor:=private.require_google_user(); if p_claim_id is null or p_client_key is null then raise exception 'claim and client key are required' using errcode='22023'; end if; if p_reaction is not null then v_reaction:=lower(btrim(p_reaction)); if char_length(p_reaction)>20 or v_reaction not in('confirm','dispute') then raise exception 'invalid claim reaction' using errcode='22023'; end if; end if; fp:=private.benefit_claim_moderation_fingerprint(jsonb_build_object('claim_id',p_claim_id,'reaction',v_reaction)); perform 1 from public.profiles where id=actor for key share; perform pg_advisory_xact_lock(hashtextextended('benefit-claim-reaction:intent:'||actor||':'||p_client_key,0)); select * into req from public.benefit_claim_reaction_requests where actor_snapshot=actor and client_key=p_client_key; if found then if req.payload_fingerprint<>fp then raise exception 'client key reused with different payload' using errcode='22023'; end if; return req.response; end if; perform private.require_benefit_features(array['claim_reactions_write_enabled']); select * into c from public.benefit_claims where claim_id=p_claim_id for update; if not found or c.status not in('submitted','community_confirmed','disputed') then raise exception 'benefit claim is not visible' using errcode='22023'; end if; oldstatus:=c.status; if v_reaction='confirm' and c.submitter_id=actor then raise exception 'claim submitter cannot confirm own claim' using errcode='42501'; end if; select r.reaction into oldreaction from public.benefit_claim_reactions r where claim_id=p_claim_id and user_id=actor for update; perform private.consume_rate_limit(actor,'benefit_claim.react',p_client_key::text); nowat:=clock_timestamp(); if v_reaction is null then if oldreaction is null then outcome:='unchanged'; else delete from public.benefit_claim_reactions where claim_id=p_claim_id and user_id=actor; outcome:='cleared'; end if; elsif oldreaction is null then insert into public.benefit_claim_reactions values(p_claim_id,actor,v_reaction,nowat,nowat); outcome:='set'; elsif oldreaction=v_reaction then outcome:='unchanged'; else update public.benefit_claim_reactions set reaction=v_reaction,updated_at=nowat where claim_id=p_claim_id and user_id=actor; outcome:='changed'; end if; select * into confirms,disputes from private.benefit_claim_counts(p_claim_id); newstatus:=case when disputes>0 then 'disputed' when confirms>=3 then 'community_confirmed' else 'submitted' end; pubid:=c.active_publication_id; if c.official_publication_id is null then if newstatus='community_confirmed' and pubid is null then select * into prev from public.benefit_publications where provenance->>'claim_id'=p_claim_id::text order by revision desc limit 1 for update; insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,observed_at,verified_at,provenance,created_at,updated_at) values(c.company_id,c.category_id,c.title,c.description,c.eligibility_text,c.condition_text,'community_reviewed','active','claim-'||c.claim_id,coalesce(prev.revision,0)+1,prev.publication_id,'claim_reaction',c.observed_on::timestamptz,nowat,jsonb_build_object('claim_id',c.claim_id),nowat,nowat) returning publication_id into pubid; elsif newstatus<>'community_confirmed' and pubid is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=pubid; pubid:=null; end if; else pubid:=null; end if; if newstatus<>c.status or pubid is distinct from c.active_publication_id then update public.benefit_claims set status=newstatus,active_publication_id=pubid,revision=revision+1,updated_at=nowat where claim_id=c.claim_id returning * into c; insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(c.claim_id,actor,'promote',p_client_key,fp,case when c.official_publication_id is not null then 'reaction_recomputed' when newstatus='community_confirmed' then case when prev.publication_id is null then 'promoted' else 'repromoted' end else 'demoted' end,oldstatus,newstatus,jsonb_build_object('confirm_count',confirms,'dispute_count',disputes)); end if; response:=jsonb_build_object('claim_id',c.claim_id,'reaction',v_reaction,'status',newstatus,'revision',c.revision,'confirm_count',confirms,'dispute_count',disputes,'active_publication_id',pubid,'outcome',outcome); insert into public.benefit_claim_reaction_requests values(actor,p_client_key,c.claim_id,fp,response,nowat); set constraints all immediate; set constraints all deferred; return response; end$$;

-- User withdrawal retires only community authority; official authority is independent.
create or replace function public.withdraw_benefit_claim_v1(p_client_key uuid,p_claim_id uuid,p_expected_status text,p_expected_revision bigint) returns jsonb language plpgsql volatile security definer set search_path='' as $$declare actor uuid;c public.benefit_claims%rowtype;p public.benefit_publications%rowtype;fp text;e public.benefit_claim_events%rowtype;nowat timestamptz;begin perform private.require_read_committed();actor:=private.require_google_user();if p_client_key is null or p_claim_id is null or p_expected_status is null or p_expected_revision is null then raise exception 'invalid claim withdrawal request' using errcode='22023';end if;fp:=private.benefit_claim_moderation_fingerprint(jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision));perform 1 from public.profiles where id=actor for key share;perform pg_advisory_xact_lock(hashtextextended('benefit-claim:intent:'||actor||':'||p_client_key,0));select * into e from public.benefit_claim_events where actor_snapshot=actor and operation='withdraw' and client_key=p_client_key;if found then if e.payload_fingerprint<>fp then raise exception 'client key reused with different payload' using errcode='22023';end if;return jsonb_build_object('claim_id',e.claim_id,'status','withdrawn','revision',(select revision from public.benefit_claims where claim_id=e.claim_id),'outcome','withdrawn');end if;perform private.require_benefit_features(array['claims_write_enabled']);select * into c from public.benefit_claims where claim_id=p_claim_id for update;if not found then raise exception 'benefit claim not found' using errcode='22023';end if;if c.submitter_id is distinct from actor then raise exception 'claim submitter required' using errcode='42501';end if;if c.status is distinct from p_expected_status or c.revision is distinct from p_expected_revision then raise exception 'benefit claim state changed' using errcode='40001';end if;if c.active_publication_id is not null then select * into p from public.benefit_publications where publication_id=c.active_publication_id for update;end if;perform private.consume_rate_limit(actor,'benefit_claim.withdraw',p_client_key::text);nowat:=clock_timestamp();if c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id;end if;update public.benefit_claims set status='withdrawn',active_publication_id=null,revision=revision+1,updated_at=nowat,withdrawn_at=nowat where claim_id=c.claim_id returning * into c;insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status) values(c.claim_id,actor,'withdraw',p_client_key,fp,'withdrawn',p_expected_status,'withdrawn');set constraints all immediate;set constraints all deferred;return jsonb_build_object('claim_id',c.claim_id,'status',c.status,'revision',c.revision,'outcome','withdrawn');end$$;

-- Exact response ledger replaces Task 6's mutable reconstruction replay.
create or replace function public.withdraw_benefit_claim_v1(p_client_key uuid,p_claim_id uuid,p_expected_status text,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; fp text; req public.benefit_claim_moderation_requests%rowtype; c public.benefit_claims%rowtype; p public.benefit_publications%rowtype; nowat timestamptz; response jsonb;
begin
 perform private.require_read_committed(); actor:=private.require_google_user();
 if p_client_key is null or p_claim_id is null or p_expected_status not in ('submitted','community_confirmed','disputed') or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid claim withdrawal request' using errcode='22023'; end if;
 fp:=private.benefit_claim_moderation_fingerprint(jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision));
 perform 1 from public.profiles where id=actor for key share;
 perform pg_advisory_xact_lock(hashtextextended('benefit-claim:intent:'||actor||':'||p_client_key,0));
 select * into req from public.benefit_claim_moderation_requests where actor_snapshot=actor and client_key=p_client_key;
 if found then if req.payload_fingerprint<>fp then raise exception 'client key reused with different payload' using errcode='22023'; end if; return req.response; end if;
 perform private.require_benefit_features(array['claims_write_enabled']);
 select * into c from public.benefit_claims where claim_id=p_claim_id for update;
 if not found then raise exception 'benefit claim not found' using errcode='22023'; end if;
 if c.submitter_id is distinct from actor then raise exception 'claim submitter required' using errcode='42501'; end if;
 if c.status is distinct from p_expected_status or c.revision is distinct from p_expected_revision then raise exception 'benefit claim state changed' using errcode='40001'; end if;
 if c.active_publication_id is not null then select * into p from public.benefit_publications where publication_id=c.active_publication_id for update; end if;
 perform private.consume_rate_limit(actor,'benefit_claim.withdraw',p_client_key::text); nowat:=clock_timestamp();
 if c.active_publication_id is not null then update public.benefit_publications set status='withdrawn',updated_at=nowat where publication_id=c.active_publication_id; end if;
 update public.benefit_claims set status='withdrawn',active_publication_id=null,revision=revision+1,updated_at=nowat,withdrawn_at=nowat where claim_id=c.claim_id returning * into c;
 insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status) values(c.claim_id,actor,'withdraw',p_client_key,fp,'withdrawn',p_expected_status,'withdrawn');
 response:=jsonb_build_object('claim_id',c.claim_id,'status',c.status,'revision',c.revision,'outcome','withdrawn');
 insert into public.benefit_claim_moderation_requests(actor_snapshot,client_key,claim_id,action,payload_fingerprint,response,created_at) values(actor,p_client_key,c.claim_id,'user_withdraw',fp,response,nowat);
 set constraints all immediate; set constraints all deferred; return response;
end$$;

alter function private.reject_benefit_claim_moderation_ledger_change() owner to postgres; alter function private.validate_benefit_claim_merge_reaction_origin() owner to postgres; alter function private.benefit_claim_moderation_fingerprint(jsonb) owner to postgres; alter function private.benefit_claim_counts(uuid) owner to postgres;
alter function private.validate_benefit_claim_official_review() owner to postgres; alter function private.enforce_benefit_official_evidence_invariant() owner to postgres;
alter function public.list_benefit_claim_moderation_queue_v1(text,integer,timestamptz,uuid) owner to postgres; alter function public.list_benefit_claim_audit_v1(uuid,integer,timestamptz,text,uuid) owner to postgres; alter function public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text) owner to postgres; alter function public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid) owner to postgres;
revoke all on function private.reject_benefit_claim_moderation_ledger_change(),private.validate_benefit_claim_merge_reaction_origin(),private.benefit_claim_moderation_fingerprint(jsonb),private.benefit_claim_counts(uuid),private.validate_benefit_claim_official_review(),private.enforce_benefit_official_evidence_invariant() from public,anon,authenticated,service_role;
revoke all on function public.list_benefit_claim_moderation_queue_v1(text,integer,timestamptz,uuid),public.list_benefit_claim_audit_v1(uuid,integer,timestamptz,text,uuid),public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text),public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_benefit_claim_moderation_queue_v1(text,integer,timestamptz,uuid),public.list_benefit_claim_audit_v1(uuid,integer,timestamptz,text,uuid),public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text),public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid) to authenticated;

alter table public.benefit_claims validate constraint benefit_claims_merged_target_check;
do $$declare cid uuid; begin for cid in select claim_id from public.benefit_claims loop perform private.assert_benefit_claim_publication(cid); end loop; end$$;

commit;
