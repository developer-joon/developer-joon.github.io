-- Structured community benefit claims and bounded public claim projection.
begin;

insert into public.rate_limit_rules(id,action,window_seconds,max_requests,is_enabled) values
 ('b5000000-0000-4000-8000-000000000001','benefit_claim.create',3600,5,true),
 ('b5000000-0000-4000-8000-000000000002','benefit_claim.withdraw',3600,20,true)
on conflict(action,window_seconds) do update set max_requests=excluded.max_requests,is_enabled=excluded.is_enabled,updated_at=pg_catalog.clock_timestamp();

create table public.benefit_claims (
  claim_id uuid primary key default extensions.gen_random_uuid(),
  company_id text not null references public.benefit_companies(company_id) on delete restrict,
  submitter_id uuid references public.profiles(id) on delete set null,
  client_key uuid not null,
  payload_fingerprint text not null,
  category_id text not null,
  title text not null,
  normalized_title text not null,
  description text not null,
  eligibility_text text,
  normalized_eligibility text not null default '',
  condition_text text,
  observed_on date not null,
  source_url text,
  status text not null default 'submitted',
  revision bigint not null default 1,
  active_publication_id uuid references public.benefit_publications(publication_id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  withdrawn_at timestamptz,
  constraint benefit_claims_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_claims_category_check check (category_id in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion')),
  constraint benefit_claims_title_check check (pg_catalog.char_length(title) between 1 and 200 and pg_catalog.octet_length(title)<=800 and title=pg_catalog.btrim(title)),
  constraint benefit_claims_normalized_title_check check (pg_catalog.char_length(normalized_title) between 1 and 200 and pg_catalog.octet_length(normalized_title)<=800 and normalized_title=pg_catalog.lower(pg_catalog.btrim(normalized_title))),
  constraint benefit_claims_description_check check (pg_catalog.char_length(description) between 1 and 1000 and pg_catalog.octet_length(description)<=4000 and description=pg_catalog.btrim(description)),
  constraint benefit_claims_eligibility_check check (eligibility_text is null or (pg_catalog.char_length(eligibility_text) between 1 and 500 and pg_catalog.octet_length(eligibility_text)<=2000 and eligibility_text=pg_catalog.btrim(eligibility_text))),
  constraint benefit_claims_normalized_eligibility_check check (pg_catalog.char_length(normalized_eligibility)<=500 and pg_catalog.octet_length(normalized_eligibility)<=2000 and normalized_eligibility=pg_catalog.lower(pg_catalog.btrim(normalized_eligibility)) and ((eligibility_text is null and normalized_eligibility='') or eligibility_text is not null)),
  constraint benefit_claims_condition_check check (condition_text is null or (pg_catalog.char_length(condition_text) between 1 and 500 and pg_catalog.octet_length(condition_text)<=2000 and condition_text=pg_catalog.btrim(condition_text))),
  constraint benefit_claims_observed_check check (observed_on>=date '2000-01-01'),
  constraint benefit_claims_source_check check (source_url is null or (pg_catalog.char_length(source_url) between 9 and 2048 and pg_catalog.octet_length(source_url)<=8192 and source_url=pg_catalog.btrim(source_url))),
  constraint benefit_claims_status_check check (status in ('submitted','community_confirmed','disputed','hidden','withdrawn')),
  constraint benefit_claims_revision_check check (revision>0),
  constraint benefit_claims_withdrawn_check check ((status='withdrawn')=(withdrawn_at is not null)),
  constraint benefit_claims_task5_no_active_publication_check check (active_publication_id is null),
  constraint benefit_claims_timestamps_check check (pg_catalog.isfinite(created_at) and pg_catalog.isfinite(updated_at) and updated_at>=created_at and (withdrawn_at is null or (pg_catalog.isfinite(withdrawn_at) and withdrawn_at>=created_at and withdrawn_at=updated_at)))
);

-- Task 5 has no atomic claim/reaction/publication mutation. Task 6 must
-- explicitly drop this phase constraint before it adds the locking protocol.
comment on constraint benefit_claims_task5_no_active_publication_check on public.benefit_claims is
  'Task 5 phase invariant: publication links are unsupported until Task 6 installs atomic locking.';

create table public.benefit_claim_events (
  event_id uuid primary key default extensions.gen_random_uuid(),
  claim_id uuid not null references public.benefit_claims(claim_id) on delete restrict,
  actor_snapshot uuid not null,
  operation text not null,
  client_key uuid not null,
  payload_fingerprint text not null,
  event_type text not null,
  from_status text,
  to_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(actor_snapshot,operation,client_key),
  constraint benefit_claim_events_operation_check check (operation in ('create','withdraw','moderate','promote','review')),
  constraint benefit_claim_events_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint benefit_claim_events_type_check check (event_type in ('submitted','duplicate_directed','withdrawn','hidden','restored','merged','promoted','demoted','repromoted','official_reviewed')),
  constraint benefit_claim_events_from_check check (from_status is null or from_status in ('submitted','community_confirmed','disputed','hidden','withdrawn')),
  constraint benefit_claim_events_to_check check (to_status in ('submitted','community_confirmed','disputed','hidden','withdrawn')),
  constraint benefit_claim_events_metadata_check check (pg_catalog.jsonb_typeof(metadata)='object' and pg_catalog.octet_length(metadata::text)<=2000),
  constraint benefit_claim_events_created_check check (pg_catalog.isfinite(created_at)),
  constraint benefit_claim_events_shape_check check (
    (event_type='submitted' and operation='create' and from_status is null and to_status='submitted')
    or (event_type='duplicate_directed' and operation='create' and from_status=to_status and to_status in ('submitted','community_confirmed','disputed'))
    or (event_type='withdrawn' and operation='withdraw' and from_status in ('submitted','community_confirmed','disputed') and to_status='withdrawn')
    or event_type in ('hidden','restored','merged','promoted','demoted','repromoted','official_reviewed')
  )
);

create unique index benefit_claims_active_duplicate_idx on public.benefit_claims(company_id,category_id,normalized_title,normalized_eligibility) where status in ('submitted','community_confirmed','disputed');
create index benefit_claims_company_status_created_idx on public.benefit_claims(company_id,status,created_at desc,claim_id desc);
create index benefit_claims_submitter_created_idx on public.benefit_claims(submitter_id,created_at desc,claim_id desc) where submitter_id is not null;
create index benefit_claims_submitter_client_idx on public.benefit_claims(submitter_id,client_key) where submitter_id is not null;
create index benefit_claim_events_claim_idx on public.benefit_claim_events(claim_id,created_at,event_id);
create index benefit_claim_events_actor_intent_idx on public.benefit_claim_events(actor_snapshot,operation,client_key,payload_fingerprint);

alter table public.benefit_claims owner to postgres;
alter table public.benefit_claim_events owner to postgres;
alter table public.benefit_claims enable row level security;
alter table public.benefit_claim_events enable row level security;
revoke all on table public.benefit_claims,public.benefit_claim_events from public,anon,authenticated,service_role;

create function private.benefit_claim_text(p_value text,p_name text,p_max integer,p_nullable boolean)
returns text language plpgsql immutable set search_path='' as $$
declare v text;
begin
  if p_value is null then if p_nullable then return null; end if; raise exception 'invalid %',p_name using errcode='22023'; end if;
  if pg_catalog.char_length(p_value)>p_max or pg_catalog.octet_length(p_value)>p_max*4 then raise exception 'invalid %',p_name using errcode='22023'; end if;
  v:=pg_catalog.regexp_replace(pg_catalog.btrim(p_value),'[[:space:]]+',' ','g');
  if v='' then if p_nullable then return null; end if; raise exception 'invalid %',p_name using errcode='22023'; end if;
  return v;
end $$;

create function private.benefit_claim_source_url(p_value text)
returns text language plpgsql immutable set search_path='' as $$
declare v text; v_authority text; v_host text; v_port text; v_query text; v_pair text; v_key text; v_key_lower text; v_value text; v_equals integer;
begin
  if p_value is null or pg_catalog.btrim(p_value)='' then return null; end if;
  v:=pg_catalog.btrim(p_value);
  if pg_catalog.char_length(v)>2048 or pg_catalog.octet_length(v)>8192 or v !~ '^https://[^/?#]+(?:/[^#]*)?(?:\?[^#]*)?$' or v ~ '[[:space:][:cntrl:]]' or pg_catalog.strpos(v,'#')>0 then raise exception 'invalid claim source URL' using errcode='22023'; end if;
  v_authority:=(pg_catalog.regexp_match(v,'^https://([^/?#]+)'))[1];
  if v_authority is null or pg_catalog.strpos(v_authority,'@')>0 or pg_catalog.strpos(v_authority,'[')>0 or pg_catalog.strpos(v_authority,']')>0 or v_authority !~ '^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' then raise exception 'invalid claim source URL' using errcode='22023'; end if;
  v_host:=pg_catalog.lower(pg_catalog.split_part(v_authority,':',1)); v_port:=nullif(pg_catalog.split_part(v_authority,':',2),'');
  if v_port is not null and v_port::integer not between 1 and 65535 then raise exception 'invalid claim source URL' using errcode='22023'; end if;
  if v_host='localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal' or v_host like '%.test' or v_host like '%.invalid' or v_host ~ '^[0-9.]+$' or v_host ~ '^(?:[0-9]+|0x[0-9a-f]+)(?:\.(?:[0-9]+|0x[0-9a-f]+))*$' or v_host !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$' then raise exception 'invalid claim source URL' using errcode='22023'; end if;
  v_query:=case when pg_catalog.strpos(v,'?')>0 then pg_catalog.substr(v,pg_catalog.strpos(v,'?')+1) else null end;
  if v_query is not null then
    if v_query='' or pg_catalog.strpos(v_query,';')>0 then raise exception 'invalid claim source URL' using errcode='22023'; end if;
    foreach v_pair in array pg_catalog.string_to_array(v_query,'&') loop
      v_equals:=pg_catalog.strpos(v_pair,'=');
      v_key:=case when v_equals>0 then pg_catalog.substr(v_pair,1,v_equals-1) else v_pair end;
      v_value:=case when v_equals>0 then pg_catalog.substr(v_pair,v_equals+1) else null end;
      if v_pair='' or v_key='' or v_key !~ '^[A-Za-z0-9._~-]+$' then raise exception 'invalid claim source URL' using errcode='22023'; end if;
      v_key_lower:=pg_catalog.lower(v_key);
      if v_key_lower ~ '(^|[._~-])(token|key|secret|password|passwd|signature|signed|sig|credential|auth|authorization)([._~-]|$)'
         or v_key_lower ~ '^(accesstoken|refreshtoken|idtoken|apikey|clientsecret|secretkey|accesskey|privatekey|signingkey)$' then
        raise exception 'invalid claim source URL' using errcode='22023';
      end if;
      if v_value is not null and (pg_catalog.strpos(pg_catalog.regexp_replace(v_value,'%[0-9A-Fa-f]{2}','','g'),'%')>0 or v_value ~* '%(?:[01][0-9a-f]|7f|23)') then
        raise exception 'invalid claim source URL' using errcode='22023';
      end if;
    end loop;
  end if;
  return v;
end $$;

create function private.benefit_claim_fingerprint(p_company text,p_category text,p_title text,p_description text,p_eligibility text,p_condition text,p_observed date,p_source text)
returns text language sql immutable set search_path='' as $$
 select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('company_id',p_company,'category_id',p_category,'title',p_title,'description',p_description,'eligibility_text',p_eligibility,'condition_text',p_condition,'observed_on',p_observed,'source_url',p_source)::text,'UTF8'),'sha256'),'hex')
