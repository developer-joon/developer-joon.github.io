-- Moderated user benefit submissions and atomic community publication.
begin;

insert into public.rate_limit_rules(id,action,window_seconds,max_requests,is_enabled)
values
  ('e0000000-0000-0000-0000-000000000001','benefit_submission.create',3600,5,true),
  ('e0000000-0000-0000-0000-000000000002','benefit_submission.review',3600,100,true)
on conflict(action,window_seconds) do update
set max_requests=excluded.max_requests,is_enabled=excluded.is_enabled,updated_at=pg_catalog.clock_timestamp();

create table public.benefit_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references public.profiles(id) on delete restrict,
  client_key uuid not null,
  payload_fingerprint text not null,
  company_id text not null references public.benefit_companies(company_id) on delete restrict,
  category_id text not null,
  benefit_text text not null,
  eligibility_text text,
  condition_text text,
  source_url text,
  status text not null default 'submitted',
  admin_response text,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(submitter_id,client_key),
  constraint benefit_submissions_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_submissions_category_check check (category_id in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion')),
  constraint benefit_submissions_benefit_check check (char_length(benefit_text) between 1 and 5000 and benefit_text=btrim(benefit_text)),
  constraint benefit_submissions_eligibility_check check (eligibility_text is null or (char_length(eligibility_text) between 1 and 2000 and eligibility_text=btrim(eligibility_text))),
  constraint benefit_submissions_condition_check check (condition_text is null or (char_length(condition_text) between 1 and 2000 and condition_text=btrim(condition_text))),
  constraint benefit_submissions_source_check check (source_url is null or (char_length(source_url) between 9 and 2048 and source_url=btrim(source_url))),
  constraint benefit_submissions_status_check check (status in ('submitted','reviewing','approved','rejected')),
  constraint benefit_submissions_response_check check (admin_response is null or (char_length(admin_response) between 1 and 2000 and admin_response=btrim(admin_response))),
  constraint benefit_submissions_state_check check (
    (status='submitted' and admin_response is null and reviewer_id is null and reviewed_at is null and publication_id is null)
    or (status='reviewing' and admin_response is not null and reviewer_id is not null and reviewed_at is not null and publication_id is null)
    or (status='approved' and admin_response is not null and reviewer_id is not null and reviewed_at is not null and publication_id is not null)
    or (status='rejected' and admin_response is not null and reviewer_id is not null and reviewed_at is not null and publication_id is null)
  ),
  constraint benefit_submissions_timestamps_check check (updated_at>=created_at and (reviewed_at is null or reviewed_at>=created_at))
);

create table public.benefit_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.benefit_submissions(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  client_key uuid not null,
  payload_fingerprint text not null,
  action text not null,
  from_status text,
  to_status text not null,
  response_text text,
  publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(actor_id,operation,client_key),
  constraint benefit_submission_events_operation_check check (operation in ('create','review')),
  constraint benefit_submission_events_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_submission_events_action_check check (action in ('submitted','start_review','additional_material_requested','approved','rejected')),
  constraint benefit_submission_events_status_check check (from_status is null or from_status in ('submitted','reviewing','approved','rejected')),
  constraint benefit_submission_events_to_status_check check (to_status in ('submitted','reviewing','approved','rejected')),
  constraint benefit_submission_events_response_check check (response_text is null or char_length(response_text) between 1 and 2000),
  constraint benefit_submission_events_shape_check check (
    (operation='create' and action='submitted' and from_status is null and to_status='submitted' and response_text is null and publication_id is null)
    or (operation='review' and action='start_review' and from_status='submitted' and to_status='reviewing' and response_text is not null and publication_id is null)
    or (operation='review' and action='additional_material_requested' and from_status='reviewing' and to_status='reviewing' and response_text is not null and publication_id is null)
    or (operation='review' and action='approved' and from_status='reviewing' and to_status='approved' and response_text is not null and publication_id is not null)
    or (operation='review' and action='rejected' and from_status='reviewing' and to_status='rejected' and response_text is not null and publication_id is null)
  )
);

