-- Publicering till bookstore/topplista: opt-in, publicerade böcker läsbara gratis för alla.
-- Privata böcker förblir skyddade (ägaren ser bara sina). Säker att köra om.

-- 1. Publiceringsfält
alter table barnbok_books add column if not exists is_public boolean not null default false;
alter table barnbok_books add column if not exists published_at timestamptz;
alter table barnbok_books add column if not exists author_name text;
create index if not exists idx_barnbok_books_public on barnbok_books(is_public) where is_public = true;

-- 2. Publik LÄSNING (select) av publicerade böcker - läggs UTÖVER ägarpolicyn
--    (RLS kombinerar med OR: ägare ser sina, alla ser publicerade)
drop policy if exists "publik las bocker" on barnbok_books;
create policy "publik las bocker" on barnbok_books
  for select using (is_public = true);

drop policy if exists "publik las karaktarer" on barnbok_characters;
create policy "publik las karaktarer" on barnbok_characters
  for select using (book_id in (select id from barnbok_books where is_public = true));

drop policy if exists "publik las uppslag" on barnbok_spreads;
create policy "publik las uppslag" on barnbok_spreads
  for select using (book_id in (select id from barnbok_books where is_public = true));

drop policy if exists "publik las textblock" on barnbok_text_blocks;
create policy "publik las textblock" on barnbok_text_blocks
  for select using (spread_id in (
    select id from barnbok_spreads where book_id in (select id from barnbok_books where is_public = true)
  ));
