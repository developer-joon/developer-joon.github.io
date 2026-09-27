-- Keep cursor-based public post listing available beyond a fixed corpus size.

begin;

drop index if exists public.posts_public_list_idx;
create index posts_public_list_idx
  on public.posts (is_pinned desc, created_at desc, id desc)
  where status='published' and deleted_at is null;

create function private.public_post_page_keys(
  p_sort text,
  p_limit integer,
  p_search_query tsquery,
  p_tag_id uuid,
  p_cursor_is_pinned boolean,
  p_cursor_created_at timestamptz,
  p_cursor_rank bigint,
  p_cursor_id uuid,
  p_cursor_search_rank real
)
returns table(
  id uuid,
  is_pinned boolean,
  created_at timestamptz,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
begin
  -- The common no-search newest path can walk the published keyset index and
  -- stop before any metrics, excerpts, profiles, or display tags are loaded.
  if p_sort='newest' and p_search_query is null then
    return query
    select p.id,p.is_pinned,p.created_at,null::bigint,0::real
    from public.posts p
    where p.status='published' and p.deleted_at is null
      and (p_tag_id is null or exists(
        select 1
        from public.post_tags pt
        join public.tags t on t.id=pt.tag_id and t.is_active
        where pt.post_id=p.id and pt.tag_id=p_tag_id
      ))
      and (p_cursor_is_pinned is null
        or p.is_pinned < p_cursor_is_pinned
        or (p.is_pinned=p_cursor_is_pinned
          and (0::real,p.created_at,p.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id)))
    order by p.is_pinned desc,p.created_at desc,p.id desc
    limit p_limit+1;
    return;
  end if;

  -- Search rank is part of every searched cursor, including newest. Ranking is
  -- completed on keys before the selected page is hydrated.
  if p_sort='newest' then
    return query
    with ranked as (
      select p.id,p.is_pinned,p.created_at,
        pg_catalog.ts_rank(
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
          p_search_query,32
        )::real search_rank
      from public.posts p
      where p.status='published' and p.deleted_at is null
        and (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
             pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query
        and (p_tag_id is null or exists(
          select 1 from public.post_tags pt
          join public.tags t on t.id=pt.tag_id and t.is_active
          where pt.post_id=p.id and pt.tag_id=p_tag_id
        ))
    )
    select r.id,r.is_pinned,r.created_at,null::bigint,r.search_rank
    from ranked r
    where p_cursor_is_pinned is null
      or r.is_pinned < p_cursor_is_pinned
      or (r.is_pinned=p_cursor_is_pinned
        and (r.search_rank,r.created_at,r.id)<(p_cursor_search_rank,p_cursor_created_at,p_cursor_id))
    order by r.is_pinned desc,r.search_rank desc,r.created_at desc,r.id desc
    limit p_limit+1;
    return;
  end if;

  -- Comments are ranked from the maintained one-row-per-post metric. There is
  -- no raw comment scan and no per-candidate aggregate helper invocation.
  if p_sort='comments' then
    return query
    with ranked as (
      select p.id,p.is_pinned,p.created_at,
        coalesce(m.comment_count,0)::bigint rank_key,
        case when p_search_query is null then 0::real else
          pg_catalog.ts_rank(
            pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
            pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
            p_search_query,32
          )::real end search_rank
      from public.posts p
      left join private.post_metrics m on m.post_id=p.id
      where p.status='published' and p.deleted_at is null
        and (p_search_query is null or
          (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
           pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query)
        and (p_tag_id is null or exists(
          select 1 from public.post_tags pt
          join public.tags t on t.id=pt.tag_id and t.is_active
          where pt.post_id=p.id and pt.tag_id=p_tag_id
        ))
    )
    select r.id,r.is_pinned,r.created_at,r.rank_key,r.search_rank
    from ranked r
    where p_cursor_is_pinned is null
      or r.is_pinned < p_cursor_is_pinned
      or (r.is_pinned=p_cursor_is_pinned
        and (r.search_rank,r.rank_key,r.created_at,r.id)
          <(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
    order by r.is_pinned desc,r.search_rank desc,r.rank_key desc,r.created_at desc,r.id desc
    limit p_limit+1;
    return;
  end if;

  -- Popularity uses only the bounded 30-UTC-day daily aggregate plus the
  -- maintained comment metric. All-time reactions are loaded after paging for
  -- display, so old reaction buckets do not participate in corpus ranking.
  return query
  with recent_reactions as materialized (
    select d.post_id,coalesce(sum(d.reaction_count),0)::bigint recent_count
    from private.post_reaction_daily_counts d
    where d.reaction_date between (pg_catalog.statement_timestamp() at time zone 'UTC')::date-29
                              and (pg_catalog.statement_timestamp() at time zone 'UTC')::date
    group by d.post_id
  ), ranked as (
    select p.id,p.is_pinned,p.created_at,
      (coalesce(m.comment_count,0)+coalesce(rr.recent_count,0)*2)::bigint rank_key,
      case when p_search_query is null then 0::real else
        pg_catalog.ts_rank(
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
          pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B'),
          p_search_query,32
        )::real end search_rank
    from public.posts p
    left join private.post_metrics m on m.post_id=p.id
    left join recent_reactions rr on rr.post_id=p.id
    where p.status='published' and p.deleted_at is null
      and (p_search_query is null or
        (pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.title),'A') ||
         pg_catalog.setweight(pg_catalog.to_tsvector('simple',p.body_markdown),'B')) @@ p_search_query)
      and (p_tag_id is null or exists(
        select 1 from public.post_tags pt
        join public.tags t on t.id=pt.tag_id and t.is_active
        where pt.post_id=p.id and pt.tag_id=p_tag_id
      ))
  )
  select r.id,r.is_pinned,r.created_at,r.rank_key,r.search_rank
  from ranked r
  where p_cursor_is_pinned is null
    or r.is_pinned < p_cursor_is_pinned
    or (r.is_pinned=p_cursor_is_pinned
      and (r.search_rank,r.rank_key,r.created_at,r.id)
        <(p_cursor_search_rank,p_cursor_rank,p_cursor_created_at,p_cursor_id))
  order by r.is_pinned desc,r.search_rank desc,r.rank_key desc,r.created_at desc,r.id desc
  limit p_limit+1;
end $$;

create or replace function public.list_public_posts(
  p_sort text,
  p_limit integer,
  p_search text default null,
  p_tag_id uuid default null,
  p_cursor_is_pinned boolean default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_rank bigint default null,
  p_cursor_id uuid default null,
  p_cursor_search_rank real default null
)
returns table(
  row_number bigint,
  id uuid,
  title text,
  excerpt text,
  created_at timestamptz,
  updated_at timestamptz,
  is_locked boolean,
  is_pinned boolean,
  author_id uuid,
  author_login text,
  author_display_name text,
  author_avatar_url text,
  tags jsonb,
  comment_count bigint,
  reaction_count bigint,
  popularity_score bigint,
  rank_key bigint,
  search_rank real
)
language plpgsql stable security definer set search_path='' as $$
declare
  v_search_query tsquery;
begin
  if p_sort is null or p_sort not in ('newest','comments','popular') then
    raise exception 'invalid post sort' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid page limit' using errcode='22023';
  end if;
  if p_search is not null and pg_catalog.char_length(pg_catalog.btrim(p_search)) > 200 then
    raise exception 'invalid search' using errcode='22023';
  end if;

  v_search_query := case
    when p_search is null or pg_catalog.btrim(p_search)='' then null
    else pg_catalog.websearch_to_tsquery('simple',pg_catalog.btrim(p_search))
  end;

  if (p_cursor_is_pinned is null) <> (p_cursor_created_at is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_id is null)
     or (p_cursor_is_pinned is null) <> (p_cursor_search_rank is null)
     or (p_cursor_is_pinned is null and p_cursor_rank is not null)
     or (p_sort='newest' and p_cursor_rank is not null)
     or (p_sort<>'newest' and p_cursor_is_pinned is not null and p_cursor_rank is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at))
     or (p_cursor_search_rank is not null and not (p_cursor_search_rank >= 0 and p_cursor_search_rank < 1))
     or (p_cursor_is_pinned is not null and v_search_query is null and p_cursor_search_rank <> 0)
     or (p_cursor_rank is not null and p_cursor_rank < 0) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;

  return query
  with page_keys as materialized (
    select k.*
    from private.public_post_page_keys(
      p_sort,p_limit,v_search_query,p_tag_id,p_cursor_is_pinned,
      p_cursor_created_at,p_cursor_rank,p_cursor_id,p_cursor_search_rank
    ) k
  ), hydrated as (
    select k.id,p.title,private.public_post_excerpt(p.id,p.body_markdown) excerpt,
      p.created_at,p.updated_at,p.is_locked,p.is_pinned,
      pr.id author_id,pr.login author_login,pr.display_name author_display_name,pr.avatar_url author_avatar_url,
      coalesce(t.tags,'[]'::jsonb) tags,
      c.comment_count,c.reaction_count,c.popularity_score,k.rank_key,k.search_rank
    from page_keys k
    join public.posts p on p.id=k.id
    join public.profiles pr on pr.id=p.author_id
    cross join lateral private.public_post_counts(p.id) c
    left join lateral (
      select jsonb_agg(
        jsonb_build_object('id',tag.id,'slug',tag.slug,'label',tag.label)
        order by tag.sort_order,tag.label,tag.id
      ) tags
      from public.post_tags pt
      join public.tags tag on tag.id=pt.tag_id and tag.is_active
      where pt.post_id=p.id
    ) t on true
  )
  select pg_catalog.row_number() over (
           order by x.is_pinned desc,x.search_rank desc,x.rank_key desc nulls last,x.created_at desc,x.id desc
         ),x.*
  from hydrated x
  order by x.is_pinned desc,x.search_rank desc,x.rank_key desc nulls last,x.created_at desc,x.id desc;
end $$;

alter function private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
alter function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) owner to postgres;
revoke all on function private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated,service_role;
revoke all on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) from public,anon,authenticated,service_role;
grant execute on function public.list_public_posts(text,integer,text,uuid,boolean,timestamptz,bigint,uuid,real) to anon,authenticated;

commit;
