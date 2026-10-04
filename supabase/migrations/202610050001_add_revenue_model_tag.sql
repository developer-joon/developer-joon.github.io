begin;

update public.tags
set sort_order = 60
where id = 'a1000000-0000-0000-0000-000000000005'::uuid;

insert into public.tags (id, slug, label, is_active, sort_order)
values (
  'a1000000-0000-0000-0000-000000000006'::uuid,
  'revenue-model',
  '수익모델',
  true,
  50
)
on conflict (id) do update
set slug = excluded.slug,
    label = excluded.label,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order;

commit;
