-- Bildjobb i bakgrunden: servern illustrerar boken även om användaren stänger sidan.
-- Körs i Supabase SQL Editor. Säker att köra om (idempotent).

-- 1. Jobb per bok
create table if not exists barnbok_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null,
  user_id uuid,
  kind text not null default 'illustrate',
  status text not null default 'running', -- running | done | failed | canceled
  total int not null default 0,
  done int not null default 0,
  failed int not null default 0,
  message text,
  -- Allt jobbet behöver för att kunna köra vidare efter en omstart
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

create index if not exists barnbok_jobs_book_idx on barnbok_jobs (book_id, created_at desc);
create index if not exists barnbok_jobs_status_idx on barnbok_jobs (status, heartbeat_at);

-- 2. En rad per uppslag som ska illustreras
create table if not exists barnbok_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references barnbok_jobs(id) on delete cascade,
  spread_id uuid not null,
  spread_number int not null default 0,
  label text,
  status text not null default 'queued', -- queued | running | done | error
  attempts int not null default 0,
  image_url text,
  quality jsonb,
  error text,
  claimed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists barnbok_job_items_job_idx on barnbok_job_items (job_id, spread_number);
create unique index if not exists barnbok_job_items_unik on barnbok_job_items (job_id, spread_id);

-- 3. Hämta nästa uppslag att jobba med. Atomiskt: två arbetare kan aldrig ta samma.
-- Ett uppslag som fastnat (servern startade om mitt i) tas tillbaka efter 10 minuter.
create or replace function barnbok_claim_job_item(p_job uuid)
returns setof barnbok_job_items
language plpgsql
as $$
begin
  return query
  update barnbok_job_items i
     set status = 'running', claimed_at = now(), attempts = i.attempts + 1, updated_at = now()
   where i.id = (
     select c.id from barnbok_job_items c
      where c.job_id = p_job
        and (c.status = 'queued'
             or (c.status = 'running' and c.claimed_at < now() - interval '10 minutes' and c.attempts < 3))
      order by c.spread_number
      limit 1
      for update skip locked
   )
  returning i.*;
end;
$$;

-- 4. Räkna om hur långt jobbet kommit
create or replace function barnbok_job_progress(p_job uuid)
returns void
language sql
as $$
  update barnbok_jobs j
     set done = (select count(*) from barnbok_job_items where job_id = p_job and status = 'done'),
         failed = (select count(*) from barnbok_job_items where job_id = p_job and status = 'error'),
         heartbeat_at = now(),
         updated_at = now()
   where j.id = p_job;
$$;

-- 5. Rättigheter. Testläge: samma öppna läge som böckerna har idag.
alter table barnbok_jobs enable row level security;
alter table barnbok_job_items enable row level security;

drop policy if exists "anon jobb (testlage)" on barnbok_jobs;
create policy "anon jobb (testlage)" on barnbok_jobs for all using (true) with check (true);

drop policy if exists "anon jobbrader (testlage)" on barnbok_job_items;
create policy "anon jobbrader (testlage)" on barnbok_job_items for all using (true) with check (true);

grant execute on function barnbok_claim_job_item(uuid) to anon, authenticated;
grant execute on function barnbok_job_progress(uuid) to anon, authenticated;

-- 6. Karaktärerna måste finnas helt i molnet, annars kan servern inte rita
-- samma ansikten när den jobbar i bakgrunden (referensbilden är ansiktet).
alter table barnbok_characters add column if not exists age text;
alter table barnbok_characters add column if not exists normal_clothes text;
alter table barnbok_characters add column if not exists personality text;
alter table barnbok_characters add column if not exists hero_name text;
alter table barnbok_characters add column if not exists hero_costume text;
alter table barnbok_characters add column if not exists power text;
alter table barnbok_characters add column if not exists reference_image_url text;
