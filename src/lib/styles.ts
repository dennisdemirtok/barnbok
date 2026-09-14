// Gemensamma bildstilar för "Skapa ny bok" och stilprovningen.
// `series` pekar på en analyserad stilprofil i barnbok_style_profiles - finns
// profilen används dess kalibrerade bildstil, annars används `value`.

export interface StylePreset {
  id: string;
  label: string;
  series?: string;
  value: string;
  // Tailwind-gradient för stilens färgmarkering i UI:t
  swatch: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'handbok',
    label: 'Handbok för Superhjältar',
    series: 'Handbok for Superhjaltar',
    value: 'Färgglatt, manga/comic-stil med stora uttrycksfulla ögon, tjocka konturer, detaljerade bakgrunder, skandinavisk estetik. Liknande "Handbok för Superhjältar".',
    swatch: 'from-indigo-600 to-fuchsia-500',
  },
  {
    id: 'luna',
    label: 'Luna',
    series: 'Luna',
    value: 'Mjuk, varm skandinavisk bilderboksstil med fina konturer och dämpade färger. Liknande "Luna"-böckerna.',
    swatch: 'from-sky-800 to-teal-500',
  },
  {
    id: 'knyckertz',
    label: 'Familjen Knyckertz',
    series: 'Familjen Knyckertz',
    value: 'Humoristisk, busig skandinavisk serie- och bilderboksstil i andan av "Familjen Knyckertz": lösa, energiska tuschlinjer, karikatyrmässigt överdrivna figurer med stora uttrycksfulla miner och långa, gängliga kroppar, varma mättade färger och massor av roliga små detaljer i bakgrunden. Livlig, lekfull komposition med en spännande, lite deckaraktig stämning.',
    swatch: 'from-orange-500 to-red-600',
  },
  {
    id: 'mammamu',
    label: 'Mamma Mu (akvarell)',
    series: 'Mamma Mu',
    value: 'Klassisk skandinavisk tusch- och akvarellstil med fina svarta konturer, varma naturfärger och mjuka vinjetter mot vit bakgrund. Liknande "Mamma Mu".',
    swatch: 'from-lime-600 to-amber-600',
  },
  {
    id: 'disney',
    label: 'Tecknad/Disney',
    value: 'Tecknad stil liknande moderna Disney/Pixar-filmer, varm belysning, uttrycksfulla karaktärer, detaljerade miljöer.',
    swatch: 'from-blue-500 to-violet-500',
  },
  {
    id: 'minimalistisk',
    label: 'Minimalistisk',
    value: 'Enkel, minimalistisk stil med platta färger, geometriska former och mycket vitt utrymme.',
    swatch: 'from-stone-400 to-stone-600',
  },
];

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find(s => s.id === id);
}
