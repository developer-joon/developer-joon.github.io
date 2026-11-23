-- Moderated company-add requests, independent write switches, and NTS service boundary.
begin;

create table private.benefit_feature_settings (
  setting_key text primary key,
  enabled boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint benefit_feature_settings_key_check check (setting_key in ('claims_write_enabled','claim_reactions_write_enabled','company_add_write_enabled','nts_verification_enabled')),
  constraint benefit_feature_settings_timestamps_check check (pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at)
);
insert into private.benefit_feature_settings(setting_key,enabled) values
 ('claims_write_enabled',false),('claim_reactions_write_enabled',false),('company_add_write_enabled',false),('nts_verification_enabled',false);
-- The claims keys reserve independent fail-closed controls for their owning
-- rollout. This migration introduces no claim or claim-reaction write path;
-- only the company-add and NTS keys are consumed below.
alter table private.benefit_feature_settings owner to postgres;
revoke all on table private.benefit_feature_settings from public,anon,authenticated,service_role;

insert into public.rate_limit_rules(id,action,window_seconds,max_requests,is_enabled) values
 ('a0000000-0000-4000-8000-000000000001','benefit_company_add.create',3600,5,true),
 ('a0000000-0000-4000-8000-000000000002','benefit_company_add.review',3600,100,true)
on conflict(action,window_seconds) do update set max_requests=excluded.max_requests,is_enabled=excluded.is_enabled,updated_at=pg_catalog.clock_timestamp();

create table public.benefit_company_add_requests (
  request_id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  client_key uuid not null,
  payload_fingerprint text not null,
  proposed_name text not null,
  normalized_name text not null,
  region text,
  industry text,
  website text,
  verification_method text not null,
  verification_status text not null default 'pending',
  business_number_digest text,
  external_verified_at timestamptz,
  status text not null default 'pending_review',
  revision bigint not null default 1,
  resolved_company_id text references public.benefit_companies(company_id) on delete restrict,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  processed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(requester_id,client_key),
  constraint benefit_company_add_requests_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_company_add_requests_name_check check (pg_catalog.char_length(proposed_name) between 1 and 200 and pg_catalog.octet_length(proposed_name)<=800 and proposed_name=pg_catalog.btrim(proposed_name)),
  constraint benefit_company_add_requests_normalized_name_check check (pg_catalog.char_length(normalized_name) between 1 and 200 and pg_catalog.octet_length(normalized_name)<=800 and normalized_name=pg_catalog.lower(pg_catalog.btrim(normalized_name))),
  constraint benefit_company_add_requests_region_check check (region is null or (pg_catalog.char_length(region) between 1 and 100 and pg_catalog.octet_length(region)<=400 and region=pg_catalog.btrim(region))),
  constraint benefit_company_add_requests_industry_check check (industry is null or (pg_catalog.char_length(industry) between 1 and 100 and pg_catalog.octet_length(industry)<=400 and industry=pg_catalog.btrim(industry))),
  constraint benefit_company_add_requests_website_check check (website is null or (pg_catalog.char_length(website) between 9 and 2048 and pg_catalog.octet_length(website)<=8192 and website=pg_catalog.btrim(website))),
  constraint benefit_company_add_requests_method_check check (verification_method in ('nts_full','manual')),
  constraint benefit_company_add_requests_verification_check check (verification_status in ('pending','matched','mismatched','unavailable','rejected')),
  constraint benefit_company_add_requests_digest_check check (business_number_digest is null or business_number_digest ~ '^[0-9a-f]{64}$'),
  constraint benefit_company_add_requests_status_check check (status in ('pending_review','approved','rejected','merged')),
  constraint benefit_company_add_requests_revision_check check (revision>0),
  constraint benefit_company_add_requests_state_check check (
    (status='pending_review' and verification_status='pending' and business_number_digest is null and external_verified_at is null and resolved_company_id is null and reviewer_id is null and processed_at is null)
    or (status='approved' and verification_status='matched' and resolved_company_id is not null and processed_at is not null
        and ((verification_method='manual' and reviewer_id is not null and business_number_digest is null and external_verified_at is null)
          or (verification_method='nts_full' and reviewer_id is null and business_number_digest is not null and external_verified_at is not null)))
    or (status='merged' and verification_status='matched' and resolved_company_id is not null and processed_at is not null
        and ((verification_method='manual' and reviewer_id is not null and business_number_digest is null and external_verified_at is null)
          or (verification_method='nts_full' and reviewer_id is null and business_number_digest is not null and external_verified_at is not null)))
    or (status='rejected' and verification_status in ('mismatched','unavailable','rejected') and resolved_company_id is null and processed_at is not null
        and ((verification_method='manual' and reviewer_id is not null and business_number_digest is null and external_verified_at is null)
          or (verification_method='nts_full' and reviewer_id is null and business_number_digest is null)))
  ),
  constraint benefit_company_add_requests_timestamps_check check (
    pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at
    and (external_verified_at is null or (pg_catalog.isfinite(external_verified_at) and external_verified_at>=created_at))
    and (processed_at is null or (pg_catalog.isfinite(processed_at) and processed_at>=created_at))
  )
);

