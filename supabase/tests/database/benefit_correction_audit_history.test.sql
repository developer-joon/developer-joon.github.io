begin;
select no_plan();

insert into auth.users(id,aud,role,email) values
 ('e1000000-0000-0000-0000-000000000001','authenticated','authenticated','audit-member@example.test'),
 ('e1000000-0000-0000-0000-000000000002','authenticated','authenticated','audit-admin@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('e1000000-0000-0000-0000-000000000001',99801,'audit-member','Audit Member'),
 ('e1000000-0000-0000-0000-000000000002',99802,'audit-admin','Audit Admin');
insert into public.user_roles(user_id,role) values
 ('e1000000-0000-0000-0000-000000000001','member'),
 ('e1000000-0000-0000-0000-000000000002','admin');
insert into public.benefit_correction_requests(id,submitter_id,client_key,payload_fingerprint,company_id,category_id,current_text,proposed_text,scope_text,source_url,observed_data_version,status,admin_response,reviewer_id,reviewed_at,created_at,updated_at)
values ('e2000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',repeat('a',64),'US-CIK0000320193','leave','Old','New','All','https://example.com/audit','company-benefits-2026-11-01-v1','reviewing','Second request','e1000000-0000-0000-0000-000000000002','2026-11-01 03:00:00+00','2026-11-01 00:00:00+00','2026-11-01 03:00:00+00');
insert into public.benefit_correction_events(id,request_id,actor_kind,actor_id,actor_snapshot,operation,client_key,payload_fingerprint,action,from_status,to_status,response_text,created_at) values
 ('e4000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','user','e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','create','e3000000-0000-0000-0000-000000000001',repeat('a',64),'submitted',null,'submitted',null,'2026-11-01 00:00:00+00'),
 ('e4000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','user','e1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002','review','e3000000-0000-0000-0000-000000000002',repeat('b',64),'start_review','submitted','reviewing','Started','2026-11-01 01:00:00+00'),
 ('e4000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000001','user','e1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002','review','e3000000-0000-0000-0000-000000000003',repeat('c',64),'additional_material_requested','reviewing','reviewing','First request','2026-11-01 02:00:00+00'),
 ('e4000000-0000-0000-0000-000000000004','e2000000-0000-0000-0000-000000000001','user','e1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002','review','e3000000-0000-0000-0000-000000000004',repeat('d',64),'additional_material_requested','reviewing','reviewing','Second request','2026-11-01 02:00:00+00');

select has_function('public','list_benefit_correction_audit_v1',array['uuid','integer','timestamp with time zone','uuid'],'audit list RPC exists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] and p.proconfig @> array['plan_cache_mode=force_custom_plan'] and pg_get_userbyid(p.proowner)='postgres' from pg_proc p where p.oid='public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid)'::regprocedure),'audit RPC is fixed-owner, empty-search-path, and custom-planned');
select ok(has_function_privilege('authenticated','public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid)','EXECUTE') and not has_function_privilege('anon','public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid)','EXECUTE') and not has_function_privilege('public','public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid)','EXECUTE'),'only authenticated receives browser execution grant');
select ok(not has_table_privilege('authenticated','public.benefit_correction_events','SELECT') and not has_table_privilege('anon','public.benefit_correction_events','SELECT'),'direct audit table denial remains unchanged');
select ok((select strpos(prosrc,'public.is_admin()')>0 from pg_proc where oid='public.list_benefit_correction_audit_v1(uuid,integer,timestamptz,uuid)'::regprocedure),'audit authorization uses DB-backed is_admin');

set local role anon;
select throws_like($$select public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001')$$,'%permission denied%','anonymous audit read is denied by grant');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000001';
select throws_ok($$select public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001')$$,'42501','admin required','nonadmin audit read is denied');
select set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000001","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001')$$,'42501','admin required','forged JWT metadata remains denied');
select set_config('request.jwt.claims','',true);
reset role;

set local role authenticated;
set local request.jwt.claim.sub='e1000000-0000-0000-0000-000000000002';
create temporary table audit_results(name text primary key,payload jsonb);
insert into audit_results values ('all',public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001',10));
select is((select jsonb_array_length(payload->'items') from audit_results where name='all'),4,'admin receives every append-only audit event');
select is((select jsonb_agg(item->>'event_type' order by ordinality) from audit_results,jsonb_array_elements(payload->'items') with ordinality events(item,ordinality) where name='all'),'["submitted", "start_review", "additional_material_requested", "additional_material_requested"]'::jsonb,'events use stable ascending created-at and sequence order with repeated material requests visible');
select is((select jsonb_object_agg(key,true order by key) from audit_results,jsonb_object_keys(payload->'items'->0) key where name='all'),'{"admin_response":true,"applied_version":true,"created_at":true,"event_type":true,"from_status":true,"sequence":true,"to_status":true}'::jsonb,'audit projection has exact privacy-safe keys');
select ok((select payload::text not like '%actor%' and payload::text not like '%snapshot%' and payload::text not like '%email%' and payload::text not like '%token%' and payload::text not like '%reviewer%' and payload::text not like '%fingerprint%' and payload::text not like '%diagnostic%' and payload::text not like '%example.test%' from audit_results where name='all'),'audit projection excludes identity, secret, and diagnostic material');
insert into audit_results values ('page-1',public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001',2));
insert into audit_results values ('page-2',public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001',2,((select payload->'next_cursor'->>'created_at' from audit_results where name='page-1')::timestamptz),((select payload->'next_cursor'->>'sequence' from audit_results where name='page-1')::uuid)));
select ok((select payload->>'has_more'='true' and payload->'next_cursor' is not null from audit_results where name='page-1'),'audit first page returns a complete continuation');
select is((select jsonb_agg(item->>'sequence' order by ordinality) from audit_results,jsonb_array_elements(payload->'items') with ordinality events(item,ordinality) where name='page-2'),'["e4000000-0000-0000-0000-000000000003", "e4000000-0000-0000-0000-000000000004"]'::jsonb,'audit cursor continues in exact UUID tie-break order without omissions');
select ok((select payload->>'has_more'='false' and payload->'next_cursor'='null'::jsonb from audit_results where name='page-2'),'audit terminal page has no continuation');
select is(jsonb_array_length(public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000099')->'items'),0,'unknown request returns an empty audit page');
select throws_ok($$select public.list_benefit_correction_audit_v1('not-a-uuid')$$,'22P02','invalid input syntax for type uuid: "not-a-uuid"','malformed request ID is rejected by the typed boundary');
select throws_ok($$select public.list_benefit_correction_audit_v1(null)$$,'22023','invalid correction request id','null request ID is rejected');
select throws_ok($$select public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001',0)$$,'22023','invalid page limit','audit page size is bounded');
select throws_ok($$select public.list_benefit_correction_audit_v1('e2000000-0000-0000-0000-000000000001',10,'2026-11-01')$$,'22023','invalid cursor','partial audit cursor is rejected');
reset role;

select * from finish();
rollback;
