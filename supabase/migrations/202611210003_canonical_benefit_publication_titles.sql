-- Canonicalize public benefit titles and bind title dedupe to one representation.
begin;

create function private.canonical_benefit_publication_title(p_value text)
returns text
language plpgsql
immutable
set search_path=''
as $$
declare
  v_title text;
begin
  if p_value is null then
    raise exception 'invalid public title' using errcode='22023';
  end if;

  v_title:=pg_catalog.translate(p_value,E'\t\n\v\f\r','     ');
  v_title:=pg_catalog.regexp_replace(v_title,' +',' ','g');
  v_title:=pg_catalog.btrim(v_title,' ');

  if v_title='' or pg_catalog.char_length(v_title)>200 then
    raise exception 'invalid public title' using errcode='22023';
  end if;

  return v_title;
end $$;

alter function private.canonical_benefit_publication_title(text) owner to postgres;
revoke all on function private.canonical_benefit_publication_title(text) from public,anon,authenticated,service_role;

-- Fail closed before changing any publication row. Migration 002 allowed ASCII
-- control whitespace at the edges and repeated whitespace within titles.
do $$
begin
  if exists (
    select 1
    from public.benefit_publications publication
    cross join lateral (
      select pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.translate(publication.title,E'\t\n\v\f\r','     '),
          ' +',' ','g'
        ),
        ' '
      ) canonical_title
    ) normalized
    where normalized.canonical_title=''
       or pg_catalog.char_length(normalized.canonical_title)>200
  ) then
    raise exception 'benefit title canonicalization preflight failed: invalid title'
      using errcode='22023';
  end if;

  if exists (
    select 1
    from public.benefit_publications publication
    group by publication.company_id,publication.dedupe_key
    having pg_catalog.count(distinct pg_catalog.jsonb_build_array(
      publication.company_id,publication.category_id
    ))>1
  ) then
    raise exception 'benefit title canonicalization preflight failed: inconsistent lineage company/category'
      using errcode='23514';
  end if;

  if exists (
    with lineage_base as (
      select distinct on (publication.company_id,publication.dedupe_key)
        publication.company_id,
        publication.dedupe_key old_dedupe_key,
        publication.category_id,
        private.canonical_benefit_publication_title(publication.title) canonical_title
      from public.benefit_publications publication
      order by publication.company_id,publication.dedupe_key,
        publication.revision,publication.publication_id
    ), mapped as (
      select lineage_base.*,
        'user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          lineage_base.company_id||E'\n'||lineage_base.category_id||E'\n'||
          pg_catalog.translate(lineage_base.canonical_title,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),
          'UTF8'
        ),'sha256'),'hex') new_dedupe_key
      from lineage_base
    )
    select 1
    from mapped
    group by mapped.company_id,mapped.new_dedupe_key
    having pg_catalog.count(*)>1
  ) then
    raise exception 'benefit title canonicalization preflight failed: canonical lineage collision'
      using errcode='23505';
  end if;
end $$;

create temporary table benefit_title_upgrade_lineages on commit drop as
with lineage_base as (
  select distinct on (publication.company_id,publication.dedupe_key)
    publication.company_id,
    publication.dedupe_key old_dedupe_key,
    publication.category_id,
    private.canonical_benefit_publication_title(publication.title) canonical_title
  from public.benefit_publications publication
  order by publication.company_id,publication.dedupe_key,
    publication.revision,publication.publication_id
)
select lineage_base.*,
  'migration-003-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    lineage_base.company_id||E'\n'||lineage_base.old_dedupe_key,'UTF8'
  ),'sha256'),'hex') staging_dedupe_key,
  'user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    lineage_base.company_id||E'\n'||lineage_base.category_id||E'\n'||
    pg_catalog.translate(lineage_base.canonical_title,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),
    'UTF8'
  ),'sha256'),'hex') new_dedupe_key
from lineage_base;

-- An old arbitrary key could equal a generated staging key. Reject that rare
-- case instead of relying on immediate unique-constraint update order.
do $$
begin
  if exists (
    select 1
    from pg_temp.benefit_title_upgrade_lineages staged
    join public.benefit_publications publication
      on publication.company_id=staged.company_id
     and publication.dedupe_key=staged.staging_dedupe_key
     and publication.dedupe_key<>staged.old_dedupe_key
  ) or exists (
    select 1
    from pg_temp.benefit_title_upgrade_lineages staged
    group by staged.company_id,staged.staging_dedupe_key
    having pg_catalog.count(*)>1
  ) then
    raise exception 'benefit title canonicalization preflight failed: staging lineage collision'
      using errcode='23505';
  end if;
end $$;

update public.benefit_publications publication
set dedupe_key=staged.staging_dedupe_key
from pg_temp.benefit_title_upgrade_lineages staged
where publication.company_id=staged.company_id
  and publication.dedupe_key=staged.old_dedupe_key;

update public.benefit_publications publication
set title=private.canonical_benefit_publication_title(publication.title),
    dedupe_key=staged.new_dedupe_key
from pg_temp.benefit_title_upgrade_lineages staged
where publication.company_id=staged.company_id
  and publication.dedupe_key=staged.staging_dedupe_key;

set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check immediate;
set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check deferred;

alter table public.benefit_publications
  drop constraint benefit_publications_title_check;
alter table public.benefit_publications
  add constraint benefit_publications_title_check
  check (title=private.canonical_benefit_publication_title(title));

create or replace function public.review_benefit_submission_v1(
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
    v_title:=private.canonical_benefit_publication_title(p_public_title);
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
        v_submission.company_id||E'\n'||v_submission.category_id||E'\n'||pg_catalog.translate(v_title,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'UTF8'),'sha256'),'hex');
      v_revision:=1;
    end if;
    insert into public.benefit_publications(company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,observed_at,verified_at,provenance,reviewer_id)
    values(v_submission.company_id,v_submission.category_id,v_title,v_description,v_eligibility,v_condition,'community_reviewed','active',v_dedupe,v_revision,p_existing_publication_id,v_submission.source_url,'user_submission',v_submission.created_at,v_now,pg_catalog.jsonb_build_object('submission_id',v_submission.id),v_actor::text)
    returning publication_id into v_publication_id;
    set constraints public.benefit_publications_lineage_check, public.benefit_publications_unique_active_lineage_check immediate;
    set constraints public.benefit_publications_lineage_check, public.benefit_publications_unique_active_lineage_check deferred;
  end if;
  update public.benefit_submissions set status=v_desired,admin_response=v_response,reviewer_id=v_actor,reviewed_at=v_now,publication_id=v_publication_id,updated_at=v_now where id=v_submission.id;
  insert into public.benefit_submission_events(submission_id,actor_id,operation,client_key,payload_fingerprint,action,from_status,to_status,response_text,publication_id)
  values(v_submission.id,v_actor,'review',p_client_key,v_fingerprint,v_event_action,v_submission.status,v_desired,v_response,v_publication_id);
  return private.benefit_submission_admin_item(v_submission.id);
end $$;

alter function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) owner to postgres;
revoke all on function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid) to authenticated;

commit;