create table public.benefit_company_add_events (
  event_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.benefit_company_add_requests(request_id) on delete restrict,
  actor_kind text not null,
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  from_status text,
  to_status text not null,
  resolved_company_id text references public.benefit_companies(company_id) on delete restrict,
  verification_category text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint benefit_company_add_events_actor_check check ((actor_kind in ('requester','admin') and actor_id is not null) or (actor_kind='service_role' and actor_id is null)),
  constraint benefit_company_add_events_action_check check (action in ('requested','reserved','approved','rejected','merged','verification_failed')),
  constraint benefit_company_add_events_from_check check (from_status is null or from_status in ('pending_review','approved','rejected','merged')),
  constraint benefit_company_add_events_to_check check (to_status in ('pending_review','approved','rejected','merged')),
  constraint benefit_company_add_events_category_check check (verification_category is null or verification_category in ('mismatched','unavailable','rejected')),
  constraint benefit_company_add_events_metadata_check check (pg_catalog.jsonb_typeof(metadata)='object' and pg_catalog.octet_length(metadata::text)<=4000),
  constraint benefit_company_add_events_shape_check check (
    (action in ('requested','reserved') and from_status is null and to_status='pending_review' and resolved_company_id is null and verification_category is null)
    or (action='approved' and from_status='pending_review' and to_status='approved' and resolved_company_id is not null and verification_category is null)
    or (action='merged' and from_status='pending_review' and to_status='merged' and resolved_company_id is not null and verification_category is null)
    or (action in ('rejected','verification_failed') and from_status='pending_review' and to_status='rejected' and resolved_company_id is null and verification_category is not null)
  ),
  constraint benefit_company_add_events_created_check check (pg_catalog.isfinite(created_at))
);

create index benefit_company_add_requests_owner_idx on public.benefit_company_add_requests(requester_id,created_at desc,request_id desc);
create index benefit_company_add_requests_active_queue_idx on public.benefit_company_add_requests(created_at desc,request_id desc) where status='pending_review';
create index benefit_company_add_requests_queue_idx on public.benefit_company_add_requests(created_at desc,request_id desc);
create index benefit_company_add_requests_status_queue_idx on public.benefit_company_add_requests(status,created_at desc,request_id desc);
create index benefit_company_add_events_request_idx on public.benefit_company_add_events(request_id,created_at,event_id);

alter table public.benefit_company_add_requests owner to postgres;
alter table public.benefit_company_add_events owner to postgres;
alter table public.benefit_company_add_requests enable row level security;
alter table public.benefit_company_add_events enable row level security;
revoke all on table public.benefit_company_add_requests,public.benefit_company_add_events from public,anon,authenticated,service_role;

