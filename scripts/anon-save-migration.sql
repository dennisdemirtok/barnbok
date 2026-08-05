-- TESTLÄGE: tillåt att ej inloggade besökare sparar böcker till molnet så att
-- allt som skapas hamnar i bokhandeln. Anonyma böcker får user_id = null.
-- Körs i Supabase SQL Editor. Säker att köra om (idempotent).
--
-- OBS: I testläget kan vem som helst uppdatera/radera anonyma böcker eftersom
-- de saknar ägare. När testfasen är över: ta bort policies med namnen nedan
-- (drop policy "... (testlage)" on <tabell>).

-- 1. Tabeller: anonyma rader (user_id = null) får läsas/skrivas av alla
drop policy if exists "anon bocker (testlage)" on barnbok_books;
create policy "anon bocker (testlage)" on barnbok_books
  for all using (user_id is null) with check (user_id is null);

drop policy if exists "anon karaktarer (testlage)" on barnbok_characters;
create policy "anon karaktarer (testlage)" on barnbok_characters
  for all using (user_id is null) with check (user_id is null);

drop policy if exists "anon uppslag (testlage)" on barnbok_spreads;
create policy "anon uppslag (testlage)" on barnbok_spreads
  for all using (user_id is null) with check (user_id is null);

drop policy if exists "anon textblock (testlage)" on barnbok_text_blocks;
create policy "anon textblock (testlage)" on barnbok_text_blocks
  for all using (user_id is null) with check (user_id is null);

-- 2. Storage: tillåt anonym uppladdning/uppdatering av bokbilder
drop policy if exists "anon bildskrivning (testlage)" on storage.objects;
create policy "anon bildskrivning (testlage)" on storage.objects
  for insert to anon with check (bucket_id = 'barnbok-images');

drop policy if exists "anon bilduppdatering (testlage)" on storage.objects;
create policy "anon bilduppdatering (testlage)" on storage.objects
  for update to anon
  using (bucket_id = 'barnbok-images')
  with check (bucket_id = 'barnbok-images');
