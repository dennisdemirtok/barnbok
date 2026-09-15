-- Bokhandeln: baksidestext, hjärtan (gilla), följ skapare och intresseanmälan
-- för tryckta böcker.
--
-- HUR MAN KÖR: Supabase Dashboard -> SQL Editor -> klistra in HELA filen -> Run.
-- Kräver att auth-rls-migration.sql och publish-rls-migration.sql redan körts.
-- Säker att köra om (idempotent: if not exists / create or replace / drop policy if exists).
--
-- Appen fungerar även innan skriptet körts: då döljs hjärtan, följ-knappen och
-- intresseformuläret, och baksidestexter visas inte.

-- ═══════════════════════════════════════════
-- 1. Baksidestext på böcker
-- ═══════════════════════════════════════════
alter table barnbok_books add column if not exists description text;

-- Besökare i bokhandeln får fylla i en SAKNAD baksidestext på en publicerad bok
-- (texten genereras av /api/book-blurb första gången någon öppnar boken).
-- AVVÄGNING: vem som helst med anon-nyckeln kan anropa funktionen, men den skriver
-- bara när texten är tom (först till kvarn) och max 600 tecken. Ägaren kan alltid
-- skriva över via sin vanliga uppdateringspolicy.
create or replace function barnbok_set_book_description(p_book_id uuid, p_description text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := left(btrim(coalesce(p_description, '')), 600);
begin
  if cleaned = '' then
    return false;
  end if;
  update barnbok_books
     set description = cleaned
   where id = p_book_id
     and is_public = true
     and (description is null or btrim(description) = '');
  return found;
end;
$$;
grant execute on function barnbok_set_book_description(uuid, text) to anon, authenticated;

-- ═══════════════════════════════════════════
-- 2. Hjärtan (gilla)
-- ═══════════════════════════════════════════
-- liker_id = inloggad användares id, eller 'anon:<uuid>' för ej inloggade
-- (slumpat enhets-id som sparas i webbläsarens localStorage).
create table if not exists barnbok_book_likes (
  book_id uuid not null references barnbok_books(id) on delete cascade,
  liker_id text not null check (length(liker_id) between 8 and 80),
  created_at timestamptz not null default now(),
  primary key (book_id, liker_id)
);
create index if not exists idx_barnbok_book_likes_liker on barnbok_book_likes(liker_id);

alter table barnbok_book_likes enable row level security;

-- Inloggade får se/lägga till/ta bort sina egna hjärtan direkt i tabellen.
drop policy if exists "egna hjartan" on barnbok_book_likes;
create policy "egna hjartan" on barnbok_book_likes
  for all to authenticated
  using (liker_id = auth.uid()::text)
  with check (liker_id = auth.uid()::text);

-- Ej inloggade har INGEN direkt tabellåtkomst (då kunde vem som helst lista och
-- radera andras anonyma hjärtan). De går via funktionerna nedan i stället.
-- AVVÄGNING: anonyma hjärtan är knutna till ett enhets-id som klienten själv
-- anger. Enhets-id:t fungerar som en hemlighet (det kan inte läsas ut via API:t),
-- men en besökare kan skapa nya id:n och därmed ge fler hjärtan. Det är
-- acceptabelt för en "gillad av andra"-signal i testläget, inte för något som
-- styr pengar eller rankning med höga insatser.

-- Antal hjärtan per publicerad bok (bara antal - aldrig vem som gillat).
-- Vyn körs som ägaren och kringgår därför RLS på hjärttabellen avsiktligt.
create or replace view barnbok_book_like_counts as
  select l.book_id, count(*)::int as like_count
    from barnbok_book_likes l
    join barnbok_books b on b.id = l.book_id and b.is_public = true
   group by l.book_id;
grant select on barnbok_book_like_counts to anon, authenticated;

-- Sätt/ta bort ett hjärta. Inloggad användare använder alltid sitt konto-id
-- (p_liker_id ignoreras då). Returnerar nytt antal hjärtan för boken.
create or replace function barnbok_set_like(p_book_id uuid, p_liker_id text, p_liked boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce(auth.uid()::text, 'anon:' || nullif(btrim(coalesce(p_liker_id, '')), ''));
  total int;
begin
  if who is null or length(who) < 8 or length(who) > 80 then
    raise exception 'ogiltigt gillar-id';
  end if;
  if not exists (select 1 from barnbok_books where id = p_book_id and is_public = true) then
    raise exception 'boken är inte publicerad';
  end if;

  if p_liked then
    insert into barnbok_book_likes (book_id, liker_id) values (p_book_id, who)
    on conflict do nothing;
  else
    delete from barnbok_book_likes where book_id = p_book_id and liker_id = who;
  end if;

  select count(*)::int into total from barnbok_book_likes where book_id = p_book_id;
  return total;
end;
$$;
grant execute on function barnbok_set_like(uuid, text, boolean) to anon, authenticated;

-- Vilka av dessa böcker har jag (kontot eller enheten) gillat?
create or replace function barnbok_my_likes(p_liker_id text, p_book_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select book_id
    from barnbok_book_likes
   where book_id = any(p_book_ids)
     and liker_id = coalesce(auth.uid()::text, 'anon:' || nullif(btrim(coalesce(p_liker_id, '')), ''));
$$;
grant execute on function barnbok_my_likes(text, uuid[]) to anon, authenticated;

-- ═══════════════════════════════════════════
-- 3. Följ skapare (kräver inloggning)
-- ═══════════════════════════════════════════
create table if not exists barnbok_author_follows (
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_user_id, author_user_id),
  check (follower_user_id <> author_user_id)
);
create index if not exists idx_barnbok_author_follows_author on barnbok_author_follows(author_user_id);

alter table barnbok_author_follows enable row level security;

-- Bara inloggade, och bara på sina egna rader (vem man själv följer)
drop policy if exists "egna foljningar" on barnbok_author_follows;
create policy "egna foljningar" on barnbok_author_follows
  for all to authenticated
  using (follower_user_id = auth.uid())
  with check (follower_user_id = auth.uid());

-- Antal följare per skapare - bara antal, aldrig vilka som följer
create or replace view barnbok_author_follower_counts as
  select author_user_id, count(*)::int as follower_count
    from barnbok_author_follows
   group by author_user_id;
grant select on barnbok_author_follower_counts to anon, authenticated;

-- ═══════════════════════════════════════════
-- 4. Intresseanmälan: tryckt bok
-- ═══════════════════════════════════════════
-- Ingen beställning - bara "meddela mig när det går att beställa".
-- E-post är personuppgift: besökare får BARA lägga till rader, aldrig läsa.
-- Läs anmälningarna i Supabase Dashboard (Table Editor) som admin.
create table if not exists barnbok_print_interest (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references barnbok_books(id) on delete set null,
  email text not null check (length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Vad man vill bli meddelad om: tryckt bok eller ljudbok
alter table barnbok_print_interest add column if not exists kind text not null default 'print'
  check (kind in ('print', 'audio'));

alter table barnbok_print_interest enable row level security;

drop policy if exists "anmal intresse tryck" on barnbok_print_interest;
create policy "anmal intresse tryck" on barnbok_print_interest
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Be PostgREST läsa in nya tabeller/kolumner/funktioner direkt
notify pgrst, 'reload schema';
