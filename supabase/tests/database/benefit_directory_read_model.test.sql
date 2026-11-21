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
select ok((select coalesce(bool_and(not i.indisunique),false) from pg_catalog.pg_class c join pg_catalog.pg_index i on i.indexrelid=c.oid where c.relnamespace='public'::regnamespace and c.relname='benefit_publications_active_lineage_idx'),'active lineage lookup index is non-unique so either transaction write order is possible');
select ok((select coalesce(bool_and(t.tgdeferrable and t.tginitdeferred),false) from pg_catalog.pg_trigger t where t.tgrelid='public.benefit_publications'::regclass and t.tgname='benefit_publications_unique_active_lineage_check'),'active lineage uniqueness is checked by a deferred constraint trigger');

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
  values ('b1000000-0000-0000-0000-000000000010','KR-CRN-1101111111111','health','새 건강검진','새 revision','official_verified','active','health-check',2,'b1000000-0000-0000-0000-000000000001','official_ledger','{}');
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'a transaction may supersede the predecessor before inserting an active successor');
select lives_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000015','KR-CRN-3303333333333','health','숨김 후속','lineage fixture','official_verified','active','hidden-lineage',2,'b1000000-0000-0000-0000-000000000005','official_ledger','{}');
  update public.benefit_publications set status='superseded' where publication_id='b1000000-0000-0000-0000-000000000005';
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'a transaction may insert an active successor before superseding its predecessor');
select is((select count(*) from public.benefit_publications where company_id='KR-CRN-3303333333333' and dedupe_key='hidden-lineage' and status='active'),1::bigint,'active-successor-first leaves exactly one active publication');

select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000018','KR-BIZ-1234567890','leave','두 번째 active','invalid','community_reviewed','active','refresh-leave',3,'submission','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication lineage may have at most one active publication','two active rows left at the constraint boundary are rejected');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance) values
    ('b1000000-0000-0000-0000-000000000020','KR-CRN-2202222222222','health','높은 revision 먼저','invalid','official_verified','active','reverse-two-active',2,'official_ledger','{}'),
    ('b1000000-0000-0000-0000-000000000021','KR-CRN-2202222222222','health','낮은 revision 나중','invalid','official_verified','active','reverse-two-active',1,'official_ledger','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication lineage may have at most one active publication','two active rows are rejected when the higher revision is inserted first');
select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000022','KR-CRN-2202222222222','health','이동 source','invalid','official_verified','active','move-source',1,'official_ledger','{}');
  update public.benefit_publications
  set company_id='KR-BIZ-1234567890',dedupe_key='refresh-leave',revision=4
  where publication_id='b1000000-0000-0000-0000-000000000022';
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication lineage may have at most one active publication','moving an active row into an occupied lineage is rejected');

select lives_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values ('b1000000-0000-0000-0000-000000000019','KR-BIZ-1234567890','health','이동 후 삭제','lineage fixture','official_verified','active','move-delete-lineage',1,'official_ledger','{}');
  update public.benefit_publications
  set company_id='KR-CRN-2202222222222',dedupe_key='moved-active'
  where publication_id='b1000000-0000-0000-0000-000000000019';
  delete from public.benefit_publications
  where publication_id='b1000000-0000-0000-0000-000000000019';
  set constraints all immediate;
  set constraints all deferred;
end
$test$
$lineage$,'active-row lineage moves and deletes preserve the invariant on old and new keys');
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
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,repeat('x',33),null,false,10,null)$$,'22023','invalid size length','oversized size is rejected before enum comparison');
select throws_ok($$select public.search_benefit_companies_v1(null,array[repeat('x',33)],null,null,null,false,10,null)$$,'22023','invalid category length','oversized category elements are rejected before comparison or aggregation');
select throws_ok($$select public.search_benefit_companies_v1(null,array['unknown'],null,null,null,false,10,null)$$,'22023','invalid category','invalid category is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,'giant',null,false,10,null)$$,'22023','invalid size','invalid size enum is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,null,null,false,10,'{}')$$,'22023','invalid cursor','incomplete cursor shape is rejected');
select throws_ok($$select public.search_benefit_companies_v1(null,null,null,null,null,false,10,'{"normalized_name":"x","company_id":"KR-BIZ-1234567890","extra":true}')$$,'22023','invalid cursor','cursor extra keys are rejected');
reset role;

