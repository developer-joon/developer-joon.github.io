begin;
select no_plan();

select has_table('public','benefit_companies','benefit companies table exists');
select has_table('public','benefit_publications','benefit publications table exists');
select has_function('public','search_benefit_companies_v1',array['text','text[]','text','text','text','boolean','integer','text'],'search RPC exists');
select has_function('public','get_benefit_company_v1',array['text'],'detail RPC exists');

select ok((select bool_and(relrowsecurity) from pg_class where oid=any(array['public.benefit_companies'::regclass,'public.benefit_publications'::regclass])),'read-model tables enable RLS');
select ok((select bool_and(not has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class where oid=any(array['public.benefit_companies'::regclass,'public.benefit_publications'::regclass])),'public and browser roles have no direct table rights');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres') from pg_proc p where p.oid=any(array['public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)'::regprocedure,'public.get_benefit_company_v1(text)'::regprocedure])),'public RPCs are fixed-owner SECURITY DEFINER with empty search_path');
select ok(not has_function_privilege('public','public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)','EXECUTE') and has_function_privilege('anon','public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)','EXECUTE') and has_function_privilege('authenticated','public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)','EXECUTE'),'search grants are browser-only');
select ok(not has_function_privilege('public','public.get_benefit_company_v1(text)','EXECUTE') and has_function_privilege('anon','public.get_benefit_company_v1(text)','EXECUTE') and has_function_privilege('authenticated','public.get_benefit_company_v1(text)','EXECUTE'),'detail grants are browser-only');

insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,industry,size_class,region,summary,is_searchable,source_edition,provenance) values
 ('KR-CRN-1101111111111','base_legal_identity','가나다 공식','가나다 공식','software','large','서울','공식 기업',true,'fixture-v1','{"private":"company-secret"}'),
 ('KR-BIZ-1234567890','recruitment_observation','나다라 커뮤니티','나다라 커뮤니티','software','small','부산',null,true,'fixture-v1','{"private":"company-secret"}'),
 ('KR-CRN-2202222222222','ftc_affiliate','다라마 제로','다라마 제로','finance','large_affiliate','서울',null,true,'fixture-v1','{"private":"company-secret"}'),
 ('KR-CRN-3303333333333','base_legal_identity','숨김 기업','숨김 기업',null,null,null,null,false,'fixture-v1','{}'),
 ('KR-BIZ-1000000003','base_legal_identity','Tie Company C','tie company',null,null,null,null,true,'fixture-v1','{}'),
 ('KR-BIZ-1000000001','base_legal_identity','Tie Company A','tie company',null,null,null,null,true,'fixture-v1','{}'),
 ('KR-BIZ-1000000002','base_legal_identity','Tie Company B','tie company',null,null,null,null,true,'fixture-v1','{}');

insert into public.benefit_publications(publication_id,company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,dedupe_key,revision,source_url,source_type,observed_at,verified_at,provenance,reviewer_id) values
 ('b1000000-0000-0000-0000-000000000001','KR-CRN-1101111111111','health','건강검진','연 1회 건강검진','재직자','회사 기준','official_verified','active','health-check',1,'https://private.example/official','official_ledger','2026-10-01','2026-10-02','{"ledger":"secret"}','reviewer-secret'),
 ('b1000000-0000-0000-0000-000000000002','KR-BIZ-1234567890','leave','리프레시 휴가','휴가 제공',null,null,'community_reviewed','active','refresh-leave',2,'https://private.example/community','submission','2026-10-03','2026-10-04','{"submission":"secret"}','reviewer-secret'),
 ('b1000000-0000-0000-0000-000000000003','KR-BIZ-1234567890','meals','식사 지원','과거 식사 지원',null,null,'official_verified','withdrawn','meal',1,'https://private.example/withdrawn','official_ledger','2025-01-01','2025-01-02','{}',null),
 ('b1000000-0000-0000-0000-000000000004','KR-CRN-1101111111111','health','구 건강검진','이전 revision',null,null,'official_verified','superseded','health-check',0,'https://private.example/old','official_ledger','2025-01-01','2025-01-02','{}',null),
 ('b1000000-0000-0000-0000-000000000005','KR-CRN-3303333333333','health','숨김 원본','lineage fixture',null,null,'official_verified','active','hidden-lineage',1,null,'official_ledger',null,null,'{}',null);

