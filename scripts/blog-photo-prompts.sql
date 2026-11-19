-- Photo prompts for blog posts: the photos a post needs, each described as a prompt for an AI image
-- tool, with where it goes and its alt text: [{ "place": "...", "prompt": "...", "alt": "..." }].
-- Written by the AI with each draft, shown on the Blog screen with copy buttons, never published
-- (the public reads in lib/db/index.ts do not select it).
--
-- Additive: one new column on jde_blog_posts (scripts/blog-posts.sql) with an empty-list default,
-- so every existing post simply has no prompts yet. Nothing else is altered.

alter table public.jde_blog_posts
  add column if not exists image_prompts jsonb not null default '[]'::jsonb
  check (jsonb_typeof(image_prompts) = 'array');
