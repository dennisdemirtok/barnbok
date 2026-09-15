// Boktypernas språk som färdiga författarspråk. Beskrivningen kommer från
// boktypens textStyle (skriven med egna ord utifrån analys av förlagor) - inga citat.
import type { AuthorVoice, VoiceProfile } from './author-types';
import { STYLE_PRESETS } from './styles';

const TENSE: Record<string, VoiceProfile['tense']> = {
  knyckertz: 'presens',
  serie: 'presens',
  dagbok: 'preteritum',
};

export const BUILTIN_VOICES: AuthorVoice[] = STYLE_PRESETS
  .filter(p => p.book.textStyle)
  .map(p => ({
    id: `builtin:${p.id}`,
    name: `${p.label} – boktypens språk`,
    profile: {
      summary: p.book.textStyle!,
      tense: TENSE[p.id] ?? 'blandat',
      perspective: p.id === 'dagbok' ? 'Jagform, ett barn som skriver dagbok' : 'Tredje person nära huvudpersonen',
      sentenceRhythm: '',
      dialogue: p.book.dialogue === 'quotes' ? 'Repliker i egna stycken inom citattecken (”...”) med anföringen efter.' : '',
      // Citattecken är ingen radmarkering - lämnas tom så att repliker skrivs som beskrivet
      dialogueMarker: p.book.dialogue === 'quotes' ? '' : '– ',
      vocabulary: '',
      emotions: '',
      details: '',
      humor: '',
      pacing: '',
      signatureMoves: [],
      avoid: ['Figurer, namn, platser eller repliker från de böcker boktypen är inspirerad av'],
    },
    samples: [],
    sourceTitle: 'Stilbanken',
    createdAt: '2026-09-15T00:00:00.000Z',
  }));

export function isBuiltinVoice(id?: string): boolean {
  return !!id && id.startsWith('builtin:');
}
