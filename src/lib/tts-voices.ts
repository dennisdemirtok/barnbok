// Berättarröster för ljudbok. Nyckeln till ElevenLabs har bara rättighet att
// skapa tal, inte att lista röster, så listan är handplockad: först svenska
// röster ur röstbiblioteket, sedan de flerspråkiga standardrösterna som läser
// svenska med en viss brytning.
export interface NarratorVoice {
  id: string;
  name: string;
  description: string;
  gender: 'kvinna' | 'man';
  native: boolean; // svensk röst
}

export const NARRATOR_VOICES: NarratorVoice[] = [
  { id: 'kkwvaJeTPw4KK0sBdyvD', name: 'Anton', description: 'Lugn och varm - som när pappa läser', gender: 'man', native: true },
  { id: '4xkUqaR9MYOJHoaC1Nak', name: 'Elvira', description: 'Ljus och tydlig - passar kapitelböcker', gender: 'kvinna', native: true },
  { id: 'x0u3EW21dbrORJzOq1m9', name: 'Harald', description: 'Djup och trygg - passar godnattsagor', gender: 'man', native: true },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', description: 'Ljus och pigg', gender: 'kvinna', native: false },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Varm och berättande', gender: 'kvinna', native: false },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Georg', description: 'Djup och nyhetslugn', gender: 'man', native: false },
];

export const DEFAULT_VOICE_ID = NARRATOR_VOICES[0].id;

export function voiceById(id?: string): NarratorVoice {
  return NARRATOR_VOICES.find(v => v.id === id) || NARRATOR_VOICES[0];
}
