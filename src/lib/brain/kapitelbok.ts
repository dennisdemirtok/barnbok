// Hantverk för kapitelböcker, hämtat ur analyser av utgivna svenska kapitelböcker
// för 6-12 år (referensbocker/, scripts/hjarnan). Allt är formulerat med egna ord
// och egna exempel - inga meningar, namn eller figurer ur förlagorna.
//
// Varje regel motsvarar en mätbar skillnad mellan förlagorna och appens egna
// böcker (src/lib/text-fingerprint.ts), så att effekten går att mäta före och efter.

export type DialogueStyle = 'dash' | 'quotes';

// Repliker skrivs som boktypen gör: talstreck först i stycket eller citattecken
function say(style: DialogueStyle, line: string, tag?: string): string {
  if (style === 'quotes') return tag ? `”${line}”, ${tag}` : `”${line}”`;
  return tag ? `– ${line}, ${tag}` : `– ${line}`;
}

export function chapterCraft(style: DialogueStyle): string {
  return `HANTVERK FRÅN RIKTIGA KAPITELBÖCKER
Mätningar av utgivna svenska kapitelböcker visar var AI-text brukar skilja sig. Skriv så här:
- Låt dialogen bära scenerna. Mellan replikerna står korta handlingsrader, inte långa beskrivningar.
- Anföringar: "säger" högst ungefär varannan gång. Låt repliker stå utan anföring när det ändå framgår vem som pratar, eller låt en handling i stycket före visa talaren (Tilde slår igen boken. / ${say(style, 'Nu räcker det.')}). Välj verb som säger hur det låter (fyller i, avbryter, muttrar, väser, ropar), och använd ett sätt-adverb efter ("sa hon skarpt") bara någon gång ibland.
- Barnröst i replikerna: utrop, meningar som bryts av med tre punkter (…), en kompis som fyller i den andras mening, och småord som ju, väl, nog, ändå, faktiskt, alltså där de faller sig naturligt. Repliker får vara ofullständiga.
- Visa oftast känslor i kroppen och i handling: vad någon gör, säger eller hur kroppen reagerar. En kort handlingsrad som eget stycke räcker ofta (Moa ler stort.). Ett rakt och enkelt konstaterande (Malte blir sur.) går också bra ibland - men aldrig uppräknade känsloord eller förklaringar av hur någon känner sig.
- Varje sida och scen slutar så att man vill vända blad: en mening som fortsätter på nästa sida, en ny röst som hörs, en fråga, något som närmar sig, en komisk vändning. Variera sorten. Aldrig en sammanfattning, en lugn avrundning mitt i boken eller samma olycksbådande enradare om och om igen.
- Humor som barn gillar: ett skämt som kommer tillbaka och blir lite värre varje gång, en uppräkning som börjar sakligt och slutar i en tokig poäng, ordlekar, och en underdrift som nästa mening avslöjar.
- Varje figur pratar på sitt eget sätt: ordval, meningslängd, ett eget uttryck som kommer tillbaka. En skurk kan ha ett eget skratt eller påhittade svordomar i stället för riktiga.
- Lägg in något tidigt (ett föremål, en detalj, ett skämt) som betalar sig mot slutet.
- Hoppa över transportsträckor: börja scener mitt i handlingen eller efter att något redan har hänt.
- Ingen sensmoral: temat syns i det figurerna gör, och sista raden får gärna vara ett leende.`;
}

// Samma innehåll stolpigt och levande, med egna figurer och situationer
export function chapterContrasts(style: DialogueStyle): string {
  return `SÅ HÄR - INTE SÅ HÄR (exempel på hantverket, kopiera inte meningarna; snedstreck = nytt stycke)
- Stolpigt: Sixten blev väldigt rädd när han hörde ljudet. Han kände sig nervös och orolig.
  Levande: Det knakar i taket. Sixten drar upp täcket till näsan och räknar tyst till tio.
- Stolpigt: ${say(style, 'Vi måste hitta nyckeln innan mamma kommer hem', 'säger Ines.')} / ${say(style, 'Ja, vi måste hitta den snabbt', 'säger Omar.')}
  Levande: ${say(style, 'Om mamma kommer hem innan vi hittat nyckeln …')} / ${say(style, '… så får vi bo i förrådet', 'fyller Omar i.')}
- Stolpigt: De gick hem och åt middag. Det hade varit en spännande dag.
  Levande: De är nästan hemma när Tilde tvärstannar. Ytterdörren står på glänt. Och de låste, det är hon säker på …
- Stolpigt: ${say(style, 'Det är en mycket bra idé. Vi borde genomföra den direkt', 'sa Moa.')}
  Levande: Moa studsar upp. / ${say(style, 'Men det är ju genialt! Nu, direkt!')}
- Stolpigt: Och så lärde de sig att det är viktigt att vara snäll mot alla.
  Levande: Ivar tittar på den tomma syltburken. / ${say(style, 'Nästa gång tar vi med två.')}`;
}

// Dagboksromaner återger repliker indirekt - där gäller bara reglerna som inte handlar om dialog
export const DIARY_CRAFT = `HANTVERK FRÅN RIKTIGA KAPITELBÖCKER
- Visa känslor i kroppen och i handling, säg dem inte. Skriv vad berättaren gör eller hur kroppen reagerar.
- Varje inlägg slutar så att man vill läsa vidare: en plan som uppenbart kommer att gå fel, en torr kommentar, något som närmar sig. Variera sorten.
- Humor som barn gillar: ett skämt som kommer tillbaka och blir lite värre varje gång, en uppräkning som slutar i en tokig poäng, en underdrift som nästa mening avslöjar.
- Lägg in något tidigt som betalar sig mot slutet. Ingen sensmoral.`;
