-- Task 12: moderation queue, controlled state transitions, and append-only audit evidence.
begin;

create function private.require_admin()
returns uuid language plpgsql stable set search_path='' as $$
declare v_actor uuid;
begin
  v_actor:=private.require_user();
  if not exists(select 1 from public.user_roles r where r.user_id=v_actor and r.role='admin') then
    raise exception 'admin required' using errcode='42501';
  end if;
  return v_actor;
end $$;

create function private.moderation_key(p_key text)
returns text language plpgsql immutable set search_path='' as $$
declare v_key text:=pg_catalog.btrim(p_key);
begin
  if v_key is null or pg_catalog.char_length(v_key) not between 1 and 200 then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  return v_key;
end $$;

create function private.moderation_reason(p_reason text)
returns text language plpgsql immutable set search_path='' as $$
declare v_reason text:=pg_catalog.btrim(p_reason);
begin
  if v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 2000 then
    raise exception 'invalid moderation reason' using errcode='22023';
  end if;
  return v_reason;
end $$;

create function private.report_queue_item(p_report_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',r.id,'status',r.status,'reason_code',r.reason_code,'detail',r.detail,
    'created_at',r.created_at,'resolved_at',r.resolved_at,'resolved_by',r.resolved_by,
    'reporter',pg_catalog.jsonb_build_object('id',u.id,'login',u.login,'display_name',u.display_name,'avatar_url',u.avatar_url),
    'target',case r.target_type
      when 'post' then case when p.id is null
        then pg_catalog.jsonb_build_object('type','post','id',r.target_id,'available',false)
        else pg_catalog.jsonb_build_object(
          'type','post','id',r.target_id,'available',true,'post_id',p.id,'status',p.status,'title',p.title,
          'excerpt',pg_catalog.left(pg_catalog.regexp_replace(p.body_markdown,'[[:space:]]+',' ','g'),240),
          'is_locked',p.is_locked,'is_pinned',p.is_pinned)
        end
      when 'comment' then case when c.id is null
        then pg_catalog.jsonb_build_object('type','comment','id',r.target_id,'available',false)
        else pg_catalog.jsonb_build_object(
          'type','comment','id',r.target_id,'available',true,'post_id',p.id,'status',c.status,'title',p.title,
          'excerpt',pg_catalog.left(pg_catalog.regexp_replace(c.body_markdown,'[[:space:]]+',' ','g'),240),
          'is_locked',p.is_locked,'is_pinned',p.is_pinned)
        end
    end)
  from public.reports r
  join public.profiles u on u.id=r.reporter_id
  left join public.comments c on r.target_type='comment' and c.id=r.target_id
  left join public.posts p on p.id=case when r.target_type='post' then r.target_id else c.post_id end
  where r.id=p_report_id
$$;

create function private.moderation_post_state(p_post_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',p.id,'status',p.status,'is_locked',p.is_locked,
    'is_pinned',p.is_pinned,'updated_at',p.updated_at,'deleted_at',p.deleted_at)
  from public.posts p where p.id=p_post_id
$$;

create function private.moderation_comment_state(p_comment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',c.id,'post_id',c.post_id,'status',c.status,
    'updated_at',c.updated_at,'deleted_at',c.deleted_at)
  from public.comments c where c.id=p_comment_id
$$;

create function private.moderation_tag_state(p_tag_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('id',t.id,'slug',t.slug,'label',t.label,
    'is_active',t.is_active,'sort_order',t.sort_order)
  from public.tags t where t.id=p_tag_id
$$;

create function private.enforce_report_updates()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason_code is distinct from old.reason_code
     or new.detail is distinct from old.detail
     or new.created_at is distinct from old.created_at then
    raise exception 'report immutable fields cannot change' using errcode='23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='open' and new.status in ('reviewing','resolved','dismissed'))
    or (old.status='reviewing' and new.status in ('resolved','dismissed'))
  ) then
    raise exception 'illegal report status transition' using errcode='23514';
  end if;
  if (new.resolved_at is distinct from old.resolved_at or new.resolved_by is distinct from old.resolved_by)
     and not (old.status in ('open','reviewing') and new.status in ('resolved','dismissed')) then
    raise exception 'report resolution fields may change only on terminal transition' using errcode='23514';
  end if;
  return new;
end $$;
create trigger reports_enforce_updates before update on public.reports
for each row execute function private.enforce_report_updates();