create index benefit_submissions_owner_created_idx on public.benefit_submissions(submitter_id,created_at desc,id desc);
create index benefit_submissions_active_queue_idx on public.benefit_submissions(created_at desc,id desc) where status in ('submitted','reviewing');
create index benefit_submissions_queue_idx on public.benefit_submissions(created_at desc,id desc);
create index benefit_submissions_status_queue_idx on public.benefit_submissions(status,created_at desc,id desc);
create index benefit_submission_events_submission_idx on public.benefit_submission_events(submission_id,created_at,id);

alter table public.benefit_submissions enable row level security;
alter table public.benefit_submission_events enable row level security;
revoke all on table public.benefit_submissions,public.benefit_submission_events from public,anon,authenticated,service_role;

create function private.benefit_submission_text(p_value text,p_name text,p_max integer,p_nullable boolean default false)
returns text language plpgsql immutable set search_path='' as $$
declare v_value text:=pg_catalog.btrim(p_value);
begin
  if p_value is null then
    if p_nullable then return null; end if;
    raise exception 'invalid %',p_name using errcode='22023';
  end if;
  if pg_catalog.char_length(p_value)>p_max or pg_catalog.octet_length(p_value)>p_max*4 or v_value='' then
    raise exception 'invalid %',p_name using errcode='22023';
  end if;
  return v_value;
end $$;

