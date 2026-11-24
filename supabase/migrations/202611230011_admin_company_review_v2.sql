-- Versioned, durable admin company-review idempotency and safe NTS time.
begin;

create table private.benefit_company_review_requests (
  actor_snapshot uuid not null references public.profiles(id) on delete restrict,
  client_key uuid not null,
  request_id uuid not null references public.benefit_company_add_requests(request_id) on delete restrict,
  action text not null check (action in ('approve','reject','merge')),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  response jsonb not null check (pg_catalog.jsonb_typeof(response)='object' and pg_catalog.octet_length(response::text)<=4000),
  created_at timestamptz not null default pg_catalog.clock_timestamp() check (pg_catalog.isfinite(created_at)),
  primary key(actor_snapshot,client_key)
);
alter table private.benefit_company_review_requests owner to postgres;
alter table private.benefit_company_review_requests enable row level security;
revoke all on table private.benefit_company_review_requests from public,anon,authenticated,service_role;

create function private.reject_benefit_company_review_request_change()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'benefit company review requests are append-only' using errcode='23514';
end$$;
create trigger benefit_company_review_requests_append_only before update or delete on private.benefit_company_review_requests for each row execute function private.reject_benefit_company_review_request_change();
create trigger benefit_company_review_requests_no_truncate before truncate on private.benefit_company_review_requests for each statement execute function private.reject_benefit_company_review_request_change();

create function private.benefit_company_request_admin_item_v2(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.benefit_company_request_admin_item(r.request_id)
        || pg_catalog.jsonb_build_object('external_verified_at',r.external_verified_at)
 from public.benefit_company_add_requests r where r.request_id=p_request_id
$$;

create function private.benefit_claim_moderation_item_v1(p_claim_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object(
   'claim_id',c.claim_id,'company_id',c.company_id,'company_name',bc.display_name,
   'category_id',c.category_id,'title',c.title,'status',c.status,'revision',c.revision,
   'confirm_count',(select pg_catalog.count(*) from public.benefit_claim_reactions r where r.claim_id=c.claim_id and r.reaction='confirm'),
   'dispute_count',(select pg_catalog.count(*) from public.benefit_claim_reactions r where r.claim_id=c.claim_id and r.reaction='dispute'),
   'community_publication_active',c.active_publication_id is not null,
   'official_publication_active',c.official_publication_id is not null,
   'created_at',c.created_at,'updated_at',c.updated_at
 )
 from public.benefit_claims c join public.benefit_companies bc using(company_id)
 where c.claim_id=p_claim_id
$$;

create function public.get_benefit_company_request_detail_v2(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if p_request_id is null then raise exception 'request id is required' using errcode='22023'; end if;
 if not exists(select 1 from public.benefit_company_add_requests r where r.request_id=p_request_id) then raise exception 'benefit company request not found' using errcode='22023'; end if;
 return private.benefit_company_request_admin_item_v2(p_request_id);
end$$;

create function public.get_benefit_claim_moderation_detail_v1(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin();
 if p_claim_id is null then raise exception 'claim id is required' using errcode='22023'; end if;
 if not exists(select 1 from public.benefit_claims c where c.claim_id=p_claim_id) then raise exception 'benefit claim not found' using errcode='22023'; end if;
 return private.benefit_claim_moderation_item_v1(p_claim_id);
end$$;

create function private.benefit_company_review_fingerprint(
 p_request_id uuid,p_expected_status text,p_expected_revision bigint,p_action text,p_reason text,p_destination_company_id text
) returns text language sql immutable set search_path='' as $$
 select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
  'request_id',p_request_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision,
  'action',p_action,'reason',p_reason,'destination_company_id',p_destination_company_id
 )::text,'UTF8'),'sha256'),'hex')
$$;

create function public.list_benefit_company_request_queue_v2(
 p_status text default 'pending_review',p_limit integer default 50,
 p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_items jsonb; v_more boolean; v_next jsonb;
begin
 perform private.require_admin();
 if p_status is null or p_status not in ('pending_review','approved','rejected','merged','all') then raise exception 'invalid company request status filter' using errcode='22023'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
 if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with candidates as materialized (
  select r.request_id,r.created_at,private.benefit_company_request_admin_item_v2(r.request_id) item
  from public.benefit_company_add_requests r
  where (p_status='all' or r.status=p_status)
    and (p_cursor_created_at is null or (r.created_at,r.request_id)<(p_cursor_created_at,p_cursor_id))
  order by r.created_at desc,r.request_id desc limit p_limit+1
 ), page as (select * from candidates order by created_at desc,request_id desc limit p_limit)
 select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,request_id desc),'[]'),
        (select count(*)>p_limit from candidates),
        case when (select count(*)>p_limit from candidates) then
          (select pg_catalog.jsonb_build_object('created_at',created_at,'request_id',request_id) from page order by created_at,request_id limit 1)
        else 'null'::jsonb end
 into v_items,v_more,v_next from page;
 return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_more,'next_cursor',v_next);
end$$;

