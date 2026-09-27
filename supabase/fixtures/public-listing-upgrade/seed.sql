insert into auth.users(id,aud,role,email) values
  ('71000000-0000-0000-0000-000000000001','authenticated','authenticated','listing-upgrade@example.test');
insert into public.profiles(id,github_user_id,login,display_name) values
  ('71000000-0000-0000-0000-000000000001',971001,'listing-upgrade','Listing Upgrade');
insert into public.posts(id,author_id,title,body_markdown,status,created_at,updated_at)
select md5('listing-upgrade-'||g::text)::uuid,
       '71000000-0000-0000-0000-000000000001',
       'Listing upgrade '||g,'body','published',clock_timestamp(),clock_timestamp()
from generate_series(1,5000) g;
insert into private.post_reaction_daily_counts(post_id,reaction_date,reaction_bucket,reaction_count) values
  (md5('listing-upgrade-1')::uuid,current_date-31,0,1),
  (md5('listing-upgrade-2')::uuid,current_date,0,1);
create table public.public_listing_upgrade_probe(original_index_oid oid not null);
insert into public.public_listing_upgrade_probe
select 'public.posts_public_list_idx'::regclass::oid;