-- Lås hjärnans referenstabeller: stilprofiler, språkexempel och referensbilder.
-- Efter detta kan webbläsaren (anon-nyckeln, som syns i klientkoden) varken läsa,
-- ändra eller radera dem. Servern läser med SUPABASE_SERVICE_ROLE_KEY, som går förbi RLS.
--
-- KÖR I RÄTT ORDNING:
--   1. Kontrollera att SUPABASE_SERVICE_ROLE_KEY finns i Railway (servern).
--   2. Deploya koden där src/lib/style-profiles.ts läser via serverSupabase().
--   3. Supabase Dashboard -> SQL Editor -> klistra in HELA filen -> Run.
-- Säker att köra om. Ångra: "alter table ... disable row level security;" per tabell.

alter table if exists barnbok_style_profiles enable row level security;
alter table if exists barnbok_reference_texts enable row level security;
alter table if exists barnbok_reference_images enable row level security;

-- Ta bort eventuella öppna policyer. Utan policyer når bara servernyckeln tabellerna.
do $$
declare p record;
begin
  for p in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and tablename in ('barnbok_style_profiles', 'barnbok_reference_texts', 'barnbok_reference_images')
  loop
    execute format('drop policy if exists %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
