-- Task 3: fail-closed browser grants, public-read RLS, and controlled mutations.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
alter schema private owner to postgres;

-- These limits are production invariants, not optional development seed data.
insert into public.rate_limit_rules (id, action, window_seconds, max_requests, is_enabled)
values
  ('b1000000-0000-0000-0000-000000000001', 'post.create', 600, 5, true),
  ('b1000000-0000-0000-0000-000000000002', 'post.create', 86400, 30, true),
  ('b1000000-0000-0000-0000-000000000003', 'comment.create', 600, 20, true),
  ('b1000000-0000-0000-0000-000000000004', 'comment.create', 86400, 200, true),
  ('b1000000-0000-0000-0000-000000000005', 'report.create', 86400, 10, true)
on conflict (action, window_seconds) do update
set max_requests = excluded.max_requests,
    is_enabled = excluded.is_enabled,
    updated_at = pg_catalog.clock_timestamp();

create function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or not exists (select 1 from public.profiles p where p.id = caller_id) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return caller_id;
end;
$$;

create function private.validate_post_tags(p_tag_ids uuid[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  supplied_count integer := coalesce(pg_catalog.cardinality(p_tag_ids), 0);
  active_distinct_count integer;
begin
  select count(distinct t.id)::integer
    into active_distinct_count
    from public.tags t
   where t.id = any(coalesce(p_tag_ids, array[]::uuid[]))
     and t.is_active;

  if supplied_count < 1 or supplied_count > 3 or active_distinct_count <> supplied_count then
    raise exception 'post requires between 1 and 3 active tags' using errcode = '22023';
  end if;
end;
$$;

create function private.require_read_committed()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'mutation RPCs require READ COMMITTED isolation' using errcode = '0A000';
  end if;
end;
$$;

-- Duplicate-body matching is intentionally case-sensitive. It trims outer
-- whitespace and collapses every internal whitespace run to one ASCII space.
create function private.normalize_duplicate_body(p_body text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.btrim(p_body), '[[:space:]]+', ' ', 'g')
$$;

create function private.consume_rate_limit(p_user_id uuid, p_action text, p_idempotency_key text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  rule record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rate-limit:' || p_user_id::text || ':' || p_action, 0)
  );

  for rule in
    select r.window_seconds, r.max_requests
      from public.rate_limit_rules r
     where r.action = p_action and r.is_enabled
     order by r.window_seconds
  loop
    if (select count(*) from public.rate_limit_events e
         where e.user_id = p_user_id
           and e.action = p_action
           and e.occurred_at > pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => rule.window_seconds)) >= rule.max_requests then
      raise sqlstate 'PGRST' using
        message = pg_catalog.format(
          '{"code":"rate_limit_exceeded","message":"Rate limit exceeded","details":%s,"hint":"Retry later"}',
          pg_catalog.to_json(p_action)::text
        ),
        detail = pg_catalog.jsonb_build_object(
          'status', 429,
          'headers', pg_catalog.jsonb_build_object('Retry-After', rule.window_seconds::text)
        )::text;
    end if;
  end loop;

  insert into public.rate_limit_events(user_id, action, idempotency_key, occurred_at)
  values (p_user_id, p_action, p_idempotency_key, pg_catalog.clock_timestamp());
end;
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
     where r.user_id = auth.uid() and r.role = 'admin'
  )
$$;

alter function private.require_user() owner to postgres;
alter function private.validate_post_tags(uuid[]) owner to postgres;
alter function private.require_read_committed() owner to postgres;
alter function private.normalize_duplicate_body(text) owner to postgres;
alter function private.consume_rate_limit(uuid, text, text) owner to postgres;
alter function public.is_admin() owner to postgres;
revoke all on function private.require_user() from public, anon, authenticated;
revoke all on function private.validate_post_tags(uuid[]) from public, anon, authenticated;
revoke all on function private.require_read_committed() from public, anon, authenticated;
revoke all on function private.normalize_duplicate_body(text) from public, anon, authenticated;
revoke all on function private.consume_rate_limit(uuid, text, text) from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- Public reads are deliberately limited both by grants (profile columns) and RLS.
grant select (id, login, display_name, avatar_url, created_at) on public.profiles to anon, authenticated;
grant select on public.posts, public.comments, public.tags, public.post_tags to anon, authenticated;

