begin;

create or replace function public.get_public_post_v3(p_post_id uuid)
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
  v_count bigint;
begin
  select p.status, p.deleted_at
    into v_status, v_deleted_at
    from public.posts p
   where p.id = p_post_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'not_found');
  end if;

  if v_status = 'hidden' then
    return pg_catalog.jsonb_build_object('kind', 'hidden');
  end if;

  select coalesce(m.comment_count, 0)
    into v_count
    from private.post_metrics m
   where m.post_id = p_post_id;
  v_count := coalesce(v_count, 0);

  if v_status = 'published' and v_deleted_at is null then
    select pg_catalog.to_jsonb(d)
      into v_post
      from public.get_public_post(p_post_id) d;

    if v_post is null then
      return pg_catalog.jsonb_build_object('kind', 'not_found');
    end if;

    v_post := v_post || pg_catalog.jsonb_build_object(
      'attachment_count',
      (
        select pg_catalog.count(*)::integer
          from public.attachments a
         where a.post_id = p_post_id
           and a.status = 'attached'
      ),
      'viewer_reacted',
      coalesce(
        (
          select true
            from public.post_reactions r
           where r.post_id = p_post_id
             and r.user_id = auth.uid()
        ),
        false
      )
    );

    return pg_catalog.jsonb_build_object('kind', 'published', 'post', v_post);
  end if;

  if v_status = 'deleted' and v_deleted_at is not null and v_count > 0 then
    return pg_catalog.jsonb_build_object('kind', 'deleted', 'comment_count', v_count);
  end if;

  return pg_catalog.jsonb_build_object('kind', 'not_found');
end
$$;

commit;
