-- Task 4: private image storage and intent-first attachment lifecycle.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-images',
  'community-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.attachments
  add column client_key uuid,
  add column payload_sha256 text,
  add column cleanup_attempt_count integer not null default 0,
  add column next_attempt_at timestamptz default pg_catalog.clock_timestamp(),
  add column cleanup_claim_token uuid,
  add column cleanup_lease_until timestamptz,
  add column cleanup_last_error text,
  drop constraint attachments_status_check,
  drop constraint attachments_state_check;

-- Rows without upload identity predate the managed intent lifecycle. Preserve
-- valid linked attachments and unlinked pending rows, including their real
-- object paths. Only contradictory legacy linkage is made cleanup-safe.
update public.attachments
   set status = 'quarantined',
       post_id = null,
       attached_at = null,
       deleted_at = null,
       cleanup_last_error = 'legacy_invalid_attachment_state',
       next_attempt_at = pg_catalog.clock_timestamp()
 where client_key is null
   and payload_sha256 is null
   and (
     (status = 'pending' and post_id is not null)
     or (status = 'attached' and post_id is null)
   );

alter table public.attachments
  add constraint attachments_status_check check (
    status in ('pending', 'attached', 'quarantined', 'deleting', 'deleted', 'cleanup_failed')
  ),
  add constraint attachments_state_check check (
    (status = 'pending' and attached_at is null and deleted_at is null)
    or (status = 'attached' and attached_at is not null and deleted_at is null)
    or (status in ('quarantined', 'deleting', 'cleanup_failed') and deleted_at is null)
    or (status = 'deleted' and deleted_at is not null)
  ),
  add constraint attachments_owner_storage_path_check check (
    (client_key is null and payload_sha256 is null)
    or storage_path ~ (
      '^' || owner_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  ),
  add constraint attachments_post_state_check check (
    (status = 'pending' and post_id is null)
    or (status = 'attached' and post_id is not null)
    or status in ('quarantined', 'deleting', 'deleted', 'cleanup_failed')
  ),
  add constraint attachments_cleanup_attempt_count_check check (
    cleanup_attempt_count between 0 and 5
  ),
  add constraint attachments_cleanup_lease_check check (
    (cleanup_claim_token is null and cleanup_lease_until is null)
    or (cleanup_claim_token is not null and cleanup_lease_until is not null)
  ),
  add constraint attachments_payload_sha256_check check (
    payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint attachments_upload_identity_check check (
    (client_key is null) = (payload_sha256 is null)
  );

-- This deliberately narrow table policy lets the Storage policy's correlated
-- legacy lookup run under the caller's real RLS context without a definer helper.
create policy attachments_select_own_attached_legacy
on public.attachments
for select
to authenticated
using (
  owner_id = auth.uid()
  and status = 'attached'
  and post_id is not null
  and client_key is null
  and payload_sha256 is null
);

-- The managed Storage branch needs the same caller-context correlation without
-- trusting a path prefix. Keep it separate from the legacy policy so identity
-- requirements remain explicit and auditable.
create policy attachments_select_own_attached_managed
on public.attachments
for select
to authenticated
using (
  owner_id = auth.uid()
  and status = 'attached'
  and post_id is not null
  and client_key is not null
  and payload_sha256 is not null
);
grant select (owner_id, post_id, storage_path, status, client_key, payload_sha256)
on public.attachments to authenticated;

-- Managed objects are readable only through their exact attached intent row.
-- Legacy objects additionally require at least one Storage owner field, and
-- every populated owner field must agree with the attachment owner. Service-role
-- uploads are ownerless, so only the managed identity branch accepts them.
create policy community_images_select_own_uuid
on storage.objects
for select
to authenticated
using (
  bucket_id = 'community-images'
  and archived_at is null
  and auth.uid() is not null
  and (
    exists (
      select 1
        from public.attachments a
       where a.owner_id = auth.uid()
         and a.storage_path collate "C" = name collate "C"
         and a.status = 'attached'
         and a.post_id is not null
         and a.client_key is not null
         and a.payload_sha256 is not null
    )
    or (
      (owner is not null or owner_id is not null)
      and (owner is null or owner = auth.uid())
      and (owner_id is null or owner_id = auth.uid()::text)
      and exists (
        select 1
          from public.attachments a
         where a.owner_id = auth.uid()
           and a.storage_path collate "C" = name collate "C"
           and a.status = 'attached'
           and a.post_id is not null
           and a.client_key is null
           and a.payload_sha256 is null
      )
    )
  )
);

alter table public.rate_limit_events
  add column upload_reservation_id uuid;

create unique index rate_limit_events_upload_reservation_idx
on public.rate_limit_events (upload_reservation_id)
where upload_reservation_id is not null;

create unique index attachments_owner_client_key_idx
on public.attachments (owner_id, client_key)
where client_key is not null;

create index attachments_cleanup_queue_idx
on public.attachments (next_attempt_at, created_at, id)
where status in ('pending', 'attached', 'quarantined', 'deleting');

insert into public.rate_limit_rules (
  id, action, window_seconds, max_requests, is_enabled
)
values (
  'b1000000-0000-0000-0000-000000000006',
  'attachment.upload',
  600,
  20,
  true
)
on conflict (action, window_seconds) do update
set max_requests = excluded.max_requests,
    is_enabled = excluded.is_enabled,
    updated_at = pg_catalog.clock_timestamp();

create type public.attachment_upload_intent as (
  id uuid,
  storage_path text,
  is_replay boolean,
  object_exists boolean
);

create function public.reserve_attachment_upload(p_idempotency_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  canonical_key text;
  reservation_id uuid := gen_random_uuid();
  reservation_started_at timestamptz := pg_catalog.clock_timestamp();
begin
  perform private.require_read_committed();
  caller_id := private.require_user();
  if p_idempotency_key is null then
    raise exception 'client key is required' using errcode = '22023';
  end if;
  canonical_key := p_idempotency_key::text;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-rate-reservation:' || caller_id::text || ':' || canonical_key, 0)
  );
  perform private.consume_rate_limit(caller_id, 'attachment.upload', canonical_key);

  update public.rate_limit_events e
     set upload_reservation_id = reservation_id
   where e.id = (
     select latest.id
       from public.rate_limit_events latest
      where latest.user_id = caller_id
        and latest.action = 'attachment.upload'
        and latest.idempotency_key = canonical_key
        and latest.upload_reservation_id is null
        and latest.occurred_at >= reservation_started_at
      order by latest.occurred_at desc, latest.id desc
      limit 1
   );
  if not found then
    raise exception 'upload rate reservation was not recorded' using errcode = '55000';
  end if;
  return reservation_id;
end;
$$;

create function public.refund_attachment_upload_replay(
  p_reservation_id uuid,
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_byte_size bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_reservation_id is null or p_idempotency_key is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('rate-limit:' || caller_id::text || ':attachment.upload', 0)
  );

  delete from public.rate_limit_events e
   where e.upload_reservation_id = p_reservation_id
     and e.user_id = caller_id
     and e.action = 'attachment.upload'
     and e.idempotency_key = p_idempotency_key::text
     and exists (
       select 1
         from public.attachments a
         join storage.objects o
           on o.bucket_id = 'community-images'
          and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
        where a.owner_id = caller_id
          and a.client_key = p_idempotency_key
          and a.post_id is null
          and a.status in ('pending', 'quarantined')
          and (
            a.cleanup_lease_until is null
            or a.cleanup_lease_until <= pg_catalog.clock_timestamp()
          )
          and a.payload_sha256 = p_content_hash
          and a.mime_type = p_mime_type
          and a.byte_size = p_byte_size
          and o.metadata ->> 'mimetype' = a.mime_type
          and o.metadata ->> 'size' ~ '^[0-9]+$'
          and (o.metadata ->> 'size')::bigint = a.byte_size
          and coalesce(
            o.user_metadata ->> 'sha256',
            o.metadata ->> 'sha256',
            o.metadata #>> '{metadata,sha256}'
          ) = a.payload_sha256
     );

  return found;
end;
$$;

create function public.create_attachment_upload_intent(
  p_idempotency_key uuid,
  p_content_hash text,
  p_mime_type text,
  p_byte_size bigint
)
returns public.attachment_upload_intent
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  canonical_key text;
  intended_path text;
  existing_attachment public.attachments%rowtype;
  any_object_exists boolean;
  matching_object_exists boolean;
  pending_count integer;
  pending_bytes bigint;
  created_intent public.attachment_upload_intent;
  -- Fifteen minutes is more than twice the hosted Edge worker's 400-second
  -- wall-clock ceiling, so a resumed intent cannot become cleanup-eligible
  -- while its validate-upload invocation can still perform Storage upload.
  upload_retry_grace constant interval := interval '15 minutes';
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  if p_idempotency_key is null then
    raise exception 'client key is required' using errcode = '22023';
  end if;

  canonical_key := p_idempotency_key::text;
  intended_path := caller_id::text || '/' || canonical_key;

  -- One actor lock serializes replay, rate consumption, and both quota checks.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-upload:' || caller_id::text, 0)
  );

  -- Replay precedes metadata and pending-quota checks. The Edge endpoint still
  -- applies a hard pre-decode request-rate gate, then refunds only a validated
  -- replay whose immutable Storage object matches this intent.
  select a.*
    into existing_attachment
    from public.attachments a
   where a.owner_id = caller_id
     and a.storage_path = intended_path
   for update;

  if found then
    if existing_attachment.mime_type is distinct from p_mime_type
       or existing_attachment.byte_size is distinct from p_byte_size
       or existing_attachment.payload_sha256 is distinct from p_content_hash then
      raise exception 'client key reused with different payload metadata'
        using errcode = '22023';
    end if;

    if existing_attachment.status in ('attached', 'deleting', 'deleted', 'cleanup_failed')
       or existing_attachment.post_id is not null then
      raise exception 'upload intent is no longer retryable' using errcode = '55000';
    end if;
    if existing_attachment.cleanup_lease_until > pg_catalog.clock_timestamp() then
      raise exception 'upload intent has an active cleanup lease' using errcode = '55000';
    end if;

    select exists (
             select 1 from storage.objects o
              where o.bucket_id = 'community-images' and o.name collate "C" = intended_path collate "C"
                and o.archived_at is null
           ),
           exists (
             select 1 from storage.objects o
              where o.bucket_id = 'community-images' and o.name collate "C" = intended_path collate "C"
                and o.archived_at is null
                and o.metadata ->> 'mimetype' = p_mime_type
                and o.metadata ->> 'size' ~ '^[0-9]+$'
                and (o.metadata ->> 'size')::bigint = p_byte_size
                and coalesce(
                  o.user_metadata ->> 'sha256',
                  o.metadata ->> 'sha256',
                  o.metadata #>> '{metadata,sha256}'
                ) = p_content_hash
           )
      into any_object_exists, matching_object_exists;
    if any_object_exists and not matching_object_exists then
      raise exception 'storage object metadata does not match intent' using errcode = '22023';
    end if;

    update public.attachments a
       set status = 'pending', cleanup_claim_token = null,
           cleanup_lease_until = null, cleanup_last_error = null,
           next_attempt_at = pg_catalog.clock_timestamp() + upload_retry_grace
     where a.id = existing_attachment.id;

    created_intent.id := existing_attachment.id;
    created_intent.storage_path := existing_attachment.storage_path;
    created_intent.is_replay := true;
    created_intent.object_exists := matching_object_exists;
    return created_intent;
  end if;

  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_byte_size is null
     or p_byte_size not between 1 and 5242880
     or p_content_hash is null
     or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid attachment metadata' using errcode = '22023';
  end if;

  -- Client keys determine paths, so a new intent may not adopt any object that
  -- predates its tracked attachment row. Replays returned above remain valid.
  if exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'community-images'
       and o.name collate "C" = intended_path collate "C"
       and o.archived_at is null
  ) then
    raise exception 'storage path already exists' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attachment-rate-reservation:' || caller_id::text || ':' || canonical_key, 0)
  );
  if not exists (
    select 1 from public.rate_limit_events e
     where e.user_id = caller_id and e.action = 'attachment.upload'
       and e.idempotency_key = canonical_key
       and e.occurred_at > pg_catalog.clock_timestamp() - interval '10 minutes'
  ) then
    begin
      perform private.consume_rate_limit(caller_id, 'attachment.upload', canonical_key);
    exception
      when sqlstate 'PGRST' then
        raise exception 'attachment upload rate limit exceeded' using errcode = 'P0001';
    end;
  end if;

  select count(*)::integer, coalesce(sum(a.byte_size), 0)::bigint
    into pending_count, pending_bytes
    from public.attachments a
   where a.owner_id = caller_id
     and a.status in ('pending', 'quarantined');

  if pending_count >= 10 then
    raise exception 'pending attachment count limit exceeded'
      using errcode = '23514';
  end if;

  if pending_bytes + p_byte_size > 26214400 then
    raise exception 'pending attachment byte limit exceeded'
      using errcode = '23514';
  end if;

  insert into public.attachments (
    owner_id, client_key, payload_sha256, storage_path, mime_type, byte_size, status
  ) values (
    caller_id, p_idempotency_key, p_content_hash, intended_path, p_mime_type, p_byte_size, 'pending'
  )
  returning id, storage_path into created_intent;

  created_intent.is_replay := false;
  created_intent.object_exists := false;
  return created_intent;
