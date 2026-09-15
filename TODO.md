# TODO – funktioner som saknas

Upptäckta under designgranskningen 2026-08-12. Sorterade efter uppskattat värde.

## Delning & bokhandel
- [ ] **Egen sida per bok** (`/bok/[id]`) med Open Graph-metadata, så att delade länkar får
      omslagsbild och titel som förhandsvisning i sociala medier/meddelandeappar.
      Idag är delningslänken en query-param (`/?bok=<id>`) som renderas client-side och saknar OG-data.
- [x] **Riktig bokläsare** i bokhandeln: den satta boken (samma sidor som PDF:en), pilar/svep/tangentbord.
- [ ] **Fullskärmsläge** och zoom i läsaren (brödtexten blir liten på mobil).
- [x] **Sök/filter/sortering i bokhandeln**: sök, bokformat, nyast/titel.
- [ ] Filter på ålder och sortering på popularitet (kräver läsräknare).
- [x] **Ladda ner PDF från bokhandeln**.
- [ ] **Dela med QR-kod** (visa QR för bokens länk).
- [x] **Gilla-knapp (hjärtan)**, beskrivning, huvudpersoner och författarsida i bokhandeln (kräver `scripts/bookstore-social.sql`).
- [ ] Läsräknare och topplista.
- [ ] Egen URL för författarsidor (idag bara inne i bokhandeln).
- [ ] **Beställ tryckt bok**: integration med tryckpartner (t.ex. Gelato/Lulu) + betalning. Idag: intresseanmälan + tryckfärdig PDF.

## Skapa-flödet
- [ ] **Molnautospar med statusindikator** ("Sparad i molnet ✓" i headern). Idag autosparas bara
      lokalt; molnsynk kräver att man klickar "Spara bok" i steg 4 – lätt att missa.
- [x] **Generera om bild med feedback**: AI-förslag + egna instruktioner i Redigera-vyn.
- [ ] **Ångra/versionshistorik** för uppslag (behåll föregående bild när man regenererar och kunna växla tillbaka).
- [ ] **Fortsätt där du var**: bokgenereringen (steg 1, "Skapa med AI") tar 1–2 min utan progress i procent
      – visa streamad progress eller delresultat, och överlev en sidomladdning.
- [x] **Aktivera bokformaten** separat text och kapitelbok (sätts nu som riktig bok).
- [ ] Lärobok: egen sättning (idag samma som serieformat).
- [ ] **Onboarding**: kort guidad tur första gången man skapar en bok.
- [ ] Karaktärsbiblioteket sparas bara i webbläsaren - synka till molnet för inloggade.
- [ ] Referensbilder för karaktärer sparas inte i molnet (visas som initialer i bokhandeln).

## Ljudbok
- [ ] **Ljudbok med ElevenLabs** (kräver konto + API-nyckel `ELEVENLABS_API_KEY`): svensk röst per boktyp,
      uppläsning sida för sida (en ljudfil per sida i Supabase Storage), uppspelning i läsaren med
      automatisk bläddring, och "Lyssna" i bokhandeln. Idag: knapp + intresseanmälan ("kommer snart").

## Konto & säkerhet
- [ ] **Glömt lösenord**-flöde (Supabase `resetPasswordForEmail`).
- [ ] **Google-inloggning** (Supabase OAuth) – sänker tröskeln rejält.
- [ ] **Gör anonyma böcker "claimbara"**: när testläget stängs, låt inloggad användare ta ägarskap
      över böcker skapade utan konto (user_id är null). Ta sedan bort anon-policies
      (se `scripts/anon-save-migration.sql`).
- [ ] **Admin**: sätt `NEXT_PUBLIC_ADMIN_EMAILS` i Railway så att Referensdatabasen syns i kontomenyn (annars via `/?admin=1`).
- [ ] **Juridik i sidfoten**: integritetspolicy, villkor och kontakt.
- [ ] **Moderering**: admin-vy för att avpublicera olämpliga böcker ur bokhandeln
      (viktigt så länge allt auto-publiceras).

## Mobil & tillgänglighet
- [x] **Referensdata nåbar på mobil** (ikon i headern).
- [ ] **Uppläsning** (text-to-speech) av boktext i läsaren – målgruppen är barn.
- [ ] **Alt-texter** på uppslagsbilder (generera beskrivning per bild).

## Övrigt
- [ ] **Flerspråksstöd**: generera böcker på engelska (UI + prompt).
- [ ] **Print-on-demand**: beställ fysisk bok (t.ex. Gelato/Peecho-integration).
- [ ] **E-postnotis** när en delad bok lästs X gånger (återengagemang).
- [ ] **Statistiksida för skaparen**: antal läsningar/delningar per bok.
