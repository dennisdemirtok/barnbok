'use client';

import { useState, useEffect, useRef } from 'react';
import { Character, SavedCharacter } from '@/lib/types';
import { saveCharacter, listSavedCharacters, deleteSavedCharacter } from '@/lib/storage';

interface Props {
  characters: Character[];
  styleGuide: string;
  bookId?: string;
  bookTitle?: string;
  onCharactersApproved: (characters: Character[]) => void;
  onBack: () => void;
}

export default function CharacterApproval({ characters, styleGuide, bookId, bookTitle, onCharactersApproved, onBack }: Props) {
  const [chars, setChars] = useState<Character[]>(characters);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const abortRef = useRef(false);

  const isGenerating = generatingIds.size > 0;
  const BATCH_SIZE = 3;
  const [error, setError] = useState('');
  const [showRegistry, setShowRegistry] = useState(false);
  const [savedChars, setSavedChars] = useState<SavedCharacter[]>([]);
  const [saveMessage, setSaveMessage] = useState('');
  const [mappingCharId, setMappingCharId] = useState<string | null>(null);

  // Sync with prop changes when navigating back/forward between steps
  // This ensures that if the user goes back to import, re-parses, and comes back,
  // the updated characters are reflected
  useEffect(() => {
    setChars(characters);
  }, [characters]);

  // Load saved characters on mount
  useEffect(() => {
    loadSavedCharacters();
  }, []);

  const loadSavedCharacters = async () => {
    try {
      const saved = await listSavedCharacters();
      setSavedChars(saved);
    } catch (err) {
      console.error('Kunde inte ladda sparade karaktärer:', err);
    }
  };

  const generateCharacterImage = async (charId: string) => {
    const char = chars.find(c => c.id === charId);
    if (!char) return;

    setGeneratingIds(prev => new Set(prev).add(charId));
    setError('');

    try {
      const res = await fetch('/api/generate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character: char, styleGuide }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Generering misslyckades');
      }

      const { image } = await res.json();

      setChars(prev => prev.map(c =>
        c.id === charId ? { ...c, referenceImage: image } : c
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(charId);
        return next;
      });
    }
  };

  const generateAll = async () => {
    abortRef.current = false;
    setError('');

    const pending = chars.filter(c => !c.referenceImage);
    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (abortRef.current) break;

      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map(c => c.id);

      // Mark all in this batch as generating
      setGeneratingIds(prev => {
        const next = new Set(prev);
        batchIds.forEach(id => next.add(id));
        return next;
      });

      try {
        const res = await fetch('/api/generate-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: true, characters: batch, styleGuide }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Batch-generering misslyckades');
        }

        const { results } = await res.json() as {
          results: Array<{ id: string; image?: string; error?: string }>;
        };

        // Update each character with its result
        for (const result of results) {
          if (result.image) {
            setChars(prev => prev.map(c =>
              c.id === result.id ? { ...c, referenceImage: result.image } : c
            ));
          } else if (result.error) {
            console.error(`Karaktär ${result.id} misslyckades:`, result.error);
          }
        }
      } catch (err) {
        if (!abortRef.current) {
          setError(err instanceof Error ? err.message : 'Något gick fel');
        }
      } finally {
        // Remove this batch from generating set
        setGeneratingIds(prev => {
          const next = new Set(prev);
          batchIds.forEach(id => next.delete(id));
          return next;
        });
      }
    }
  };

  const stopGeneration = () => {
    abortRef.current = true;
  };

  const toggleApproval = (charId: string) => {
    setChars(prev => prev.map(c =>
      c.id === charId ? { ...c, approved: !c.approved } : c
    ));
  };

  const updateCharField = (charId: string, field: keyof Character, value: string) => {
    setChars(prev => prev.map(c =>
      c.id === charId ? { ...c, [field]: value } : c
    ));
  };

  // Save character to registry
  const handleSaveToRegistry = async (char: Character) => {
    try {
      const savedChar: SavedCharacter = {
        id: `saved-${char.id}-${Date.now()}`,
        name: char.name,
        heroName: char.heroName,
        age: char.age,
        appearance: char.appearance,
        normalClothes: char.normalClothes,
        heroCostume: char.heroCostume,
        personality: char.personality,
        power: char.power,
        role: char.role,
        referenceImage: char.referenceImage,
        savedAt: new Date().toISOString(),
        fromBookId: bookId,
        fromBookTitle: bookTitle,
      };
      await saveCharacter(savedChar);
      await loadSavedCharacters();
      setSaveMessage(`${char.name} sparad i registret!`);
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      setError('Kunde inte spara karaktären');
    }
  };

  // Import character from registry into current book
  const handleImportFromRegistry = (saved: SavedCharacter) => {
    const newChar: Character = {
      id: `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: saved.name,
      heroName: saved.heroName,
      age: saved.age,
      appearance: saved.appearance,
      normalClothes: saved.normalClothes,
      heroCostume: saved.heroCostume,
      personality: saved.personality,
      power: saved.power,
      role: saved.role,
      referenceImage: saved.referenceImage,
      approved: !!saved.referenceImage, // Auto-approve if has image
    };
    setChars(prev => [...prev, newChar]);
    setShowRegistry(false);
  };

  // Delete from registry
  const handleDeleteFromRegistry = async (id: string) => {
    try {
      await deleteSavedCharacter(id);
      await loadSavedCharacters();
    } catch (err) {
      console.error('Kunde inte ta bort karaktären:', err);
    }
  };

  // Map a saved character's visual data onto an existing book character
  // Keeps the book character's name/role (identity from text) but copies image + appearance
  const handleMapFromRegistry = (targetCharId: string, saved: SavedCharacter) => {
    setChars(prev => prev.map(c =>
      c.id === targetCharId
        ? {
            ...c,
            referenceImage: saved.referenceImage,
            appearance: saved.appearance,
            normalClothes: saved.normalClothes || c.normalClothes,
            heroCostume: saved.heroCostume || c.heroCostume,
            personality: saved.personality || c.personality,
            power: saved.power || c.power,
            approved: !!saved.referenceImage,
          }
        : c
    ));
    setMappingCharId(null);
    setSaveMessage(`Sparad karaktär kopplad till ${chars.find(c => c.id === targetCharId)?.name || 'karaktären'}!`);
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const allApproved = chars.every(c => c.approved && c.referenceImage);
  const anyGenerated = chars.some(c => c.referenceImage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold brand-text mb-2">
            Steg 2: Godkänn karaktärer
          </h2>
          <p className="text-gray-600">
            Redigera detaljer, generera referensbilder och godkänn varje karaktär.
          </p>
        </div>
        <button onClick={onBack} className="text-brand/70 hover:text-brand font-heading font-semibold transition-colors">
          Tillbaka
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={generateAll}
          disabled={isGenerating}
          className="btn-primary"
        >
          {isGenerating
            ? `Genererar ${generatingIds.size} referensbilder... (~30 sek/bild)`
            : 'Generera alla karaktärer'}
        </button>
        {isGenerating && (
          <button
            onClick={stopGeneration}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-red-600 text-white font-heading font-bold shadow-glow hover:bg-red-700 hover:-translate-y-0.5 transition-all"
          >
            Stoppa
          </button>
        )}
        <button
          onClick={() => setShowRegistry(!showRegistry)}
          className={`inline-flex items-center gap-2 transition-all ${
            showRegistry
              ? 'btn-primary'
              : 'btn-ghost'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Karaktärsregister ({savedChars.length})
        </button>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-sm font-medium">
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700">
          {error}
        </div>
      )}

      {/* Character Registry Panel */}
      {showRegistry && (
        <div className="glass rounded-4xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-bold brand-text text-lg">Sparade karaktärer</h3>
            <button
              onClick={() => setShowRegistry(false)}
              className="text-brand/60 hover:text-brand text-sm font-semibold transition-colors"
            >
              Stäng
            </button>
          </div>

          {savedChars.length === 0 ? (
            <p className="text-brand/70 text-sm py-4 text-center">
              Inga sparade karaktärer än. Godkänn en karaktär och klicka &quot;Spara till register&quot; för att börja bygga ditt karaktärsbibliotek.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedChars.map(saved => (
                <div key={saved.id} className="card-glass rounded-2xl overflow-hidden">
                  {/* Thumbnail */}
                  <div className="bg-brand/5 h-32 flex items-center justify-center">
                    {saved.referenceImage ? (
                      <img
                        src={`data:image/png;base64,${saved.referenceImage}`}
                        alt={saved.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-gray-400 text-sm">Ingen bild</span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-heading font-bold text-gray-800 text-sm">
                        {saved.name}
                        {saved.heroName && (
                          <span className="text-magic ml-1 font-normal">({saved.heroName})</span>
                        )}
                      </h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        saved.role === 'main' ? 'bg-brand/10 text-brand ring-1 ring-brand/15' :
                        saved.role === 'villain' ? 'bg-red-100 text-red-700' :
                        'bg-magic/10 text-magic ring-1 ring-magic/15'
                      }`}>
                        {saved.role === 'main' ? 'Huvud' : saved.role === 'villain' ? 'Skurk' : 'Bi'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-2">{saved.appearance}</p>
                    {saved.fromBookTitle && (
                      <p className="text-xs text-gray-400 mb-2">Från: {saved.fromBookTitle}</p>
                    )}
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleImportFromRegistry(saved)}
                        className="flex-1 px-3 py-1.5 bg-gradient-to-r from-brand to-magic text-white text-xs rounded-full
                                   shadow-glow hover:shadow-glow-lg transition-all font-heading font-bold"
                      >
                        Använd i boken
                      </button>
                      <button
                        onClick={() => handleDeleteFromRegistry(saved.id)}
                        className="px-2 py-1.5 bg-red-100 text-red-600 text-xs rounded-full
                                   hover:bg-red-200 transition-colors"
                        title="Ta bort från registret"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Character cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {chars.map(char => {
          const isEditing = editingId === char.id;

          return (
            <div
              key={char.id}
              className={`card-glass overflow-hidden ${
                char.approved
                  ? 'ring-2 ring-emerald-400/70 shadow-glow-lg'
                  : ''
              }`}
            >
              {/* Header */}
              <div className="p-4 pb-0">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={char.name}
                            onChange={(e) => updateCharField(char.id, 'name', e.target.value)}
                            className="field flex-1 py-2 text-lg font-heading font-bold"
                            placeholder="Namn"
                          />
                          <input
                            type="text"
                            value={char.heroName || ''}
                            onChange={(e) => updateCharField(char.id, 'heroName', e.target.value)}
                            className="field w-32 py-2 text-sm text-magic"
                            placeholder="Hjältenamn"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={char.age || ''}
                            onChange={(e) => updateCharField(char.id, 'age', e.target.value)}
                            className="field w-24 py-2 text-sm"
                            placeholder="Ålder"
                          />
                          <select
                            value={char.role}
                            onChange={(e) => updateCharField(char.id, 'role', e.target.value)}
                            className="field py-2 text-sm"
                          >
                            <option value="main">Huvudkaraktär</option>
                            <option value="supporting">Bikaraktär</option>
                            <option value="villain">Skurk</option>
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-heading font-bold text-gray-800">
                          {char.name}
                          {char.heroName && (
                            <span className="text-magic ml-2">({char.heroName})</span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2">
                          {char.age && (
                            <span className="text-sm text-gray-500">{char.age}</span>
                          )}
                          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                            char.role === 'main' ? 'bg-brand/10 text-brand ring-1 ring-brand/15' :
                            char.role === 'villain' ? 'bg-red-100 text-red-700' :
                            'bg-magic/10 text-magic ring-1 ring-magic/15'
                          }`}>
                            {char.role === 'main' ? 'Huvudkaraktär' :
                             char.role === 'villain' ? 'Skurk' : 'Bikaraktär'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setEditingId(isEditing ? null : char.id)}
                    className={`px-4 py-1.5 text-xs rounded-full font-heading font-semibold transition-all ${
                      isEditing
                        ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                        : 'text-brand border border-brand/30 bg-white/60 hover:bg-white hover:border-brand/50'
                    }`}
                  >
                    {isEditing ? 'Klar' : 'Redigera'}
                  </button>
                </div>
              </div>

              {/* Editable details */}
              <div className="px-4 pb-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-brand/70 font-heading font-semibold">Utseende</label>
                      <textarea
                        value={char.appearance}
                        onChange={(e) => updateCharField(char.id, 'appearance', e.target.value)}
                        className="field h-20 py-2 text-sm resize-y"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand/70 font-heading font-semibold">Vanliga kläder</label>
                      <input
                        type="text"
                        value={char.normalClothes || ''}
                        onChange={(e) => updateCharField(char.id, 'normalClothes', e.target.value)}
                        className="field py-2 text-sm"
                        placeholder="T.ex. jeans och hoodie"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand/70 font-heading font-semibold">Superhjältedräkt</label>
                      <input
                        type="text"
                        value={char.heroCostume || ''}
                        onChange={(e) => updateCharField(char.id, 'heroCostume', e.target.value)}
                        className="field py-2 text-sm"
                        placeholder="T.ex. bla cape med blixtlogo"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand/70 font-heading font-semibold">Personlighet</label>
                      <input
                        type="text"
                        value={char.personality || ''}
                        onChange={(e) => updateCharField(char.id, 'personality', e.target.value)}
                        className="field py-2 text-sm"
                        placeholder="T.ex. modig, nyfiken, lite busig"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-brand/70 font-heading font-semibold">Kraft/förmåga</label>
                      <input
                        type="text"
                        value={char.power || ''}
                        onChange={(e) => updateCharField(char.id, 'power', e.target.value)}
                        className="field py-2 text-sm"
                        placeholder="T.ex. kan kontrollera blixtar"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 line-clamp-3">
                      {char.appearance}
                    </p>
                    {(char.personality || char.power) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {char.personality && <span className="magic-chip">🎭 {char.personality}</span>}
                        {char.power && <span className="magic-chip">⚡ {char.power}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Character image */}
              <div className="mx-4 mb-3 bg-brand/5 rounded-2xl overflow-hidden" style={{ minHeight: '200px' }}>
                {generatingIds.has(char.id) ? (
                  <div className="flex items-center justify-center h-48">
                    <div className="text-center">
                      <svg className="animate-spin h-8 w-8 text-brand mx-auto mb-2" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-sm text-gray-500">Genererar...</p>
                    </div>
                  </div>
                ) : char.referenceImage ? (
                  <img
                    src={`data:image/png;base64,${char.referenceImage}`}
                    alt={char.name}
                    className="w-full object-contain max-h-80"
                  />
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-400">
                    Ingen bild genererad än
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="p-4 pt-0 flex gap-2 flex-wrap">
                <button
                  onClick={() => generateCharacterImage(char.id)}
                  disabled={isGenerating}
                  className="btn-primary flex-1 px-4 py-2 text-sm"
                >
                  {char.referenceImage ? 'Regenerera' : 'Generera'}
                </button>

                {/* Map from saved character button */}
                <button
                  onClick={() => setMappingCharId(mappingCharId === char.id ? null : char.id)}
                  className={`px-4 py-2 text-sm rounded-full transition-all flex items-center gap-1 font-heading font-semibold ${
                    mappingCharId === char.id
                      ? 'bg-gradient-to-r from-brand to-magic text-white shadow-glow'
                      : 'text-brand border border-brand/30 bg-white/60 hover:bg-white hover:border-brand/50'
                  }`}
                  title="Välj sparad karaktär från registret"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Välj sparad
             </button>

                {char.referenceImage && (
                  <>
                    <button
                      onClick={() => toggleApproval(char.id)}
                      className={`flex-1 px-4 py-2 text-sm rounded-full font-heading font-bold transition-all ${
                        char.approved
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-glow hover:shadow-glow-lg hover:-translate-y-0.5'
                          : 'text-emerald-700 border border-emerald-300 bg-emerald-50/60 hover:bg-emerald-50'
                      }`}
                    >
                      {char.approved ? 'Godkänd ✓' : 'Godkänn'}
                    </button>

                    {char.approved && (
                      <button
                        onClick={() => handleSaveToRegistry(char)}
                        className="btn-action px-4 py-2 text-sm"
                        title="Spara till karaktärsregistret"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                        Spara
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Inline saved character picker */}
              {mappingCharId === char.id && (
                <div className="mx-4 mb-4 p-4 glass rounded-2xl">
                  <p className="text-sm font-heading font-semibold text-brand mb-2">
                    Välj sparad karaktär för {char.name}:
                  </p>
                  {savedChars.filter(sc => sc.referenceImage).length > 0 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {savedChars.filter(sc => sc.referenceImage).map(saved => (
                        <button
                          key={saved.id}
                          onClick={() => handleMapFromRegistry(char.id, saved)}
                          className="border-2 border-white/60 bg-white/60 rounded-2xl overflow-hidden hover:border-brand/40 hover:shadow-glow
                                     transition-all text-left"
                        >
                          <img
                            src={`data:image/png;base64,${saved.referenceImage}`}
                            alt={saved.name}
                            className="w-full h-20 object-contain bg-brand/5"
                          />
                          <div className="p-1.5">
                            <p className="text-xs font-medium text-gray-800 truncate">{saved.name}</p>
                            {saved.fromBookTitle && (
                              <p className="text-[10px] text-gray-400 truncate">{saved.fromBookTitle}</p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-brand/70 text-center py-2">
                      Inga sparade karaktärer med bilder. Godkänn en karaktär och spara den först.
                    </p>
                  )}
                  <button
                    onClick={() => setMappingCharId(null)}
                    className="mt-2 text-xs text-brand/60 hover:text-brand font-semibold transition-colors"
                  >
                    Avbryt
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {anyGenerated && (
        <div className="flex justify-end">
          <button
            onClick={() => onCharactersApproved(chars)}
            disabled={!allApproved}
            className="btn-action px-8 py-3 disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none disabled:cursor-not-allowed"
          >
            {allApproved
              ? 'Fortsätt till sidgenerering'
              : `Godkänn alla karaktärer först (${chars.filter(c => c.approved).length}/${chars.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