create function private.benefit_submission_source_url(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v_value text:=pg_catalog.btrim(p_value); v_authority text; v_host text; v_port text;
begin
  if p_value is null then return null; end if;
  if pg_catalog.char_length(p_value)>2048 or pg_catalog.octet_length(p_value)>8192 or pg_catalog.char_length(v_value)<9
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
  if v_port is not null and v_port::integer not between 1 and 65535 then raise exception 'invalid public source URL' using errcode='22023'; end if;
  if v_host='localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal'
     or v_host like '%.test' or v_host like '%.invalid' or v_host ~ '^[0-9.]+$'
     or v_host ~ '^(?:[0-9]+|0x[0-9a-f]+)(?:\.(?:[0-9]+|0x[0-9a-f]+))*$'
     or v_host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'invalid public source URL' using errcode='22023';
  end if;
  return v_value;
end $$;

alter table public.benefit_submissions add constraint benefit_submissions_valid_source_check
  check (source_url is null or source_url=private.benefit_submission_source_url(source_url));

create function private.benefit_submission_owner_item(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',s.id,'company_id',s.company_id,'category_id',s.category_id,'benefit_text',s.benefit_text,
    'eligibility_text',s.eligibility_text,'condition_text',s.condition_text,'source_url',s.source_url,
    'status',s.status,'admin_response',s.admin_response,'publication_id',s.publication_id,'reviewed_at',s.reviewed_at,
    'created_at',s.created_at,'updated_at',s.updated_at)
  from public.benefit_submissions s where s.id=p_id
$$;

create function private.benefit_submission_admin_item(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.benefit_submission_owner_item(s.id)||pg_catalog.jsonb_build_object('reviewed_at',s.reviewed_at)
  from public.benefit_submissions s where s.id=p_id
$$;

create function private.enforce_benefit_submission_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.submitter_id is distinct from old.submitter_id or new.client_key is distinct from old.client_key
     or new.payload_fingerprint is distinct from old.payload_fingerprint or new.company_id is distinct from old.company_id
     or new.category_id is distinct from old.category_id or new.benefit_text is distinct from old.benefit_text
     or new.eligibility_text is distinct from old.eligibility_text or new.condition_text is distinct from old.condition_text
     or new.source_url is distinct from old.source_url or new.created_at is distinct from old.created_at then
    raise exception 'benefit submitted payload is immutable' using errcode='23514';
  end if;
  if new.status is distinct from old.status and not ((old.status='submitted' and new.status='reviewing') or (old.status='reviewing' and new.status in ('approved','rejected'))) then
    raise exception 'illegal benefit submission status transition' using errcode='23514';
  end if;
  if old.status in ('approved','rejected') and (new.admin_response is distinct from old.admin_response or new.reviewer_id is distinct from old.reviewer_id or new.reviewed_at is distinct from old.reviewed_at or new.publication_id is distinct from old.publication_id) then
    raise exception 'terminal benefit submission fields are immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger benefit_submissions_enforce_update before update on public.benefit_submissions for each row execute function private.enforce_benefit_submission_update();

create function private.enforce_benefit_submission_event_append_only()
returns trigger language plpgsql set search_path='' as $$ begin raise exception 'benefit submission events are append-only' using errcode='23514'; end $$;
create trigger benefit_submission_events_append_only_row before update or delete on public.benefit_submission_events for each row execute function private.enforce_benefit_submission_event_append_only();
create trigger benefit_submission_events_append_only_truncate before truncate on public.benefit_submission_events for each statement execute function private.enforce_benefit_submission_event_append_only();

create function public.create_benefit_submission_v1(
  p_client_key uuid,p_company_id text,p_category_id text,p_benefit_text text,
  p_eligibility_text text default null,p_condition_text text default null,p_source_url text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_company text:=pg_catalog.btrim(p_company_id); v_category text:=pg_catalog.lower(pg_catalog.btrim(p_category_id));
  v_benefit text; v_eligibility text; v_condition text; v_url text; v_fingerprint text; v_submission public.benefit_submissions%rowtype;
begin
  perform private.require_read_committed(); v_actor:=private.require_user();
  if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
  if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or pg_catalog.octet_length(p_company_id)>256 or v_company !~ '^(KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$' then raise exception 'invalid company id' using errcode='22023'; end if;
  if not exists(select 1 from public.benefit_companies where company_id=v_company) then raise exception 'benefit company not found' using errcode='22023'; end if;
  if p_category_id is null or pg_catalog.char_length(p_category_id)>20 or v_category not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion') then raise exception 'invalid category id' using errcode='22023'; end if;
  v_benefit:=private.benefit_submission_text(p_benefit_text,'benefit text',5000,false);
  v_eligibility:=private.benefit_submission_text(p_eligibility_text,'eligibility text',2000,true);
  v_condition:=private.benefit_submission_text(p_condition_text,'condition text',2000,true);
  v_url:=private.benefit_submission_source_url(p_source_url);
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('company_id',v_company,'category_id',v_category,'benefit_text',v_benefit,'eligibility_text',v_eligibility,'condition_text',v_condition,'source_url',v_url)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-submission:create:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_submission from public.benefit_submissions where submitter_id=v_actor and client_key=p_client_key;
  if found then
    if v_submission.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_submission_owner_item(v_submission.id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_submission.create',p_client_key::text);
  insert into public.benefit_submissions(submitter_id,client_key,payload_fingerprint,company_id,category_id,benefit_text,eligibility_text,condition_text,source_url)
  values(v_actor,p_client_key,v_fingerprint,v_company,v_category,v_benefit,v_eligibility,v_condition,v_url) returning * into v_submission;
  insert into public.benefit_submission_events(submission_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status)
  values(v_submission.id,v_actor,'create',p_client_key,v_fingerprint,'submitted',null,'submitted');
  return private.benefit_submission_owner_item(v_submission.id);
end $$;

create function public.list_my_benefit_submissions_v1(p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_actor uuid; v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  v_actor:=private.require_user();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  with candidates as materialized (
    select s.id,s.created_at,private.benefit_submission_owner_item(s.id) item from public.benefit_submissions s
    where s.submitter_id=v_actor and (p_cursor_created_at is null or (s.created_at,s.id)<(p_cursor_created_at,p_cursor_id))
    order by s.created_at desc,s.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),(select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.list_benefit_submission_queue_v1(p_status text default 'active',p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('active','submitted','reviewing','approved','rejected','all') then raise exception 'invalid benefit submission status filter' using errcode='22023'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  with candidates as materialized (
    select s.id,s.created_at,private.benefit_submission_admin_item(s.id) item from public.benefit_submissions s
    where (p_status='all' or (p_status='active' and s.status in ('submitted','reviewing')) or s.status=p_status)
      and (p_cursor_created_at is null or (s.created_at,s.id)<(p_cursor_created_at,p_cursor_id))
    order by s.created_at desc,s.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),(select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1) else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.list_benefit_submission_audit_v1(p_submission_id uuid,p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_sequence uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_submission_id is null then raise exception 'invalid benefit submission id' using errcode='22023'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_sequence is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  with candidates as materialized (
    select e.id sequence,e.created_at,pg_catalog.jsonb_build_object('sequence',e.id,'action',e.action,'from_status',e.from_status,'to_status',e.to_status,'admin_response',e.response_text,'created_at',e.created_at) item
    from public.benefit_submission_events e where e.submission_id=p_submission_id
      and (p_cursor_created_at is null or (e.created_at,e.id)>(p_cursor_created_at,p_cursor_sequence))
    order by e.created_at,e.id limit p_limit+1
  ), page as (select * from candidates order by created_at,sequence limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at,sequence),'[]'::jsonb),(select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'sequence',sequence) from page order by created_at desc,sequence desc limit 1) else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.review_benefit_submission_v1(
  p_submission_id uuid,p_expected_status text,p_action text,p_admin_response text,p_client_key uuid,
  p_public_title text default null,p_public_description text default null,p_public_eligibility text default null,
  p_public_condition text default null,p_existing_publication_id uuid default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_response text; v_title text; v_description text; v_eligibility text; v_condition text;
  v_fingerprint text; v_event public.benefit_submission_events%rowtype; v_submission public.benefit_submissions%rowtype;
  v_existing public.benefit_publications%rowtype; v_publication_id uuid; v_dedupe text; v_revision integer; v_desired text; v_event_action text; v_now timestamptz;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  if p_submission_id is null or p_client_key is null then raise exception 'submission and client key are required' using errcode='22023'; end if;
  if p_expected_status is null or p_expected_status not in ('submitted','reviewing') then raise exception 'invalid expected benefit submission status' using errcode='22023'; end if;
  if p_action is null or p_action not in ('start_review','additional_material_requested','approve','reject') then raise exception 'benefit submission review action not allowed' using errcode='22023'; end if;
  v_response:=private.benefit_submission_text(p_admin_response,'admin response',2000,false);
  if p_action='approve' then
    v_title:=private.benefit_submission_text(p_public_title,'public title',200,false);
    v_description:=private.benefit_submission_text(p_public_description,'public description',5000,false);
    v_eligibility:=private.benefit_submission_text(p_public_eligibility,'public eligibility',2000,true);
    v_condition:=private.benefit_submission_text(p_public_condition,'public condition',2000,true);
  elsif p_public_title is not null or p_public_description is not null or p_public_eligibility is not null or p_public_condition is not null or p_existing_publication_id is not null then
    raise exception 'public projection is allowed only for approval' using errcode='22023';
  end if;
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('submission_id',p_submission_id,'expected_status',p_expected_status,'action',p_action,'admin_response',v_response,'public_title',v_title,'public_description',v_description,'public_eligibility',v_eligibility,'public_condition',v_condition,'existing_publication_id',p_existing_publication_id)::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-submission:review:'||v_actor::text||':'||p_client_key::text,0));
  select * into v_event from public.benefit_submission_events where actor_id=v_actor and operation='review' and client_key=p_client_key;
  if found then
    if v_event.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
    return private.benefit_submission_admin_item(v_event.submission_id);
  end if;
  perform private.consume_rate_limit(v_actor,'benefit_submission.review',p_client_key::text);
  select * into v_submission from public.benefit_submissions where id=p_submission_id for update;
  if not found then raise exception 'benefit submission not found' using errcode='22023'; end if;
  if v_submission.status is distinct from p_expected_status then raise exception 'benefit submission state changed' using errcode='40001'; end if;
  if p_action='start_review' and v_submission.status='submitted' then v_desired:='reviewing'; v_event_action:='start_review';
  elsif p_action='additional_material_requested' and v_submission.status='reviewing' then v_desired:='reviewing'; v_event_action:='additional_material_requested';
  elsif p_action='approve' and v_submission.status='reviewing' then v_desired:='approved'; v_event_action:='approved';
  elsif p_action='reject' and v_submission.status='reviewing' then v_desired:='rejected'; v_event_action:='rejected';
  else raise exception 'benefit submission review action not allowed' using errcode='22023'; end if;
  v_now:=pg_catalog.clock_timestamp();
  if p_action='approve' then
    if p_existing_publication_id is not null then
      select * into v_existing from public.benefit_publications where publication_id=p_existing_publication_id for update;
      if not found or v_existing.company_id<>v_submission.company_id or v_existing.category_id<>v_submission.category_id or v_existing.status<>'active' or v_existing.trust_tier<>'community_reviewed' then
        raise exception 'existing publication is not an active matching community publication' using errcode='22023';
      end if;
      v_dedupe:=v_existing.dedupe_key; v_revision:=v_existing.revision+1;
      update public.benefit_publications set status='superseded',updated_at=v_now where publication_id=v_existing.publication_id;
    else
      v_dedupe:='user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
        v_submission.company_id||E'\n'||v_submission.category_id||E'\n'||pg_catalog.regexp_replace(pg_catalog.translate(v_title,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'[ \t\n\r\f\v]+',' ','g'),'UTF8'),'sha256'),'hex');
      v_revision:=1;
    end if;
    insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,observed_at,verified_at,provenance,reviewer_id)
    values(v_submission.company_id,v_submission.category_id,v_title,v_description,v_eligibility,v_condition,'community_reviewed','active',v_dedupe,v_revision,p_existing_publication_id,v_submission.source_url,'user_submission',v_submission.created_at,v_now,pg_catalog.jsonb_build_object('submission_id',v_submission.id),v_actor::text)
    returning publication_id into v_publication_id;
    -- Task 1 lineage triggers are deferred and security-invoker. Force them while
    -- this SECURITY DEFINER function still owns the privilege and transaction.
    set constraints public.benefit_publications_lineage_check, public.benefit_publications_unique_active_lineage_check immediate;
    set constraints public.benefit_publications_lineage_check, public.benefit_publications_unique_active_lineage_check deferred;
  end if;
  update public.benefit_submissions set status=v_desired,admin_response=v_response,reviewer_id=v_actor,reviewed_at=v_now,publication_id=v_publication_id,updated_at=v_now where id=v_submission.id;
  insert into public.benefit_submission_events(submission_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status,response_text,publication_id)
  values(v_submission.id,v_actor,'review',p_client_key,v_fingerprint,v_event_action,v_submission.status,v_desired,v_response,v_publication_id);
  return private.benefit_submission_admin_item(v_submission.id);
end $$;

alter function private.benefit_submission_text(text,text,integer,boolean) owner to postgres;
alter function private.benefit_submission_source_url(text) owner to postgres;
alter function private.benefit_submission_owner_item(uuid) owner to postgres;
alter function private.benefit_submission_admin_item(uuid) owner to postgres;
alter function private.enforce_benefit_submission_update() owner to postgres;
alter function private.enforce_benefit_submission_event_append_only() owner to postgres;
alter function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) owner to postgres;
alter function public.list_my_benefit_submissions_v1(integer,timestamptz,uuid) owner to postgres;
alter function public.list_benefit_submission_queue_v1(text,integer,timestamptz,uuid) owner to postgres;
alter function public.list_benefit_submission_audit_v1(uuid,integer,timestamptz,uuid) owner to postgres;
alter function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) owner to postgres;

revoke all on function private.benefit_submission_text(text,text,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function private.benefit_submission_source_url(text) from public,anon,authenticated,service_role;
revoke all on function private.benefit_submission_owner_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.benefit_submission_admin_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.enforce_benefit_submission_update() from public,anon,authenticated,service_role;
revoke all on function private.enforce_benefit_submission_event_append_only() from public,anon,authenticated,service_role;
revoke all on function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_my_benefit_submissions_v1(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_benefit_submission_queue_v1(text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_benefit_submission_audit_v1(uuid,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_submission_v1(uuid,text,text,text,text,text,text) to authenticated;
grant execute on function public.list_my_benefit_submissions_v1(integer,timestamptz,uuid) to authenticated;
grant execute on function public.list_benefit_submission_queue_v1(text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.list_benefit_submission_audit_v1(uuid,integer,timestamptz,uuid) to authenticated;
grant execute on function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) to authenticated;

commit;
