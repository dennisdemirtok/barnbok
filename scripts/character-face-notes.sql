-- Ansiktets kännetecken från karaktärsbladet (följer med i varje bildprompt).
-- Körs i Supabase SQL Editor. Säker att köra om.
alter table barnbok_characters add column if not exists face_notes text;