end;
$$;

create function public.fail_attachment_upload(
  p_attachment_id uuid,
  p_storage_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  update public.attachments a
     set status = 'quarantined',
         cleanup_last_error = 'upload_failed',
         next_attempt_at = least(
           coalesce(a.next_attempt_at, pg_catalog.clock_timestamp()),
           pg_catalog.clock_timestamp()
         )
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.owner_id = caller_id
     and a.status in ('pending', 'quarantined')
     and a.post_id is null;

  return found;
end;
$$;

create function public.attach_attachments(
  p_post_id uuid,
  p_attachment_ids uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  requested_count integer := coalesce(pg_catalog.cardinality(p_attachment_ids), 0);
  distinct_count integer;
  linkable_count integer;
  pending_count integer;
  valid_pending_count integer;
  existing_count integer;
  final_count integer;
begin
  perform private.require_read_committed();
  caller_id := private.require_user();

  select count(distinct requested_id)::integer
    into distinct_count
    from pg_catalog.unnest(coalesce(p_attachment_ids, array[]::uuid[])) requested_id;

  if requested_count < 1 or requested_count > 5
     or distinct_count <> requested_count
     or pg_catalog.array_position(p_attachment_ids, null::uuid) is not null then
    raise exception 'attachment list must contain 1 to 5 distinct ids; duplicate attachment ids are not allowed'
      using errcode = '22023';
  end if;

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

  perform 1
    from public.attachments a
   where a.id = any(p_attachment_ids)
   order by a.id
   for update;

  select count(*)::integer,
         count(*) filter (where a.status = 'pending')::integer
    into linkable_count, pending_count
    from public.attachments a
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and (
       (
         a.status = 'pending' and a.post_id is null
         and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp())
       )
       or (
         a.status = 'attached' and a.post_id = p_post_id
         and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp())
       )
     );

  if linkable_count <> requested_count then
    raise exception 'attachment not found or not linkable' using errcode = '42501';
  end if;

  -- Validate every object in the same transaction immediately before changing
  -- its pending intent to attached. Malformed metadata is a mismatch, not a cast
  -- error exposed to the caller.
  select count(*)::integer
    into valid_pending_count
    from public.attachments a
    join storage.objects o
      on o.bucket_id = 'community-images'
     and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null
     and o.metadata ->> 'mimetype' = a.mime_type
     and coalesce(
       o.user_metadata ->> 'sha256',
       o.metadata ->> 'sha256',
       o.metadata #>> '{metadata,sha256}'
     ) = a.payload_sha256
     and case
       when o.metadata ->> 'size' ~ '^[0-9]+$'
       then (o.metadata ->> 'size')::bigint = a.byte_size
       else false
     end;

  if valid_pending_count <> pending_count then
    raise exception 'storage object metadata does not match intent'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into existing_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  if existing_count + pending_count > 5 then
    raise exception 'a post may have at most 5 attachments' using errcode = '23514';
  end if;

  update public.attachments a
     set post_id = p_post_id,
         status = 'attached',
         attached_at = pg_catalog.clock_timestamp()
   where a.id = any(p_attachment_ids)
     and a.owner_id = caller_id
     and a.status = 'pending'
     and a.post_id is null
     and (a.cleanup_lease_until is null or a.cleanup_lease_until <= pg_catalog.clock_timestamp());

  select count(*)::integer
    into final_count
    from public.attachments a
   where a.post_id = p_post_id
     and a.status = 'attached';

  return final_count;