$$;

create function private.benefit_claim_owner_item(p_claim_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('claim_id',c.claim_id,'company_id',c.company_id,'company_name',bc.display_name,'category_id',c.category_id,'title',c.title,'description',c.description,'eligibility_text',c.eligibility_text,'condition_text',c.condition_text,'observed_on',c.observed_on,'status',c.status,'revision',c.revision,'created_at',c.created_at,'updated_at',c.updated_at,'withdrawn_at',c.withdrawn_at)
 from public.benefit_claims c join public.benefit_companies bc using(company_id) where c.claim_id=p_claim_id
$$;

create function private.enforce_benefit_claim_update()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.claim_id is distinct from old.claim_id or new.company_id is distinct from old.company_id
    or (new.submitter_id is distinct from old.submitter_id and not (old.submitter_id is not null and new.submitter_id is null))
    or new.client_key is distinct from old.client_key or new.payload_fingerprint is distinct from old.payload_fingerprint or new.category_id is distinct from old.category_id
    or new.title is distinct from old.title or new.normalized_title is distinct from old.normalized_title or new.description is distinct from old.description
    or new.eligibility_text is distinct from old.eligibility_text or new.normalized_eligibility is distinct from old.normalized_eligibility
    or new.condition_text is distinct from old.condition_text or new.observed_on is distinct from old.observed_on or new.source_url is distinct from old.source_url or new.created_at is distinct from old.created_at then
   raise exception 'benefit claim payload is immutable' using errcode='23514';
 end if;
 if new.status is distinct from old.status or new.active_publication_id is distinct from old.active_publication_id then
   if new.revision<>old.revision+1 then raise exception 'benefit claim revision must increment once' using errcode='23514'; end if;
 else
   if new.revision is distinct from old.revision then raise exception 'benefit claim revision changes only on transition' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger benefit_claims_enforce_update before update on public.benefit_claims for each row execute function private.enforce_benefit_claim_update();

create function private.reject_benefit_claim_event_change()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'benefit claim events are append-only' using errcode='23514'; end$$;
create trigger benefit_claim_events_append_only_row before update or delete on public.benefit_claim_events for each row execute function private.reject_benefit_claim_event_change();
create trigger benefit_claim_events_append_only_truncate before truncate on public.benefit_claim_events for each statement execute function private.reject_benefit_claim_event_change();

create function public.create_benefit_claim_v1(p_client_key uuid,p_company_id text,p_category_id text,p_title text,p_description text,p_eligibility_text text default null,p_condition_text text default null,p_observed_on date default current_date,p_source_url text default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_company text; v_category text; v_title text; v_normalized_title text; v_description text; v_eligibility text; v_normalized_eligibility text; v_condition text; v_source text; v_fingerprint text; v_event public.benefit_claim_events%rowtype; v_claim public.benefit_claims%rowtype;
begin
 perform private.require_read_committed(); v_actor:=private.require_google_user();
 if p_client_key is null then raise exception 'client key is required' using errcode='22023'; end if;
 v_company:=pg_catalog.btrim(p_company_id); v_category:=pg_catalog.lower(pg_catalog.btrim(p_category_id));
 if p_company_id is null or pg_catalog.char_length(p_company_id)>64 or pg_catalog.octet_length(p_company_id)>256 or not private.is_benefit_company_id(v_company) then raise exception 'invalid company id' using errcode='22023'; end if;
 if not exists(select 1 from public.benefit_companies c where c.company_id=v_company and c.is_searchable) then raise exception 'benefit company not searchable' using errcode='22023'; end if;
 if p_category_id is null or pg_catalog.char_length(p_category_id)>20 or v_category not in ('leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion') then raise exception 'invalid category id' using errcode='22023'; end if;
 v_title:=private.benefit_claim_text(p_title,'claim title',200,false); v_normalized_title:=pg_catalog.lower(v_title);
 v_description:=private.benefit_claim_text(p_description,'claim description',1000,false);
 v_eligibility:=private.benefit_claim_text(p_eligibility_text,'claim eligibility',500,true); v_normalized_eligibility:=pg_catalog.lower(coalesce(v_eligibility,''));
 v_condition:=private.benefit_claim_text(p_condition_text,'claim condition',500,true);
 if p_observed_on is null or p_observed_on<date '2000-01-01' or p_observed_on>current_date then raise exception 'invalid observed date' using errcode='22023'; end if;
 v_source:=private.benefit_claim_source_url(p_source_url);
 v_fingerprint:=private.benefit_claim_fingerprint(v_company,v_category,v_title,v_description,v_eligibility,v_condition,p_observed_on,v_source);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-claim:intent:'||v_actor::text||':'||p_client_key::text,0));
 select * into v_event from public.benefit_claim_events where actor_snapshot=v_actor and operation='create' and client_key=p_client_key;
 if found then
   if v_event.payload_fingerprint<>v_fingerprint then raise exception 'client key reused with different payload' using errcode='22023'; end if;
   return pg_catalog.jsonb_build_object('claim_id',v_event.claim_id,'outcome',case when v_event.event_type='duplicate_directed' then 'duplicate' else 'created' end);
 end if;
 perform private.require_benefit_features(array['claims_write_enabled']);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-claim:duplicate:'||v_company||':'||v_category||':'||v_normalized_title||':'||v_normalized_eligibility,0));
 perform private.consume_rate_limit(v_actor,'benefit_claim.create',p_client_key::text);
 select * into v_claim from public.benefit_claims c where c.company_id=v_company and c.category_id=v_category and c.normalized_title=v_normalized_title and c.normalized_eligibility=v_normalized_eligibility and c.status in ('submitted','community_confirmed','disputed') order by c.created_at,c.claim_id limit 1;
 if found then
   insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(v_claim.claim_id,v_actor,'create',p_client_key,v_fingerprint,'duplicate_directed',v_claim.status,v_claim.status,'{}');
   return pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id,'outcome','duplicate');
 end if;
 insert into public.benefit_claims(company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,eligibility_text,normalized_eligibility,condition_text,observed_on,source_url)
 values(v_company,v_actor,p_client_key,v_fingerprint,v_category,v_title,v_normalized_title,v_description,v_eligibility,v_normalized_eligibility,v_condition,p_observed_on,v_source) returning * into v_claim;
 insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(v_claim.claim_id,v_actor,'create',p_client_key,v_fingerprint,'submitted',null,'submitted','{}');
 return pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id,'outcome','created');
