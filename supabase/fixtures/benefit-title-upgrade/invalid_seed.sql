insert into public.benefit_companies(
  company_id,identity_class,display_name,normalized_name,source_edition,provenance
) values (
  'KR-BIZ-9970000002','registered_business','Benefit Title Rollback Company',
  'benefit title rollback company','benefit-title-upgrade-v1',
  '{"fixture":"benefit-title-upgrade-rollback"}'::jsonb
);

insert into public.benefit_publications(
  publication_id,company_id,category_id,title,description,trust_tier,status,
  dedupe_key,revision,source_type,provenance
) values (
  'e7000000-0000-4000-8000-000000000020','KR-BIZ-9970000002','health',
  E'\t\r\n\v\f','Whitespace-only title accepted by migration 002',
  'community_reviewed','active','legacy-invalid-title-lineage',1,
  'user_submission','{"submission_id":"e7100000-0000-4000-8000-000000000020"}'::jsonb
);
