-- Blog posts for the company website: articles on backhoe loaders, rock breakers and excavators,
-- drafted by the AI writer on the Blog screen, checked by the owner, then published. Published posts
-- of the storefront company are read by the public /blog pages and /api/public/blog, which select
-- only the public columns below; drafts and the "check before publishing" notes never leave the ERP.
--
-- Additive: one new table, one trigger function. Nothing existing is altered. Service role only,
-- like every jde_ table.

create table if not exists public.jde_blog_posts (
  id text primary key default gen_random_uuid()::text,
  company_id text not null references public.jde_companies(id) on delete cascade,
  -- The post's web address, /blog/<slug>. Lower case words joined by hyphens, one per company.
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  title text not null check (char_length(trim(title)) between 1 and 150),
  -- What search engines show under the title.
  summary text not null default '' check (char_length(summary) <= 320),
  machine text not null default 'general' check (machine in ('backhoe', 'breaker', 'excavator', 'general')),
  -- What the post was asked to be about, and which topic of the topic bank (lib/blog.ts) it covers.
  topic text not null default '' check (char_length(topic) <= 300),
  topic_id text,
  -- The article itself, in the small Markdown subset lib/blog.ts reads.
  body text not null default '' check (char_length(body) <= 40000),
  -- Questions and answers shown under the article: [{ "question": "...", "answer": "..." }].
  faq jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array'),
  tags text[] not null default '{}',
  -- Things the AI was unsure of, for the owner to check. Never published.
  fact_checks text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published')),
  -- Which AI model wrote the first draft, for the record.
  ai_model text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When it first went live. Kept if it is taken down and published again.
  published_at timestamptz,
  unique (company_id, slug)
);

create index if not exists jde_blog_posts_public_idx on public.jde_blog_posts (company_id, status, published_at desc);

-- Every save moves updated_at, and the first publish stamps published_at, here rather than in the
-- browser: a post edited through the generic table route cannot forget either.
create or replace function public.jde_blog_posts_stamp()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $function$;

drop trigger if exists jde_blog_posts_stamp on public.jde_blog_posts;
create trigger jde_blog_posts_stamp before insert or update on public.jde_blog_posts
  for each row execute function public.jde_blog_posts_stamp();

alter table public.jde_blog_posts enable row level security;
revoke all on public.jde_blog_posts from anon, authenticated;
grant all on public.jde_blog_posts to service_role;
revoke all on function public.jde_blog_posts_stamp() from public, anon, authenticated;