end $$;

create function public.withdraw_benefit_claim_v1(p_client_key uuid,p_claim_id uuid,p_expected_status text,p_expected_revision bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid; v_fingerprint text; v_event public.benefit_claim_events%rowtype; v_claim public.benefit_claims%rowtype; v_now timestamptz;
begin
 perform private.require_read_committed(); v_actor:=private.require_google_user();
 if p_client_key is null or p_claim_id is null or p_expected_status is null or p_expected_status not in ('submitted','community_confirmed','disputed') or p_expected_revision is null or p_expected_revision<1 then raise exception 'invalid claim withdrawal request' using errcode='22023'; end if;
 v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('claim_id',p_claim_id,'expected_status',p_expected_status,'expected_revision',p_expected_revision)::text,'UTF8'),'sha256'),'hex');
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
 if v_claim.active_publication_id is not null then raise exception 'published claim withdrawal is not supported' using errcode='55000'; end if;
 perform private.consume_rate_limit(v_actor,'benefit_claim.withdraw',p_client_key::text);
 v_now:=pg_catalog.clock_timestamp();
 update public.benefit_claims set status='withdrawn',revision=revision+1,updated_at=v_now,withdrawn_at=v_now where claim_id=p_claim_id returning * into v_claim;
 insert into public.benefit_claim_events(claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata) values(v_claim.claim_id,v_actor,'withdraw',p_client_key,v_fingerprint,'withdrawn',p_expected_status,'withdrawn','{}');
 return pg_catalog.jsonb_build_object('claim_id',v_claim.claim_id,'status',v_claim.status,'revision',v_claim.revision,'outcome','withdrawn');