create function private.require_benefit_features(p_keys text[])
returns void language plpgsql volatile set search_path='' as $$
declare v_key text; v_enabled boolean; v_seen integer:=0;
begin
  if p_keys is null or pg_catalog.cardinality(p_keys)<1 or exists(select 1 from pg_catalog.unnest(p_keys) k where k is null) then
    raise exception 'invalid feature setting request' using errcode='22023';
  end if;
  for v_key,v_enabled in
    select s.setting_key,s.enabled from private.benefit_feature_settings s
    where s.setting_key=any(p_keys) order by s.setting_key for share
  loop
    v_seen:=v_seen+1;
    if not v_enabled then
      if v_key='company_add_write_enabled' then raise exception 'company add writes are disabled' using errcode='55000';
      elsif v_key='nts_verification_enabled' then raise exception 'NTS verification is disabled' using errcode='55000';
      else raise exception 'benefit writes are disabled' using errcode='55000'; end if;
    end if;
  end loop;
  if v_seen<>(select pg_catalog.count(distinct k) from pg_catalog.unnest(p_keys) k) then raise exception 'feature setting missing' using errcode='55000'; end if;
end $$;

create function private.require_google_user()
returns uuid language plpgsql stable set search_path='' as $$
declare v_actor uuid;
begin
  v_actor:=private.require_user();
  if not exists(select 1 from auth.identities i where i.user_id=v_actor and i.provider='google') then
    raise exception 'trusted Google identity required' using errcode='42501';
  end if;
  return v_actor;
end $$;

create function private.benefit_company_add_text(p_value text,p_name text,p_max integer,p_nullable boolean default true)
returns text language plpgsql immutable set search_path='' as $$
declare v_value text;
begin
  if p_value is null then if p_nullable then return null; end if; raise exception 'invalid %',p_name using errcode='22023'; end if;
  if pg_catalog.char_length(p_value)>p_max or pg_catalog.octet_length(p_value)>p_max*4 then raise exception 'invalid %',p_name using errcode='22023'; end if;
  v_value:=pg_catalog.regexp_replace(pg_catalog.btrim(p_value),'[[:space:]]+',' ','g');
  if v_value='' then if p_nullable then return null; end if; raise exception 'invalid %',p_name using errcode='22023'; end if;
  return v_value;
end $$;

create function private.benefit_company_add_website(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v text:=pg_catalog.btrim(p_value); v_authority text; v_host text; v_port text;
begin
  if p_value is null then return null; end if;
  if pg_catalog.char_length(p_value)>2048 or pg_catalog.octet_length(p_value)>8192 or pg_catalog.char_length(v)<9 or v !~ '^https://[^/?#]+(?:[/?#].*)?$' or v ~ '[[:space:][:cntrl:]]' then raise exception 'invalid company website' using errcode='22023'; end if;
  v_authority:=(pg_catalog.regexp_match(v,'^https://([^/?#]+)'))[1];
  if v_authority is null or pg_catalog.strpos(v_authority,'@')>0 or pg_catalog.strpos(v_authority,'[')>0 or pg_catalog.strpos(v_authority,']')>0 or v_authority !~ '^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' then raise exception 'invalid company website' using errcode='22023'; end if;
  v_host:=pg_catalog.lower(pg_catalog.split_part(v_authority,':',1)); v_port:=nullif(pg_catalog.split_part(v_authority,':',2),'');
  if v_port is not null and v_port::integer not between 1 and 65535 then raise exception 'invalid company website' using errcode='22023'; end if;
  if v_host='localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal' or v_host like '%.test' or v_host like '%.invalid' or v_host ~ '^[0-9.]+' or v_host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$' then raise exception 'invalid company website' using errcode='22023'; end if;
  return v;
end $$;

create function private.benefit_company_add_fingerprint(p_method text,p_name text,p_region text,p_industry text,p_website text)
returns text language sql immutable set search_path='' as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('verification_method',p_method,'proposed_name',p_name,'region',p_region,'industry',p_industry,'website',p_website)::text,'UTF8'),'sha256'),'hex')
$$;