create policy profiles_public_read on public.profiles
  for select to anon, authenticated using (true);
create policy posts_public_read on public.posts
  for select to anon, authenticated using (status = 'published' and deleted_at is null);
create policy comments_public_read on public.comments
  for select to anon, authenticated using (
    status = 'published' and deleted_at is null and exists (
      select 1 from public.posts p
       where p.id = comments.post_id and p.status = 'published' and p.deleted_at is null
    )
  );
create policy tags_public_read on public.tags
  for select to anon, authenticated using (is_active);
create policy post_tags_public_read on public.post_tags
  for select to anon, authenticated using (
    exists (select 1 from public.posts p where p.id = post_tags.post_id and p.status = 'published' and p.deleted_at is null)
    and exists (select 1 from public.tags t where t.id = post_tags.tag_id and t.is_active)
  );
create function public.create_post(
  p_title text, p_body_markdown text, p_tag_ids uuid[], p_idempotency_key text
)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; normalized_body text;
  request_fingerprint text; previous public.idempotency_keys%rowtype;
  new_id uuid; canonical_tags uuid[];
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  select array_agg(x order by x) into canonical_tags from unnest(p_tag_ids) x;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('title',p_title,'body',p_body_markdown,'tags',canonical_tags)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':post.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k
   where k.user_id=caller_id and k.operation='post.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='post.create' and k.key=canonical_key;
  perform private.validate_post_tags(p_tag_ids);
  normalized_body := private.normalize_duplicate_body(p_body_markdown);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-body:'||caller_id::text||':post:'||pg_catalog.md5(normalized_body),0));
  if exists(select 1 from public.posts p where p.author_id=caller_id and p.created_at>pg_catalog.clock_timestamp()-interval '10 minutes' and private.normalize_duplicate_body(p.body_markdown)=normalized_body) then
    raise exception 'duplicate post body within 10 minutes' using errcode='23505';
  end if;
  perform private.consume_rate_limit(caller_id,'post.create',canonical_key);
  insert into public.posts(author_id,title,body_markdown) values(caller_id,p_title,p_body_markdown) returning id into new_id;
  insert into public.post_tags(post_id,tag_id) select new_id,x from unnest(canonical_tags) x;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'post.create',canonical_key,request_fingerprint,'post',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

create function public.update_post(p_post_id uuid, p_title text, p_body_markdown text, p_tag_ids uuid[])
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; canonical_tags uuid[];
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform private.validate_post_tags(p_tag_ids);
  select array_agg(x order by x) into canonical_tags from unnest(p_tag_ids) x;
  perform 1 from public.posts p where p.id=p_post_id and p.author_id=caller_id and p.status='published' and p.deleted_at is null for update;
  if not found then raise exception 'post not found or not editable' using errcode='42501'; end if;
  update public.posts set title=p_title,body_markdown=p_body_markdown,updated_at=pg_catalog.clock_timestamp() where id=p_post_id;
  delete from public.post_tags where post_id=p_post_id;
  insert into public.post_tags(post_id,tag_id) select p_post_id,x from unnest(canonical_tags) x;
  return p_post_id;
end;
$$;

