begin;

select plan(3);

select row_eq(
  $$select id, slug, label, is_active, sort_order
      from public.tags
     where id = 'a1000000-0000-0000-0000-000000000006'::uuid$$,
  row(
    'a1000000-0000-0000-0000-000000000006'::uuid,
    'revenue-model'::text,
    '수익모델'::text,
    true,
    50
  ),
  'the production catalog contains the active revenue-model tag'
);

select is(
  (select sort_order from public.tags where id = 'a1000000-0000-0000-0000-000000000005'::uuid),
  60,
  'free-talk remains after revenue-model in the catalog order'
);

set local role anon;
select is(
  (select label from public.tags where id = 'a1000000-0000-0000-0000-000000000006'::uuid),
  '수익모델'::text,
  'anonymous readers can discover the active revenue-model tag'
);

select * from finish();
rollback;