-- Keep the representative corpus in this transaction so rollback cleans it up.
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition,provenance)
select 'KR-BIZ-'||pg_catalog.lpad(n::text,10,'0'),'recruitment_observation',
  'Performance Company '||pg_catalog.lpad(n::text,5,'0'),
  'performance company '||pg_catalog.lpad(n::text,5,'0'),true,'performance-fixture-v1','{}'::jsonb
from pg_catalog.generate_series(2000000000,2000040046) n;
analyze public.benefit_companies;

create function pg_temp.explain_json(p_sql text)
returns jsonb language plpgsql as $$
declare v_plan jsonb;
begin
  execute 'explain (format json,costs off) '||p_sql into v_plan;
  return v_plan;
end $$;
create function pg_temp.plan_nodes(p_plan jsonb)
returns setof jsonb language sql immutable as $$
  with recursive nodes(node) as (
    select p_plan->0->'Plan'
    union all
    select child
    from nodes
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(node->'Plans','[]'::jsonb)) child
  )
  select node from nodes
$$;
create temporary table benefit_directory_plans(plan jsonb);
insert into benefit_directory_plans values (pg_temp.explain_json($sql$
  with candidates as materialized (
    select c.company_id,c.normalized_name
    from public.benefit_companies c
    where c.is_searchable
    order by c.normalized_name,c.company_id
    limit 11
  ), page as materialized (
    select company_id,normalized_name
    from candidates
    order by normalized_name,company_id
    limit 10
  ), publication_aggregates as materialized (
    select bp.company_id,count(*) benefit_count,
      count(*) filter (where bp.trust_tier='official_verified') official_count,
      count(*) filter (where bp.trust_tier='community_reviewed') community_count,
      pg_catalog.jsonb_agg(distinct bp.category_id order by bp.category_id) categories
    from page p
    join public.benefit_publications bp on bp.company_id=p.company_id and bp.status='active'
    group by bp.company_id
  )
  select p.company_id,p.normalized_name,coalesce(a.benefit_count,0)
  from page p
  left join publication_aggregates a using(company_id)
  order by p.normalized_name,p.company_id
$sql$));
select ok((select exists(
    select 1 from pg_temp.plan_nodes(plan) node
    where node->>'Node Type'='Limit'
      and node::text like '%benefit_companies_search_order_idx%'
  ) and exists(
    select 1 from pg_temp.plan_nodes(plan) node
    where node->>'Node Type'='Aggregate'
      and node::text like '%"CTE Name": "page"%'
      and node::text like '%benefit_publications%'
  ) from benefit_directory_plans),'page candidates use the ordered company index and are limited before page-only publication aggregation');

set local role anon;
insert into benefit_results values ('representative-volume',public.search_benefit_companies_v1(null,null,null,null,null,false,10,null));
reset role;
select is((select (payload->>'total')::integer from benefit_results where name='representative-volume'),40053,'representative-volume search reports the exact full-set total');
select ok((select jsonb_array_length(payload->'items')<=10 from benefit_results where name='representative-volume'),'representative-volume first page stays within page size');
select is(
  (select array_agg(item->>'company_id' order by ordinal) from benefit_results cross join lateral jsonb_array_elements(payload->'items') with ordinality rows(item,ordinal) where name='representative-volume'),
  (select array_agg(company_id order by normalized_name,company_id) from (select company_id,normalized_name from public.benefit_companies where is_searchable order by normalized_name,company_id limit 10) expected),
  'representative-volume first page uses deterministic normalized-name and company-id order'
);

select throws_ok($lineage$
do $test$
begin
  insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance)
  values ('KR-CRN-1101111111111','health','중복','중복 active','official_verified','active','health-check',3,'official_ledger','{}');
  set constraints all immediate;
end
$test$
$lineage$,'23514','benefit publication lineage may have at most one active publication','duplicate active lineage is rejected at the deferred constraint boundary');
select throws_ok($$insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition,provenance) values ('KR-BIZ-9999999999','group_affiliate','invalid','invalid',true,'fixture','{}')$$,'23514',null,'identity classes are explicit and stable');
select throws_ok($$insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance) values ('KR-CRN-2202222222222','health','bad trust','bad','admin_approved','active','bad',1,'submission','{}')$$,'23514',null,'public trust claims are bounded to two tiers');

select * from finish();
rollback;
