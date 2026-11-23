begin;
select no_plan();

select has_table('public','benefit_company_identifiers','private company identifier ledger exists');
select has_table('public','benefit_company_merge_events','append-only company merge ledger exists');
select has_function('private','is_benefit_company_id',array['text'],'one SQL company ID validator exists');

select ok(private.is_benefit_company_id('KR-CRN-1101112948086') and private.is_benefit_company_id('KR-BIZ-1234567890'),'representative legacy CRN and BIZ IDs remain accepted');
select ok(not private.is_benefit_company_id(' KR-BIZ-1234567890') and not private.is_benefit_company_id('kr-biz-1234567890') and not private.is_benefit_company_id('KR-CAN-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),'company ID validation rejects whitespace and case variants');

insert into auth.users(id,aud,role,email) values
 ('c1000000-0000-4000-8000-000000000001','authenticated','authenticated','company-merge-actor@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('c1000000-0000-4000-8000-000000000001',999000001,'company-merge-actor','Company Merge Actor');

insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition) values
 ('KR-CAN-00000000000000000000000000000001','registered_business','Same Name One','same name','identifier-test'),
 ('KR-CAN-00000000000000000000000000000002','registered_business','Same Name Two','same name','identifier-test');
select is((select count(*)::integer from public.benefit_companies where normalized_name='same name'),2,'name equality has no merge authority');
select lives_ok($$insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition) values ('KR-CRN-9999999999999','legal_corporation','Legacy CRN','legacy crn','identifier-test'),('KR-BIZ-9999999999','registered_business','Legacy BIZ','legacy biz','identifier-test')$$,'legacy IDs remain insertable without rewriting');
select throws_ok($$insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition) values ('KR-CAN-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','registered_business','Bad CAN','bad can','identifier-test')$$,'23514',null,'uppercase opaque IDs are rejected by the company constraint');

insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values
 ('KR-CAN-00000000000000000000000000000001','legacy_company_id','KR-BIZ-9999999999','identifier-test','2026-11-23T00:00:00Z'),
 ('KR-CAN-00000000000000000000000000000001','opendart_corp_code','00123456','opendart-2026-11-23','2026-11-23T00:00:00Z'),
 ('KR-CAN-00000000000000000000000000000002','business_number_hmac_v1',repeat('a',64),'nts-test','2026-11-23T00:00:00Z');
select throws_ok($$insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values ('KR-CAN-00000000000000000000000000000002','opendart_corp_code','00123456','duplicate-test',now())$$,'23505',null,'duplicate strong identifiers fail with SQLSTATE 23505');
select throws_ok($$insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values ('KR-CAN-00000000000000000000000000000002','business_number_hmac_v1','1234567890','raw-number-test',now())$$,'23514',null,'raw business numbers cannot be stored as HMAC identifiers');
select throws_ok($$insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values ('KR-CAN-00000000000000000000000000000002','legacy_company_id','KR-CAN-00000000000000000000000000000002','identifier-test',now())$$,'23514',null,'legacy identifier values are bounded to unchanged CRN or BIZ IDs');
select throws_ok($$insert into public.benefit_company_identifiers(company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values ('KR-CAN-00000000000000000000000000000002','alias','anything','identifier-test',now())$$,'23514',null,'identifier types are exactly the approved enum');

insert into public.benefit_company_merge_events(source_company_id,destination_company_id,actor_id,reason) values
 ('KR-CAN-00000000000000000000000000000001','KR-CAN-00000000000000000000000000000002','c1000000-0000-4000-8000-000000000001','Strong identifier reviewed by an operator');
select throws_ok($$insert into public.benefit_company_merge_events(source_company_id,destination_company_id,actor_id,reason) values ('KR-CAN-00000000000000000000000000000001','KR-CAN-00000000000000000000000000000001','c1000000-0000-4000-8000-000000000001','self merge')$$,'23514',null,'merge source and destination must differ');
select throws_ok($$update public.benefit_company_merge_events set reason='tampered'$$,'23514','benefit company merge events are append-only','merge UPDATE is rejected');
select throws_ok($$delete from public.benefit_company_merge_events$$,'23514','benefit company merge events are append-only','merge DELETE is rejected');
select throws_ok($$truncate public.benefit_company_merge_events$$,'23514','benefit company merge events are append-only','merge TRUNCATE is rejected');
select throws_ok($$delete from public.benefit_companies where company_id='KR-CAN-00000000000000000000000000000001'$$,'23503',null,'source companies remain resolvable after a merge event');
select throws_ok($$delete from public.profiles where id='c1000000-0000-4000-8000-000000000001'$$,'23503',null,'actor deletion cannot erase merge attribution');

select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_company_identifiers'::regclass,'public.benefit_company_merge_events'::regclass])),'identity and merge ledgers enable RLS');
select ok((select bool_and(not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class where oid=any(array['public.benefit_company_identifiers'::regclass,'public.benefit_company_merge_events'::regclass])),'browser roles have no raw ledger privileges');
select is((select count(*)::integer from pg_policies where schemaname='public' and tablename in ('benefit_company_identifiers','benefit_company_merge_events')),0,'raw ledgers expose no RLS policies');
select ok((select bool_and(confdeltype='r') from pg_constraint where conrelid=any(array['public.benefit_company_identifiers'::regclass,'public.benefit_company_merge_events'::regclass]) and contype='f'),'all identity and merge foreign keys use explicit RESTRICT deletion');
select ok(not has_function_privilege('public','private.is_benefit_company_id(text)','EXECUTE') and not has_function_privilege('anon','private.is_benefit_company_id(text)','EXECUTE') and not has_function_privilege('authenticated','private.is_benefit_company_id(text)','EXECUTE'),'SQL company ID validator is private');

select is((public.get_benefit_company_v1('KR-CAN-00000000000000000000000000000002')->'company'->>'company_id'),'KR-CAN-00000000000000000000000000000002','detail RPC accepts opaque IDs');
select is((public.search_benefit_companies_v1('same name',null,null,null,null,false,1,null)->>'total')::integer,2,'same-name companies remain distinct in search');
select ok((public.search_benefit_companies_v1('same name',null,null,null,null,false,1,null)->>'next_cursor') like '%KR-CAN-%','search cursors carry opaque IDs');
select lives_ok($$select public.search_benefit_companies_v1('same name',null,null,null,null,false,1,(public.search_benefit_companies_v1('same name',null,null,null,null,false,1,null)->>'next_cursor'))$$,'search accepts an opaque-ID cursor');

select * from finish();
rollback;