create function public.review_benefit_company_request_v2(
 p_client_key uuid,p_request_id uuid,p_expected_status text,p_expected_revision bigint,
 p_action text,p_reason text,p_destination_company_id text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 v_actor uuid; v_request public.benefit_company_add_requests%rowtype; v_ledger private.benefit_company_review_requests%rowtype;
 v_reason text; v_company text; v_now timestamptz; v_action text; v_fingerprint text; v_response jsonb;
begin
 perform private.require_read_committed();
 v_actor:=private.require_admin();
 if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
 if p_request_id is null then raise exception 'request id is required' using errcode='22023'; end if;
 if p_expected_status is null or p_expected_status<>'pending_review' then raise exception 'invalid expected company request status' using errcode='22023'; end if;
 if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid expected company request revision' using errcode='22023'; end if;
 if p_action is null or p_action not in ('approve','reject','merge') then raise exception 'company request review action not allowed' using errcode='22023'; end if;
 v_reason:=private.benefit_company_add_text(p_reason,'review reason',1000,false);
 if p_action='merge' then
   if p_destination_company_id is null or not private.is_benefit_company_id(p_destination_company_id) then raise exception 'merge destination must be canonical and searchable' using errcode='22023'; end if;
 elsif p_destination_company_id is not null then
   if p_action='approve' then raise exception 'approval destination must be null' using errcode='22023';
   else raise exception 'rejection destination must be null' using errcode='22023'; end if;
 end if;
 v_fingerprint:=private.benefit_company_review_fingerprint(p_request_id,p_expected_status,p_expected_revision,p_action,v_reason,p_destination_company_id);
 perform 1 from public.profiles where id=v_actor for key share;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-company-review:'||v_actor::text||':'||p_client_key::text,0));
 select * into v_ledger from private.benefit_company_review_requests where actor_snapshot=v_actor and client_key=p_client_key;
 if found then
   if v_ledger.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
   return v_ledger.response;
 end if;
 perform private.require_benefit_features(array['company_add_write_enabled']);
 select * into v_request from public.benefit_company_add_requests where request_id=p_request_id for update;
 if not found then raise exception 'benefit company request not found' using errcode='22023'; end if;
 if v_request.status is distinct from p_expected_status or v_request.revision is distinct from p_expected_revision then raise exception 'benefit company request state changed' using errcode='40001'; end if;
 if v_request.verification_method<>'manual' then raise exception 'NTS requests require service finalization' using errcode='42501'; end if;
 perform private.consume_rate_limit(v_actor,'benefit_company_add.review',p_client_key::text);
 v_now:=pg_catalog.clock_timestamp();
 if p_action='approve' then
   v_company:=private.new_opaque_benefit_company_id();
   insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,industry,region,is_searchable,source_edition,provenance)
   values(v_company,'registered_business',v_request.proposed_name,v_request.normalized_name,v_request.industry,v_request.region,true,'community-reviewed',pg_catalog.jsonb_build_object('company_add_request_id',v_request.request_id));
   v_action:='approved';
 elsif p_action='merge' then
   if not exists(select 1 from public.benefit_companies c where c.company_id=p_destination_company_id and c.is_searchable for share) then raise exception 'merge destination must be canonical and searchable' using errcode='22023'; end if;
   v_company:=p_destination_company_id; v_action:='merged';
 else
   v_action:='rejected';
 end if;
 update public.benefit_company_add_requests
 set verification_status=case when p_action='reject' then 'rejected' else 'matched' end,status=v_action,revision=revision+1,
     resolved_company_id=v_company,reviewer_id=v_actor,processed_at=v_now,updated_at=v_now
 where request_id=p_request_id;
 insert into public.benefit_company_add_events(request_id,actor_kind,actor_id,action,from_status,to_status,resolved_company_id,verification_category,metadata)
 values(p_request_id,'admin',v_actor,v_action,'pending_review',v_action,v_company,case when p_action='reject' then 'rejected' end,pg_catalog.jsonb_build_object('reason',v_reason));
 v_response:=private.benefit_company_request_admin_item_v2(p_request_id);
 insert into private.benefit_company_review_requests(actor_snapshot,client_key,request_id,action,payload_fingerprint,response,created_at)
 values(v_actor,p_client_key,p_request_id,p_action,v_fingerprint,v_response,v_now);
 return v_response;
end$$;

alter function private.reject_benefit_company_review_request_change() owner to postgres;
alter function private.benefit_company_request_admin_item_v2(uuid) owner to postgres;
alter function private.benefit_claim_moderation_item_v1(uuid) owner to postgres;
alter function private.benefit_company_review_fingerprint(uuid,text,bigint,text,text,text) owner to postgres;
alter function public.get_benefit_company_request_detail_v2(uuid) owner to postgres;
alter function public.get_benefit_claim_moderation_detail_v1(uuid) owner to postgres;
alter function public.list_benefit_company_request_queue_v2(text,integer,timestamptz,uuid) owner to postgres;
alter function public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text) owner to postgres;
revoke all on function private.reject_benefit_company_review_request_change(),private.benefit_company_request_admin_item_v2(uuid),private.benefit_claim_moderation_item_v1(uuid),private.benefit_company_review_fingerprint(uuid,text,bigint,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_benefit_company_request_detail_v2(uuid),public.get_benefit_claim_moderation_detail_v1(uuid),public.list_benefit_company_request_queue_v2(text,integer,timestamptz,uuid),public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_benefit_company_request_detail_v2(uuid),public.get_benefit_claim_moderation_detail_v1(uuid),public.list_benefit_company_request_queue_v2(text,integer,timestamptz,uuid),public.review_benefit_company_request_v2(uuid,uuid,text,bigint,text,text,text) to authenticated;

commit;
