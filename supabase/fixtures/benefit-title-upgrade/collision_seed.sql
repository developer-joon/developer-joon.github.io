begin;

insert into public.benefit_companies(
  company_id,identity_class,display_name,normalized_name,industry,size_class,region,summary,source_edition,provenance
) values (
  'KR-BIZ-9970000003','registered_business','Benefit Title Collision Company',
  'benefit title collision company','Technology','small','Seoul',
  'Production-shaped canonical-lineage collision fixture','benefit-title-upgrade-v1',
  '{"fixture":"benefit-title-upgrade-collision"}'::jsonb
);

insert into public.benefit_publications(
  publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
  trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
  observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
) values
  (
    'e7000000-0000-4000-8000-000000000040','KR-BIZ-9970000003','health','Collision title',
    'First distinct migration 002 lineage','All employees','Annual enrollment',
    'community_reviewed','active','legacy-collision-lineage-a',1,null,
    'https://example.com/collision-lineage-a','user_submission',
    '2026-11-05 00:00:00+00','2026-11-06 00:00:00+00',
    '{"submission_id":"e7100000-0000-4000-8000-000000000040","payload":"first"}'::jsonb,
    'e7200000-0000-4000-8000-000000000001',
    '2026-11-05 00:00:00+00','2026-11-06 00:00:00+00'
  ),
  (
    'e7000000-0000-4000-8000-000000000041','KR-BIZ-9970000003','health',E'Collision\t title',
    'Second distinct migration 002 lineage','Full-time employees','Manager approval',
    'community_reviewed','active','legacy-collision-lineage-b',1,null,
    'https://example.com/collision-lineage-b','user_submission',
    '2026-11-07 00:00:00+00','2026-11-08 00:00:00+00',
    '{"submission_id":"e7100000-0000-4000-8000-000000000041","payload":"second"}'::jsonb,
    'e7200000-0000-4000-8000-000000000001',
    '2026-11-07 00:00:00+00','2026-11-08 00:00:00+00'
  );

set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check immediate;
set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check deferred;

commit;
