# TODO – funktioner som saknas

Upptäckta under designgranskningen 2026-08-12. Sorterade efter uppskattat värde.

## Delning & bokhandel
- [ ] **Egen sida per bok** (`/bok/[id]`) med Open Graph-metadata, så att delade länkar får
      omslagsbild och titel som förhandsvisning i sociala medier/meddelandeappar.
      Idag är delningslänken en query-param (`/?bok=<id>`) som renderas client-side och saknar OG-data.
- [ ] **Riktig bokläsare** i bokhandeln: bläddra uppslag för uppslag (pilar/svep) i stället för
      en lång bildlista. Fullskärmsläge. Stöd för Luna-layouter (text + bild) – idag visas bara bilder,
      så böcker i "separat text"-format tappar sin text i läsaren.
- [ ] **Sök/filter/sortering i bokhandeln**: ålder, bokformat, nyast/populärast.
- [ ] **Ladda ner PDF från bokhandeln** (idag bara från granska-steget).
- [ ] **Dela med QR-kod** (visa QR för bokens länk).
- [ ] **Läsräknare + gilla-knapp** per bok, och topplista i bokhandeln.

## Skapa-flödet
- [ ] **Molnautospar med statusindikator** ("Sparad i molnet ✓" i headern). Idag autosparas bara
      lokalt; molnsynk kräver att man klickar "Spara bok" i steg 4 – lätt att missa.
- [ ] **Generera om bild med feedback**: textfält "vad ska ändras?" vid regenerering i granska-vyn.
- [ ] **Ångra/versionshistorik** för uppslag (behåll föregående bild när man regenererar och kunna växla tillbaka).
- [ ] **Fortsätt där du var**: bokgenereringen (steg 1, "Skapa med AI") tar 1–2 min utan progress i procent
      – visa streamad progress eller delresultat, och överlev en sidomladdning.
- [ ] **Aktivera de tre låsta bokformaten** (separat text, kapitelbok, lärobok är "kommer snart" i creatorn
      men stöds redan av prompt/parser-lagret).
- [ ] **Onboarding**: kort guidad tur första gången man skapar en bok.

## Konto & säkerhet
- [ ] **Glömt lösenord**-flöde (Supabase `resetPasswordForEmail`).
- [ ] **Google-inloggning** (Supabase OAuth) – sänker tröskeln rejält.
- [ ] **Gör anonyma böcker "claimbara"**: när testläget stängs, låt inloggad användare ta ägarskap
      över böcker skapade utan konto (user_id är null). Ta sedan bort anon-policies
      (se `scripts/anon-save-migration.sql`).
- [ ] **Moderering**: admin-vy för att avpublicera olämpliga böcker ur bokhandeln
      (viktigt så länge allt auto-publiceras).

## Mobil & tillgänglighet
- [ ] **Mobilmeny** (hamburgare) – Referensdata är helt dold på mobil idag.
- [ ] **Uppläsning** (text-to-speech) av boktext i läsaren – målgruppen är barn.
- [ ] **Alt-texter** på uppslagsbilder (generera beskrivning per bild).

## Övrigt
- [ ] **Flerspråksstöd**: generera böcker på engelska (UI + prompt).
- [ ] **Print-on-demand**: beställ fysisk bok (t.ex. Gelato/Peecho-integration).
- [ ] **E-postnotis** när en delad bok lästs X gånger (återengagemang).
- [ ] **Statistiksida för skaparen**: antal läsningar/delningar per bok.
