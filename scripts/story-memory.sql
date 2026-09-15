-- Berättelseminne: fingeravtryck av AI-genererade idéer och bokbörjan, så att nya
-- böcker kan undvika namn, titlar och miljöer som nyligen använts.
--
-- HUR MAN KÖR: Supabase Dashboard -> SQL Editor -> klistra in HELA filen -> Run.
-- Säker att köra om. Appen fungerar utan tabellen (minnet ligger då bara i serverns arbetsminne).
--
-- Integritet: bara korta fingeravtryck sparas (namn, titel, miljö, en rad om idén),
-- aldrig hela texter eller vem som skapade dem. Författarens egna manus sparas inte.

create table if not exists barnbok_story_memory (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('plot', 'beginning')),
  style text,
  title text check (length(title) <= 120),
  names text[] not null default '{}',
  setting text check (length(setting) <= 160),
  premise text check (length(premise) <= 200),
  opening text check (length(opening) <= 160),
  created_at timestamptz not null default now()
);
create index if not exists idx_barnbok_story_memory_created on barnbok_story_memory(created_at desc);

-- Ingen direkt tabellåtkomst - bara via funktionerna nedan
alter table barnbok_story_memory enable row level security;

create or replace function barnbok_remember_story(
  p_kind text, p_style text, p_title text, p_names text[], p_setting text, p_premise text, p_opening text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into barnbok_story_memory (kind, style, title, names, setting, premise, opening)
  values (
    p_kind,
    left(p_style, 40),
    left(p_title, 120),
    coalesce((select array_agg(left(n, 30)) from unnest(p_names[1:8]) n), '{}'),
    left(p_setting, 160),
    left(p_premise, 200),
    left(p_opening, 160)
  );
  -- Behåll bara de senaste 500
  delete from barnbok_story_memory
   where id < (select min(id) from (select id from barnbok_story_memory order by id desc limit 500) latest);
end;
$$;
grant execute on function barnbok_remember_story(text, text, text, text[], text, text, text) to anon, authenticated;

create or replace function barnbok_recent_stories(p_limit int default 40)
returns table (kind text, style text, title text, names text[], setting text, premise text, opening text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select kind, style, title, names, setting, premise, opening, created_at
    from barnbok_story_memory
   order by id desc
   limit least(greatest(p_limit, 1), 100);
$$;
grant execute on function barnbok_recent_stories(int) to anon, authenticated;

notify pgrst, 'reload schema';