create function private.enforce_content_status_transition()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status is distinct from old.status and not (
    (old.status='published' and new.status in ('hidden','deleted'))
    or (old.status='hidden' and new.status in ('published','deleted'))
    -- Privileged restore workflows remain available during the existing
    -- soft-delete retention window. Browser roles still have no table UPDATE,
    -- and moderation RPCs deliberately reject restoring deleted content.
    or (old.status='deleted' and new.status in ('published','hidden'))
  ) then
    raise exception 'illegal % status transition',pg_catalog.rtrim(tg_table_name,'s') using errcode='23514';
  end if;
  return new;
end $$;
create trigger posts_enforce_status_transition before update of status on public.posts
for each row execute function private.enforce_content_status_transition();
create trigger comments_enforce_status_transition before update of status on public.comments
for each row execute function private.enforce_content_status_transition();

create function private.enforce_audit_append_only()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
     and old.actor_id is not null and new.actor_id is null
     and (pg_catalog.to_jsonb(new)-'actor_id')=(pg_catalog.to_jsonb(old)-'actor_id')
     and not exists(select 1 from public.profiles p where p.id=old.actor_id) then
    return new;
  end if;
  raise exception 'moderation audit logs are append-only' using errcode='23514';
end $$;
create trigger moderation_audit_logs_append_only_row
before update or delete on public.moderation_audit_logs
for each row execute function private.enforce_audit_append_only();
create trigger moderation_audit_logs_append_only_truncate
before truncate on public.moderation_audit_logs
for each statement execute function private.enforce_audit_append_only();

drop index public.reports_queue_idx;
drop index public.moderation_audit_logs_target_idx;
create index reports_queue_idx on public.reports(created_at desc,id desc)
  where status in ('open','reviewing');
create index reports_created_id_idx on public.reports(created_at desc,id desc);
create index reports_status_created_id_idx on public.reports(status,created_at desc,id desc);
create index moderation_audit_logs_target_created_id_idx
  on public.moderation_audit_logs(target_type,target_id,created_at desc,id desc);

create function public.create_report_v2(
  p_target_type text,p_target_id uuid,p_reason_code text,p_detail text,p_idempotency_key text
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_detail text; v_hash text;
  v_previous public.idempotency_keys%rowtype; v_id uuid; v_post_id uuid;
begin
  perform private.require_read_committed();
  v_actor:=private.require_user();
  v_key:=private.moderation_key(p_idempotency_key);
  v_reason:=pg_catalog.lower(pg_catalog.btrim(p_reason_code));
  v_detail:=nullif(pg_catalog.btrim(p_detail),'');
  if v_reason is null or v_reason not in ('spam','harassment','harmful','other') then
    raise exception 'invalid report reason' using errcode='22023';
  end if;
  if v_detail is not null and pg_catalog.char_length(v_detail)>2000 then
    raise exception 'invalid report detail' using errcode='22023';
  end if;
  if v_reason='other' and v_detail is null then
    raise exception 'report detail required for other' using errcode='22023';
  end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('type',p_target_type,'target',p_target_id,'reason',v_reason,'detail',v_detail)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':report.create.v2:'||v_key,0));
  select * into v_previous from public.idempotency_keys k
   where k.user_id=v_actor and k.operation='report.create.v2' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return v_previous.resource_id;
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='report.create.v2' and key=v_key;
  if p_target_type='post' then
    perform 1 from public.posts p where p.id=p_target_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  elsif p_target_type='comment' then
    select c.post_id into v_post_id from public.comments c where c.id=p_target_id;
    perform 1 from public.posts p where p.id=v_post_id and p.status='published' and p.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
    perform 1 from public.comments c where c.id=p_target_id and c.post_id=v_post_id and c.status='published' and c.deleted_at is null for share;
    if not found then raise exception 'report target not found or visible' using errcode='22023'; end if;
  else
    raise exception 'report target not found or visible' using errcode='22023';
  end if;
  if exists(select 1 from public.reports r where r.reporter_id=v_actor and r.target_type=p_target_type and r.target_id=p_target_id and r.status in ('open','reviewing')) then
    raise exception 'open report already exists' using errcode='23505';
  end if;
  perform private.consume_rate_limit(v_actor,'report.create',v_key);
  insert into public.reports(reporter_id,target_type,target_id,reason_code,detail)
  values(v_actor,p_target_type,p_target_id,v_reason,v_detail) returning id into v_id;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'report.created','report',v_id,null,pg_catalog.jsonb_build_object('reported_target_type',p_target_type,'reported_target_id',p_target_id));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'report.create.v2',v_key,v_hash,'report',v_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return v_id;
