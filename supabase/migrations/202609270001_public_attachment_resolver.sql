-- Service-only authorization boundary for public attachment delivery.

begin;

create function public.resolve_public_attachment(p_attachment_id uuid)
returns table(
  attachment_id uuid,
  owner_id uuid,
  object_token uuid,
  storage_path text,
  mime_type text,
  byte_size bigint
)
language sql stable security definer set search_path='' as $$
  select a.id,a.owner_id,a.client_key,a.storage_path,a.mime_type,a.byte_size
    from public.attachments a
    join public.posts p on p.id=a.post_id
   where a.id=p_attachment_id
     and a.client_key is not null
     and a.payload_sha256 is not null
     and a.storage_path collate "C" =
       (a.owner_id::text||'/'||a.client_key::text) collate "C"
     and a.status='attached'
     and a.deleted_at is null
     and p.status='published'
     and p.deleted_at is null
$$;

alter function public.resolve_public_attachment(uuid) owner to postgres;
revoke all on function public.resolve_public_attachment(uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_public_attachment(uuid) to service_role;

commit;
