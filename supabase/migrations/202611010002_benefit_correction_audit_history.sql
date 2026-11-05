-- Task 11: privacy-safe admin correction audit history.
begin;

create function public.list_benefit_correction_audit_v1(
  p_request_id uuid,
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_sequence uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
set plan_cache_mode='force_custom_plan'
as $$
declare
  v_items jsonb;
  v_has_more boolean;
  v_next jsonb;
begin
  perform private.require_user();
  if not public.is_admin() then
    raise exception 'admin required' using errcode='42501';
  end if;
  if p_request_id is null then
    raise exception 'invalid correction request id' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_sequence is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  with candidates as materialized (
    select
      e.id as sequence,
      e.created_at,
      pg_catalog.jsonb_build_object(
        'sequence',e.id,
        'event_type',e.action,
        'from_status',e.from_status,
        'to_status',e.to_status,
        'admin_response',e.response_text,
        'applied_version',e.applied_data_version,
        'created_at',e.created_at
      ) as item
    from public.benefit_correction_events e
    where e.request_id=p_request_id
      and (p_cursor_created_at is null or (e.created_at,e.id)>(p_cursor_created_at,p_cursor_sequence))
    order by e.created_at,e.id
    limit p_limit+1
  ), page as materialized (
    select * from candidates order by created_at,sequence limit p_limit
  )
  select
    coalesce(pg_catalog.jsonb_agg(item order by created_at,sequence),'[]'::jsonb),
    (select count(*)>p_limit from candidates),
    case when (select count(*)>p_limit from candidates)
      then (select pg_catalog.jsonb_build_object('created_at',created_at,'sequence',sequence) from page order by created_at desc,sequence desc limit 1)
      else 'null'::jsonb
    end
  into v_items,v_has_more,v_next
  from page;

  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end
$$;

alter function public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid) owner to postgres;
revoke all on function public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid) to authenticated;

commit;