create function private.benefit_company_request_owner_item(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('request_id',r.request_id,'proposed_name',r.proposed_name,'region',r.region,'industry',r.industry,'website',r.website,'verification_status',r.verification_status,'status',r.status,'revision',r.revision,'resolved_company_id',r.resolved_company_id,'created_at',r.created_at,'updated_at',r.updated_at)
 from public.benefit_company_add_requests r where r.request_id=p_request_id
$$;

create function private.benefit_company_request_admin_item(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.benefit_company_request_owner_item(r.request_id)||pg_catalog.jsonb_build_object('verification_method',r.verification_method)
 from public.benefit_company_add_requests r where r.request_id=p_request_id
$$;

create function private.enforce_benefit_company_add_request_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.requester_id is distinct from old.requester_id or new.client_key is distinct from old.client_key or new.payload_fingerprint is distinct from old.payload_fingerprint
     or new.proposed_name is distinct from old.proposed_name or new.normalized_name is distinct from old.normalized_name or new.region is distinct from old.region
     or new.industry is distinct from old.industry or new.website is distinct from old.website or new.verification_method is distinct from old.verification_method or new.created_at is distinct from old.created_at then
    raise exception 'benefit company request payload is immutable' using errcode='23514';
  end if;
  if old.status<>'pending_review' and new is distinct from old then raise exception 'terminal benefit company request is immutable' using errcode='23514'; end if;
  if new.status is distinct from old.status and not (old.status='pending_review' and new.status in ('approved','rejected','merged')) then raise exception 'illegal benefit company request transition' using errcode='23514'; end if;
  if new.status is distinct from old.status then
    if new.revision<>old.revision+1 then raise exception 'benefit company request revision must increment once' using errcode='23514'; end if;
  elsif new.revision is distinct from old.revision then
    raise exception 'benefit company request revision changes only on transition' using errcode='23514';
  end if;
  return new;
end $$;
create trigger benefit_company_add_requests_enforce_update before update on public.benefit_company_add_requests for each row execute function private.enforce_benefit_company_add_request_update();

create function private.reject_benefit_company_add_event_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'benefit company add events are append-only' using errcode='23514'; end$$;
create trigger benefit_company_add_events_append_only_row before update or delete on public.benefit_company_add_events for each row execute function private.reject_benefit_company_add_event_change();
create trigger benefit_company_add_events_append_only_truncate before truncate on public.benefit_company_add_events for each statement execute function private.reject_benefit_company_add_event_change();

create function private.create_benefit_company_request(p_method text,p_client_key uuid,p_name text,p_region text,p_industry text,p_website text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_name text; v_normalized text; v_region text; v_industry text; v_website text; v_fingerprint text; v_request public.benefit_company_add_requests%rowtype;
begin
  perform private.require_read_committed();
  perform private.require_benefit_features(case when p_method='nts_full' then array['company_add_write_enabled','nts_verification_enabled'] else array['company_add_write_enabled'] end);
  v_actor:=private.require_google_user();
  if p_method not in ('manual','nts_full') then raise exception 'invalid verification method' using errcode='22023'; end if;
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  v_name:=private.benefit_company_add_text(p_name,'proposed name',200,false);
  v_normalized:=private.normalize_benefit_company_search(v_name);
  v_region:=private.benefit_company_add_text(p_region,'region',100,true);
  v_industry:=private.benefit_company_add_text(p_industry,'industry',100,true);
  v_website:=private.benefit_company_add_website(p_website);
  v_fingerprint:=private.benefit_company_add_fingerprint(p_method,v_name,v_region,v_industry,v_website);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-company-add:create:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_request from public.benefit_company_add_requests where requester_id=v_actor and client_key=p_client_key;
  if found then
    if v_request.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_company_request_owner_item(v_request.request_id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_company_add.create',p_client_key::text);
  insert into public.benefit_company_add_requests(requester_id,client_key,payload_fingerprint,proposed_name,normalized_name,region,industry,website,verification_method)
  values(v_actor,p_client_key,v_fingerprint,v_name,v_normalized,v_region,v_industry,v_website,p_method) returning * into v_request;
  insert into public.benefit_company_add_events(request_id,actor_kind,actor_id,action,to_status,metadata)
  values(v_request.request_id,'requester',v_actor,case when p_method='manual' then 'requested' else 'reserved' end,'pending_review','{}');
  return private.benefit_company_request_owner_item(v_request.request_id);
end $$;

create function public.create_manual_benefit_company_request_v1(p_client_key uuid,p_proposed_name text,p_region text default null,p_industry text default null,p_website text default null)
returns jsonb language sql volatile security definer set search_path='' as $$select private.create_benefit_company_request('manual',p_client_key,p_proposed_name,p_region,p_industry,p_website)$$;
create function public.reserve_benefit_company_nts_request_v1(p_client_key uuid,p_proposed_name text,p_region text default null,p_industry text default null,p_website text default null)
returns jsonb language sql volatile security definer set search_path='' as $$select private.create_benefit_company_request('nts_full',p_client_key,p_proposed_name,p_region,p_industry,p_website)$$;

create function public.list_my_benefit_company_requests_v1(p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_actor uuid; v_items jsonb; v_more boolean; v_next jsonb;
begin
 v_actor:=private.require_user();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
 if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with candidates as materialized (select r.request_id,r.created_at,private.benefit_company_request_owner_item(r.request_id) item from public.benefit_company_add_requests r where r.requester_id=v_actor and (p_cursor_created_at is null or (r.created_at,r.request_id)<(p_cursor_created_at,p_cursor_id)) order by r.created_at desc,r.request_id desc limit p_limit+1),
 page as (select * from candidates order by created_at desc,request_id desc limit p_limit)
 select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,request_id desc),'[]'),(select count(*)>p_limit from candidates),case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'request_id',request_id) from page order by created_at,request_id limit 1) else 'null'::jsonb end into v_items,v_more,v_next from page;
 return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_more,'next_cursor',v_next);
