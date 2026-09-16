// Berättarröster för ljudbok. Nyckeln till ElevenLabs har bara rättighet att
// skapa tal, inte att lista röster, så listan är handplockad bland de röster
// som alla konton har. Alla läser svenska med den flerspråkiga modellen.
export interface NarratorVoice {
  id: string;
  name: string;
  description: string;
  gender: 'kvinna' | 'man';
}

export const NARRATOR_VOICES: NarratorVoice[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sara', description: 'Mjuk och lugn - passar godnattsagor', gender: 'kvinna' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Ljus och pigg - passar kapitelböcker', gender: 'kvinna' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Varm och berättande', gender: 'kvinna' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Georg', description: 'Djup och trygg - som en morfar som läser', gender: 'man' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Tydlig och nyhetslugn', gender: 'man' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', description: 'Ung och driven - passar äventyr', gender: 'man' },
];

export const DEFAULT_VOICE_ID = NARRATOR_VOICES[1].id;

export function voiceById(id?: string): NarratorVoice {
  return NARRATOR_VOICES.find(v => v.id === id) || NARRATOR_VOICES.find(v => v.id === DEFAULT_VOICE_ID)!;
}
