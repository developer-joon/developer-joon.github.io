-- Dedicated company-benefit correction request, moderation, and application boundary.
begin;

insert into public.rate_limit_rules(id,action,window_seconds,max_requests,is_enabled)
values
  ('d0000000-0000-0000-0000-000000000001','benefit_correction.create',3600,5,true),
  ('d0000000-0000-0000-0000-000000000002','benefit_correction.review',3600,100,true),
  ('d0000000-0000-0000-0000-000000000003','benefit_correction.apply',3600,100,true)
on conflict(action,window_seconds) do update
set max_requests=excluded.max_requests,is_enabled=excluded.is_enabled,updated_at=pg_catalog.clock_timestamp();

create table public.benefit_correction_requests (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references public.profiles(id) on delete restrict,
  client_key uuid not null,
  payload_fingerprint text not null,
  company_id text not null,
  category_id text not null,
  current_text text not null,
  proposed_text text not null,
  scope_text text not null,
  source_url text not null,
  observed_data_version text not null,
  status text not null default 'submitted',
  admin_response text,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  applied_data_version text,
  applied_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(submitter_id,client_key),
  constraint benefit_correction_requests_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint benefit_correction_requests_company_check check (company_id ~ '^(KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$'),
  constraint benefit_correction_requests_category_check check (category_id in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion')),
  constraint benefit_correction_requests_current_check check (char_length(current_text) between 1 and 5000 and current_text=btrim(current_text)),
  constraint benefit_correction_requests_proposed_check check (char_length(proposed_text) between 1 and 5000 and proposed_text=btrim(proposed_text)),
  constraint benefit_correction_requests_scope_check check (char_length(scope_text) between 1 and 2000 and scope_text=btrim(scope_text)),
  constraint benefit_correction_requests_source_check check (char_length(source_url) between 9 and 2048 and source_url=btrim(source_url)),
  constraint benefit_correction_requests_observed_version_check check (char_length(observed_data_version) between 30 and 100 and observed_data_version=btrim(observed_data_version)),
  constraint benefit_correction_requests_status_check check (status in ('submitted','reviewing','approved','rejected','applied')),
  constraint benefit_correction_requests_response_check check (admin_response is null or (char_length(admin_response) between 1 and 2000 and admin_response=btrim(admin_response))),
  constraint benefit_correction_requests_applied_version_check check (applied_data_version is null or (char_length(applied_data_version) between 30 and 100 and applied_data_version=btrim(applied_data_version))),
  constraint benefit_correction_requests_state_check check (
    (status='submitted' and admin_response is null and reviewer_id is null and reviewed_at is null and applied_data_version is null and applied_at is null)
    or (status in ('reviewing','approved','rejected') and admin_response is not null and reviewer_id is not null and reviewed_at is not null and applied_data_version is null and applied_at is null)
    or (status='applied' and admin_response is not null and reviewer_id is not null and reviewed_at is not null and applied_data_version is not null and applied_at is not null)
  ),
  constraint benefit_correction_requests_timestamps_check check (
    updated_at>=created_at and (reviewed_at is null or reviewed_at>=created_at) and (applied_at is null or applied_at>=reviewed_at)
  )
);

create table public.benefit_correction_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.benefit_correction_requests(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  operation text not null,
  client_key uuid not null,
  payload_fingerprint text not null,
  action text not null,
  from_status text,
  to_status text not null,
  response_text text,
  applied_data_version text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(actor_id,operation,client_key),
  constraint benefit_correction_events_operation_check check (operation in ('create','review','apply')),
  constraint benefit_correction_events_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{32}$'),
  constraint benefit_correction_events_action_check check (action in ('submitted','start_review','additional_material_requested','approved','rejected','applied')),
  constraint benefit_correction_events_from_status_check check (from_status is null or from_status in ('submitted','reviewing','approved','rejected','applied')),
  constraint benefit_correction_events_to_status_check check (to_status in ('submitted','reviewing','approved','rejected','applied')),
  constraint benefit_correction_events_response_check check (response_text is null or char_length(response_text) between 1 and 2000),
  constraint benefit_correction_events_version_check check (applied_data_version is null or char_length(applied_data_version) between 30 and 100),
  constraint benefit_correction_events_shape_check check (
    (operation='create' and action='submitted' and from_status is null and to_status='submitted' and response_text is null and applied_data_version is null)
    or (operation='review' and action='start_review' and from_status='submitted' and to_status='reviewing' and response_text is not null and applied_data_version is null)
    or (operation='review' and action='additional_material_requested' and from_status='reviewing' and to_status='reviewing' and response_text is not null and applied_data_version is null)
    or (operation='review' and action in ('approved','rejected') and from_status='reviewing' and to_status=case action when 'approved' then 'approved' else 'rejected' end and response_text is not null and applied_data_version is null)
    or (operation='apply' and action='applied' and from_status='approved' and to_status='applied' and response_text is null and applied_data_version is not null)
  )
);

create index benefit_correction_requests_owner_created_idx
  on public.benefit_correction_requests(submitter_id,created_at desc,id desc);
create index benefit_correction_requests_active_queue_idx
  on public.benefit_correction_requests(created_at desc,id desc)
  where status in ('submitted','reviewing','approved');
create index benefit_correction_requests_queue_idx
  on public.benefit_correction_requests(created_at desc,id desc);
create index benefit_correction_requests_status_queue_idx
  on public.benefit_correction_requests(status,created_at desc,id desc);
create index benefit_correction_events_request_idx
  on public.benefit_correction_events(request_id,created_at,id);

alter table public.benefit_correction_requests enable row level security;
alter table public.benefit_correction_events enable row level security;
revoke all on table public.benefit_correction_requests,public.benefit_correction_events from public,anon,authenticated,service_role;

create function private.benefit_correction_text(p_value text,p_name text,p_max integer)
returns text language plpgsql immutable set search_path='' as $$
declare v_value text:=pg_catalog.btrim(p_value);
begin
  if p_value is null or pg_catalog.char_length(p_value)>p_max or v_value='' then
    raise exception 'invalid %',p_name using errcode='22023';
  end if;
  return v_value;
end $$;

create function private.benefit_correction_data_version(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v_value text:=pg_catalog.btrim(p_value); v_date text;
begin
  if p_value is null or pg_catalog.char_length(p_value)>100 or v_value !~ '^company-benefits-[0-9]{4}-[0-9]{2}-[0-9]{2}-v[1-9][0-9]*$' then
    raise exception 'invalid data version' using errcode='22023';
  end if;
  v_date:=pg_catalog.substr(v_value,18,10);
  begin
    if pg_catalog.to_char(pg_catalog.to_date(v_date,'FXYYYY-MM-DD'),'YYYY-MM-DD')<>v_date then
      raise exception 'invalid data version' using errcode='22023';
    end if;
  exception when datetime_field_overflow then
    raise exception 'invalid data version' using errcode='22023';
  end;
  return v_value;
end $$;

create function private.benefit_correction_source_url(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare
  v_value text:=pg_catalog.btrim(p_value); v_authority text; v_host text; v_port text;
begin
  if p_value is null or pg_catalog.char_length(p_value)>2048 or pg_catalog.char_length(v_value)<9
     or v_value !~ '^https://[^/?#]+(?:[/?#].*)?$' or v_value ~ '[[:space:][:cntrl:]]' then
    raise exception 'invalid public source URL' using errcode='22023';
  end if;
  v_authority:=(pg_catalog.regexp_match(v_value,'^https://([^/?#]+)'))[1];
  if v_authority is null or pg_catalog.strpos(v_authority,'@')>0 or pg_catalog.strpos(v_authority,'[')>0 or pg_catalog.strpos(v_authority,']')>0
     or v_authority !~ '^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' then
    raise exception 'invalid public source URL' using errcode='22023';
  end if;
  v_host:=pg_catalog.lower(pg_catalog.split_part(v_authority,':',1));
  v_port:=nullif(pg_catalog.split_part(v_authority,':',2),'');
  if v_port is not null and v_port::integer not between 1 and 65535 then
    raise exception 'invalid public source URL' using errcode='22023';
  end if;
  if v_host='localhost' or v_host like '%.localhost' or v_host like '%.local'
     or v_host like '%.internal' or v_host like '%.test' or v_host like '%.invalid'
     or v_host ~ '^[0-9.]+$'
     or v_host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'invalid public source URL' using errcode='22023';
  end if;
  return v_value;
end $$;

alter table public.benefit_correction_requests
  add constraint benefit_correction_requests_public_source_check
    check (source_url=private.benefit_correction_source_url(source_url)),
  add constraint benefit_correction_requests_valid_observed_version_check
    check (observed_data_version=private.benefit_correction_data_version(observed_data_version)),
  add constraint benefit_correction_requests_valid_applied_version_check
    check (applied_data_version is null or applied_data_version=private.benefit_correction_data_version(applied_data_version));

create function private.benefit_correction_owner_item(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',r.id,'company_id',r.company_id,'category_id',r.category_id,
    'current_text',r.current_text,'proposed_text',r.proposed_text,'scope_text',r.scope_text,
    'source_url',r.source_url,'observed_data_version',r.observed_data_version,
    'status',r.status,'admin_response',r.admin_response,
    'applied_data_version',r.applied_data_version,'applied_at',r.applied_at,
    'created_at',r.created_at,'updated_at',r.updated_at)
  from public.benefit_correction_requests r where r.id=p_request_id
$$;

create function private.benefit_correction_admin_item(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.benefit_correction_owner_item(r.id)||pg_catalog.jsonb_build_object(
    'submitter_id',r.submitter_id,'reviewer_id',r.reviewer_id,'reviewed_at',r.reviewed_at)
  from public.benefit_correction_requests r where r.id=p_request_id
$$;

create function private.enforce_benefit_correction_request_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.submitter_id is distinct from old.submitter_id or new.client_key is distinct from old.client_key
     or new.payload_fingerprint is distinct from old.payload_fingerprint or new.company_id is distinct from old.company_id
     or new.category_id is distinct from old.category_id or new.current_text is distinct from old.current_text
     or new.proposed_text is distinct from old.proposed_text or new.scope_text is distinct from old.scope_text
     or new.source_url is distinct from old.source_url or new.observed_data_version is distinct from old.observed_data_version
     or new.created_at is distinct from old.created_at then
    raise exception 'correction submitted payload is immutable' using errcode='23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='submitted' and new.status='reviewing')
    or (old.status='reviewing' and new.status in ('approved','rejected'))
    or (old.status='approved' and new.status='applied')
  ) then
    raise exception 'illegal correction status transition' using errcode='23514';
  end if;
  if new.applied_data_version is distinct from old.applied_data_version or new.applied_at is distinct from old.applied_at then
    if not (old.status='approved' and new.status='applied') then
      raise exception 'correction application fields may change only on applied transition' using errcode='23514';
    end if;
  end if;
  if old.status in ('approved','rejected','applied') and (
    new.admin_response is distinct from old.admin_response or new.reviewer_id is distinct from old.reviewer_id
    or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'terminal correction review fields are immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger benefit_correction_requests_enforce_update
before update on public.benefit_correction_requests
for each row execute function private.enforce_benefit_correction_request_update();

create function private.enforce_benefit_correction_event_append_only()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.actor_id is not null and new.actor_id is null
     and (pg_catalog.to_jsonb(new)-'actor_id')=(pg_catalog.to_jsonb(old)-'actor_id')
     and not exists(select 1 from public.profiles p where p.id=old.actor_id) then
    return new;
  end if;
  raise exception 'benefit correction events are append-only' using errcode='23514';
end $$;
create trigger benefit_correction_events_append_only_row
before update or delete on public.benefit_correction_events
for each row execute function private.enforce_benefit_correction_event_append_only();
create trigger benefit_correction_events_append_only_truncate
before truncate on public.benefit_correction_events
for each statement execute function private.enforce_benefit_correction_event_append_only();

create function public.create_benefit_correction_request_v1(
  p_client_key uuid,p_company_id text,p_category_id text,p_current_text text,
  p_proposed_text text,p_scope_text text,p_source_url text,p_observed_data_version text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_company text:=pg_catalog.btrim(p_company_id); v_category text:=pg_catalog.lower(pg_catalog.btrim(p_category_id));
  v_current text; v_proposed text; v_scope text; v_url text; v_version text; v_fingerprint text;
  v_request public.benefit_correction_requests%rowtype;
begin
  perform private.require_read_committed(); v_actor:=private.require_user();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or v_company !~ '^(KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$' then raise exception 'invalid company id' using errcode='22023'; end if;
  if p_category_id is null or pg_catalog.char_length(p_category_id)>20 or v_category not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion') then raise exception 'invalid category id' using errcode='22023'; end if;
  v_current:=private.benefit_correction_text(p_current_text,'current text',5000);
  v_proposed:=private.benefit_correction_text(p_proposed_text,'proposed text',5000);
  v_scope:=private.benefit_correction_text(p_scope_text,'scope text',2000);
  v_url:=private.benefit_correction_source_url(p_source_url);
  v_version:=private.benefit_correction_data_version(p_observed_data_version);
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object('company_id',v_company,'category_id',v_category,'current_text',v_current,'proposed_text',v_proposed,'scope_text',v_scope,'source_url',v_url,'observed_data_version',v_version)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-correction:create:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_request from public.benefit_correction_requests where submitter_id=v_actor and client_key=p_client_key;
  if found then
    if v_request.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_correction_owner_item(v_request.id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_correction.create',p_client_key::text);
  insert into public.benefit_correction_requests(submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version)
  values(v_actor,p_client_key,v_fingerprint,v_company,v_category,v_current,v_proposed,v_scope,v_url,v_version) returning * into v_request;
  insert into public.benefit_correction_events(request_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status)
  values(v_request.id,v_actor,'create',p_client_key,v_fingerprint,'submitted',null,'submitted');
  return private.benefit_correction_owner_item(v_request.id);
end $$;

create function public.list_my_benefit_correction_requests_v1(
  p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_actor uuid; v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  v_actor:=private.require_user();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  with candidates as materialized (
    select r.id,r.created_at,private.benefit_correction_owner_item(r.id) item
    from public.benefit_correction_requests r where r.submitter_id=v_actor
      and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
    (select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.list_benefit_correction_queue_v1(
  p_status text default 'active',p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('active','submitted','reviewing','approved','rejected','applied','all') then raise exception 'invalid correction status filter' using errcode='22023'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  with candidates as materialized (
    select r.id,r.created_at,private.benefit_correction_admin_item(r.id) item
    from public.benefit_correction_requests r
    where (p_status='all' or (p_status='active' and r.status in ('submitted','reviewing','approved')) or r.status=p_status)
      and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
    (select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.review_benefit_correction_request_v1(
  p_request_id uuid,p_expected_status text,p_action text,p_admin_response text,p_client_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_response text; v_fingerprint text; v_event public.benefit_correction_events%rowtype;
  v_request public.benefit_correction_requests%rowtype; v_desired text; v_event_action text; v_now timestamptz;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_expected_status is null or p_expected_status not in ('submitted','reviewing') then raise exception 'invalid expected correction status' using errcode='22023'; end if;
  if p_action is null or p_action not in ('start_review','request_additional_material','approve','reject') then raise exception 'correction review action not allowed' using errcode='22023'; end if;
  v_response:=private.benefit_correction_text(p_admin_response,'admin response',2000);
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object('request_id',p_request_id,'expected_status',p_expected_status,'action',p_action,'admin_response',v_response)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-correction:review:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_event from public.benefit_correction_events where actor_id=v_actor and operation='review' and client_key=p_client_key;
  if found then
    if v_event.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_correction_admin_item(v_event.request_id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_correction.review',p_client_key::text);
  select * into v_request from public.benefit_correction_requests where id=p_request_id for update;
  if not found then raise exception 'correction request not found' using errcode='22023'; end if;
  if v_request.status is distinct from p_expected_status then raise exception 'correction state changed' using errcode='40001'; end if;
  if p_action='start_review' and v_request.status='submitted' then v_desired:='reviewing'; v_event_action:='start_review';
  elsif p_action='request_additional_material' and v_request.status='reviewing' then v_desired:='reviewing'; v_event_action:='additional_material_requested';
  elsif p_action='approve' and v_request.status='reviewing' then v_desired:='approved'; v_event_action:='approved';
  elsif p_action='reject' and v_request.status='reviewing' then v_desired:='rejected'; v_event_action:='rejected';
  else raise exception 'correction review action not allowed' using errcode='22023'; end if;
  v_now:=pg_catalog.clock_timestamp();
  update public.benefit_correction_requests set status=v_desired,admin_response=v_response,reviewer_id=v_actor,reviewed_at=v_now,updated_at=v_now where id=p_request_id;
  insert into public.benefit_correction_events(request_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status,response_text)
  values(p_request_id,v_actor,'review',p_client_key,v_fingerprint,v_event_action,v_request.status,v_desired,v_response);
  return private.benefit_correction_admin_item(p_request_id);
end $$;

create function public.mark_benefit_correction_applied_v1(
  p_request_id uuid,p_expected_status text,p_applied_data_version text,p_client_key uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_version text; v_fingerprint text; v_event public.benefit_correction_events%rowtype;
  v_request public.benefit_correction_requests%rowtype; v_now timestamptz;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_expected_status is null or p_expected_status<>'approved' then raise exception 'invalid expected correction status' using errcode='22023'; end if;
  v_version:=private.benefit_correction_data_version(p_applied_data_version);
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object('request_id',p_request_id,'expected_status',p_expected_status,'applied_data_version',v_version)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-correction:apply:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_event from public.benefit_correction_events where actor_id=v_actor and operation='apply' and client_key=p_client_key;
  if found then
    if v_event.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_correction_admin_item(v_event.request_id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_correction.apply',p_client_key::text);
  select * into v_request from public.benefit_correction_requests where id=p_request_id for update;
  if not found then raise exception 'correction request not found' using errcode='22023'; end if;
  if v_request.status is distinct from p_expected_status then raise exception 'correction state changed' using errcode='40001'; end if;
  v_now:=pg_catalog.clock_timestamp();
  update public.benefit_correction_requests set status='applied',applied_data_version=v_version,applied_at=v_now,updated_at=v_now where id=p_request_id;
  insert into public.benefit_correction_events(request_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status,applied_data_version)
  values(p_request_id,v_actor,'apply',p_client_key,v_fingerprint,'applied',v_request.status,'applied',v_version);
  return private.benefit_correction_admin_item(p_request_id);
end $$;

alter function private.benefit_correction_text(text,text,integer) owner to postgres;
alter function private.benefit_correction_data_version(text) owner to postgres;
alter function private.benefit_correction_source_url(text) owner to postgres;
alter function private.benefit_correction_owner_item(uuid) owner to postgres;
alter function private.benefit_correction_admin_item(uuid) owner to postgres;
alter function private.enforce_benefit_correction_request_update() owner to postgres;
alter function private.enforce_benefit_correction_event_append_only() owner to postgres;
alter function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) owner to postgres;
alter function public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid) owner to postgres;
alter function public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid) owner to postgres;
alter function public.review_benefit_correction_request_v1(uuid,text,text,text,uuid) owner to postgres;
alter function public.mark_benefit_correction_applied_v1(uuid,text,text,uuid) owner to postgres;

revoke all on function private.benefit_correction_text(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function private.benefit_correction_data_version(text) from public,anon,authenticated,service_role;
revoke all on function private.benefit_correction_source_url(text) from public,anon,authenticated,service_role;
revoke all on function private.benefit_correction_owner_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.benefit_correction_admin_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.enforce_benefit_correction_request_update() from public,anon,authenticated,service_role;
revoke all on function private.enforce_benefit_correction_event_append_only() from public,anon,authenticated,service_role;
revoke all on function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.review_benefit_correction_request_v1(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.mark_benefit_correction_applied_v1(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_correction_request_v1(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.list_my_benefit_correction_requests_v1(integer,timestamptz,uuid) to authenticated;
grant execute on function public.list_benefit_correction_queue_v1(text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.review_benefit_correction_request_v1(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.mark_benefit_correction_applied_v1(uuid,text,text,uuid) to service_role;

commit;