end$$;

create function public.list_benefit_company_request_queue_v1(p_status text default 'pending_review',p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_items jsonb; v_more boolean; v_next jsonb;
begin
 perform private.require_admin();
 if p_status is null or p_status not in ('pending_review','approved','rejected','merged','all') then raise exception 'invalid company request status filter' using errcode='22023'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
 if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with candidates as materialized (select r.request_id,r.created_at,private.benefit_company_request_admin_item(r.request_id) item from public.benefit_company_add_requests r where (p_status='all' or r.status=p_status) and (p_cursor_created_at is null or (r.created_at,r.request_id)<(p_cursor_created_at,p_cursor_id)) order by r.created_at desc,r.request_id desc limit p_limit+1),
 page as (select * from candidates order by created_at desc,request_id desc limit p_limit)
 select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,request_id desc),'[]'),(select count(*)>p_limit from candidates),case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'request_id',request_id) from page order by created_at,request_id limit 1) else 'null'::jsonb end into v_items,v_more,v_next from page;
 return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_more,'next_cursor',v_next);
end$$;

create function private.new_opaque_benefit_company_id()
returns text language sql volatile set search_path='' as $$select 'KR-CAN-'||pg_catalog.encode(extensions.gen_random_bytes(16),'hex')$$;

create function public.review_benefit_company_request_v1(p_request_id uuid,p_expected_status text,p_expected_revision bigint,p_action text,p_reason text,p_destination_company_id text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_request public.benefit_company_add_requests%rowtype; v_reason text; v_company text; v_now timestamptz; v_action text;
begin
 perform private.require_read_committed(); perform private.require_benefit_features(array['company_add_write_enabled']); v_actor:=private.require_admin();
 if p_request_id is null then raise exception 'request id is required' using errcode='22023'; end if;
 if p_expected_status is null or p_expected_status<>'pending_review' then raise exception 'invalid expected company request status' using errcode='22023'; end if;
 if p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid expected company request revision' using errcode='22023'; end if;
 if p_action is null or p_action not in ('approve','reject','merge') then raise exception 'company request review action not allowed' using errcode='22023'; end if;
 v_reason:=private.benefit_company_add_text(p_reason,'review reason',1000,false);
 select * into v_request from public.benefit_company_add_requests where request_id=p_request_id for update;
 if not found then raise exception 'benefit company request not found' using errcode='22023'; end if;
 if v_request.status is distinct from p_expected_status or v_request.revision is distinct from p_expected_revision then raise exception 'benefit company request state changed' using errcode='40001'; end if;
 if v_request.verification_method<>'manual' then raise exception 'NTS requests require service finalization' using errcode='42501'; end if;
 perform private.consume_rate_limit(v_actor,'benefit_company_add.review',p_request_id::text||':'||p_action);
 v_now:=pg_catalog.clock_timestamp();
 if p_action='approve' then
   if p_destination_company_id is not null then raise exception 'approval destination must be null' using errcode='22023'; end if;
   v_company:=private.new_opaque_benefit_company_id();
   insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,industry,region,is_searchable,source_edition,provenance)
   values(v_company,'registered_business',v_request.proposed_name,v_request.normalized_name,v_request.industry,v_request.region,true,'community-reviewed',pg_catalog.jsonb_build_object('company_add_request_id',v_request.request_id));
   v_action:='approved';
 elsif p_action='merge' then
   if p_destination_company_id is null or not private.is_benefit_company_id(p_destination_company_id) or not exists(select 1 from public.benefit_companies c where c.company_id=p_destination_company_id and c.is_searchable for share) then raise exception 'merge destination must be canonical and searchable' using errcode='22023'; end if;
   v_company:=p_destination_company_id; v_action:='merged';
 else
   if p_destination_company_id is not null then raise exception 'rejection destination must be null' using errcode='22023'; end if; v_action:='rejected';
 end if;
 update public.benefit_company_add_requests set verification_status=case when p_action='reject' then 'rejected' else 'matched' end,status=v_action,revision=revision+1,resolved_company_id=v_company,reviewer_id=v_actor,processed_at=v_now,updated_at=v_now where request_id=p_request_id;
 insert into public.benefit_company_add_events(request_id,actor_kind,actor_id,action,from_status,to_status,resolved_company_id,verification_category,metadata)
 values(p_request_id,'admin',v_actor,v_action,'pending_review',v_action,v_company,case when p_action='reject' then 'rejected' end,pg_catalog.jsonb_build_object('reason',v_reason));
 return private.benefit_company_request_admin_item(p_request_id);
