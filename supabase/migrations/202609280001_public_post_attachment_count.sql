-- Expose the authoritative attached-row count with public post details.

begin;

create or replace function public.get_public_post_v2(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_deleted_at timestamptz;
  v_post jsonb;
  v_comment_count bigint;
begin
  select p.status,p.deleted_at
    into v_status,v_deleted_at
    from public.posts p
   where p.id=p_post_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind','not_found');
  end if;
  if v_status='hidden' then
    return pg_catalog.jsonb_build_object('kind','hidden');
  end if;
  if v_status='published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(detail)
      into v_post
      from public.get_public_post(p_post_id) detail;
    if v_post is null then
      return pg_catalog.jsonb_build_object('kind','not_found');
    end if;
    v_post := v_post || pg_catalog.jsonb_build_object(
      'attachment_count',
      (select pg_catalog.count(*)::integer
         from public.attachments a
        where a.post_id=p_post_id and a.status='attached')
    );
    return pg_catalog.jsonb_build_object('kind','published','post',v_post);
  end if;
  if v_status='deleted' and v_deleted_at is not null then
    select pg_catalog.count(*)::bigint
      into v_comment_count
      from public.comments c
      join public.comments root
        on root.id=coalesce(c.parent_id,c.id)
       and root.post_id=c.post_id
       and root.parent_id is null
       and root.status='published'
       and root.deleted_at is null
     where c.post_id=p_post_id
       and c.status='published'
       and c.deleted_at is null;
    if v_comment_count > 0 then
      return pg_catalog.jsonb_build_object('kind','deleted','comment_count',v_comment_count);
    end if;
  end if;
  return pg_catalog.jsonb_build_object('kind','not_found');
end
$$;

alter function public.get_public_post_v2(uuid) owner to postgres;
revoke all on function public.get_public_post_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_public_post_v2(uuid) to anon,authenticated;

commit;
