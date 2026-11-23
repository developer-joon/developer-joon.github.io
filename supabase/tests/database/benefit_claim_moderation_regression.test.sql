begin;
select no_plan();

select has_column('public','benefit_claims','merged_into_claim_id','merged sources retain an explicit target marker');
select has_function('public','list_benefit_claim_audit_v1',array['uuid','integer','timestamptz','text','uuid'],'audit cursor includes a namespace discriminator');
select ok(exists(select 1 from pg_trigger where tgrelid='public.benefit_claim_official_reviews'::regclass and tgname='benefit_claim_official_reviews_evidence_gate'),'official reviews have a storage-boundary evidence gate');
select is((select count(*)::integer from pg_trigger where tgrelid=any(array['public.benefit_claims'::regclass,'public.benefit_publications'::regclass,'public.benefit_claim_official_reviews'::regclass]) and tgname like '%official_evidence_invariant%'),3,'official evidence invariant is enforced from all three tables');
select ok((select not has_table_privilege('service_role','public.benefit_claim_official_reviews','INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','public.benefit_claim_moderation_requests','INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','public.benefit_claim_merges','INSERT,UPDATE,DELETE,TRUNCATE')),'service role has no direct ledger mutation rights');

insert into auth.users(id,aud,role,email) values
 ('b9100000-0000-4000-8000-000000000001','authenticated','authenticated','reg-admin@example.test'),
 ('b9100000-0000-4000-8000-000000000002','authenticated','authenticated','reg-owner@example.test'),
 ('b9100000-0000-4000-8000-000000000003','authenticated','authenticated','reg-reactor@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
 ('b9100000-0000-4000-8000-000000000001',99910001,'reg-admin','Admin'),
 ('b9100000-0000-4000-8000-000000000002',99910002,'reg-owner','Owner'),
 ('b9100000-0000-4000-8000-000000000003',99910003,'reg-reactor','Reactor');
insert into public.user_roles values
 ('b9100000-0000-4000-8000-000000000001','admin'),
 ('b9100000-0000-4000-8000-000000000002','member'),
 ('b9100000-0000-4000-8000-000000000003','member');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('reg-admin','b9100000-0000-4000-8000-000000000001','{}','google'),
 ('reg-owner','b9100000-0000-4000-8000-000000000002','{}','google'),
 ('reg-reactor','b9100000-0000-4000-8000-000000000003','{}','google');
insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values
 ('KR-BIZ-9991000001','registered_business','Regression Company','regression company',true,'moderation-regression'),
 ('KR-BIZ-9991000002','registered_business','Other Company','other company',true,'moderation-regression');
insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on) values
 ('b9200000-0000-4000-8000-000000000001','KR-BIZ-9991000001','b9100000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('1',64),'health','Replay claim','replay claim','Replay description','',date '2026-01-01'),
 ('b9200000-0000-4000-8000-000000000002','KR-BIZ-9991000001','b9100000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('2',64),'health','Merge source','merge source','Merge source description','',date '2026-01-01'),
 ('b9200000-0000-4000-8000-000000000003','KR-BIZ-9991000001','b9100000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('3',64),'health','Merge target','merge target','Merge target description','',date '2026-01-01'),
 ('b9200000-0000-4000-8000-000000000004','KR-BIZ-9991000001','b9100000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('4',64),'leave','Community official','community official','Community official description','',date '2026-01-01');
insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values
 ('b9200000-0000-4000-8000-000000000004','b9100000-0000-4000-8000-000000000001','confirm'),
 ('b9200000-0000-4000-8000-000000000004','b9100000-0000-4000-8000-000000000003','confirm'),
 ('b9200000-0000-4000-8000-000000000004','b9100000-0000-4000-8000-000000000099','confirm');
do $setup$ declare p uuid; begin
 insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,observed_at,verified_at,provenance)
 values('KR-BIZ-9991000001','leave','Community official','Community official description','community_reviewed','active','claim-b9200000-0000-4000-8000-000000000004',1,'claim_reaction',date '2026-01-01',clock_timestamp(),jsonb_build_object('claim_id','b9200000-0000-4000-8000-000000000004')) returning publication_id into p;
 update public.benefit_claims set status='community_confirmed',active_publication_id=p,revision=2,updated_at=clock_timestamp() where claim_id='b9200000-0000-4000-8000-000000000004';
 set constraints all immediate; set constraints all deferred;
end$setup$;
update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key in ('claims_write_enabled','claim_reactions_write_enabled');

-- User withdrawal must retain Task 6 guards and replay immutable response bytes.
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000002';
select throws_ok($$select public.set_benefit_claim_reaction_v1('b9200000-0000-4000-8000-000000000001',repeat(' ',21)||'confirm',gen_random_uuid())$$,'22023','invalid claim reaction','Task 7 preserves the Task 6 pre-normalization reaction length guard');
select throws_ok($$select public.withdraw_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000001','hidden',1)$$,'22023','invalid claim withdrawal request','user withdrawal rejects hidden expected status before lookup');
select throws_ok($$select public.withdraw_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000001','submitted',0)$$,'22023','invalid claim withdrawal request','user withdrawal rejects nonpositive revision');
create temporary table regression_results(name text primary key,payload jsonb);
insert into regression_results values ('withdraw',public.withdraw_benefit_claim_v1('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','submitted',1));
reset role;
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
select lives_ok($$select public.moderate_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000001',2,'withdrawn','restore',null,'restore for review')$$,'admin may restore a withdrawn nonmerged claim');
select lives_ok($$select public.officially_verify_benefit_claim_v1('b9200000-0000-4000-8000-000000000001','submitted',3,'Official replay title','Official replay description',null,null,'official_website','https://example.com/replay-policy',date '2026-01-01','review note',gen_random_uuid())$$,'later official verification changes claim revision');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000002';
select is(public.withdraw_benefit_claim_v1('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','submitted',1),(select payload from regression_results where name='withdraw'),'withdraw replay is the immutable stored response after later state changes');
select throws_ok($$select public.withdraw_benefit_claim_v1('b9300000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001','submitted',2)$$,'22023','client key reused with different payload','withdraw replay conflicts on a changed payload');
reset role;
select is((select count(*)::integer from public.benefit_claim_moderation_requests where actor_snapshot='b9100000-0000-4000-8000-000000000002' and client_key='b9300000-0000-4000-8000-000000000001'),1,'withdraw has one immutable request ledger row');
select is((select count(*)::integer from public.benefit_claim_events where claim_id='b9200000-0000-4000-8000-000000000001' and event_type='withdrawn'),1,'withdraw replay emits no duplicate event');
select is((select count(*)::integer from public.rate_limit_events where user_id='b9100000-0000-4000-8000-000000000002' and action='benefit_claim.withdraw'),1,'withdraw replay consumes no duplicate rate slot');
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
select lives_ok($$select public.officially_verify_benefit_claim_v1('b9200000-0000-4000-8000-000000000004','community_confirmed',2,'Official community title','Official community description',null,null,'official_website','https://example.com/community-policy',date '2026-01-01','community review note',gen_random_uuid())$$,'official verification at three confirmations retires community authority');
reset role;
select ok((select c.status='community_confirmed' and c.active_publication_id is null and c.official_publication_id is not null and p.status='active' and p.trust_tier='official_verified' and p.supersedes_publication_id is not null from public.benefit_claims c join public.benefit_publications p on p.publication_id=c.official_publication_id where c.claim_id='b9200000-0000-4000-8000-000000000004'),'three-confirmation official claim has only active official authority');
select is((select count(*)::integer from public.benefit_publications where provenance->>'claim_id'='b9200000-0000-4000-8000-000000000004' and trust_tier='community_reviewed' and status<>'active'),1,'community authority is retired by official verification');
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000002';
select lives_ok($$select public.withdraw_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000004','community_confirmed',3)$$,'user withdrawal may retain official authority pending explicit admin withdrawal');
reset role;
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
select lives_ok($$select public.moderate_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000004',4,'withdrawn','withdraw_official',null,'retire official authority','official_website',date '2026-01-01','https://example.com/community-policy')$$,'admin can explicitly withdraw official authority from a user-withdrawn claim');
reset role;
select ok((select status='withdrawn' and official_publication_id is null and active_publication_id is null and revision=5 from public.benefit_claims where claim_id='b9200000-0000-4000-8000-000000000004'),'explicit official withdrawal preserves withdrawn terminal state and timestamp invariant');
select is((select count(*)::integer from public.benefit_claim_official_reviews where claim_id='b9200000-0000-4000-8000-000000000004' and action='withdraw_official' and predecessor_publication_id=publication_id),1,'official withdrawal adds an immutable review bound to its predecessor');
insert into public.benefit_claim_events(event_id,claim_id,actor_snapshot,operation,client_key,payload_fingerprint,event_type,from_status,to_status,metadata,created_at)
select review_id,claim_id,'b9100000-0000-4000-8000-000000000001','review',gen_random_uuid(),repeat('a',64),'official_reviewed','submitted','submitted',jsonb_build_object('publication_id',publication_id),reviewed_at
from public.benefit_claim_official_reviews where claim_id='b9200000-0000-4000-8000-000000000001';

-- Official evidence rows are the authority boundary, not just an RPC convention.
select throws_ok($attack$do $x$ declare p uuid; begin
 insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_url,source_type,observed_at,verified_at,provenance)
 values('KR-BIZ-9991000001','health','Spoof','Spoof','official_verified','active','claim-b9200000-0000-4000-8000-000000000002',1,'https://example.com/evidence','claim_official',date '2026-01-01',clock_timestamp(),jsonb_build_object('claim_id','b9200000-0000-4000-8000-000000000002')) returning publication_id into p;
 update public.benefit_claims set official_publication_id=p,revision=revision+1,updated_at=clock_timestamp() where claim_id='b9200000-0000-4000-8000-000000000002';
 set constraints all immediate;
end$x$$attack$,'23514','official claim publication requires one immutable verification review','direct claim/publication authority without review is rejected');
select throws_ok($$insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,successor_publication_id) values('b9200000-0000-4000-8000-000000000002',gen_random_uuid(),'b9100000-0000-4000-8000-000000000001','verify','official_website','https://example.com/evidence',current_date,'valid note',gen_random_uuid())$$,'23514','official review must bind exactly to its claim publication','direct review without an exact publication binding is rejected');
select throws_ok($$insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,successor_publication_id) select claim_id,publication_id,'b9100000-0000-4000-8000-000000000001','verify','blog','https://example.com/evidence',current_date,'valid note',publication_id from public.benefit_claim_official_reviews limit 1$$,'23514',null,'direct review evidence type outside allowlist is rejected');
select throws_ok($$insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,successor_publication_id) select claim_id,publication_id,'b9100000-0000-4000-8000-000000000001','verify','official_website','http://example.com/evidence',current_date,'valid note',publication_id from public.benefit_claim_official_reviews limit 1$$,'22023','invalid claim source URL','direct review HTTP evidence is rejected');
select throws_ok($$insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,successor_publication_id) select claim_id,publication_id,'b9100000-0000-4000-8000-000000000001','verify','official_website',evidence_source_url,current_date+1,'valid note',publication_id from public.benefit_claim_official_reviews limit 1$$,'22023','invalid official evidence','direct review future evidence date is rejected');
select throws_ok($$insert into public.benefit_claim_official_reviews(claim_id,publication_id,reviewer_snapshot,action,evidence_type,evidence_source_url,evidence_observed_on,verification_note,successor_publication_id) select claim_id,publication_id,'b9100000-0000-4000-8000-000000000001','verify','official_website',evidence_source_url,evidence_observed_on,' bad ',publication_id from public.benefit_claim_official_reviews limit 1$$,'23514',null,'direct review untrimmed note is rejected');
select throws_ok($attack$do $x$ begin update public.benefit_publications set status='withdrawn' where publication_id=(select official_publication_id from public.benefit_claims where claim_id='b9200000-0000-4000-8000-000000000001'); set constraints all immediate; end$x$$attack$,'23514','claim official publication must be its active official authority','direct official publication retirement is rejected');
select throws_ok($attack$do $x$ begin update public.benefit_claims set official_publication_id=null,revision=revision+1,updated_at=clock_timestamp() where claim_id='b9200000-0000-4000-8000-000000000001'; set constraints all immediate; end$x$$attack$,'23514','official claim publication requires one immutable verification review','direct claim pointer removal is rejected while official publication remains active');
select throws_ok($attack$do $x$ declare p uuid; begin select official_publication_id into p from public.benefit_claims where claim_id='b9200000-0000-4000-8000-000000000001'; update public.benefit_publications set status='withdrawn' where publication_id=p; update public.benefit_claims set official_publication_id=null,revision=revision+1,updated_at=clock_timestamp() where claim_id='b9200000-0000-4000-8000-000000000001'; set constraints all immediate; end$x$$attack$,'23514','explicit official withdrawal requires one immutable withdrawal review','combined direct publication retirement and pointer clearing without a withdrawal review is rejected');

-- Merge stores terminal truth and emits symmetric audit identities.
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
select lives_ok($$select public.moderate_benefit_claim_v1('b9300000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000002',1,'submitted','merge','b9200000-0000-4000-8000-000000000003','duplicate')$$,'merge succeeds');
select throws_ok($$select public.moderate_benefit_claim_v1(gen_random_uuid(),'b9200000-0000-4000-8000-000000000002',2,'merged','restore',null,'no')$$,'22023','claim cannot be restored','merged source cannot be restored');
select throws_ok($$select public.set_benefit_claim_reaction_v1('b9200000-0000-4000-8000-000000000002','dispute',gen_random_uuid())$$,'22023','benefit claim is not visible','merged source cannot receive reactions');
reset role;
select ok((select status='merged' and merged_into_claim_id='b9200000-0000-4000-8000-000000000003' from public.benefit_claims where claim_id='b9200000-0000-4000-8000-000000000002'),'merged source is terminal and explicitly points to target');
select is((select metadata->>'target_claim_id' from public.benefit_claim_events where claim_id='b9200000-0000-4000-8000-000000000002' and operation='moderate' and event_type='merged'),'b9200000-0000-4000-8000-000000000003','merged source event identifies its target');
select is((select metadata->>'source_claim_id' from public.benefit_claim_events where claim_id='b9200000-0000-4000-8000-000000000003' and operation='merge_target' and event_type='merged'),'b9200000-0000-4000-8000-000000000002','merge target event identifies its source');
select is((select item->>'related_claim_id' from jsonb_array_elements(public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000002',100)->'items') item where item->>'event_kind'='claim_event' and item->>'action'='merged'),'b9200000-0000-4000-8000-000000000003','source claim audit hydrates the target from its claim event');
select is((select item->>'related_claim_id' from jsonb_array_elements(public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000003',100)->'items') item where item->>'event_kind'='claim_event' and item->>'action'='merged'),'b9200000-0000-4000-8000-000000000002','target claim audit hydrates the source from its claim event');

set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.list_benefit_claim_moderation_queue_v1('all',10)) key),'{"has_more":true,"items":true,"next_cursor":true}'::jsonb,'queue envelope has exact keys');
select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.list_benefit_claim_moderation_queue_v1('all',10)->'items'->0) key),'{"claim_id":true,"community_publication_active":true,"company_id":true,"company_name":true,"confirm_count":true,"created_at":true,"category_id":true,"dispute_count":true,"official_publication_active":true,"revision":true,"status":true,"title":true,"updated_at":true}'::jsonb,'queue item has exact dense safe keys');
select is((select jsonb_object_agg(key,true order by key) from jsonb_object_keys(public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',10)->'items'->0) key),'{"action":true,"created_at":true,"event_id":true,"event_kind":true,"evidence_observed_on":true,"evidence_type":true,"from_status":true,"publication_id":true,"related_claim_id":true,"to_status":true}'::jsonb,'audit item has exact dense keys');
select ok(public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',100)::text not like '%review note%' and public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',100)::text not like '%reviewer%' and public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',100)::text not like '%client_key%' and public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',100)::text not like '%fingerprint%','audit leaks no private note, reviewer, client key, or fingerprint');
create temporary table audit_pages(page integer,payload jsonb);
insert into audit_pages values(1,public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',1));
insert into audit_pages select 2,public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000001',1,(payload->'next_cursor'->>'created_at')::timestamptz,payload->'next_cursor'->>'event_kind',(payload->'next_cursor'->>'event_id')::uuid) from audit_pages where page=1;
select is((select count(distinct (item->>'created_at',item->>'event_kind',item->>'event_id'))::integer from audit_pages cross join lateral jsonb_array_elements(payload->'items') item),2,'namespace-aware audit cursor does not skip or duplicate identical timestamp/id rows');
select is((public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000002',100)->'items'->0->>'related_claim_id'),'b9200000-0000-4000-8000-000000000003','source audit points to target');
select ok(exists(select 1 from jsonb_array_elements(public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000003',100)->'items') i where i->>'related_claim_id'='b9200000-0000-4000-8000-000000000002'),'target audit points to source, never itself');
select throws_ok($$select public.list_benefit_claim_audit_v1('b9200000-0000-4000-8000-000000000003',10,'infinity','merge','b9200000-0000-4000-8000-000000000002')$$,'22023','invalid cursor','audit rejects infinite cursor timestamps');
select throws_ok($$select public.list_benefit_claim_moderation_queue_v1('all',10,'-infinity',gen_random_uuid())$$,'22023','invalid cursor','queue rejects infinite cursor timestamps');
reset role;

insert into public.benefit_claims(company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
select 'KR-BIZ-9991000002',gen_random_uuid(),repeat('b',64),'leave','Queue overflow '||lpad(g::text,3,'0'),'queue overflow '||lpad(g::text,3,'0'),'Queue bound fixture','',date '2026-01-01' from generate_series(1,102) g;
set local role authenticated;
set local request.jwt.claim.sub='b9100000-0000-4000-8000-000000000001';
create temporary table queue_pages(page integer,payload jsonb);
insert into queue_pages values(1,public.list_benefit_claim_moderation_queue_v1('all',100));
insert into queue_pages select 2,public.list_benefit_claim_moderation_queue_v1('all',100,(payload->'next_cursor'->>'created_at')::timestamptz,(payload->'next_cursor'->>'claim_id')::uuid) from queue_pages where page=1;
select ok((select payload->>'has_more'='true' and jsonb_array_length(payload->'items')=100 from queue_pages where page=1),'queue probes max plus one before returning a full bounded first page');
select is((select count(distinct item->>'claim_id')::integer from queue_pages cross join lateral jsonb_array_elements(payload->'items') item),106,'queue pagination has no skip or duplicate across identical timestamps');
reset role;

select throws_ok($$update public.benefit_claim_official_reviews set verification_note='tampered'$$,'23514','benefit claim moderation ledgers are append-only','official review update rejected');
select throws_ok($$delete from public.benefit_claim_official_reviews$$,'23514','benefit claim moderation ledgers are append-only','official review delete rejected');
select throws_ok($$truncate public.benefit_claim_official_reviews$$,'23514','benefit claim moderation ledgers are append-only','official review truncate rejected');
select throws_ok($$update public.benefit_claim_moderation_requests set response='{}'$$,'23514','benefit claim moderation ledgers are append-only','request update rejected');
select throws_ok($$delete from public.benefit_claim_moderation_requests$$,'23514','benefit claim moderation ledgers are append-only','request delete rejected');
select throws_ok($$truncate public.benefit_claim_moderation_requests$$,'23514','benefit claim moderation ledgers are append-only','request truncate rejected');
select throws_ok($$update public.benefit_claim_merges set actor_snapshot=gen_random_uuid()$$,'23514','benefit claim moderation ledgers are append-only','merge update rejected');
select throws_ok($$delete from public.benefit_claim_merges$$,'23514','benefit claim moderation ledgers are append-only','merge delete rejected');
select throws_ok($$truncate public.benefit_claim_merges cascade$$,'23514','benefit claim moderation ledgers are append-only','merge truncate rejected');

select * from finish();
rollback;
