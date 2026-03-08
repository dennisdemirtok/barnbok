'use client';

import { useState, useEffect } from 'react';
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
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showRegistry, setShowRegistry] = useState(false);
  const [savedChars, setSavedChars] = useState<SavedCharacter[]>([]);
  const [saveMessage, setSaveMessage] = useState('');

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
      console.error('Kunde inte ladda sparade karaktarer:', err);
    }
  };

  const generateCharacterImage = async (charId: string) => {
    const char = chars.find(c => c.id === charId);
    if (!char) return;

    setGeneratingId(charId);
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
      setError(err instanceof Error ? err.message : 'Nagot gick fel');
    } finally {
      setGeneratingId(null);
    }
  };

  const generateAll = async () => {
    for (const char of chars) {
      if (!char.referenceImage) {
        await generateCharacterImage(char.id);
      }
    }
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
      setError('Kunde inte spara karaktaren');
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
      console.error('Kunde inte ta bort karaktaren:', err);
    }
  };

  const allApproved = chars.every(c => c.approved && c.referenceImage);
  const anyGenerated = chars.some(c => c.referenceImage);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Steg 2: Godkann karaktarer
          </h2>
          <p className="text-gray-600">
            Redigera detaljer, generera referensbilder och godkann varje karaktar.
          </p>
        </div>
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
          Tillbaka
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={generateAll}
          disabled={!!generatingId}
          className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700
                     disabled:bg-gray-400 transition-colors"
        >
          Generera alla karaktarer
        </button>
        <button
          onClick={() => setShowRegistry(!showRegistry)}
          className={`px-6 py-2 rounded-lg transition-colors flex items-center gap-2 ${
            showRegistry
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Karaktarsregister ({savedChars.length})
        </button>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-medium">
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Character Registry Panel */}
      {showRegistry && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-blue-800 text-lg">Sparade karaktarer</h3>
            <button
              onClick={() => setShowRegistry(false)}
              className="text-blue-500 hover:text-blue-700 text-sm"
            >
              Stang
            </button>
          </div>

          {savedChars.length === 0 ? (
            <p className="text-blue-600 text-sm py-4 text-center">
              Inga sparade karaktarer an. Godkann en karaktar och klicka &quot;Spara till register&quot; for att borja bygga ditt karaktarsbibliotek.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedChars.map(saved => (
                <div key={saved.id} className="bg-white rounded-lg border border-blue-100 overflow-hidden">
                  {/* Thumbnail */}
                  <div className="bg-gray-100 h-32 flex items-center justify-center">
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
                      <h4 className="font-bold text-gray-800 text-sm">
                        {saved.name}
                        {saved.heroName && (
                          <span className="text-purple-600 ml-1 font-normal">({saved.heroName})</span>
                        )}
                      </h4>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        saved.role === 'main' ? 'bg-blue-100 text-blue-700' :
                        saved.role === 'villain' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {saved.role === 'main' ? 'Huvud' : saved.role === 'villain' ? 'Skurk' : 'Bi'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-2">{saved.appearance}</p>
                    {saved.fromBookTitle && (
                      <p className="text-xs text-gray-400 mb-2">Fran: {saved.fromBookTitle}</p>
                    )}
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleImportFromRegistry(saved)}
                        className="flex-1 px-2 py-1.5 bg-blue-600 text-white text-xs rounded-lg
                                   hover:bg-blue-700 transition-colors font-medium"
                      >
                        Anvand i boken
                      </button>
                      <button
                        onClick={() => handleDeleteFromRegistry(saved.id)}
                        className="px-2 py-1.5 bg-red-100 text-red-600 text-xs rounded-lg
                                   hover:bg-red-200 transition-colors"
                        title="Ta bort fran registret"
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
              className={`border-2 rounded-xl overflow-hidden transition-colors ${
                char.approved
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-200 bg-white'
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
                            className="flex-1 px-2 py-1 border rounded text-lg font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                            placeholder="Namn"
                          />
                          <input
                            type="text"
                            value={char.heroName || ''}
                            onChange={(e) => updateCharField(char.id, 'heroName', e.target.value)}
                            className="w-32 px-2 py-1 border rounded text-sm text-purple-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-200"
                            placeholder="Hjaltenamn"
                          />
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={char.age || ''}
                            onChange={(e) => updateCharField(char.id, 'age', e.target.value)}
                            className="w-24 px-2 py-1 border rounded text-sm focus:border-blue-500"
                            placeholder="Alder"
                          />
                          <select
                            value={char.role}
                            onChange={(e) => updateCharField(char.id, 'role', e.target.value)}
                            className="px-2 py-1 border rounded text-sm focus:border-blue-500"
                          >
                            <option value="main">Huvudkaraktar</option>
                            <option value="supporting">Bikaraktar</option>
                            <option value="villain">Skurk</option>
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="text-lg font-bold text-gray-800">
                          {char.name}
                          {char.heroName && (
                            <span className="text-purple-600 ml-2">({char.heroName})</span>
                          )}
                        </h3>
                        <div className="flex items-center gap-2">
                          {char.age && (
                            <span className="text-sm text-gray-500">{char.age}</span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            char.role === 'main' ? 'bg-blue-100 text-blue-700' :
                            char.role === 'villain' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {char.role === 'main' ? 'Huvudkaraktar' :
                             char.role === 'villain' ? 'Skurk' : 'Bikaraktar'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setEditingId(isEditing ? null : char.id)}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      isEditing
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                      <label className="text-xs text-gray-500 font-medium">Utseende</label>
                      <textarea
                        value={char.appearance}
                        onChange={(e) => updateCharField(char.id, 'appearance', e.target.value)}
                        className="w-full h-20 px-2 py-1 border rounded text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-200 resize-y"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Vanliga klader</label>
                      <input
                        type="text"
                        value={char.normalClothes || ''}
                        onChange={(e) => updateCharField(char.id, 'normalClothes', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm focus:border-blue-500"
                        placeholder="T.ex. jeans och hoodie"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Superhjalteddrakt</label>
                      <input
                        type="text"
                        value={char.heroCostume || ''}
                        onChange={(e) => updateCharField(char.id, 'heroCostume', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm focus:border-blue-500"
                        placeholder="T.ex. bla cape med blixtlogo"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Personlighet</label>
                      <input
                        type="text"
                        value={char.personality || ''}
                        onChange={(e) => updateCharField(char.id, 'personality', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm focus:border-blue-500"
                        placeholder="T.ex. modig, nyfiken, lite busig"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Kraft/formaga</label>
                      <input
                        type="text"
                        value={char.power || ''}
                        onChange={(e) => updateCharField(char.id, 'power', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm focus:border-blue-500"
                        placeholder="T.ex. kan kontrollera blixtar"
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 line-clamp-3">
                    {char.appearance}
                  </p>
                )}
              </div>

              {/* Character image */}
              <div className="mx-4 mb-3 bg-gray-100 rounded-lg overflow-hidden" style={{ minHeight: '200px' }}>
                {generatingId === char.id ? (
                  <div className="flex items-center justify-center h-48">
                    <div className="text-center">
                      <svg className="animate-spin h-8 w-8 text-purple-600 mx-auto mb-2" viewBox="0 0 24 24">
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
                    Ingen bild genererad an
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="p-4 pt-0 flex gap-2 flex-wrap">
                <button
                  onClick={() => generateCharacterImage(char.id)}
                  disabled={!!generatingId}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg
                             hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {char.referenceImage ? 'Regenerera' : 'Generera'}
                </button>

                {char.referenceImage && (
                  <>
                    <button
                      onClick={() => toggleApproval(char.id)}
                      className={`flex-1 px-4 py-2 text-sm rounded-lg font-semibold transition-colors ${
                        char.approved
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      {char.approved ? 'Godkand ✓' : 'Godkann'}
                    </button>

                    {char.approved && (
                      <button
                        onClick={() => handleSaveToRegistry(char)}
                        className="px-3 py-2 bg-yellow-500 text-white text-sm rounded-lg
                                   hover:bg-yellow-600 transition-colors flex items-center gap-1"
                        title="Spara till karaktarsregistret"
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
            </div>
          );
        })}
      </div>

      {anyGenerated && (
        <div className="flex justify-end">
          <button
            onClick={() => onCharactersApproved(chars)}
            disabled={!allApproved}
            className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg
                       hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                       transition-colors"
          >
            {allApproved
              ? 'Fortsatt till sidgenerering'
              : `Godkann alla karaktarer forst (${chars.filter(c => c.approved).length}/${chars.length})`}
          </button>
        </div>
      )}
    </div>
  );
}
