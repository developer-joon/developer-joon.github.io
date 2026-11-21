-- Private provenance and immutable receipts for exact benefit seed imports.
begin;

create table private.benefit_company_sources (
  company_id text primary key references public.benefit_companies(company_id) on delete restrict,
  source_contract text not null,
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  source_binding jsonb not null check (pg_catalog.jsonb_typeof(source_binding)='object'),
  bundle_digest text not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (updated_at>=created_at)
);

create table private.benefit_import_receipts (
  bundle_digest text primary key check (bundle_digest ~ '^[0-9a-f]{64}$'),
  import_key text not null unique,
  schema_version text not null,
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  company_count integer not null check (company_count>=0),
  identity_counts jsonb not null check (pg_catalog.jsonb_typeof(identity_counts)='object'),
  ordered_id_set_sha256 text not null check (ordered_id_set_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz not null default pg_catalog.clock_timestamp()
);

create function private.reject_benefit_import_receipt_change()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'benefit import receipts are immutable' using errcode='23514';
end $$;

create trigger benefit_import_receipts_immutable
  before update or delete on private.benefit_import_receipts
  for each row execute function private.reject_benefit_import_receipt_change();

alter table private.benefit_company_sources owner to postgres;
alter table private.benefit_import_receipts owner to postgres;
alter function private.reject_benefit_import_receipt_change() owner to postgres;
alter table private.benefit_company_sources disable row level security;
alter table private.benefit_import_receipts disable row level security;
revoke all on table private.benefit_company_sources,private.benefit_import_receipts from public,anon,authenticated,service_role;
revoke all on function private.reject_benefit_import_receipt_change() from public,anon,authenticated,service_role;

commit;
