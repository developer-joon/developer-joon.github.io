do $$
declare v_plan jsonb;
begin
  if (select original_index_oid from public.public_listing_upgrade_probe)
       <> 'public.posts_public_list_idx'::regclass::oid then
    raise exception 'posts_public_list_idx was rebuilt';
  end if;
  if not (select indisvalid and indisready from pg_index
            where indexrelid='private.post_reaction_daily_recent_idx'::regclass) then
    raise exception 'recent reaction index is not valid and ready';
  end if;
  -- Seeded rows need deterministic statistics before asserting the exact plan.
  analyze public.posts;
  set local enable_seqscan=off;
  execute $explain$
    explain (format json)
    select id from public.posts
    where status='published' and deleted_at is null
    order by is_pinned desc,created_at desc,id desc limit 10
  $explain$ into v_plan;
  if v_plan::text not like '%posts_public_list_idx%' then
    raise exception 'published/deleted-state query did not use original list index: %',v_plan;
  end if;
end $$;