end;
$$;

create function public.claim_attachment_cleanup(p_limit integer default 100)
returns table(id uuid, storage_path text, claim_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'cleanup limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select a.id
      from public.attachments a
      left join public.posts p on p.id = a.post_id
      left join lateral (
        select true as object_exists, o.owner, o.owner_id
          from storage.objects o
         where o.bucket_id = 'community-images'
           and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
         limit 1
      ) o on true
     where a.cleanup_attempt_count < 5
       and a.next_attempt_at <= pg_catalog.clock_timestamp()
       and (
         a.cleanup_lease_until is null
         or a.cleanup_lease_until <= pg_catalog.clock_timestamp()
       )
       and (
         (a.client_key is not null and a.payload_sha256 is not null)
         or o.object_exists is null
         or (
           (o.owner is not null or o.owner_id is not null)
           and (o.owner is null or o.owner = a.owner_id)
           and (o.owner_id is null or o.owner_id = a.owner_id::text)
         )
       )
       and (
         a.status = 'deleting'
         or (
           a.post_id is null
           and a.status in ('pending', 'quarantined')
           and (
             a.cleanup_last_error in ('upload_failed', 'legacy_invalid_attachment_state')
             or a.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
           )
         )
         or (
           a.post_id is not null
           and a.status in ('attached', 'quarantined')
           and p.status = 'deleted'
           and p.deleted_at < pg_catalog.clock_timestamp() - interval '30 days'
         )
       )
     order by a.next_attempt_at, a.created_at, a.id
     for update of a skip locked
     limit p_limit
  ), claimed as (
    update public.attachments a
       set cleanup_claim_token = gen_random_uuid(),
           cleanup_lease_until = pg_catalog.clock_timestamp() + interval '5 minutes'
      from candidates c
     where a.id = c.id
    returning a.id, a.storage_path, a.cleanup_claim_token
  )
  select c.id, c.storage_path, c.cleanup_claim_token
    from claimed c
   order by c.id;
