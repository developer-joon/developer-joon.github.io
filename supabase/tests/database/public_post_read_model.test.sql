begin;

select plan(172);

create function pg_temp.explain_json(p_sql text)
returns jsonb language plpgsql as $$
declare v_plan jsonb;
begin
  execute 'explain (analyze, buffers, format json) '||p_sql into v_plan;
  return v_plan;
end $$;

insert into auth.users (id, aud, role, email) values
  ('51000000-0000-0000-0000-000000000001','authenticated','authenticated','read-a@example.test'),
  ('51000000-0000-0000-0000-000000000002','authenticated','authenticated','read-b@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
  ('51000000-0000-0000-0000-000000000001',95101,'read-a','Read A'),
  ('51000000-0000-0000-0000-000000000002',95102,'read-b','Read B');
insert into public.tags(id,slug,label,sort_order) values
  ('53000000-0000-0000-0000-000000000001','read-one','Read One',951),
  ('53000000-0000-0000-0000-000000000002','read-two','Read Two',952);
insert into public.posts(id,author_id,title,body_markdown,status,is_pinned,created_at,updated_at,deleted_at) values
  ('52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','weighted needle','short body','published',false,'2026-09-01','2026-09-01',null),
  ('52000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001','newest',E'needle [leak](<https://project.supabase.co/storage/v1/object/sign/community-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002?token=list_secret> "safe list") [ordinary](cafe/dead)','published',false,'2026-09-03','2026-09-03',null),
  ('52000000-0000-0000-0000-000000000003','51000000-0000-0000-0000-000000000001','pinned','other','published',true,'2026-09-02','2026-09-02',null),
  ('52000000-0000-0000-0000-000000000004','51000000-0000-0000-0000-000000000001','hidden needle','secret','hidden',false,'2026-09-04','2026-09-04',null),
  ('52000000-0000-0000-0000-000000000005','51000000-0000-0000-0000-000000000001','deleted needle','secret','deleted',false,'2026-09-05','2026-09-05','2026-09-05');
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
select ok(not has_function_privilege('service_role','public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)','EXECUTE'),'service_role cannot execute list RPC');
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
select ok(not exists(select 1 from read_rows where id='52000000-0000-0000-0000-000000000005'),'deleted posts are excluded from listing');
select is((select id from read_rows order by row_number limit 1),'52000000-0000-0000-0000-000000000003'::uuid,'pinned post sorts first');
select ok(not exists(select 1 from information_schema.columns where table_schema like 'pg_temp%' and table_name='read_rows' and column_name='body_markdown'),'list transfers no full body');
select is((select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'),E'needle [leak](about:blank#attachment-unavailable "safe list") [ordinary](cafe/dead)','list excerpt is derived from the sanitized public body');
select ok(position('storage/v1/object' in (select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'))=0,'list excerpt exposes no Storage API URL');
select ok(position('token=' in (select excerpt from read_rows where id='52000000-0000-0000-0000-000000000002'))=0,'list excerpt exposes no credential suffix');
select is((select comment_count from read_rows where id='52000000-0000-0000-0000-000000000001'),2::bigint,'initial comment metric backfill excludes hidden comments');
select is((select reaction_count from read_rows where id='52000000-0000-0000-0000-000000000001'),2::bigint,'display reaction count includes all-time likes');
select is((select popularity_score from read_rows where id='52000000-0000-0000-0000-000000000001'),4::bigint,'popularity excludes likes older than 30 UTC days');
reset role;
insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
values ('52000000-0000-0000-0000-000000000001',current_date-1,63,0);
select is(
  (select popularity_score from private.public_post_counts('52000000-0000-0000-0000-000000000001')),
  4::bigint,
  'zero-count recent buckets do not change popularity'
);
set local role anon;
select is((select jsonb_array_length(tags) from public.list_public_posts('newest',10,null,'53000000-0000-0000-0000-000000000001',null,null,null,null,null) where id='52000000-0000-0000-0000-000000000001'),2,'tag filtering preserves all post tags');
select is((select count(*)::integer from public.list_public_posts('newest',10,'needle',null,null,null,null,null,null)),2,'FTS searches title and body and excludes hidden posts');
select is((select id from public.list_public_posts('newest',10,'needle',null,null,null,null,null,null) order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'title-weighted relevance outranks a newer body-only match');
create temporary table search_first as select * from public.list_public_posts('newest',1,'needle',null,null,null,null,null,null) where row_number=1;
create temporary table search_second as
select * from public.list_public_posts(
  'newest',1,'needle',null,
  (select is_pinned from search_first),(select created_at from search_first),null,
  (select id from search_first),(select search_rank from search_first)
) where row_number=1;
select is((select id from search_first),'52000000-0000-0000-0000-000000000001'::uuid,'search cursor exposes the first relevance-ranked key');
select is((select id from search_second),'52000000-0000-0000-0000-000000000002'::uuid,'search cursor continues without skipping the lower relevance rank');
select ok(
  not exists(
    select 1 from public.list_public_posts('newest',10,'needle',null,null,null,null,null,null)
    where not (search_rank >= 0 and search_rank < 1)
  ),
  'emitted search ranks stay finite and within the accepted cursor domain'
);
select is((select id from public.list_public_posts('comments',10,null,null,null,null,null,null,null) where not is_pinned order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'comments sort uses public comment count');
select is((select id from public.list_public_posts('popular',10,null,null,null,null,null,null,null) where not is_pinned order by row_number limit 1),'52000000-0000-0000-0000-000000000001'::uuid,'popular sort uses recent likes times two plus comments');
select is(pg_typeof((select rank_key from public.list_public_posts('comments',10,null,null,null,null,null,null,null) limit 1))::text,'bigint','ranked cursors preserve a bigint rank key');
select ok(not exists(select 1 from public.list_public_posts('newest',10,null,null,null,null,null,null,null) where rank_key is not null),'newest rows retain a null rank key');
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
update public.posts
   set body_markdown = E'<https://project.supabase.co/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?token=autolink_secret>\n[image-ref]: community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000002#apikey=reference_secret "reference title"\nplain 51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?token=plain_secret end\nunsafe https://project.supabase.co/storage/v1/object/sign/community-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002?token=storage_secret end\nforged https://evil.example/functions/v1/public-attachment/59000000-0000-4000-8000-000000000003?apikey=route_secret end\ncredentials token=loose_secret apikey=loose_key sb_secret_very_private end\nplain-no-suffix 51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001 end\nordinary https://example.com/docs?q=1 and cafe/dead'
 where id = '52000000-0000-0000-0000-000000000001';
select is(
  (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')),
  E'</functions/v1/public-attachment/56000000-0000-4000-8000-000000000001>\n[image-ref]: /functions/v1/public-attachment/56000000-0000-4000-8000-000000000002 "reference title"\nplain /functions/v1/public-attachment/56000000-0000-4000-8000-000000000001 end\nunsafe about:blank#attachment-unavailable end\nforged about:blank#attachment-unavailable end\ncredentials about:blank#attachment-unavailable about:blank#attachment-unavailable about:blank#attachment-unavailable end\nplain-no-suffix /functions/v1/public-attachment/56000000-0000-4000-8000-000000000001 end\nordinary https://example.com/docs?q=1 and cafe/dead',
  'detail sanitizer covers autolinks, reference definitions, plain paths, URLs, routes, and credentials'
);
select ok(position('autolink_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'autolink credential suffix is removed');
select ok(position('reference_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'reference credential suffix is removed');
select ok(position('plain_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'plain-path credential suffix is removed');
select ok(position('storage_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'plain Storage URL credential suffix is removed');
select ok(position('route_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'forged-route credential suffix is removed');
select ok(position('loose_secret' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'loose token credential is removed');
select ok(position('loose_key' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'loose apikey credential is removed');
select ok(position('sb_secret_very_private' in (select body_markdown from public.get_public_post('52000000-0000-0000-0000-000000000001')))=0,'loose Supabase secret is removed');
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001, next'
  ),
  '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001, next',
  'canonical raw paths next to ordinary punctuation are rewritten without consuming punctuation'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '[x](storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001)'
  ),
  '[x](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001)',
  'relative managed Storage routes are rewritten'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'secret=very_private [docs](https://example.com/tokenization)'
  ),
  'about:blank#attachment-unavailable [docs](https://example.com/tokenization)',
  'credential assignments are removed without matching key-name substrings'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '[ref]:storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'
  ),
  '[ref]:/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001',
  'Markdown reference colons do not hide managed Storage routes'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'key=/storage/v1/object/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'
  ),
  'key=/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001',
  'equals signs do not hide managed Storage routes'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'raw:51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'
  ),
  'raw:51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001',
  'an opaque absolute URI outranks canonical raw-path matching'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001? next'
  ),
  '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001? next',
  'a bare trailing question mark is punctuation rather than a URL suffix'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?'
  ),
  '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001?',
  'a bare final question mark is preserved'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       prefix||'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'
     ) <> prefix||'/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001'
  ),
  0,
  'canonical raw paths are rewritten after practical ASCII punctuation prefixes'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       prefix||'/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'
     ) <> prefix||'/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001'
  ),
  0,
  'managed Storage routes are rewritten after practical ASCII punctuation prefixes'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) s(suffix)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'||suffix||' next'
     ) <> '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001'||suffix||' next'
  ),
  0,
  'canonical raw paths preserve practical ASCII punctuation suffixes'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) s(suffix)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       '/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001'||suffix||' next'
     ) <> '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001'||suffix||' next'
  ),
  0,
  'managed Storage routes preserve practical ASCII punctuation suffixes'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     cross join unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) s(suffix)
     cross join lateral (
       values
         (prefix||'59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'||suffix||' next'),
         (prefix||'/storage/v1/object/sign/community-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'||suffix||' next')
     ) sample(input)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',sample.input
     ) <> prefix||'about:blank#attachment-unavailable'||suffix||' next'
  ),
  0,
  'unmapped raw and managed paths are removed while surrounding punctuation survives'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     where position('51000000-0000-0000-0000-000000000001/57000000' in private.public_post_body(
             '52000000-0000-0000-0000-000000000001',
             prefix||'/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?token=prefix_secret'
           )) > 0
        or position('prefix_secret' in private.public_post_body(
             '52000000-0000-0000-0000-000000000001',
             prefix||'/storage/v1/object/sign/community-images/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?token=prefix_secret'
           )) > 0
  ),
  0,
  'punctuation-prefixed managed paths and credential suffixes never leak'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     cross join unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) s(suffix)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       prefix||'https://example.com/docs?q=1'||suffix||' cafe/dead'
     ) <> prefix||'https://example.com/docs?q=1'||suffix||' cafe/dead'
  ),
  0,
  'ordinary URLs and prose remain unchanged across punctuation boundaries'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    repeat('[ordinary](https://example.com/docs?q=1) ',1200)
  ),
  repeat('[ordinary](https://example.com/docs?q=1) ',1200),
  '1200 ordinary links within the body capacity are preserved'
);
select is(
  regexp_count(pg_get_functiondef('private.public_post_body(uuid,text)'::regprocedure),'from public.attachments',1,'ni'),
  1,
  'body sanitizer loads its attachment mapping with one SQL query'
);
select ok(
  to_regprocedure('private.public_attachment_destination(uuid,text,text)') is null,
  'body sanitizer has no per-destination SQL helper'
);
select ok(
  (
    select p.prosecdef
       and p.proconfig = array['search_path=""']
       and pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p
     where p.oid = 'private.public_post_body(uuid,text)'::regprocedure
  ),
  'body sanitizer is fixed-owner SECURITY DEFINER with empty search_path'
);
select has_function('private','public_post_excerpt',array['uuid','text'],'bounded excerpt sanitizer exists');
select ok(
  (
    select p.prosecdef
       and p.proconfig = array['search_path=""']
       and pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p
     where p.oid = 'private.public_post_excerpt(uuid,text)'::regprocedure
  ),
  'excerpt sanitizer is fixed-owner SECURITY DEFINER with empty search_path'
);
select is(
  private.public_post_excerpt(
    '52000000-0000-0000-0000-000000000001',
    repeat('ordinary ',10)||'token=excerpt_secret '||repeat('after ',8200)
  ),
  left(repeat('ordinary ',10)||'about:blank#attachment-unavailable '||repeat('after ',20),180),
  'excerpt scans a bounded prefix, sanitizes it, and returns at most 180 characters'
);
select has_function(
  'private','scan_public_post_body',array['text','uuid[]','text[]'],
  'query-free bounded body scanner exists'
);
select is(
  regexp_count(
    pg_get_functiondef(to_regprocedure('private.scan_public_post_body(text,uuid[],text[])')),
    '\m(from|join)\M',1,'ni'
  ),
  0,
  'bounded body scanner has no relation access'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'urn:public-attachment:56000000-0000-4000-8000-000000000001'
  ),
  'urn:public-attachment:56000000-0000-4000-8000-000000000001',
  'user text resembling the retired placeholder is never promoted'
);
select is(
  (
    select count(*)::integer
      from unnest(array[
        'https://example.com/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002?ok=1#fine',
        'https://example.com/?next=59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
        'ftp://example.com/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
        'custom+v1://host/path/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'
      ]) uri
     where private.public_post_body('52000000-0000-0000-0000-000000000001',uri) <> uri
  ),
  0,
  'ordinary absolute URIs preserve UUID-pair paths and query values byte-for-byte'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'https://example.com/archive/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?ok=1'
  ),
  'https://example.com/archive/51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001?ok=1',
  'a mapped raw path nested inside an ordinary external URI is preserved'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'https://example.com/download?token=credential_value'
  ),
  'about:blank#attachment-unavailable',
  'an ordinary absolute URI carrying a recognized credential is redacted whole'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001#'
  ),
  '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001#',
  'a bare final fragment marker remains punctuation'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    E'안전한 본문 []{}(),.;!?\nordinary https://example.com/a?b=1#c'
  ),
  E'안전한 본문 []{}(),.;!?\nordinary https://example.com/a?b=1#c',
  'safe multilingual input is an exact identity transformation'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    private.public_post_body(
      '52000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001 token=once'
    )
  ),
  '/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001 about:blank#attachment-unavailable',
  'body sanitization is idempotent'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'xsb_secret_keep sb_secret_drop _sb_secret_keep'
  ),
  'xsb_secret_keep about:blank#attachment-unavailable _sb_secret_keep',
  'Supabase secret recognition requires identifier boundaries'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    E'prefix "token=one\\"still-secret" suffix'
  ),
  'prefix about:blank#attachment-unavailable suffix',
  'a quoted credential with an escaped quote is redacted as one span'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    E'prefix "token=unterminated\nnext'
  ),
  E'prefix about:blank#attachment-unavailable\nnext',
  'an unterminated quoted credential is consumed only to end of line'
);
select is(
  array[
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$prefix token="quoted secret value" suffix$input$),
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$prefix token='quoted secret value' suffix$input$),
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$prefix token="one\"still secret" suffix$input$),
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$prefix token="unterminated secret
next$input$)
  ],
  array[
    'prefix about:blank#attachment-unavailable suffix',
    'prefix about:blank#attachment-unavailable suffix',
    'prefix about:blank#attachment-unavailable suffix',
    E'prefix about:blank#attachment-unavailable\nnext'
  ]::text[],
  'credential assignments consume double, single, escaped, and unterminated quoted values'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    'prefix,"token=quoted secret value" suffix'
  ),
  'prefix,about:blank#attachment-unavailable suffix',
  'a punctuation-prefixed quote establishes credential value context'
);
select is(
  (
    select count(*)::integer
      from unnest(array[':', '=', ',', '.', ';', '!', '?', '[', ']']) p(prefix)
     cross join (values ('"','token'),('''','token'),('"','apikey'),('''','apikey')) v(quote_mark,key_name)
     where private.public_post_body(
       '52000000-0000-0000-0000-000000000001',
       prefix||quote_mark||key_name||'=quoted secret value'||quote_mark||' suffix'
     ) <> prefix||'about:blank#attachment-unavailable suffix'
  ),
  0,
  'quoted credential assignments leave no secret remainder after practical ASCII punctuation prefixes'
);
select is(
  array[
    private.public_post_body('52000000-0000-0000-0000-000000000001','prefix,"ordinary quoted prose" suffix'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','prefix,"ordinary quoted prose" token="quoted secret value" suffix'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','prefix,"/functions/v1/public-attachment/59000000-0000-4000-8000-000000000003" suffix')
  ],
  array[
    'prefix,"ordinary quoted prose" suffix',
    'prefix,"ordinary quoted prose" about:blank#attachment-unavailable suffix',
    'prefix,"about:blank#attachment-unavailable" suffix'
  ]::text[],
  'ordinary quoted prose is preserved while inner and following sensitive tokens are scanned'
);
select is(
  array[
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$"51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000001"$input$),
    private.public_post_body('52000000-0000-0000-0000-000000000001',$input$'/functions/v1/public-attachment/59000000-0000-4000-8000-000000000003'$input$)
  ],
  array[
    '"/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001"',
    '''about:blank#attachment-unavailable'''
  ]::text[],
  'quoted managed tokens are sanitized inside their preserved quotes'
);
select is(
  array[
    private.public_post_body('52000000-0000-0000-0000-000000000001','custom:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','ftp:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','urn:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','custom:/functions/v1/public-attachment/59000000-0000-4000-8000-000000000003'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','custom:functions/v1/public-attachment/59000000-0000-4000-8000-000000000003'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','custom:opaque?token=secret')
  ],
  array[
    'custom:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
    'ftp:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
    'urn:59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
    'about:blank#attachment-unavailable',
    'about:blank#attachment-unavailable',
    'about:blank#attachment-unavailable'
  ]::text[],
  'all absolute URI schemes outrank path scanning but managed and credential-bearing URIs fail closed'
);
select is(
  array[
    private.public_post_body('52000000-0000-0000-0000-000000000001','mystorage/v1/object/ordinary'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','xcommunity-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','storage/v1/object/ordinary'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','prefix storage/v1/object/ordinary'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','"storage/v1/object/ordinary"'),
    private.public_post_body('52000000-0000-0000-0000-000000000001',':storage/v1/object/ordinary'),
    private.public_post_body('52000000-0000-0000-0000-000000000001','=storage/v1/object/ordinary')
  ],
  array[
    'mystorage/v1/object/ordinary',
    'xcommunity-images/59000000-0000-4000-8000-000000000001/59000000-0000-4000-8000-000000000002',
    'about:blank#attachment-unavailable',
    'prefix about:blank#attachment-unavailable',
    '"about:blank#attachment-unavailable"',
    ':about:blank#attachment-unavailable',
    '=about:blank#attachment-unavailable'
  ]::text[],
  'relative managed tokens require a lexical left boundary'
);
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    repeat('(',33)||'token=nested_secret'
  ),
  'about:blank#attachment-unavailable',
  'nesting beyond 32 levels fails closed'
);
select throws_ok(
  $$select private.public_post_body('52000000-0000-0000-0000-000000000001',repeat('x',50001))$$,
  '54000','public post body capacity exceeded',
  'direct body sanitization rejects input above the 50000-character bound'
);
select throws_like(
  $$update public.posts set body_markdown='x'||repeat(' ',50000) where id='52000000-0000-0000-0000-000000000001'$$,
  '%posts_body_length_check%',
  'stored post bodies enforce actual length rather than trimmed length'
);
insert into public.attachments(
  id,owner_id,post_id,client_key,payload_sha256,storage_path,mime_type,byte_size,status,deleted_at,attached_at
) values
  ('56000000-0000-4000-8000-000000000011','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000011',repeat('1',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000011','image/png',123,'attached',null,now()),
  ('56000000-0000-4000-8000-000000000012','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000012',repeat('2',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000012','image/png',123,'attached',null,now()),
  ('56000000-0000-4000-8000-000000000013','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000013',repeat('3',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000013','image/png',123,'attached',null,now()),
  ('56000000-0000-4000-8000-000000000014','51000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','57000000-0000-4000-8000-000000000014',repeat('4',64),'51000000-0000-0000-0000-000000000001/57000000-0000-4000-8000-000000000014','image/png',123,'attached',null,now());
select throws_ok(
  $$select private.public_post_body('52000000-0000-0000-0000-000000000001','safe')$$,
  '54000','public post attachment capacity exceeded',
  'six eligible attachment rows fail closed after the bounded mapping query'
);
delete from public.attachments where id in (
  '56000000-0000-4000-8000-000000000011','56000000-0000-4000-8000-000000000012',
  '56000000-0000-4000-8000-000000000013','56000000-0000-4000-8000-000000000014'
);
set local statement_timeout='2s';
select is(
  private.public_post_body(
    '52000000-0000-0000-0000-000000000001',
    repeat(E'한a[]()!? ',5000)
  ),
  repeat(E'한a[]()!? ',5000),
  'the maximum-size multibyte punctuation workload terminates and remains unchanged'
);
select is(
  private.scan_public_post_body(
    private.scan_public_post_body(
      repeat('token=xxxxxxxxxxxxxxxxxxxxxxxxxxxx ',256)||repeat('z',41040),array[]::uuid[],array[]::text[]
    ),
    array[]::uuid[],array[]::text[]
  ),
  repeat('about:blank#attachment-unavailable ',256)||repeat('z',41040),
  'a maximum-size body permits 256 transformations and its output is idempotent'
);
select throws_ok(
  $$select private.scan_public_post_body(
    repeat('token=xxxxxxxxxxxxxxxxxxxxxxxxxxxx ',257)||repeat('z',41005),array[]::uuid[],array[]::text[]
  )$$,
  '54000','public post body transformation capacity exceeded',
  'a 257th transformation is rejected at the fixed scanner bound'
);
set local statement_timeout=default;
select throws_ok($$select * from public.list_public_posts('bad',10,null,null,null,null,null,null,null)$$,'22023','invalid post sort','invalid sort is rejected');
select throws_ok($$select * from public.list_public_posts(null,10,null,null,null,null,null,null,null)$$,'22023','invalid post sort','null sort is rejected');
select throws_ok($$select * from public.list_public_posts('newest',101,null,null,null,null,null,null,null)$$,'22023','invalid page limit','invalid limit is rejected');
select throws_ok($$select * from public.list_public_posts('comments',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','incomplete cursor is rejected');
select throws_ok($$select * from public.list_public_posts('comments',10,null,null,null,null,2,null,null)$$,'22023','invalid cursor','an isolated rank is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,null,null,null,null,0.5)$$,'22023','invalid cursor','an isolated search rank is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,repeat('x',201),null,null,null,null,null,null)$$,'22023','invalid search','oversized search input is rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'infinity',null,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','infinite cursor timestamps are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001','NaN'::real)$$,'22023','invalid cursor','non-finite search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',0.5)$$,'22023','invalid cursor','null-search cursors require the emitted zero search rank');
select throws_ok($$select * from public.list_public_posts('newest',10,'   ',null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',0.5)$$,'22023','invalid cursor','blank-search cursors require the emitted zero search rank');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',-0.1)$$,'22023','invalid cursor','negative null-search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,null,null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001','Infinity'::real)$$,'22023','invalid cursor','infinite null-search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,'needle',null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',-0.1)$$,'22023','invalid cursor','negative active-search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,'needle',null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001',1)$$,'22023','invalid cursor','active-search ranks outside the emitted domain are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,'needle',null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001','NaN'::real)$$,'22023','invalid cursor','NaN active-search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('newest',10,'needle',null,false,'2026-09-01',null,'52000000-0000-0000-0000-000000000001','Infinity'::real)$$,'22023','invalid cursor','infinite active-search ranks are rejected');
select throws_ok($$select * from public.list_public_posts('comments',10,null,null,false,'2026-09-01',-1,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','negative comments rank keys are rejected');
select throws_ok($$select * from public.list_public_posts('popular',10,null,null,false,'2026-09-01',-1,'52000000-0000-0000-0000-000000000001',0)$$,'22023','invalid cursor','negative popular rank keys are rejected');
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
insert into public.post_tags(post_id,tag_id)
select md5('capacity-post-'||g::text)::uuid,
       '53000000-0000-0000-0000-000000000001'
from generate_series(1,5001) g;
insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count)
select md5('capacity-post-'||(((g-1)%5001)+1)::text)::uuid,
       (statement_timestamp() at time zone 'UTC')::date-31-((g-1)/5001)::integer,
       0,
       1
from generate_series(1,100000) g;
insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count) values
  (md5('capacity-post-1')::uuid,(statement_timestamp() at time zone 'UTC')::date,1,3),
  (md5('capacity-post-2')::uuid,(statement_timestamp() at time zone 'UTC')::date,1,0);
analyze private.post_reaction_daily_counts;
select is(
  (select popularity_score from private.public_post_counts(md5('capacity-post-1')::uuid)),
  6::bigint,
  'recent nonzero buckets contribute exactly twice their count to popularity'
);
select is(
  (select popularity_score from private.public_post_counts(md5('capacity-post-2')::uuid)),
  0::bigint,
  'recent zero-count buckets remain semantically invisible'
);
create temporary table stale_history_plan as
select pg_temp.explain_json($query$
  select d.post_id,coalesce(sum(d.reaction_count),0)::bigint recent_count
  from private.post_reaction_daily_counts d
  where d.reaction_date between (statement_timestamp() at time zone 'UTC')::date-29
                            and (statement_timestamp() at time zone 'UTC')::date
    and d.reaction_count > 0
  group by d.post_id
$query$) plan;
select ok(
  (select plan::text like '%post_reaction_daily_recent_idx%' from stale_history_plan),
  'the exact recent-popularity aggregate uses the date-leading covering index'
);
select ok(
  (select coalesce((plan#>>'{0,Plan,Shared Hit Blocks}')::integer,0)
        +coalesce((plan#>>'{0,Plan,Shared Read Blocks}')::integer,0) < 100
     from stale_history_plan),
  '100000 entirely stale buckets require fewer than 100 shared buffers'
);
set local role anon;
create temporary table scale_newest_first as
select * from public.list_public_posts('newest',10,null,null,null,null,null,null,null) where row_number<=10;
create temporary table scale_newest_second as
select * from public.list_public_posts(
  'newest',10,null,null,
  (select is_pinned from scale_newest_first order by row_number desc limit 1),
  (select created_at from scale_newest_first order by row_number desc limit 1),null,
  (select id from scale_newest_first order by row_number desc limit 1),
  (select search_rank from scale_newest_first order by row_number desc limit 1)
) where row_number<=10;
select is((select count(*)::integer from scale_newest_first),10,'newest returns a full first page above 5000 posts');
select is((select count(*)::integer from scale_newest_second),10,'newest returns a full second page above 5000 posts');
select is((select count(*)::integer from scale_newest_first join scale_newest_second using(id)),0,'newest keyset has no duplicate across large tied pages');

create temporary table scale_newest_walk(id uuid,is_fixture boolean);
do $$
declare
  v_is_pinned boolean;
  v_created_at timestamptz;
  v_id uuid;
  v_search_rank real;
  v_page_count integer;
begin
  loop
    with page as materialized (
      select * from public.list_public_posts(
        'newest',100,null,null,
        v_is_pinned,v_created_at,null,v_id,v_search_rank
      ) where row_number<=100
    ), inserted as (
      insert into scale_newest_walk(id,is_fixture)
      select id,id in (select md5('capacity-post-'||g::text)::uuid from generate_series(1,5001) g)
      from page returning 1
    )
    select p.is_pinned,p.created_at,p.id,p.search_rank,(select count(*) from inserted)
      into v_is_pinned,v_created_at,v_id,v_search_rank,v_page_count
      from page p order by p.row_number desc limit 1;
    exit when coalesce(v_page_count,0)<100;
  end loop;
end $$;
select is((select count(*)::integer from scale_newest_walk where is_fixture),5001,'newest cursor traverses all 5001 fixture posts');
select is((select count(distinct id)::integer from scale_newest_walk where is_fixture),5001,'newest cursor traverses 5001 fixture posts without duplicates or skips');

create temporary table scale_search_first as
select * from public.list_public_posts('newest',100,'Capacity post',null,null,null,null,null,null) where row_number<=100;
create temporary table scale_search_second as
select * from public.list_public_posts(
  'newest',100,'Capacity post',null,
  (select is_pinned from scale_search_first order by row_number desc limit 1),
  (select created_at from scale_search_first order by row_number desc limit 1),null,
  (select id from scale_search_first order by row_number desc limit 1),
  (select search_rank from scale_search_first order by row_number desc limit 1)
) where row_number<=100;
select is((select count(*)::integer from scale_search_second),100,'search continues with a full page across more than 5000 equal-rank matches');
select is((select count(*)::integer from scale_search_first join scale_search_second using(id)),0,'large equal search-rank pages continue without duplicates');

create temporary table scale_tag_first as
select * from public.list_public_posts('newest',10,null,'53000000-0000-0000-0000-000000000001',null,null,null,null,null) where row_number<=10;
create temporary table scale_tag_second as
select * from public.list_public_posts(
  'newest',10,null,'53000000-0000-0000-0000-000000000001',
  (select is_pinned from scale_tag_first order by row_number desc limit 1),
  (select created_at from scale_tag_first order by row_number desc limit 1),null,
  (select id from scale_tag_first order by row_number desc limit 1),
  (select search_rank from scale_tag_first order by row_number desc limit 1)
) where row_number<=10;
select is((select count(*)::integer from scale_tag_first),10,'tag filter returns a full page above 5000 matches');
select is((select count(*)::integer from scale_tag_second),10,'tag filter returns a second page above 5000 matches');
select is((select count(*)::integer from scale_tag_first join scale_tag_second using(id)),0,'tag keyset has no duplicate across large tied pages');

create temporary table scale_comments_first as
select * from public.list_public_posts('comments',10,null,null,null,null,null,null,null) where row_number<=10;
create temporary table scale_comments_second as
select * from public.list_public_posts(
  'comments',10,null,null,
  (select is_pinned from scale_comments_first order by row_number desc limit 1),
  (select created_at from scale_comments_first order by row_number desc limit 1),
  (select rank_key from scale_comments_first order by row_number desc limit 1),
  (select id from scale_comments_first order by row_number desc limit 1),
  (select search_rank from scale_comments_first order by row_number desc limit 1)
) where row_number<=10;
select is((select count(*)::integer from scale_comments_first),10,'comments returns a full first page above 5000 tied metrics');
select is((select count(*)::integer from scale_comments_second),10,'comments returns a full second page above 5000 tied metrics');
select is((select count(*)::integer from scale_comments_first join scale_comments_second using(id)),0,'comments keyset has no duplicate across large ties');

create temporary table scale_popular_first as
select * from public.list_public_posts('popular',10,null,null,null,null,null,null,null) where row_number<=10;
create temporary table scale_popular_second as
select * from public.list_public_posts(
  'popular',10,null,null,
  (select is_pinned from scale_popular_first order by row_number desc limit 1),
  (select created_at from scale_popular_first order by row_number desc limit 1),
  (select rank_key from scale_popular_first order by row_number desc limit 1),
  (select id from scale_popular_first order by row_number desc limit 1),
  (select search_rank from scale_popular_first order by row_number desc limit 1)
) where row_number<=10;
select is((select count(*)::integer from scale_popular_first),10,'popular returns a full first page above 5000 tied metrics');
select is((select count(*)::integer from scale_popular_second),10,'popular returns a full second page above 5000 tied metrics');
select is((select count(*)::integer from scale_popular_first join scale_popular_second using(id)),0,'popular keyset has no duplicate across large ties');

create temporary table scale_boundaries as
select sort_name, first_row.id first_id, second_row.id second_id,
       first_row.is_pinned first_pinned, second_row.is_pinned second_pinned
from unnest(array['newest','comments','popular']) sort_name
cross join lateral public.list_public_posts(sort_name,1,null,null,null,null,null,null,null) first_row
cross join lateral public.list_public_posts(
  sort_name,1,null,null,first_row.is_pinned,first_row.created_at,first_row.rank_key,
  first_row.id,first_row.search_rank
) second_row
where first_row.row_number=1 and second_row.row_number=1;
select is((select count(*)::integer from scale_boundaries),3,'every sort returns rows across the pinned boundary');
select is((select count(*)::integer from scale_boundaries where first_pinned),3,'every sort places the pinned row first');
select is((select count(*)::integer from scale_boundaries where not second_pinned),3,'every sort continues with unpinned rows');
select is((select count(*)::integer from scale_boundaries where first_id=second_id),0,'no sort duplicates the pinned cursor row');
select is((select count(*)::integer from scale_boundaries where first_id<>second_id),3,'every sort advances beyond its pinned cursor row');
select is((select count(*)::integer from scale_boundaries where first_id is null or second_id is null),0,'every sort supplies both sides of the pinned boundary');
reset role;

select ok(
  regexp_count(
    pg_get_functiondef('private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure),
    'limit p_limit\+1',1,'ni'
  )=4
  and position('private.public_post_excerpt' in pg_get_functiondef('private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure))=0
  and position('private.public_post_counts' in pg_get_functiondef('private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure))=0
  and position('private.public_post_excerpt' in pg_get_functiondef('public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure))>0,
  'ranking key branches are bounded and exclude hydration helpers'
);
select ok(
  (select p.prosecdef and p.proconfig=array['search_path=""'] and pg_get_userbyid(p.proowner)='postgres'
     from pg_proc p where p.oid='public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure),
  'large-list RPC retains fixed-owner SECURITY DEFINER and empty search_path'
);
select is(
  (select count(*)::integer from pg_proc where pronamespace='public'::regnamespace and proname='list_public_posts'),
  1,
  'large-list migration creates no ambiguous RPC overload'
);
select ok(
  (select indexdef not like '%deleted_at%' from pg_indexes
    where schemaname='public' and indexname='posts_public_list_idx'),
  'large-list migration retains the original published-post index without rebuilding it'
);
select ok(
  (select indisvalid and indisready from pg_index
    where indexrelid='private.post_reaction_daily_recent_idx'::regclass),
  'date-leading recent-reaction index is ready and valid'
);
select ok(
  (select indexdef like '%(reaction_date, post_id) INCLUDE (reaction_count)%'
       and indexdef like '%WHERE (reaction_count > 0)%'
     from pg_indexes
    where schemaname='private' and indexname='post_reaction_daily_recent_idx'),
  'recent-reaction index is date-leading, covering, and excludes zero buckets'
);
select ok(
  position('d.reaction_count > 0' in pg_get_functiondef(
    'private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure
  ))>0,
  'popular ranking applies the partial-index reaction-count predicate'
);

select * from finish();
rollback;