end$$;

create function private.require_service_role()
returns void language plpgsql stable set search_path='' as $$begin if pg_catalog.current_setting('role',true)<>'service_role' then raise exception 'service operator required' using errcode='42501'; end if; end$$;

-- Task 3 contract: the browser-authenticated reserve call derives auth.uid() and
-- persists the immutable safe payload before any external request. The Edge
-- service recomputes that safe fingerprint from the same bounded fields and may
-- finalize only by immutable request ID + expected state + fingerprint + HMAC.
-- No service function accepts a requester UUID, and no raw NTS value crosses
-- this storage boundary.
create function public.finalize_benefit_company_nts_request_v1(p_request_id uuid,p_expected_verification_status text,p_payload_fingerprint text,p_business_number_digest text,p_external_verified_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_request public.benefit_company_add_requests%rowtype; v_existing text; v_company text; v_now timestamptz; v_status text;
begin
 perform private.require_read_committed(); perform private.require_service_role(); perform private.require_benefit_features(array['company_add_write_enabled','nts_verification_enabled']);
 if p_request_id is null or p_expected_verification_status is null or p_expected_verification_status<>'pending' then raise exception 'invalid expected NTS state' using errcode='22023'; end if;
 if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid safe payload fingerprint' using errcode='22023'; end if;
 if p_business_number_digest is null or p_business_number_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid business number digest' using errcode='22023'; end if;
 if p_external_verified_at is null or not pg_catalog.isfinite(p_external_verified_at) then raise exception 'invalid external verification time' using errcode='22023'; end if;
 select * into v_request from public.benefit_company_add_requests where request_id=p_request_id for update;
 if not found then raise exception 'benefit company request not found' using errcode='22023'; end if;
 if v_request.verification_method<>'nts_full' then raise exception 'request is not NTS verification' using errcode='22023'; end if;
 if v_request.status<>'pending_review' or v_request.verification_status is distinct from p_expected_verification_status then raise exception 'benefit company request state changed' using errcode='40001'; end if;
 if v_request.payload_fingerprint<>p_payload_fingerprint then raise exception 'safe payload fingerprint mismatch' using errcode='22023'; end if;
 if p_external_verified_at<v_request.created_at or p_external_verified_at>pg_catalog.clock_timestamp()+interval '5 minutes' then raise exception 'invalid external verification time' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-company-add:business-digest:'||p_business_number_digest,0));
 select i.company_id into v_existing from public.benefit_company_identifiers i where i.identifier_type='business_number_hmac_v1' and i.identifier_digest_or_value=p_business_number_digest;
 v_now:=pg_catalog.clock_timestamp();
 if v_existing is not null then v_company:=v_existing; v_status:='merged';
 else
   v_company:=private.new_opaque_benefit_company_id(); v_status:='approved';
   insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,industry,region,is_searchable,source_edition,provenance)
   values(v_company,'registered_business',v_request.proposed_name,v_request.normalized_name,v_request.industry,v_request.region,true,'nts-verified',pg_catalog.jsonb_build_object('company_add_request_id',v_request.request_id));
   insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at)
   values(v_company,'business_number_hmac_v1',p_business_number_digest,'nts-verification-v1',p_external_verified_at);
 end if;
 update public.benefit_company_add_requests set verification_status='matched',business_number_digest=p_business_number_digest,external_verified_at=p_external_verified_at,status=v_status,revision=revision+1,resolved_company_id=v_company,processed_at=v_now,updated_at=v_now where request_id=p_request_id;
 insert into public.benefit_company_add_events(request_id,actor_kind,action,from_status,to_status,resolved_company_id,metadata)
 values(p_request_id,'service_role',case when v_status='approved' then 'approved' else 'merged' end,'pending_review',v_status,v_company,'{}');
 return private.benefit_company_request_admin_item(p_request_id);