end $$;

create function public.list_my_benefit_claims_v1(p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare v_actor uuid; v_items jsonb; v_more boolean; v_next jsonb;
begin
 v_actor:=private.require_user();
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
 if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
 with candidates as materialized (select c.claim_id,c.created_at,private.benefit_claim_owner_item(c.claim_id) item from public.benefit_claims c where c.submitter_id=v_actor and (p_cursor_created_at is null or (c.created_at,c.claim_id)<(p_cursor_created_at,p_cursor_id)) order by c.created_at desc,c.claim_id desc limit p_limit+1), page as (select * from candidates order by created_at desc,claim_id desc limit p_limit)
 select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,claim_id desc),'[]'),(select pg_catalog.count(*)>p_limit from candidates),case when (select pg_catalog.count(*)>p_limit from candidates) then (select pg_catalog.jsonb_build_object('created_at',created_at,'claim_id',claim_id) from page order by created_at,claim_id limit 1) else 'null'::jsonb end into v_items,v_more,v_next from page;
 return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_more,'next_cursor',v_next);
end $$;

create function public.get_benefit_company_v2(p_company_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_base jsonb; v_count integer; v_claims jsonb;
begin
 v_base:=public.get_benefit_company_v1(p_company_id);
 if v_base='null'::jsonb then return v_base; end if;
 select pg_catalog.count(*)::integer into v_count from (select 1 from public.benefit_claims c where c.company_id=p_company_id and c.status in ('submitted','community_confirmed','disputed') limit 201) bounded;
 if v_count>200 then raise exception 'benefit claim limit exceeded' using errcode='P0001'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('claim_id',b.claim_id,'category_id',b.category_id,'category_name',case b.category_id when 'leave' then '휴가' when 'family' then '가족' when 'health' then '건강' when 'growth' then '성장' when 'housing' then '주거' when 'commute' then '통근' when 'remote' then '유연근무' when 'retirement' then '퇴직' when 'meals' then '식사' when 'inclusion' then '포용' end,'title',b.title,'description',b.description,'eligibility_text',b.eligibility_text,'condition_text',b.condition_text,'status_code',b.status,'status_label',case b.status when 'submitted' then '제보됨' when 'community_confirmed' then '커뮤니티 확인' when 'disputed' then '재확인 필요' end,'nickname',coalesce(nullif(pg_catalog.btrim(p.display_name),''),'탈퇴한 사용자'),'submitted_at',b.created_at,'observed_on',b.observed_on,'confirm_count',0,'dispute_count',0,'last_confirmation_at',null) order by b.category_id,b.title,b.claim_id),'[]') into v_claims
 from (select c.claim_id,c.submitter_id,c.category_id,c.title,c.description,c.eligibility_text,c.condition_text,c.status,c.created_at,c.observed_on from public.benefit_claims c where c.company_id=p_company_id and c.status in ('submitted','community_confirmed','disputed') order by c.category_id,c.title,c.claim_id limit 200) b left join public.profiles p on p.id=b.submitter_id;
 return v_base||pg_catalog.jsonb_build_object('claims',v_claims);
