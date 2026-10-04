# Mall för analys.md (syntesen av en referensbok)

Skrivs efter `sammanstall.mjs` och `jamfor.mjs`. Underlag:
- `observationer.md` (handling, skriv- och bildgrepp per uppslag)
- `fingeravtryck.json`
- `jamforelse.md`
- några av bilderna i `sidor/` (i molnmappen efter `stada.mjs`)

Allt skrivs med egna ord.

**Upphovsrätt:**
- Bokens text sparas aldrig: inga utdrag, inga citat utöver enstaka ord.
- Förlagans namn på figurer, platser och påhitt får aldrig hamna i regler, grepp eller exempel.
- Skriv aldrig "som i <förlagan>" i det som ska in i hjärnan. Hjärnan beskriver hantverket, inte boken.

## 1. Boken i korthet
- Titel, författare, illustratör, förlag (det som syns på omslaget).
- Ålder, format, antal sidor och kapitel, ungefärligt antal ord.
- Närmaste boktyp i appen (`src/lib/styles.ts`), eller förslag på en ny boktyp med motivering.

## 2. Textens röst (stilkort)
5–8 meningar som instruerar en skribent:
- berättarperspektiv och tempus
- rytm
- hur repliker skrivs och anförs
- humor
- hur känslor visas
- hur kapitel börjar och slutar
- hur texten talar till läsaren

## 3. Fingeravtrycket
De 8–10 viktigaste måtten ur `fingeravtryck.json` med en mening om vad varje mått betyder i praktiken. Föreslå målintervall för boktypen. Intervallen blir säkrare ju fler böcker som läses in.

## 4. Grepp (5–10)
Per grepp:
- **Namn**
- **Vad det är och när det används**
- **Hur ofta** (ungefär)
- **Ett eget påhittat exempel**, inte ur boken, med andra figurer och en annan situation.

## 5. Bildspråket
- **Bildtyper och fördelning** (full/spread/band/spot/round/panels) och hur de växlar genom boken.
- **Text och bild:** var texten står (vitt papper eller ljusa ytor i bilden) och hur bild och text delar på berättandet (vad bilden visar som texten inte säger).
- **Utseende:** linje, färg, skuggning, figurdesign, bakgrunder och grafiska grepp.
- **Kapitelstarter** och återkommande element.
- **Förslag till art direction** på engelska, 4–6 rader i samma form som `artDirection` i `styles.ts`. Beskriv hantverket, inte förlagans figurer.

## 6. Bokens uppbyggnad
- Kapitellängd och ord per uppslag.
- Hur ofta bilder kommer.
- Sidvändningar och cliffhangers.
- Prolog och direkt tilltal, och vad som finns före och efter berättelsen.

## 7. Skillnader mot appen
De 5–8 största skillnaderna ur `jamforelse.md`, tolkade:
- vad appen gör annorlunda
- varför det får texten att kännas stolpig eller platt
- vilken regel eller vilket kontrastpar som skulle krympa skillnaden

## 8. Kontrastpar (3–6)
Varje par har tre delar:
- **"Stolpigt"**, skrivet så som appen typiskt skriver (gärna utifrån mönster i appens publicerade böcker).
- **"Levande"**, samma innehåll skrivet med bokens hantverk.
- **"Varför"** i en mening.

Båda versionerna är egenskrivna, med egna figurer.

## 9. Förslag till hjärnan
Konkreta tillägg, markerade som FÖRSLAG tills Dennis godkänt:
- **Boktyp:** stilkort, målintervall, grepp, kontrastpar, bildspråk och bildtypsblandning.
- **Hantverk** (gäller alla böcker): nya regler som boken visar.
- **Bildregler.**
- **Kvalitetskontroller:** sådant Lektören eller granskaren ska titta efter.
