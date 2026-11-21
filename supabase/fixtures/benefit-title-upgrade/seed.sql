begin;

insert into public.benefit_companies(
  company_id,identity_class,display_name,normalized_name,industry,size_class,region,summary,source_edition,provenance
) values (
  'KR-BIZ-9970000001','registered_business','Benefit Title Upgrade Company','benefit title upgrade company',
  'Technology','small','Seoul','Production-shaped upgrade fixture','benefit-title-upgrade-v1',
  '{"fixture":"benefit-title-upgrade"}'::jsonb
);

insert into public.benefit_publications(
  publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
  trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
  observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
) values
  (
    'e7000000-0000-4000-8000-000000000001','KR-BIZ-9970000001','health','Legacy  title',
    'Standalone community publication','All employees','Annual enrollment',
    'community_reviewed','active','legacy-standalone-lineage',1,null,
    'https://example.com/legacy-standalone','user_submission',
    '2026-11-01 00:00:00+00','2026-11-02 00:00:00+00',
    '{"submission_id":"e7100000-0000-4000-8000-000000000001"}'::jsonb,
    'e7200000-0000-4000-8000-000000000001',
    '2026-11-01 00:00:00+00','2026-11-02 00:00:00+00'
  ),
  (
    'e7000000-0000-4000-8000-000000000010','KR-BIZ-9970000001','leave',E'\tLegacy  leave\r',
    'Original revision','Full-time employees',null,
    'community_reviewed','superseded','legacy-revision-lineage',1,null,
    'https://example.com/legacy-revision-1','user_submission',
    '2026-10-01 00:00:00+00','2026-10-02 00:00:00+00',
    '{"submission_id":"e7100000-0000-4000-8000-000000000010"}'::jsonb,
    'e7200000-0000-4000-8000-000000000001',
    '2026-10-01 00:00:00+00','2026-10-03 00:00:00+00'
  ),
  (
    'e7000000-0000-4000-8000-000000000011','KR-BIZ-9970000001','leave',E'\nUpdated\t\tleave\v',
    'Current revision','All employees','Manager approval',
    'community_reviewed','active','legacy-revision-lineage',2,
    'e7000000-0000-4000-8000-000000000010',
    'https://example.com/legacy-revision-2','user_submission',
    '2026-11-01 00:00:00+00','2026-11-02 00:00:00+00',
    '{"submission_id":"e7100000-0000-4000-8000-000000000011"}'::jsonb,
    'e7200000-0000-4000-8000-000000000001',
    '2026-11-01 00:00:00+00','2026-11-02 00:00:00+00'
  );

set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check immediate;
set constraints public.benefit_publications_lineage_check,
  public.benefit_publications_unique_active_lineage_check deferred;

commit;