select lives_ok($lineage$
do $test$
begin
  update public.benefit_publications
  set status='superseded'
  where publication_id='b1000000-0000-0000-0000-000000000001';
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000010','KR-CRN-1101111111111','health','새 건강검진','새 revision','official_verified','withdrawn','health-check',2,'b1000000-0000-0000-0000-000000000001','official_ledger','{}');
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'a transaction may supersede the predecessor before inserting its successor');
select lives_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000015','KR-CRN-3303333333333','health','숨김 후속','lineage fixture','official_verified','superseded','hidden-lineage',2,'b1000000-0000-0000-0000-000000000005','official_ledger','{}');
  update public.benefit_publications set status='withdrawn' where publication_id='b1000000-0000-0000-0000-000000000005';
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'a transaction may insert a superseded successor before withdrawing its predecessor');
select throws_ok($lineage$
do $test$
begin
  update public.benefit_publications set status='active' where publication_id='b1000000-0000-0000-0000-000000000001';
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor must be superseded or withdrawn','a referenced predecessor cannot be reactivated');
select lives_ok($lineage$
do $test$
begin
  update public.benefit_publications set status='superseded' where publication_id='b1000000-0000-0000-0000-000000000001';
  update public.benefit_publications set status='active' where publication_id='b1000000-0000-0000-0000-000000000010';
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'successor status remains independently active, withdrawn, or superseded');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000011','KR-BIZ-1234567890','health','교차 회사','invalid','official_verified','withdrawn','health-check',3,'b1000000-0000-0000-0000-000000000001','official_ledger','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor must have the same company and dedupe key','cross-company predecessors are rejected');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000012','KR-CRN-1101111111111','health','교차 dedupe','invalid','official_verified','withdrawn','other-key',3,'b1000000-0000-0000-0000-000000000001','official_ledger','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor must have the same company and dedupe key','cross-dedupe predecessors are rejected');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000013','KR-BIZ-1234567890','meals','낮은 revision','invalid','official_verified','withdrawn','meal',0,'b1000000-0000-0000-0000-000000000003','official_ledger','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor revision must be lower','non-increasing revisions are rejected');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000014','KR-BIZ-1234567890','leave','active predecessor','invalid','community_reviewed','withdrawn','refresh-leave',3,'b1000000-0000-0000-0000-000000000002','submission','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor must be superseded or withdrawn','active predecessors are rejected');
select throws_ok($lineage$
do $test$
begin
  update public.benefit_publications
  set supersedes_publication_id='b1000000-0000-0000-0000-000000000010'
  where publication_id='b1000000-0000-0000-0000-000000000001';
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication predecessor revision must be lower','direct cycles are rejected by revision monotonicity');
select throws_ok($lineage$
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
values ('b1000000-0000-0000-0000-000000000016','KR-BIZ-1234567890','health','self reference','invalid','official_verified','withdrawn','self-reference',1,'b1000000-0000-0000-0000-000000000016','official_ledger','{}')
$lineage$,'23514',null,'self-referencing publications are rejected');
select throws_ok($lineage$
insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
values ('b1000000-0000-0000-0000-000000000017','KR-BIZ-1234567890','health','missing predecessor','invalid','official_verified','withdrawn','missing-predecessor',1,'b1000000-0000-0000-0000-000000000099','official_ledger','{}')
$lineage$,'23503',null,'a superseded publication must reference an existing predecessor');

set local role anon;
select throws_like($$select * from public.benefit_companies limit 1$$,'%permission denied%','anon cannot read companies directly');
select throws_like($$select * from public.benefit_publications limit 1$$,'%permission denied%','anon cannot read publications directly');

create temporary table benefit_results(name text primary key,payload jsonb);
insert into benefit_results values ('all',public.search_benefit_companies_v1(null,null,null,null,null,false,50,null));
select is((select jsonb_object_agg(key,true order by key) from benefit_results,jsonb_object_keys(payload) key where name='all'),'{"has_more":true,"items":true,"next_cursor":true,"total":true}'::jsonb,'search response has exact top-level keys');
select is((select payload->>'total' from benefit_results where name='all'),'6','search includes searchable zero-benefit company');
select is((select jsonb_array_length(payload->'items') from benefit_results where name='all'),6,'search returns all searchable companies');
select is((select jsonb_object_agg(key,true order by key) from benefit_results,jsonb_object_keys(payload->'items'->0) key where name='all'),'{"benefit_count":true,"categories":true,"community_count":true,"company_id":true,"display_name":true,"identity_label":true,"industry":true,"official_count":true,"region":true,"size_label":true,"summary":true}'::jsonb,'search items have exact public keys');
select is((select (item->>'benefit_count')::integer from benefit_results,jsonb_array_elements(payload->'items') item where name='all' and item->>'company_id'='KR-CRN-1101111111111'),1,'active publication rows, not revisions or evidence, determine count');
select is((select (item->>'official_count')::integer from benefit_results,jsonb_array_elements(payload->'items') item where name='all' and item->>'company_id'='KR-CRN-1101111111111'),1,'official active count is correct');
select is((select (item->>'community_count')::integer from benefit_results,jsonb_array_elements(payload->'items') item where name='all' and item->>'company_id'='KR-BIZ-1234567890'),1,'community active count is correct');
select is((select (item->>'benefit_count')::integer from benefit_results,jsonb_array_elements(payload->'items') item where name='all' and item->>'company_id'='KR-CRN-2202222222222'),0,'zero-benefit company has zero count');
select ok((select payload::text not like '%source_url%' and payload::text not like '%source_type%' and payload::text not like '%verified_at%' and payload::text not like '%provenance%' and payload::text not like '%reviewer%' and payload::text not like '%private.example%' from benefit_results where name='all'),'search exposes no private provenance fields or values');

insert into benefit_results values ('benefits-only',public.search_benefit_companies_v1(null,null,null,null,null,true,50,null));
select is((select payload->>'total' from benefit_results where name='benefits-only'),'2','has-benefits filter uses active publications over the full set');
insert into benefit_results values ('category',public.search_benefit_companies_v1(null,array['health'],null,null,null,false,50,null));
select is((select payload->>'total' from benefit_results where name='category'),'1','category filter requires an active matching publication');
insert into benefit_results values ('region',public.search_benefit_companies_v1(null,null,null,null,'서울',false,50,null));
select is((select payload->>'total' from benefit_results where name='region'),'2','region filter is applied server-side');
insert into benefit_results values ('literal-pattern',public.search_benefit_companies_v1('%',null,null,null,null,false,50,null));
select is((select payload->>'total' from benefit_results where name='literal-pattern'),'0','query metacharacters are treated as literal text');

insert into benefit_results values ('page-one',public.search_benefit_companies_v1(null,null,null,null,null,false,1,null));
insert into benefit_results values ('page-two',public.search_benefit_companies_v1(null,null,null,null,null,false,1,(select payload->>'next_cursor' from benefit_results where name='page-one')));
select ok((select payload->>'has_more'='true' and jsonb_array_length(payload->'items')=1 and payload->'next_cursor' is not null from benefit_results where name='page-one'),'first keyset page has a bounded continuation');
select isnt((select payload->'items'->0->>'company_id' from benefit_results where name='page-one'),(select payload->'items'->0->>'company_id' from benefit_results where name='page-two'),'keyset pages do not duplicate the tie-broken company');

insert into benefit_results values ('tie-1',public.search_benefit_companies_v1('tie',null,null,null,null,false,1,null));
insert into benefit_results values ('tie-2',public.search_benefit_companies_v1('tie',null,null,null,null,false,1,(select payload->>'next_cursor' from benefit_results where name='tie-1')));
insert into benefit_results values ('tie-3',public.search_benefit_companies_v1('tie',null,null,null,null,false,1,(select payload->>'next_cursor' from benefit_results where name='tie-2')));
select is((select array_agg(payload->'items'->0->>'company_id' order by name) from benefit_results where name like 'tie-%'),array['KR-BIZ-1000000001','KR-BIZ-1000000002','KR-BIZ-1000000003']::text[],'identical normalized names paginate in exact company-id order');
select is((select count(distinct payload->'items'->0->>'company_id') from benefit_results where name like 'tie-%'),3::bigint,'identical normalized-name pages have no duplicates or omissions');
select ok((select bool_and((payload->>'total')::integer=3) from benefit_results where name like 'tie-%'),'every identical normalized-name page reports the full total');
select ok((select payload->>'has_more'='false' and payload->>'next_cursor' is null from benefit_results where name='tie-3'),'the final identical normalized-name page terminates pagination');

insert into benefit_results values ('detail',public.get_benefit_company_v1('KR-BIZ-1234567890'));
select is((select jsonb_object_agg(key,true order by key) from benefit_results,jsonb_object_keys(payload) key where name='detail'),'{"company":true,"publications":true}'::jsonb,'detail has exact top-level keys');
select is((select jsonb_array_length(payload->'publications') from benefit_results where name='detail'),1,'detail returns active publications only');
select is((select jsonb_object_agg(key,true order by key) from benefit_results,jsonb_object_keys(payload->'publications'->0) key where name='detail'),'{"category_id":true,"condition_text":true,"description":true,"eligibility_text":true,"publication_id":true,"revision":true,"title":true,"trust_label":true}'::jsonb,'detail publication has exact public keys and trust label');
select is((select payload->'publications'->0->>'trust_label' from benefit_results where name='detail'),'사용자 제보','community trust has the bounded public label');
select ok((select payload::text not like '%source_url%' and payload::text not like '%source_type%' and payload::text not like '%verified_at%' and payload::text not like '%provenance%' and payload::text not like '%reviewer%' and payload::text not like '%private.example%' from benefit_results where name='detail'),'detail exposes no private provenance fields or values');
select is(public.get_benefit_company_v1('KR-CRN-3303333333333'),'null'::jsonb,'non-searchable company is not disclosed');

select throws_ok($$select public.search_benefit_companies_v1(null,null,null,null,null,false,51,null)$$,'22023','invalid page size','page size above 50 is rejected');
select throws_ok($$select public.search_benefit_companies_v1(repeat('x',201),null,null,null,null,false,10,null)$$,'22023','invalid query','oversized query is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,array['unknown'],null,null,null,false,10,null)$$,'22023','invalid category','invalid category is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,'giant',null,false,10,null)$$,'22023','invalid size','invalid size enum is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,null,null,false,10,'{}')$$,'22023','invalid cursor','incomplete cursor shape is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,null,null,false,10,'{"normalized_name":"x","company_id":"KR-BIZ-1234567890","extra":true}')$$,'22023','invalid cursor','cursor extra keys are rejected');
reset role;

select throws_ok($$insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance) values ('KR-CRN-1101111111111','health','중복','중복 active','official_verified','active','health-check',2,'official_ledger','{}')$$,'23505',null,'duplicate active lineage is rejected');
select throws_ok($$insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition,provenance) values ('KR-BIZ-9999999999','group_affiliate','invalid','invalid',true,'fixture','{}')$$,'23514',null,'identity classes are explicit and stable');
select throws_ok($$insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance) values ('KR-CRN-2202222222222','health','bad trust','bad','admin_approved','active','bad',1,'submission','{}')$$,'23514',null,'public trust claims are bounded to two tiers');

select * from finish();
rollback;