end;
$$;

create function public.prepare_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.attachments a
     set status = 'deleting'
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp()
     and (
       (a.client_key is not null and a.payload_sha256 is not null)
       or not exists (
         select 1
           from storage.objects o
          where o.bucket_id = 'community-images'
            and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
       )
       or exists (
         select 1
           from storage.objects o
           where o.bucket_id = 'community-images'
            and o.name collate "C" = a.storage_path collate "C"
           and o.archived_at is null
            and (o.owner is not null or o.owner_id is not null)
            and (o.owner is null or o.owner = a.owner_id)
            and (o.owner_id is null or o.owner_id = a.owner_id::text)
           )
     )
     and (
       a.status = 'deleting'
       or (
         a.post_id is null
         and a.status in ('pending', 'quarantined')
         and (
           a.cleanup_last_error in ('upload_failed', 'legacy_invalid_attachment_state')
           or a.created_at < pg_catalog.clock_timestamp() - interval '24 hours'
         )
       )
       or (
         a.post_id is not null
         and a.status in ('attached', 'quarantined')
         and exists (
           select 1 from public.posts p
            where p.id = a.post_id
              and p.status = 'deleted'
              and p.deleted_at < pg_catalog.clock_timestamp() - interval '30 days'
         )
       )
     );

  return found;