end $$;

alter function private.benefit_claim_text(text,text,integer,boolean) owner to postgres;
alter function private.benefit_claim_source_url(text) owner to postgres;
alter function private.benefit_claim_fingerprint(text,text,text,text,text,text,date,text) owner to postgres;
alter function private.benefit_claim_owner_item(uuid) owner to postgres;
alter function private.enforce_benefit_claim_update() owner to postgres;
alter function private.reject_benefit_claim_event_change() owner to postgres;
alter function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text) owner to postgres;
alter function public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint) owner to postgres;
alter function public.list_my_benefit_claims_v1(integer,timestamptz,uuid) owner to postgres;
alter function public.get_benefit_company_v2(text) owner to postgres;

revoke all on function private.benefit_claim_text(text,text,integer,boolean),private.benefit_claim_source_url(text),private.benefit_claim_fingerprint(text,text,text,text,text,text,date,text),private.benefit_claim_owner_item(uuid),private.enforce_benefit_claim_update(),private.reject_benefit_claim_event_change() from public,anon,authenticated,service_role;
revoke all on function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text),public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint),public.list_my_benefit_claims_v1(integer,timestamptz,uuid),public.get_benefit_company_v2(text) from public,anon,authenticated,service_role;
grant execute on function public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text),public.withdraw_benefit_claim_v1(uuid,uuid,text,bigint),public.list_my_benefit_claims_v1(integer,timestamptz,uuid) to authenticated;
grant execute on function public.get_benefit_company_v2(text) to anon,authenticated;

commit;