create function public.soft_delete_post(p_post_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  update public.posts set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
   where id=p_post_id and author_id=caller_id and status='published' and deleted_at is null;
  if not found then raise exception 'post not found or not editable' using errcode='42501'; end if;
  return p_post_id;
end;
$$;

create function public.create_comment(p_post_id uuid, p_parent_id uuid, p_body_markdown text, p_idempotency_key text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; normalized_body text;
  request_fingerprint text; previous public.idempotency_keys%rowtype; new_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then raise exception 'invalid idempotency key' using errcode='22023'; end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('post',p_post_id,'parent',p_parent_id,'body',p_body_markdown)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':comment.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k where k.user_id=caller_id and k.operation='comment.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='comment.create' and k.key=canonical_key;
  normalized_body := private.normalize_duplicate_body(p_body_markdown);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('duplicate-body:'||caller_id::text||':comment:'||pg_catalog.md5(normalized_body),0));
  if exists(select 1 from public.comments c where c.author_id=caller_id and c.created_at>pg_catalog.clock_timestamp()-interval '10 minutes' and private.normalize_duplicate_body(c.body_markdown)=normalized_body) then
    raise exception 'duplicate comment body within 10 minutes' using errcode='23505';
  end if;
  -- Shared validation locks preserve post-then-comment order while allowing
  -- independent interactions; moderation UPDATE/DELETE still conflicts.
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null and not p.is_locked for share;
  if not found then raise exception 'post not found, visible, or unlocked' using errcode='22023'; end if;
  if p_parent_id is not null then
    perform 1 from public.comments c where c.id=p_parent_id and c.post_id=p_post_id and c.parent_id is null and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'parent must be a visible top-level comment on the same post' using errcode='22023'; end if;
  end if;
  perform private.consume_rate_limit(caller_id,'comment.create',canonical_key);
  insert into public.comments(post_id,author_id,parent_id,body_markdown) values(p_post_id,caller_id,p_parent_id,p_body_markdown) returning id into new_id;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'comment.create',canonical_key,request_fingerprint,'comment',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

create function public.update_comment(p_comment_id uuid, p_body_markdown text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.comments c where c.id=p_comment_id and c.author_id=caller_id and c.status='published' and c.deleted_at is null for update;
  if not found then raise exception 'comment not found or not editable' using errcode='42501'; end if;
  update public.comments set body_markdown=p_body_markdown,updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  return p_comment_id;
end;
$$;

create function public.soft_delete_comment(p_comment_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.comments c where c.id=p_comment_id and c.author_id=caller_id and c.status='published' and c.deleted_at is null for update;
  if not found then raise exception 'comment not found or not editable' using errcode='42501'; end if;
  update public.comments set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  return p_comment_id;
end;
$$;

create function public.toggle_post_reaction(p_post_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; removed uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  perform 1 from public.posts p where p.id=p_post_id and p.status='published' and p.deleted_at is null for share;
  if not found then raise exception 'post not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('post-reaction:'||caller_id::text||':'||p_post_id::text,0));
  delete from public.post_reactions where user_id=caller_id and post_id=p_post_id returning id into removed;
  if removed is not null then return false; end if;
  insert into public.post_reactions(user_id,post_id) values(caller_id,p_post_id);
  return true;
end;
$$;

create function public.toggle_comment_reaction(p_comment_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare caller_id uuid; removed uuid; target_post_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  select c.post_id into target_post_id from public.comments c where c.id=p_comment_id;
  -- Moderation must use the same post-then-comment row-lock order.
  perform 1 from public.posts p where p.id=target_post_id and p.status='published' and p.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform 1 from public.comments c where c.id=p_comment_id and c.post_id=target_post_id and c.status='published' and c.deleted_at is null for share;
  if not found then raise exception 'comment not found or visible' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment-reaction:'||caller_id::text||':'||p_comment_id::text,0));
  delete from public.comment_reactions where user_id=caller_id and comment_id=p_comment_id returning id into removed;
  if removed is not null then return false; end if;
  insert into public.comment_reactions(user_id,comment_id) values(caller_id,p_comment_id);
  return true;
end;
$$;

create function public.create_report(p_target_type text, p_target_id uuid, p_reason_code text, p_detail text, p_idempotency_key text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller_id uuid; canonical_key text; target_post_id uuid;
  request_fingerprint text; previous public.idempotency_keys%rowtype; new_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  canonical_key := pg_catalog.btrim(p_idempotency_key);
  if canonical_key is null or pg_catalog.char_length(canonical_key) not between 1 and 200 then raise exception 'invalid idempotency key' using errcode='22023'; end if;
  request_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('type',p_target_type,'target',p_target_id,'reason',p_reason_code,'detail',p_detail)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||caller_id::text||':report.create:'||canonical_key,0));
  select * into previous from public.idempotency_keys k where k.user_id=caller_id and k.operation='report.create' and k.key=canonical_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if previous.request_hash<>request_fingerprint then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return previous.resource_id;
  end if;
  delete from public.idempotency_keys k where k.user_id=caller_id and k.operation='report.create' and k.key=canonical_key;
  if p_target_type='post' then
    perform 1 from public.posts p where p.id=p_target_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  elsif p_target_type='comment' then
    select c.post_id into target_post_id from public.comments c where c.id=p_target_id;
    -- Moderation must use the same post-then-comment row-lock order.
    perform 1 from public.posts p where p.id=target_post_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
    perform 1 from public.comments c where c.id=p_target_id and c.post_id=target_post_id and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  else
    raise exception 'report target not found or visible' using errcode='22023';
  end if;
  if exists(select 1 from public.reports r where r.reporter_id=caller_id and r.target_type=p_target_type and r.target_id=p_target_id and r.status in ('open','reviewing')) then raise exception 'open report already exists' using errcode='23505'; end if;
  perform private.consume_rate_limit(caller_id,'report.create',canonical_key);
  insert into public.reports(reporter_id,target_type,target_id,reason_code,detail) values(caller_id,p_target_type,p_target_id,p_reason_code,p_detail) returning id into new_id;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(caller_id,'report.create',canonical_key,request_fingerprint,'report',new_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return new_id;
end;
$$;

alter function public.create_post(text,text,uuid[],text) owner to postgres;
alter function public.update_post(uuid,text,text,uuid[]) owner to postgres;
alter function public.soft_delete_post(uuid) owner to postgres;
alter function public.create_comment(uuid,uuid,text,text) owner to postgres;
alter function public.update_comment(uuid,text) owner to postgres;
alter function public.soft_delete_comment(uuid) owner to postgres;
alter function public.toggle_post_reaction(uuid) owner to postgres;
alter function public.toggle_comment_reaction(uuid) owner to postgres;
alter function public.create_report(text,uuid,text,text,text) owner to postgres;

revoke all on function public.create_post(text,text,uuid[],text) from public, anon, authenticated;
revoke all on function public.update_post(uuid,text,text,uuid[]) from public, anon, authenticated;
revoke all on function public.soft_delete_post(uuid) from public, anon, authenticated;
revoke all on function public.create_comment(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.update_comment(uuid,text) from public, anon, authenticated;
revoke all on function public.soft_delete_comment(uuid) from public, anon, authenticated;
revoke all on function public.toggle_post_reaction(uuid) from public, anon, authenticated;
revoke all on function public.toggle_comment_reaction(uuid) from public, anon, authenticated;
revoke all on function public.create_report(text,uuid,text,text,text) from public, anon, authenticated;

grant execute on function public.create_post(text,text,uuid[],text) to authenticated;
grant execute on function public.update_post(uuid,text,text,uuid[]) to authenticated;
grant execute on function public.soft_delete_post(uuid) to authenticated;
grant execute on function public.create_comment(uuid,uuid,text,text) to authenticated;
grant execute on function public.update_comment(uuid,text) to authenticated;
grant execute on function public.soft_delete_comment(uuid) to authenticated;
grant execute on function public.toggle_post_reaction(uuid) to authenticated;
grant execute on function public.toggle_comment_reaction(uuid) to authenticated;
grant execute on function public.create_report(text,uuid,text,text,text) to authenticated;