end$$;

create function public.fail_benefit_company_nts_request_v1(p_request_id uuid,p_expected_verification_status text,p_payload_fingerprint text,p_failure_category text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_request public.benefit_company_add_requests%rowtype; v_now timestamptz;
begin
 perform private.require_read_committed(); perform private.require_service_role(); perform private.require_benefit_features(array['company_add_write_enabled','nts_verification_enabled']);
 if p_request_id is null or p_expected_verification_status is null or p_expected_verification_status<>'pending' then raise exception 'invalid expected NTS state' using errcode='22023'; end if;
 if p_payload_fingerprint is null or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid safe payload fingerprint' using errcode='22023'; end if;
 if p_failure_category is null or p_failure_category not in ('mismatched','unavailable','rejected') then raise exception 'invalid NTS failure category' using errcode='22023'; end if;
 select * into v_request from public.benefit_company_add_requests where request_id=p_request_id for update;
 if not found then raise exception 'benefit company request not found' using errcode='22023'; end if;
 if v_request.verification_method<>'nts_full' or v_request.status<>'pending_review' or v_request.verification_status is distinct from p_expected_verification_status then raise exception 'benefit company request state changed' using errcode='40001'; end if;
 if v_request.payload_fingerprint<>p_payload_fingerprint then raise exception 'safe payload fingerprint mismatch' using errcode='22023'; end if;
 v_now:=pg_catalog.clock_timestamp();
 update public.benefit_company_add_requests set verification_status=p_failure_category,status='rejected',revision=revision+1,processed_at=v_now,updated_at=v_now where request_id=p_request_id;
 insert into public.benefit_company_add_events(request_id,actor_kind,action,from_status,to_status,verification_category,metadata) values(p_request_id,'service_role','verification_failed','pending_review','rejected',p_failure_category,'{}');
 return private.benefit_company_request_admin_item(p_request_id);
end$$;

alter function private.require_benefit_features(text[]) owner to postgres;
alter function private.require_google_user() owner to postgres;
alter function private.benefit_company_add_text(text,text,integer,boolean) owner to postgres;
alter function private.benefit_company_add_website(text) owner to postgres;
alter function private.benefit_company_add_fingerprint(text,text,text,text,text) owner to postgres;
alter function private.benefit_company_request_owner_item(uuid) owner to postgres;
alter function private.benefit_company_request_admin_item(uuid) owner to postgres;
alter function private.enforce_benefit_company_add_request_update() owner to postgres;
alter function private.reject_benefit_company_add_event_change() owner to postgres;
alter function private.create_benefit_company_request(text,uuid,text,text,text,text) owner to postgres;
alter function private.new_opaque_benefit_company_id() owner to postgres;
alter function private.require_service_role() owner to postgres;
alter function public.create_manual_benefit_company_request_v1(uuid,text,text,text,text) owner to postgres;
alter function public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text) owner to postgres;
alter function public.list_my_benefit_company_requests_v1(integer,timestamptz,uuid) owner to postgres;
alter function public.list_benefit_company_request_queue_v1(text,integer,timestamptz,uuid) owner to postgres;
alter function public.review_benefit_company_request_v1(uuid,text,bigint,text,text,text) owner to postgres;
alter function public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz) owner to postgres;
alter function public.fail_benefit_company_nts_request_v1(uuid,text,text,text) owner to postgres;

