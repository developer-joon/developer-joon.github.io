begin;
select no_plan();

select ok((select bool_and(p.proconfig @> array['TimeZone=UTC']) from pg_catalog.pg_proc p where p.oid=any(array[
  'public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure,
  'private.validate_benefit_claim_official_review()'::regprocedure,
  'public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid)'::regprocedure,
  'public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text)'::regprocedure
])),'all current-date benefit validators pin UTC in function configuration');

insert into auth.users(id,aud,role,email) values
 ('bc100000-0000-4000-8000-000000000001','authenticated','authenticated','utc-member@example.test'),
 ('bc100000-0000-4000-8000-000000000002','authenticated','authenticated','utc-admin@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('bc100000-0000-4000-8000-000000000001',99100001,'utc-member'),
 ('bc100000-0000-4000-8000-000000000002',99100002,'utc-admin');
insert into public.user_roles values
 ('bc100000-0000-4000-8000-000000000001','member'),
 ('bc100000-0000-4000-8000-000000000002','admin');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('utc-member','bc100000-0000-4000-8000-000000000001','{}','google'),
 ('utc-admin','bc100000-0000-4000-8000-000000000002','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition)
values ('KR-BIZ-9910000001','registered_business','UTC Contract Company','utc contract company',true,'utc-contract-test');
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claims_write_enabled';

set local role authenticated;
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000001';
set local timezone='Pacific/Kiritimati';
select lives_ok($$select public.create_benefit_claim_v1('bc200000-0000-4000-8000-000000000001','KR-BIZ-9910000001','health','UTC plus fourteen','UTC date accepted',null,null,pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date,null)$$,'claim creation accepts the UTC day in UTC+14');
select throws_ok($$select public.create_benefit_claim_v1('bc200000-0000-4000-8000-000000000002','KR-BIZ-9910000001','health','UTC future plus fourteen','UTC future rejected',null,null,pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date+1,null)$$,'22023','invalid observed date','claim creation rejects the next UTC day in UTC+14');
set local timezone='Etc/GMT+12';
select lives_ok($$select public.create_benefit_claim_v1('bc200000-0000-4000-8000-000000000003','KR-BIZ-9910000001','leave','UTC minus twelve','UTC date accepted',null,null,pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date,null)$$,'claim creation accepts the UTC day in UTC-12');
reset role;

insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
values ('bc300000-0000-4000-8000-000000000001','KR-BIZ-9910000001','bc100000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('c',64),'growth','UTC official evidence','utc official evidence','UTC official evidence','',date '2026-01-01');
set local role authenticated;
set local request.jwt.claim.sub='bc100000-0000-4000-8000-000000000002';
set local timezone='Pacific/Kiritimati';
select lives_ok($$select public.officially_verify_benefit_claim_v1('bc300000-0000-4000-8000-000000000001','submitted',1,'UTC official','UTC official description',null,null,'official_website','https://example.com/utc',pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date,'UTC review','bc400000-0000-4000-8000-000000000001')$$,'official verification and its storage trigger accept the UTC day in UTC+14');
select throws_ok($$select public.moderate_benefit_claim_v1('bc400000-0000-4000-8000-000000000002','bc300000-0000-4000-8000-000000000001',2,'submitted','withdraw_official',null,'UTC future evidence','official_website',pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date+1,'https://example.com/utc-withdraw')$$,'22023','official withdrawal requires evidence','moderation rejects the next UTC day in UTC+14');
set local timezone='Etc/GMT+12';
select lives_ok($$select public.moderate_benefit_claim_v1('bc400000-0000-4000-8000-000000000003','bc300000-0000-4000-8000-000000000001',2,'submitted','withdraw_official',null,'UTC withdrawal evidence','official_website',pg_catalog.timezone('UTC',pg_catalog.statement_timestamp())::date,'https://example.com/utc-withdraw')$$,'moderation and its storage trigger accept the UTC day in UTC-12');
reset role;

select * from finish();
rollback;
