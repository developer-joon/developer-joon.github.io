-- Make the client-observed attachment total an atomic server-side precondition.

begin;

alter function public.attach_attachments(uuid,uuid[])
  rename to attach_attachments_legacy;

revoke all on function public.attach_attachments_legacy(uuid,uuid[])
  from public, anon, authenticated, service_role;

create function public.attach_attachments(
  p_post_id uuid,
  p_attachment_ids uuid[],
  p_expected_total integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  requested_count integer := coalesce(pg_catalog.cardinality(p_attachment_ids),0);
  distinct_count integer;
  linkable_count integer;
  existing_count integer;
  pending_count integer;
  final_count integer;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_expected_total is null or p_expected_total not between 1 and 5 then
    raise exception 'expected attachment total must be between 1 and 5'
      using errcode = '22023';
  end if;

  select count(distinct requested_id)::integer
    into distinct_count
    from pg_catalog.unnest(coalesce(p_attachment_ids,array[]::uuid[])) requested_id;
  if requested_count < 1 or requested_count > 5
     or distinct_count <> requested_count
     or pg_catalog.array_position(p_attachment_ids,null::uuid) is not null then
    raise exception 'attachment list must contain 1 to 5 distinct ids; duplicate attachment ids are not allowed'
      using errcode = '22023';
  end if;

  -- Serialize every checked attach for a post before evaluating the expected
  -- total. The legacy implementation takes the same lock reentrantly.
  perform 1
    from public.posts p
   where p.id = p_post_id
     and p.author_id = caller_id
     and p.status = 'published'
     and p.deleted_at is null
   for update;
  if not found then
    raise exception 'post not found or not attachable' using errcode = '42501';
  end if;

  select count(*)::integer
    into linkable_count
    from public.attachments a
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and (
       (a.status = 'pending' and a.post_id is null)
       or (a.status = 'attached' and a.post_id = p_post_id)
     )
     and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp());
  if linkable_count <> requested_count then
    raise exception 'attachment not found or not linkable' using errcode = '42501';
  end if;

  select count(*)::integer
    into existing_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  select count(*)::integer
    into pending_count
    from public.attachments a
   where a.id = any(coalesce(p_attachment_ids,array[]::uuid[]))
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null;

  if existing_count + pending_count <> p_expected_total then
    raise exception 'attachment total changed concurrently'
      using errcode = '40001';
  end if;

  final_count := public.attach_attachments_legacy(p_post_id,p_attachment_ids);
  if final_count <> p_expected_total then
    raise exception 'attachment total changed concurrently'
      using errcode = '40001';
  end if;
  return final_count;
end;
$$;

alter function public.attach_attachments(uuid,uuid[],integer) owner to postgres;
revoke all on function public.attach_attachments(uuid,uuid[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.attach_attachments(uuid,uuid[],integer)
  to authenticated;

comment on function public.attach_attachments(uuid,uuid[],integer) is
  'Atomically attach owned pending images when the locked post total matches the caller checkpoint.';
comment on function public.attach_attachments_legacy(uuid,uuid[]) is
  'Internal implementation retained for the checked attach wrapper; not client executable.';

commit;