revoke all on function private.require_benefit_features(text[]),private.require_google_user(),private.benefit_company_add_text(text,text,integer,boolean),private.benefit_company_add_website(text),private.benefit_company_add_fingerprint(text,text,text,text,text),private.benefit_company_request_owner_item(uuid),private.benefit_company_request_admin_item(uuid),private.enforce_benefit_company_add_request_update(),private.reject_benefit_company_add_event_change(),private.create_benefit_company_request(text,uuid,text,text,text,text),private.new_opaque_benefit_company_id(),private.require_service_role() from public,anon,authenticated,service_role;
revoke all on function public.create_manual_benefit_company_request_v1(uuid,text,text,text,text),public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text),public.list_my_benefit_company_requests_v1(integer,timestamptz,uuid),public.list_benefit_company_request_queue_v1(text,integer,timestamptz,uuid),public.review_benefit_company_request_v1(uuid,text,bigint,text,text,text),public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz),public.fail_benefit_company_nts_request_v1(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_manual_benefit_company_request_v1(uuid,text,text,text,text),public.reserve_benefit_company_nts_request_v1(uuid,text,text,text,text),public.list_my_benefit_company_requests_v1(integer,timestamptz,uuid),public.list_benefit_company_request_queue_v1(text,integer,timestamptz,uuid),public.review_benefit_company_request_v1(uuid,text,bigint,text,text,text) to authenticated;
grant execute on function public.finalize_benefit_company_nts_request_v1(uuid,text,text,text,timestamptz),public.fail_benefit_company_nts_request_v1(uuid,text,text,text) to service_role;

commit;
