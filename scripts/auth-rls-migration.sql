-- Knyter användardata till konton och aktiverar Row Level Security (RLS)
-- så att varje användare bara ser och ändrar sina egna böcker.
-- Körs i Supabase SQL Editor. Säker att köra om (idempotent).

-- 1. Lägg till user_id på alla användardatatabeller (nullable - bryter inte gammal data)
alter table barnbok_books        add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table barnbok_characters   add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table barnbok_spreads      add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table barnbok_text_blocks  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_barnbok_books_user      on barnbok_books(user_id);
create index if not exists idx_barnbok_characters_user on barnbok_characters(user_id);
create index if not exists idx_barnbok_spreads_user    on barnbok_spreads(user_id);
create index if not exists idx_barnbok_text_blocks_user on barnbok_text_blocks(user_id);

-- 2. Aktivera RLS
alter table barnbok_books       enable row level security;
alter table barnbok_characters  enable row level security;
alter table barnbok_spreads     enable row level security;
alter table barnbok_text_blocks enable row level security;

-- 3. Ta bort ev. gammal tillåtande policy som öppnade tabellerna för alla.
--    VIKTIGT: RLS kombinerar policies med OR, så en kvarvarande "public access"-
--    policy gör att RLS inte skyddar något. (Upptäcktes vid test 2026-06-12.)
drop policy if exists "barnbok_public_access" on barnbok_books;
drop policy if exists "barnbok_public_access" on barnbok_characters;
drop policy if exists "barnbok_public_access" on barnbok_spreads;
drop policy if exists "barnbok_public_access" on barnbok_text_blocks;

-- 4. Policies: ägaren får göra allt med sina egna rader.
--    (drop-if-exists först så skriptet kan köras om)
drop policy if exists "egna bocker"     on barnbok_books;
drop policy if exists "egna karaktarer" on barnbok_characters;
drop policy if exists "egna uppslag"    on barnbok_spreads;
drop policy if exists "egna textblock"  on barnbok_text_blocks;

create policy "egna bocker" on barnbok_books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egna karaktarer" on barnbok_characters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egna uppslag" on barnbok_spreads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "egna textblock" on barnbok_text_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- OBS: barnbok_style_profiles och barnbok_reference_texts lämnas med RLS AV.
-- De innehåller ingen användardata (delad stilbibliotek) och skrivs av admin-
-- skripten med anon-nyckeln. Hårdna ev. senare med admin-only write-policy.
