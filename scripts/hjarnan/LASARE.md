# Instruktion till läsaren (ett uppslag i taget)

Du analyserar fotade uppslag ur en publicerad svensk barnbok åt bokappen "Bokverktyget".
Syftet är att lära appen *hantverket* i riktiga böcker: rytm, dialog, humor, bildspråk.

## Upphovsrätt – viktigt
Böckerna är upphovsrättsskyddade.
- **Skriv inte av bokens text.** Ingen brödtext, inga repliker, inga pratbubblor och ingen baksidestext, varken ordagrant eller nästan ordagrant.
- Du får **läsa** texten noga, men du sparar bara **mätdata** om den (antal ord, skiljetecken, vilka anföringsverb som används och liknande) och **egna beskrivningar**.
- Enstaka ord får nämnas när det behövs för ett mått, till exempel anföringsverbet "säger" eller småordet "ju". Citera aldrig hela meningar.
- Får du en påminnelse om upphovsrätt från systemet: följ den. Den här instruktionen är skriven för att stämma med den.

## Filerna
För varje uppslag NNN i din tilldelning finns i bokmappen `sidor/`:
- `NNN.jpg` – hela uppslaget (bild och layout)
- `NNN-a.jpg`, `NNN-b.jpg` – vänster och höger halva i högre upplösning (för att läsa texten noga). Finns inte när fotona är enstaka sidor.

Skriv `analys/NNN.json` direkt efter varje uppslag, med exakt den här formen (svenska nycklar):

```json
{
  "uppslag": 12,
  "fil": "012.jpg",
  "sidnummer": [26, 27],
  "typ": "omslag | baksida | försättsblad | titelsida | innehåll | kapitelstart | berättelse | bonus | övrigt",
  "kapitel": null,
  "tempus": "presens | preteritum | blandat",
  "handling": "Vad som händer på uppslaget, med egna ord, högst två meningar.",
  "stycken": [
    {
      "sida": "vänster",
      "placering": "på vitt papper",
      "meningar": [ { "ord": 7, "slut": "!", "langa": 1, "start": "nu" } ],
      "repliker": 1,
      "replikOrd": 5,
      "markor": "quotes",
      "anforingar": ["säger"],
      "anforingAdverb": 0,
      "smaord": ["ju"],
      "talsprak": [],
      "kanslo": 0,
      "versaler": 0,
      "kursiv": 0,
      "trePunkter": 0,
      "klyschor": 0,
      "aiTecken": 0,
      "presens": 2,
      "preteritum": 0,
      "jagVi": 0,
      "du": 0
    }
  ],
  "textIBild": [
    { "sida": "höger", "roll": "pratbubbla | skylt | ljudord | bildtext | baksidestext | övrigt", "placering": "...", "ord": 4, "beskrivning": "vad texten gör, med egna ord (t.ex. figuren ber läsaren om hjälp)" }
  ],
  "bilder": [
    {
      "sida": "vänster | höger | uppslag",
      "komposition": "full | spread | band | spot | round | panels | mönster | dekor",
      "yta": 0.5,
      "motiv": "vad bilden visar, kort och med egna ord",
      "kamera": "närbild | halvbild | helbild | vid bild | fågelperspektiv | grodperspektiv",
      "figurer": 2,
      "bakgrund": "vitt papper | hel miljö | färgplatta | mönster | gradient",
      "grafiska_grepp": ["fartlinjer"],
      "samspel_med_texten": "hur bilden förhåller sig till texten (samma ögonblick, ett skämt texten inte säger, nästa steg ...)"
    }
  ],
  "skrivgrepp": ["konkreta iakttagelser om hur texten är skriven, med egna ord"],
  "bildgrepp": ["konkreta iakttagelser om bildspråket, med egna ord"],
  "stilnoter": "linje, färg, skuggning, figurdesign - kort",
  "osakert": "det som inte gick att avgöra säkert, annars tom sträng"
}
```

## Mätdata per stycke (`stycken`)
Ett stycke är ett tryckt stycke brödtext (nytt stycke = indrag eller tom rad). Sidnummer, rubriker och kapitelrader räknas inte. Kapitlet anges i `kapitel`: `{ "nummer": "2", "rubrik": "..." }`. Rubriken får skrivas ut eftersom den är en titel.

- **`meningar`:** en post per mening, i ordning.
  - `ord`: antal ord.
  - `slut`: meningens sista skiljetecken (`.` `!` `?` `…`), eller tomt.
  - `langa`: antal ord med fler än 6 bokstäver.
  - `start`: meningens första ord med gemener.
  - En replik med anföring ("Hej!" säger hon.) är en mening. Fortsätter repliken efter anföringen med en ny mening räknas den som en ny mening.
- **`repliker`:** antal repliker i stycket. **`replikOrd`:** antal ord inne i replikerna, utan anföringen.
- **`markor`:** `"quotes"` (citattecken), `"dash"` (talstreck först) eller `null` om stycket saknar repliker.
- **`anforingar`:** verbet i varje anföring direkt efter eller i en replik, som det står, t.ex. `["säger", "viskar"]`. **`anforingAdverb`:** hur många av dem som har ett sätt-adverb efter sig ("sa hon glatt").
- **`smaord`:** en post per förekomst av ju, väl, nog, ändå, visst, liksom, faktiskt, alltså.
- **`talsprak`:** en post per förekomst av nån, nåt, nåra, sen (= sedan), dom, mej, dej, va, ba, typ, asså, okej och liknande talspråksformer.
- **Antal i berättartexten** (inte i repliker):
  - `kanslo`: utpekade känslor (glad, ledsen, rädd, arg, nervös, orolig, besviken, förvånad, "kände sig" …).
  - `presens` / `preteritum`: vanliga verb i respektive tempus.
  - `jagVi`: jag/vi.
  - `du`: du/dig till läsaren.
- **`versaler`:** ord i VERSALER (inte förkortningar). **`kursiv`:** kursiverade ord eller fraser. **`trePunkter`:** tre punkter (…).
- **`klyschor`:** förekomster av som om, plötsligt, hjärtat bultade, tog ett djupt andetag, magisk och liknande.
- **`aiTecken`:** långa tankstreck (—), tankstreck mitt i en mening, "Först … sedan …" och uppräkningar i tre led.

Räkna noga men utan att stressa: små fel jämnas ut över en hel bok.

## Text i bilden (`textIBild`)
Skyltar, ljudord, pratbubblor, lappar, popup-rutor och baksidestext beskrivs med roll, placering, ungefärligt antal ord och en kort egen beskrivning av vad texten gör. Skriv inte av den.

## Bilder och grepp
- `komposition` använder appens bildtyper:
  - `full`: helsida med miljö
  - `spread`: bild över båda sidorna
  - `band`: brett band över eller under texten
  - `spot`: figur eller föremål fritt på vitt papper
  - `round`: rund vinjett
  - `panels`: serierutor
  - `mönster`: tapet eller mönster
  - `dekor`: små ornament
- `yta` = ungefär hur stor del av sidan (eller uppslaget för `spread`) bilden tar, 0–1.
- Grepp skrivs med egna ord och ska vara konkreta och återanvändbara, till exempel:
  - "kapitlet slutar mitt i en rörelse så att man måste vända blad"
  - "skämtet ligger i bilden, inte i texten"
- Läsaruppdrag (en figur ber läsaren göra något med boken) noteras alltid.

Skriv en fil per uppslag med Write-verktyget. Svara till sist bara med en kort rad per uppslag (nummer, typ, ungefärligt antal ord brödtext).
