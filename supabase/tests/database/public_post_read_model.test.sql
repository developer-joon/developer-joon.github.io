begin;

select plan(64);

insert into auth.users (id, aud, role, email) values
  ('51000000-0000-0000-0000-000000000001','authenticated','authenticated','read-a@example.test'),
  ('51000000-0000-0000-0000-000000000002','authenticated','authenticated','read-b@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
  ('51000000-0000-0000-0000-000000000001',95101,'read-a','Read A'),
  ('51000000-0000-0000-0000-000000000002',95102,'read-b','Read B');
insert into public.tags(id,slug,label,sort_order) values
  ('53000000-0000-0000-0000-000000000001','read-one','Read One',951),
  ('53000000-0000-0000-0000-000000000002','read-two','Read Two',952);
insert into public.posts(id,author_id,title,body_markdown,status,is_pinned,created_at,updated_at) values
  ('52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','weighted needle','short body','published',false,'2026-09-01','2026-09-01'),
  ('52000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','newest',E'needle [leak](<https://project.supabase.co/storage/v1/object/sign/community-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002?token=list_secret> "safe list") [ordinary](cafe/dead)','published',false,'2026-09-03','2026-09-03'),
  ('52000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','pinned','other','published',true,'2026-09-02','2026-09-02'),
  ('52000000-0000-0000-0000-000000000004','51000000-0000-0000-0000-000000000001','hidden needle','secret','hidden',false,'2026-09-04','2026-09-04');
insert into public.post_tags(post_id,tag_id) values
  ('52000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001'),
  ('52000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000002'),
  ('52000000-0000-0000-0000-000000000002','53000000-0000-0000-0000-000000000001');
insert into public.comments(id,post_id,author_id,body_markdown,status,deleted_at) values
  ('54000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','public one','published',null),
  ('54000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','hidden one','hidden',null),
  ('54000000-0000-0000-0000-000000000003','52000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000002','public two','published',null),
  ('54000000-0000-0000-0000-000000000005','52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','public extra','published',null);
insert into public.post_reactions(id,user_id,post_id,created_at) values
 ('55000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001',statement_timestamp()),
 ('55000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001',statement_timestamp()-interval '31 days');

select has_function('public','list_public_posts',array['text','integer','text','uuid','boolean','timestamp with time zone','bigint','uuid','real'],'public list RPC exists');
select ok(not has_function_privilege('public','public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)','EXECUTE'),'PUBLIC cannot execute list RPC');
select ok(has_function_privilege('anon','public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)','EXECUTE'),'anon can execute list RPC');
select ok(has_function_privilege('authenticated','public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)','EXECUTE'),'authenticated can execute list RPC');
select is((select prosecdef from pg_proc where oid='public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure),true,'RPC is a constrained security definer');
select ok(not has_table_privilege('anon','public.post_reactions','SELECT'),'raw reactions remain private');
select ok(not has_table_privilege('anon','private.post_reaction_daily_counts','SELECT'),'browser cannot directly read buckets');
select ok(not has_table_privilege('anon','private.post_reaction_counts','SELECT'),'browser cannot directly read all-time counter shards');
select ok(not has_schema_privilege('anon','private','USAGE'),'browser cannot enumerate the private read-model schema');
select ok(not has_function_privilege('anon','private.public_post_counts(uuid)','EXECUTE'),'browser cannot query private counts by hidden post UUID');
select has_function('public','get_public_post',array['uuid'],'public detail RPC exists');
select ok(not has_function_privilege('public','public.get_public_post(uuid)','EXECUTE'),'PUBLIC cannot execute detail RPC');
select ok(has_function_privilege('anon','public.get_public_post(uuid)','EXECUTE'),'anon can execute detail RPC');

set local role anon;
create temporary table read_rows as select * from public.list_public_posts('newest',10,null,null,null,null,null,null,null);
select is((select count(*)::integer from read_rows),3,'only public posts are listed');
select is((select id from read_rows order by row_number limit 1),'52000000-0000-0000-0000-000000000003'::uuid,'pinned post sorts first');
select ok(not exists(select 1 from information_schema.columns where table_schema like 'pg_temp%' and table_name='read_rows' and column_name='body_markdown'),'list transfers no full body');
select is((select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'),E'needle [leak](about:blank#attachment-unavailable "safe list") [ordinary](cafe/dead)','list excerpt is derived from the sanitized public body');
select ok(position('storage/v1/object' in (select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'))=0,'list excerpt exposes no Storage API URL');
select ok(position('token=' in (select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'))=0,'list excerpt exposes no credential suffix');
select is((select comment_count from read_rows where id='52000000-0000-0000-0000-000000000001'),2::bigint,'initial comment metric backfill excludes hidden comments');
select is((select reaction_count from read_rows where id='52000000-0000-0000-0000-000000000001'),2::bigint,'display reaction count includes all-time likes');
select is((select popularity_score from read_rows where id='52000000-0000-0000-0000-000000000001'),4::bigint,'popularity excludes likes older than 30 UTC days');
select is((select jsonb_array_length(tags) from public.list_public_posts('newest',10,null,'53000000-0000-0000-0000-000000000001',null,null,null,null,null) where id='52000000-0000-0000-0000-000000000001'),2,'tag filtering preserves all post tags');
select is((select count(*)::integer from public.list_public_posts('newest',10,'needle',null,null,null,null,null,null)),2,'FTS searches title and body and excludes hidden posts');
select is((select id from public.list_public_posts('newest',10,'needle',null,null,null,null,null,null) order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'title-weighted relevance outranks a newer body-only match');
select is((select id from public.list_public_posts('comments',10,null,null,null,null,null,null,null) where not is_pinned order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'comments sort uses public comment count');
select is((select id from public.list_public_posts('popular',10,null,null,null,null,null,null,null) where not is_pinned order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'popular sort uses recent likes times two plus comments');
select is((select count(*)::integer from public.get_public_post('52000000-0000-0000-0000-000000000004')),0,'detail RPC does not expose hidden posts or their metrics');
reset role;
insert into public.attachments(
  id,owner_id,post_id,client_key,payload_sha256,storage_path,mime_type,byte_size,status,deleted_at,attached_at
) values
  ('56000000-0000-4000-8000-000000000001','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000001',repeat('a',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001','image/png',123,'attached',null,now()),
  ('56000000-0000-4000-8000-000000000002','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000002',repeat('b',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000002','image/webp',123,'attached',null,now()),
  ('56000000-0000-4000-8000-000000000003','51000000-0000-0000-0000-000000000001',null,'57000000-0000-4000-8000-000000000003',repeat('c',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000003','image/jpeg',123,'quarantined',null,null);
update public.posts
   set body_markdown = E'앞 문단 **그대로**\n\n![첫 이미지](<51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?token=raw_secret#apikey=sb_secret_raw> "첫 제목")\n[둘째 파일](https://project.supabase.co/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000002?token=storage_secret#apikey=sb_secret_storage ''둘째 제목'')\n![정식 공개 URL](https://project.supabase.co/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001?token=route_secret#apikey=sb_secret_route (셋째 제목))\n![격리](51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000003?token=quarantine_secret)\n![임의 경로](</storage/v1/object/community-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002?apikey=sb_secret_leak#token=forged> "안전 제목")\n[위조 공개 URL](https://evil.example/functions/v1/public-attachment/59000000-0000-4000-8000-000000000003?token=forged#apikey=sb_secret_forged "token=title_secret")\n![대문자 UUID](/functions/v1/public-attachment/56000000-0000-4000-8000-00000000000A?token=uppercase)\n![인코딩 UUID](/functions/v1/public-attachment/%35%36%30%30%30%30%30%30-0000-4000-8000-000000000001?apikey=encoded)\n![잘못된 UUID](/functions/v1/public-attachment/not-a-uuid#token=malformed)\n[자격증명 링크](https://example.com/download?signature=signed_secret (다운로드))\n\n[일반 링크](https://example.com/docs?q=1) [ordinary](cafe/dead)'
 where id = '52000000-0000-0000-0000-000000000001';
select is(
  (select jsonb_build_object('body', body_markdown, 'comments', comment_count, 'reactions', reaction_count, 'popularity', popularity_score, 'tags', jsonb_array_length(tags))
     from public.get_public_post('52000000-0000-0000-0000-000000000001')),
  jsonb_build_object(
    'body', E'앞 문단 **그대로**\n\n![첫 이미지](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001 "첫 제목")\n[둘째 파일](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000002 ''둘째 제목'')\n![정식 공개 URL](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001 (셋째 제목))\n![격리](about:blank#attachment-unavailable)\n![임의 경로](about:blank#attachment-unavailable "안전 제목")\n[위조 공개 URL](about:blank#attachment-unavailable)\n![대문자 UUID](about:blank#attachment-unavailable)\n![인코딩 UUID](about:blank#attachment-unavailable)\n![잘못된 UUID](about:blank#attachment-unavailable)\n[자격증명 링크](about:blank#attachment-unavailable (다운로드))\n\n[일반 링크](https://example.com/docs?q=1) [ordinary](cafe/dead)',
    'comments', 2, 'reactions', 2, 'popularity', 4, 'tags', 2
  ),
  'detail RPC rewrites multiple eligible images to attachment-ID URLs and preserves ordinary Markdown'
);
select ok(position('51000000-0000-0000-0000-000000000001/57000000' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body exposes no raw managed Storage path');
select ok(position('storage/v1/object' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body exposes no Storage API URL');
select ok(position('service_role' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body exposes no service-role credential pattern');
select ok(position('sb_secret_' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body exposes no Supabase secret credential pattern');
select ok(position('token=' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body removes token suffixes from unsafe destinations');
select ok(position('apikey=' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body removes apikey suffixes from unsafe destinations');
select ok(position('%35' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body rejects percent-encoded attachment routes');
select ok(position('not-a-uuid' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'detail body rejects malformed attachment routes');
select is(
  (select regexp_count(body_markdown, '/functions/v1/public-attachment/', 1, 'n') from public.get_public_post('52000000-0000-0000-0000-000000000001')),
  3,
  'only identifiers for attached nondeleted rows on this post become public URLs'
);
select throws_ok($$select * from public.list_public_posts('bad',10,null,null,null,null,null,null,null)$$,'22023','invalid post sort','invalid sort is rejected');
select throws_ok($$select * from public.list_public_posts('newest',101,null,null,null,null,null,null,null)$$,'22023','invalid page limit','invalid limit is rejected');
select throws_ok($$select * from public.list_public_posts('comments',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','incomplete cursor is rejected');
select throws_ok($$select * from public.list_public_posts('comments',10,null,null,null,null,2,null,null)$$,'22023','invalid cursor','an isolated rank is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,null,null,null,null,0.5)$$,'22023','invalid cursor','an isolated search rank is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,repeat('x',201),null,null,null,null,null,null)$$,'22023','invalid search','oversized search input is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'infinity',null,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','infinite cursor timestamps are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001','NaN'::real)$$,'22023','invalid cursor','non-finite search ranks are rejected');
reset role;

insert into public.comments(id,post_id,author_id,body_markdown,status) values ('54000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000002','transition','published');
select is((select comment_count from private.post_metrics where post_id='52000000-0000-0000-0000-000000000002'),2::bigint,'comment insert increments metric');
update public.comments set status='hidden' where id='54000000-0000-0000-0000-000000000004';
select is((select comment_count from private.post_metrics where post_id='52000000-0000-0000-0000-000000000002'),1::bigint,'comment hiding decrements metric');
update public.comments set status='published' where id='54000000-0000-0000-0000-000000000004';
select is((select comment_count from private.post_metrics where post_id='52000000-0000-0000-0000-000000000002'),2::bigint,'comment restore increments metric');
update public.comments set status='deleted',deleted_at=statement_timestamp() where id='54000000-0000-0000-0000-000000000004';
select is((select comment_count from private.post_metrics where post_id='52000000-0000-0000-0000-000000000002'),1::bigint,'comment soft delete decrements metric');
update public.comments set status='published',deleted_at=null where id='54000000-0000-0000-0000-000000000004';
select is((select comment_count from private.post_metrics where post_id='52000000-0000-0000-0000-000000000002'),2::bigint,'comment undelete restores metric');
delete from public.post_reactions where id='55000000-0000-0000-0000-000000000001';
select is(coalesce((select reaction_count from private.post_reaction_daily_counts where post_id='52000000-0000-0000-0000-000000000001' and reaction_date=current_date),0),0::bigint,'reaction delete decrements without going negative');
select is((select reaction_count from public.get_public_post('52000000-0000-0000-0000-000000000001')),1::bigint,'deleting a recent like preserves the older all-time display count');
set local timezone to 'Pacific/Honolulu';
insert into public.post_reactions(id,user_id,post_id,created_at) values
  (
    '55000000-0000-0000-0000-000000000002',
    '51000000-0000-0000-0000-000000000001',
    '52000000-0000-0000-0000-000000000002',
    ((statement_timestamp() at time zone 'UTC')::date + time '00:30') at time zone 'UTC'
  );
select is(
  (select reaction_date from private.post_reaction_daily_counts where post_id='52000000-0000-0000-0000-000000000002' and reaction_count=1),
  (statement_timestamp() at time zone 'UTC')::date,
  'reaction buckets use UTC rather than the database session timezone'
);
select is(
  (select reaction_count from public.get_public_post('52000000-0000-0000-0000-000000000002')),
  1::bigint,
  'the rolling 30-day window also uses the UTC calendar date'
);
reset timezone;
update public.post_reactions
   set created_at=statement_timestamp()-interval '31 days'
 where id='55000000-0000-0000-0000-000000000002';
select is((select reaction_count from public.get_public_post('52000000-0000-0000-0000-000000000002')),1::bigint,'moving a reaction between day buckets preserves the all-time count');
select is((select popularity_score from public.get_public_post('52000000-0000-0000-0000-000000000002')),2::bigint,'moving a reaction outside 30 days removes only its popularity weight');

set local role anon;
create temporary table first_page as select * from public.list_public_posts('newest',2,null,null,null,null,null,null,null) where row_number<=2;
create temporary table second_page as
select * from public.list_public_posts('newest',10,null,null,(select is_pinned from first_page order by row_number desc limit 1),(select created_at from first_page order by row_number desc limit 1),null,(select id from first_page order by row_number desc limit 1),(select search_rank from first_page order by row_number desc limit 1));
select is((select count(*)::integer from first_page join second_page using(id)),0,'full newest cursor has no duplicates');
select is((select count(*)::integer from first_page)+(select count(*)::integer from second_page),3,'full newest cursor covers every public post');
create temporary table comments_first as select * from public.list_public_posts('comments',2,null,null,null,null,null,null,null) where row_number<=2;
create temporary table comments_second as select * from public.list_public_posts('comments',10,null,null,(select is_pinned from comments_first order by row_number desc limit 1),(select created_at from comments_first order by row_number desc limit 1),(select rank_key from comments_first order by row_number desc limit 1),(select id from comments_first order by row_number desc limit 1),(select search_rank from comments_first order by row_number desc limit 1));
select is((select count(*)::integer from comments_first join comments_second using(id)),0,'comments cursor has no duplicates');
select is((select count(*)::integer from comments_first)+(select count(*)::integer from comments_second),3,'comments cursor covers every public post');
create temporary table popular_first as select * from public.list_public_posts('popular',2,null,null,null,null,null,null,null) where row_number<=2;
create temporary table popular_second as select * from public.list_public_posts('popular',10,null,null,(select is_pinned from popular_first order by row_number desc limit 1),(select created_at from popular_first order by row_number desc limit 1),(select rank_key from popular_first order by row_number desc limit 1),(select id from popular_first order by row_number desc limit 1),(select search_rank from popular_first order by row_number desc limit 1));
select is((select count(*)::integer from popular_first join popular_second using(id)),0,'popular cursor has no duplicates');
select is((select count(*)::integer from popular_first)+(select count(*)::integer from popular_second),3,'popular cursor covers every public post');
reset role;

insert into public.posts(id,author_id,title,body_markdown,status)
select md5('capacity-post-'||g::text)::uuid,
       '51000000-0000-0000-0000-000000000001',
       'Capacity post '||g::text,
       'Capacity body',
       'published'
from generate_series(1,5001) g;
set local role anon;
select throws_ok(
  $$select * from public.list_public_posts('popular',10,null,null,null,null,null,null,null)$$,
  '54000',
  'public post list capacity exceeded',
  'broad aggregate queries are rejected above the explicit candidate cap'
);
reset role;

select * from finish();
rollback;
