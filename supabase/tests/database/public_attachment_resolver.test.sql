begin;
select plan(16);

select has_function('public','resolve_public_attachment',array['uuid'],'public attachment resolver exists');
select ok(
  (
    select p.prosecdef
       and p.proconfig = array['search_path=""']
       and pg_get_userbyid(p.proowner) = 'postgres'
      from pg_proc p
     where p.oid = to_regprocedure('public.resolve_public_attachment(uuid)')
  ),
  'resolver is fixed-owner SECURITY DEFINER with empty search_path'
);
select ok(not has_function_privilege('public','public.resolve_public_attachment(uuid)','EXECUTE'),'PUBLIC cannot execute resolver');
select ok(not has_function_privilege('anon','public.resolve_public_attachment(uuid)','EXECUTE'),'anon cannot execute resolver');
select ok(not has_function_privilege('authenticated','public.resolve_public_attachment(uuid)','EXECUTE'),'authenticated cannot execute resolver');
select ok(has_function_privilege('service_role','public.resolve_public_attachment(uuid)','EXECUTE'),'service_role can execute resolver');

insert into auth.users(id,aud,role,email) values
 ('c1000000-0000-4000-8000-000000000001','authenticated','authenticated','public-attachment@example.test');
insert into public.profiles(id,github_user_id,login) values
 ('c1000000-0000-4000-8000-000000000001',94001,'public-attachment');
insert into public.posts(id,author_id,title,body_markdown,status,deleted_at) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Published','body','published',null),
 ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','Hidden','body','hidden',null),
 ('c2000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','Soft deleted','body','deleted',clock_timestamp());
insert into public.attachments(
  id,owner_id,post_id,storage_path,mime_type,byte_size,status,deleted_at,attached_at
) values
 ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','public/eligible.png','image/png',123,'attached',null,now()),
 ('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001',null,'public/pending.png','image/png',123,'pending',null,null),
 ('c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','public/deleted-attachment.png','image/png',123,'deleted',clock_timestamp(),now()),
 ('c3000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002','public/hidden-post.png','image/png',123,'attached',null,now()),
 ('c3000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003','public/deleted-post.png','image/png',123,'attached',null,now()),
 ('c3000000-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000001',null,'public/quarantined.png','image/png',123,'quarantined',null,null);

set local role service_role;
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000001')),1,'attached active attachment on a published active post resolves');
select results_eq(
  $$select storage_path,mime_type,byte_size from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000001')$$,
  $$values ('public/eligible.png'::text,'image/png'::text,123::bigint)$$,
  'resolver returns only download metadata'
);
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000002')),0,'pending attachment does not resolve');
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000003')),0,'soft-deleted attachment does not resolve');
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000004')),0,'attachment on hidden post does not resolve');
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000005')),0,'attachment on soft-deleted post does not resolve');
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000006')),0,'quarantined unlinked attachment does not resolve');
select is((select count(*)::integer from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000099')),0,'missing attachment does not resolve');
reset role;

set local role anon;
select throws_like(
  $$select * from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000001')$$,
  '%permission denied for function resolve_public_attachment%',
  'anon execution is denied'
);
reset role;
set local role authenticated;
select throws_like(
  $$select * from public.resolve_public_attachment('c3000000-0000-4000-8000-000000000001')$$,
  '%permission denied for function resolve_public_attachment%',
  'authenticated execution is denied'
);
reset role;

select * from finish();
rollback;
