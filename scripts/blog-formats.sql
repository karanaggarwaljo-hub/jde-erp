-- Article formats for blog posts (lib/blog-formats.ts): a checklist, a fault finder, myths and
-- facts, a comparison and so on, so that each new post reads differently from the last ones. The
-- Blog screen picks the format no recent post has used, which needs each post's format saved here.
--
-- Additive: one new column on jde_blog_posts. Existing posts were all written as a plain guide, so
-- they take 'guide'. The database only checks the id is a short lower-case word; the list of
-- formats lives in lib/blog-formats.ts, so adding one needs no migration. No DROP, nothing altered.

alter table public.jde_blog_posts
  add column if not exists format text not null default 'guide'
  check (format ~ '^[a-z]{1,30}$');