end $$;

create function public.list_moderation_reports_v1(
  p_status text default 'active',p_limit integer default 50,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('active','open','reviewing','resolved','dismissed','all') then
    raise exception 'invalid report status filter' using errcode='22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null)
     or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then
    raise exception 'invalid cursor' using errcode='22023';
  end if;
  with candidates as materialized (
    select r.id,r.created_at,private.report_queue_item(r.id) item
    from public.reports r
    where (p_status='all' or (p_status='active' and r.status in ('open','reviewing')) or r.status=p_status)
      and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from candidates),
         case when (select pg_catalog.count(*)>p_limit from candidates)
           then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
           else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.set_report_status_v1(
  p_report_id uuid,p_expected_status text,p_desired_status text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_report public.reports%rowtype; v_post_id uuid;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('report',p_report_id,'expected',p_expected_status,'desired',p_desired_status,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':report.status.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='report.status.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.report_queue_item(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='report.status.v1' and key=v_key;
  select * into v_report from public.reports where id=p_report_id;
  if not found then raise exception 'report not found' using errcode='22023'; end if;
  if v_report.target_type='post' then
    v_post_id:=v_report.target_id;
  else
    select post_id into v_post_id from public.comments where id=v_report.target_id;
  end if;
  if v_post_id is not null then
    perform 1 from public.posts where id=v_post_id for update;
    if v_report.target_type='comment' then
      perform 1 from public.comments where id=v_report.target_id and post_id=v_post_id for update;
    end if;
  end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if v_report.status is distinct from p_expected_status then raise exception 'report state changed' using errcode='40001'; end if;
  if not ((v_report.status='open' and p_desired_status in ('reviewing','resolved','dismissed')) or (v_report.status='reviewing' and p_desired_status in ('resolved','dismissed'))) then
    raise exception 'report status transition not allowed' using errcode='22023';
  end if;
  update public.reports set status=p_desired_status,
    resolved_at=case when p_desired_status in ('resolved','dismissed') then pg_catalog.clock_timestamp() else null end,
    resolved_by=case when p_desired_status in ('resolved','dismissed') then v_actor else null end
  where id=p_report_id;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'report.status_changed','report',p_report_id,v_reason,pg_catalog.jsonb_build_object('from',v_report.status,'to',p_desired_status));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'report.status.v1',v_key,v_hash,'report',p_report_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.report_queue_item(p_report_id);
end $$;

create function public.moderate_post_v1(
  p_post_id uuid,p_expected_status text,p_expected_locked boolean,p_expected_pinned boolean,
  p_action text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_post public.posts%rowtype; v_changed boolean:=false;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_action is null or p_action not in ('hide','restore','lock','unlock','pin','unpin','delete') then raise exception 'invalid post moderation action' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('post',p_post_id,'expected_status',p_expected_status,'expected_locked',p_expected_locked,'expected_pinned',p_expected_pinned,'action',p_action,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':post.moderate.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='post.moderate.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_post_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='post.moderate.v1' and key=v_key;
  select * into v_post from public.posts where id=p_post_id for update;
  if not found then raise exception 'post not found' using errcode='22023'; end if;
  if v_post.status is distinct from p_expected_status or v_post.is_locked is distinct from p_expected_locked or v_post.is_pinned is distinct from p_expected_pinned then raise exception 'post state changed' using errcode='40001'; end if;
  if v_post.status='deleted'
     or (p_action='hide' and v_post.status<>'published')
     or (p_action='restore' and v_post.status<>'hidden')
     or (p_action='delete' and v_post.status not in ('published','hidden'))
     or (p_action='pin' and v_post.status<>'published') then
    raise exception 'post moderation transition not allowed' using errcode='22023';
  end if;
  if p_action='hide' then update public.posts set status='hidden',is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='restore' then update public.posts set status='published',updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='delete' then update public.posts set status='deleted',deleted_at=pg_catalog.clock_timestamp(),is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='lock' and not v_post.is_locked then update public.posts set is_locked=true,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='unlock' and v_post.is_locked then update public.posts set is_locked=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='pin' and not v_post.is_pinned then update public.posts set is_pinned=true,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  elsif p_action='unpin' and v_post.is_pinned then update public.posts set is_pinned=false,updated_at=pg_catalog.clock_timestamp() where id=p_post_id; v_changed:=true;
  end if;
  if not v_changed then
    raise exception 'post moderation action has no effect' using errcode='22023';
  end if;
  if v_changed then
    insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
    values(v_actor,'post.'||p_action,'post',p_post_id,v_reason,pg_catalog.jsonb_build_object('prior_status',v_post.status,'prior_locked',v_post.is_locked,'prior_pinned',v_post.is_pinned));
  end if;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'post.moderate.v1',v_key,v_hash,'post',p_post_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_post_state(p_post_id);
end $$;

create function public.moderate_comment_v1(
  p_comment_id uuid,p_expected_status text,p_action text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_comment public.comments%rowtype; v_post_id uuid;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_action is null or p_action not in ('hide','restore','delete') then raise exception 'invalid comment moderation action' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('comment',p_comment_id,'expected',p_expected_status,'action',p_action,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':comment.moderate.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='comment.moderate.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_comment_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='comment.moderate.v1' and key=v_key;
  select c.post_id into v_post_id from public.comments c where c.id=p_comment_id;
  perform 1 from public.posts p where p.id=v_post_id for update;
  select * into v_comment from public.comments c where c.id=p_comment_id and c.post_id=v_post_id for update;
  if not found then raise exception 'comment not found' using errcode='22023'; end if;
  if v_comment.status is distinct from p_expected_status then raise exception 'comment state changed' using errcode='40001'; end if;
  if not ((v_comment.status='published' and p_action in ('hide','delete')) or (v_comment.status='hidden' and p_action in ('restore','delete'))) then
    raise exception 'comment moderation transition not allowed' using errcode='22023';
  end if;
  if p_action='hide' then update public.comments set status='hidden',updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  elsif p_action='restore' then update public.comments set status='published',updated_at=pg_catalog.clock_timestamp() where id=p_comment_id;
  else update public.comments set status='deleted',deleted_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p_comment_id; end if;
  insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
  values(v_actor,'comment.'||p_action,'comment',p_comment_id,v_reason,pg_catalog.jsonb_build_object('from',v_comment.status,'to',case p_action when 'hide' then 'hidden' when 'restore' then 'published' else 'deleted' end,'post_id',v_post_id));
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'comment.moderate.v1',v_key,v_hash,'comment',p_comment_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_comment_state(p_comment_id);
end $$;

create function public.list_moderation_audit_logs_v1(
  p_limit integer default 50,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_target_type text default null,p_target_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_items jsonb; v_has_more boolean; v_next jsonb;
begin
  perform private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid page limit' using errcode='22023'; end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) or (p_cursor_created_at is not null and not pg_catalog.isfinite(p_cursor_created_at)) then raise exception 'invalid cursor' using errcode='22023'; end if;
  if (p_target_type is null)<>(p_target_id is null) then raise exception 'invalid target filter' using errcode='22023'; end if;
  with candidates as materialized (
    select l.id,l.created_at,pg_catalog.jsonb_build_object(
      'id',l.id,'actor',case when a.id is null then null else pg_catalog.jsonb_build_object('id',a.id,'login',a.login,'display_name',a.display_name,'avatar_url',a.avatar_url) end,
      'action',l.action,'target_type',l.target_type,'target_id',l.target_id,'reason',l.reason,'metadata',l.metadata,'created_at',l.created_at) item
    from public.moderation_audit_logs l left join public.profiles a on a.id=l.actor_id
    where (p_target_type is null or (l.target_type=p_target_type and l.target_id=p_target_id))
      and (p_cursor_created_at is null or (l.created_at,l.id)<(p_cursor_created_at,p_cursor_id))
    order by l.created_at desc,l.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce(pg_catalog.jsonb_agg(item order by created_at desc,id desc),'[]'::jsonb),
         (select pg_catalog.count(*)>p_limit from candidates),
         case when (select pg_catalog.count(*)>p_limit from candidates)
           then (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
           else 'null'::jsonb end
  into v_items,v_has_more,v_next from page;
  return pg_catalog.jsonb_build_object('items',v_items,'has_more',v_has_more,'next_cursor',v_next);
end $$;

create function public.set_tag_active_v1(
  p_tag_id uuid,p_expected_active boolean,p_desired_active boolean,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid; v_key text; v_reason text; v_hash text; v_previous public.idempotency_keys%rowtype;
  v_active boolean;
begin
  perform private.require_read_committed(); v_actor:=private.require_admin();
  v_key:=private.moderation_key(p_idempotency_key); v_reason:=private.moderation_reason(p_reason);
  if p_expected_active is null or p_desired_active is null then raise exception 'invalid tag active state' using errcode='22023'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('tag',p_tag_id,'expected',p_expected_active,'desired',p_desired_active,'reason',v_reason)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('idem:'||v_actor::text||':tag.active.v1:'||v_key,0));
  select * into v_previous from public.idempotency_keys k where k.user_id=v_actor and k.operation='tag.active.v1' and k.key=v_key and k.expires_at>pg_catalog.clock_timestamp();
  if found then
    if v_previous.request_hash<>v_hash then raise exception 'idempotency key reused with different request' using errcode='22023'; end if;
    return private.moderation_tag_state(v_previous.resource_id);
  end if;
  delete from public.idempotency_keys where user_id=v_actor and operation='tag.active.v1' and key=v_key;
  select t.is_active into v_active from public.tags t where t.id=p_tag_id for update;
  if not found then raise exception 'tag not found' using errcode='22023'; end if;
  if v_active is distinct from p_expected_active then raise exception 'tag state changed' using errcode='40001'; end if;
  if v_active is not distinct from p_desired_active then
    raise exception 'tag active state has no effect' using errcode='22023';
  end if;
  if v_active is distinct from p_desired_active then
    update public.tags set is_active=p_desired_active where id=p_tag_id;
    insert into public.moderation_audit_logs(actor_id,action,target_type,target_id,reason,metadata)
    values(v_actor,'tag.active_changed','tag',p_tag_id,v_reason,pg_catalog.jsonb_build_object('from',v_active,'to',p_desired_active));
  end if;
  insert into public.idempotency_keys(user_id,operation,key,request_hash,resource_type,resource_id,expires_at)
  values(v_actor,'tag.active.v1',v_key,v_hash,'tag',p_tag_id,pg_catalog.clock_timestamp()+interval '24 hours');
  return private.moderation_tag_state(p_tag_id);
end $$;

alter function private.require_admin() owner to postgres;
alter function private.moderation_key(text) owner to postgres;
alter function private.moderation_reason(text) owner to postgres;
alter function private.report_queue_item(uuid) owner to postgres;
alter function private.moderation_post_state(uuid) owner to postgres;
alter function private.moderation_comment_state(uuid) owner to postgres;
alter function private.moderation_tag_state(uuid) owner to postgres;
alter function private.enforce_report_updates() owner to postgres;
alter function private.enforce_content_status_transition() owner to postgres;
alter function private.enforce_audit_append_only() owner to postgres;
alter function public.create_report_v2(text,uuid,text,text,text) owner to postgres;
alter function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) owner to postgres;
alter function public.set_report_status_v1(uuid,text,text,text,text) owner to postgres;
alter function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) owner to postgres;
alter function public.moderate_comment_v1(uuid,text,text,text,text) owner to postgres;
alter function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) owner to postgres;
alter function public.set_tag_active_v1(uuid,boolean,boolean,text,text) owner to postgres;

revoke all on function private.require_admin() from public,anon,authenticated,service_role;
revoke all on function private.moderation_key(text) from public,anon,authenticated,service_role;
revoke all on function private.moderation_reason(text) from public,anon,authenticated,service_role;
revoke all on function private.report_queue_item(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_post_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_comment_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.moderation_tag_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.enforce_report_updates() from public,anon,authenticated,service_role;
revoke all on function private.enforce_content_status_transition() from public,anon,authenticated,service_role;
revoke all on function private.enforce_audit_append_only() from public,anon,authenticated,service_role;
revoke all on function public.create_report_v2(text,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_report_status_v1(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.moderate_comment_v1(uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_tag_active_v1(uuid,boolean,boolean,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.create_report(text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_report_v2(text,uuid,text,text,text) to authenticated;
grant execute on function public.list_moderation_reports_v1(text,integer,timestamptz,uuid) to authenticated;
grant execute on function public.set_report_status_v1(uuid,text,text,text,text) to authenticated;
grant execute on function public.moderate_post_v1(uuid,text,boolean,boolean,text,text,text) to authenticated;
grant execute on function public.moderate_comment_v1(uuid,text,text,text,text) to authenticated;
grant execute on function public.list_moderation_audit_logs_v1(integer,timestamptz,uuid,text,uuid) to authenticated;
grant execute on function public.set_tag_active_v1(uuid,boolean,boolean,text,text) to authenticated;

commit;
