insert into public.tags (id, slug, label, is_active, sort_order)
values
  ('a1000000-0000-0000-0000-000000000001', 'ai-agent', 'AI·Agent', true, 10),
  ('a1000000-0000-0000-0000-000000000002', 'development', '개발', true, 20),
  ('a1000000-0000-0000-0000-000000000003', 'infra-cloud', '인프라·클라우드', true, 30),
  ('a1000000-0000-0000-0000-000000000004', 'side-project', '사이드 프로젝트', true, 40),
  ('a1000000-0000-0000-0000-000000000005', 'free-talk', '자유 이야기', true, 50)
on conflict (id) do update
set slug = excluded.slug,
    label = excluded.label,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order;

insert into public.rate_limit_rules (id, action, window_seconds, max_requests, is_enabled)
values
  ('b1000000-0000-0000-0000-000000000001', 'post.create', 600, 5, true),
  ('b1000000-0000-0000-0000-000000000002', 'post.create', 86400, 30, true),
  ('b1000000-0000-0000-0000-000000000003', 'comment.create', 600, 20, true),
  ('b1000000-0000-0000-0000-000000000004', 'comment.create', 86400, 200, true),
  ('b1000000-0000-0000-0000-000000000005', 'report.create', 86400, 10, true)
on conflict (action, window_seconds) do update
set max_requests = excluded.max_requests,
    is_enabled = excluded.is_enabled,
    updated_at = now();