end;
$$;

create function public.complete_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.attachments a
     set status = 'deleted',
         deleted_at = pg_catalog.clock_timestamp(),
         cleanup_claim_token = null,
         cleanup_lease_until = null,
         next_attempt_at = null,
         cleanup_last_error = null
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.status = 'deleting'
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp();

  return found;
end;
$$;

create function public.release_attachment_cleanup(
  p_attachment_id uuid,
  p_storage_path text,
  p_claim_token uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  new_attempt_count integer;
begin
  if p_reason is null or pg_catalog.btrim(p_reason) = '' then
    raise exception 'cleanup failure reason is required' using errcode = '22023';
  end if;

  if p_reason = 'eligibility_changed' then
    update public.attachments a
       set cleanup_claim_token = null,
           cleanup_lease_until = null
     where a.id = p_attachment_id
       and a.storage_path = p_storage_path
       and a.cleanup_claim_token = p_claim_token
       and a.cleanup_lease_until > pg_catalog.clock_timestamp();
    return found;
  end if;

  update public.attachments a
     set cleanup_attempt_count = a.cleanup_attempt_count + 1,
         status = case
           when a.cleanup_attempt_count + 1 >= 5 then 'cleanup_failed'
           else a.status
         end,
         next_attempt_at = case
           when a.cleanup_attempt_count + 1 >= 5 then null
           else pg_catalog.clock_timestamp()
                + pg_catalog.make_interval(secs => (30 * power(2, a.cleanup_attempt_count))::integer)
         end,
         cleanup_claim_token = null,
         cleanup_lease_until = null,
         cleanup_last_error = pg_catalog.left(p_reason, 1000)
   where a.id = p_attachment_id
     and a.storage_path = p_storage_path
     and a.cleanup_claim_token = p_claim_token
     and a.cleanup_lease_until > pg_catalog.clock_timestamp()
  returning a.cleanup_attempt_count into new_attempt_count;

  return found;
end;
$$;

alter type public.attachment_upload_intent owner to postgres;
alter function public.reserve_attachment_upload(uuid) owner to postgres;
alter function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) owner to postgres;
alter function public.create_attachment_upload_intent(uuid,text,text,bigint) owner to postgres;
alter function public.fail_attachment_upload(uuid,text) owner to postgres;
alter function public.attach_attachments(uuid,uuid[]) owner to postgres;
alter function public.claim_attachment_cleanup(integer) owner to postgres;
alter function public.prepare_attachment_cleanup(uuid,text,uuid) owner to postgres;
alter function public.complete_attachment_cleanup(uuid,text,uuid) owner to postgres;
alter function public.release_attachment_cleanup(uuid,text,uuid,text) owner to postgres;

revoke all on function public.reserve_attachment_upload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.create_attachment_upload_intent(uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function public.fail_attachment_upload(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.attach_attachments(uuid,uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.claim_attachment_cleanup(integer) from public, anon, authenticated, service_role;
revoke all on function public.prepare_attachment_cleanup(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_attachment_cleanup(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.release_attachment_cleanup(uuid,text,uuid,text) from public, anon, authenticated, service_role;

grant execute on function public.reserve_attachment_upload(uuid) to authenticated;
grant execute on function public.refund_attachment_upload_replay(uuid,uuid,text,text,bigint) to authenticated;
grant execute on function public.create_attachment_upload_intent(uuid,text,text,bigint) to authenticated;
grant execute on function public.fail_attachment_upload(uuid,text) to authenticated;
grant execute on function public.attach_attachments(uuid,uuid[]) to authenticated;
grant execute on function public.claim_attachment_cleanup(integer) to service_role;
grant execute on function public.prepare_attachment_cleanup(uuid,text,uuid) to service_role;
grant execute on function public.complete_attachment_cleanup(uuid,text,uuid) to service_role;
grant execute on function public.release_attachment_cleanup(uuid,text,uuid,text) to service_role;
