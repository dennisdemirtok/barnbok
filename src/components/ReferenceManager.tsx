'use client';

import { useState, useEffect } from 'react';
import Icon from './Icon';
import {
  saveReferenceText,
  getReferenceTexts,
  saveReferenceImage,
  getReferenceImages,
  saveStyleProfile,
  getStyleProfile,
} from '@/lib/supabase-db';

const BOOK_SERIES_OPTIONS = [
  { value: 'superhjaltarna', label: 'Handbok för Superhjältar' },
  { value: 'luna', label: 'Luna (Karin Lemon)' },
  { value: 'harry-potter', label: 'Harry Potter' },
  { value: 'alfons', label: 'Alfons Åberg' },
  { value: 'pettson', label: 'Pettson & Findus' },
  { value: 'custom', label: 'Annan bokserie...' },
];

interface Props {
  onClose: () => void;
}

export default function ReferenceManager({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'texts' | 'images' | 'profiles'>('texts');
  const [bookSeries, setBookSeries] = useState('superhjaltarna');
  const [customSeries, setCustomSeries] = useState('');

  // Text form
  const [textSample, setTextSample] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [textType, setTextType] = useState<string>('narrative');
  const [styleNotes, setStyleNotes] = useState('');

  // Image form
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDescription, setImageDescription] = useState('');
  const [imageStyleNotes, setImageStyleNotes] = useState('');
  const [layoutType, setLayoutType] = useState('');

  // Profile form
  const [profileTextStyle, setProfileTextStyle] = useState('');
  const [profileImageStyle, setProfileImageStyle] = useState('');
  const [profileNotes, setProfileNotes] = useState('');

  // Lists
  const [savedTexts, setSavedTexts] = useState<any[]>([]);
  const [savedImages, setSavedImages] = useState<any[]>([]);

  // Status
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const currentSeries = bookSeries === 'custom' ? customSeries : bookSeries;

  useEffect(() => {
    loadData();
  }, [currentSeries]);

  const loadData = async () => {
    if (!currentSeries) return;
    try {
      const [texts, images, profile] = await Promise.all([
        getReferenceTexts(currentSeries, 20),
        getReferenceImages(currentSeries, 20),
        getStyleProfile(currentSeries),
      ]);
      setSavedTexts(texts);
      setSavedImages(images);
      if (profile) {
        setProfileTextStyle(profile.text_style || '');
        setProfileImageStyle(profile.image_style || '');
        setProfileNotes(profile.notes || '');
      }
    } catch (err) {
      console.error('Kunde inte ladda referensdata:', err);
    }
  };

  const handleSaveText = async () => {
    if (!textSample.trim() || !currentSeries) return;
    setSaving(true);
    try {
      await saveReferenceText({
        bookSeries: currentSeries,
        bookTitle: bookTitle || undefined,
        textSample,
        styleNotes: styleNotes || undefined,
        textType: textType as any,
      });
      setMessage('Text sparad!');
      setTextSample('');
      setBookTitle('');
      setStyleNotes('');
      await loadData();
    } catch (err) {
      setMessage('Kunde inte spara text');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSaveImage = async () => {
    if (!imageFile || !currentSeries) return;
    setSaving(true);
    try {
      const base64 = await fileToBase64(imageFile);
      await saveReferenceImage({
        bookSeries: currentSeries,
        description: imageDescription || undefined,
        imageBase64: base64,
        styleNotes: imageStyleNotes || undefined,
        layoutType: layoutType || undefined,
      });
      setMessage('Bild sparad!');
      setImageFile(null);
      setImageDescription('');
      setImageStyleNotes('');
      await loadData();
    } catch (err) {
      setMessage('Kunde inte spara bild');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSaveProfile = async () => {
    if (!currentSeries) return;
    setSaving(true);
    try {
      await saveStyleProfile({
        bookSeries: currentSeries,
        textStyle: profileTextStyle || undefined,
        imageStyle: profileImageStyle || undefined,
        notes: profileNotes || undefined,
      });
      setMessage('Stilprofil sparad!');
    } catch (err) {
      setMessage('Kunde inte spara profil');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div className="fixed inset-0 !m-0 bg-ink/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-3xl shadow-lift max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-pop">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-heading font-semibold text-ink">Referensdatabas</h2>
            <p className="text-xs text-ink/50">Texter, bilder och stilprofiler från riktiga böcker</p>
          </div>
          <button onClick={onClose} className="btn-icon" title="Stäng" aria-label="Stäng">
            <Icon name="close" size={22} />
          </button>
        </div>

        {/* Series selector */}
        <div className="px-5 py-3 border-b border-line bg-paper">
          <label className="text-xs font-semibold text-ink/60 mb-1.5 block">Bokserie</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={bookSeries}
              onChange={e => setBookSeries(e.target.value)}
              className="field !px-3 !py-2.5 text-sm sm:flex-1"
            >
              {BOOK_SERIES_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {bookSeries === 'custom' && (
              <input
                value={customSeries}
                onChange={e => setCustomSeries(e.target.value)}
                placeholder="Namn på bokserie..."
                className="field !px-3 !py-2.5 text-sm sm:flex-1"
              />
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line px-2">
          {(['texts', 'images', 'profiles'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-ink border-b-2 border-ink'
                  : 'text-ink/50 hover:text-ink/80 border-b-2 border-transparent'
              }`}
            >
              {tab === 'texts' ? `Texter (${savedTexts.length})` :
               tab === 'images' ? `Bilder (${savedImages.length})` :
               'Stilprofil'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {message && (
            <div className={`mb-4 ${message.includes('sparad') ? 'note-success' : 'note-error'}`}>
              {message}
            </div>
          )}

          {/* ─── TEXTS TAB ─── */}
          {activeTab === 'texts' && (
            <div className="space-y-4">
              <div className="p-4 bg-paper border border-line rounded-2xl space-y-3">
                <h3 className="font-heading font-semibold text-ink">Lägg till referenstext</h3>
                <input
                  value={bookTitle}
                  onChange={e => setBookTitle(e.target.value)}
                  placeholder="Boktitel (valfritt)"
                  className="field !px-3 !py-2.5 text-sm"
                />
                <textarea
                  value={textSample}
                  onChange={e => setTextSample(e.target.value)}
                  placeholder="Klistra in textexempel från boken..."
                  rows={5}
                  className="field !px-3 !py-2.5 text-sm"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={textType}
                    onChange={e => setTextType(e.target.value)}
                    className="field !px-3 !py-2.5 text-sm sm:!w-auto"
                  >
                    <option value="narrative">Berättande</option>
                    <option value="dialogue">Dialog</option>
                    <option value="description">Beskrivning</option>
                    <option value="opening">Öppning</option>
                    <option value="ending">Avslutning</option>
                  </select>
                  <input
                    value={styleNotes}
                    onChange={e => setStyleNotes(e.target.value)}
                    placeholder="Stilanteckningar (valfritt)"
                    className="field !px-3 !py-2.5 text-sm sm:flex-1"
                  />
                </div>
                <button
                  onClick={handleSaveText}
                  disabled={saving || !textSample.trim()}
                  className="btn-primary !py-2.5 text-sm"
                >
                  {saving ? 'Sparar...' : 'Spara text'}
                </button>
              </div>

              {/* Saved texts list */}
              <div className="space-y-2">
                {savedTexts.map(t => (
                  <div key={t.id} className="p-3 border border-line rounded-2xl text-sm">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium">{t.book_title || 'Utan titel'}</span>
                      <span className="text-xs text-ink/40 bg-ink/[0.05] px-2 py-0.5 rounded">
                        {t.text_type}
                      </span>
                    </div>
                    <p className="text-ink/65 text-xs line-clamp-3">{t.text_sample}</p>
                    {t.style_notes && (
                      <p className="text-xs text-ink/50 mt-1">Stil: {t.style_notes}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── IMAGES TAB ─── */}
          {activeTab === 'images' && (
            <div className="space-y-4">
              <div className="p-4 bg-paper border border-line rounded-2xl space-y-3">
                <h3 className="font-heading font-semibold text-ink">Ladda upp referensbild</h3>
                <p className="text-xs text-ink/55">
                  Ta skärmbilder från riktiga böcker för att lära systemet stilen.
                </p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => setImageFile(e.target.files?.[0] || null)}
                  className="w-full text-sm"
                />
                <input
                  value={imageDescription}
                  onChange={e => setImageDescription(e.target.value)}
                  placeholder="Beskrivning av bilden..."
                  className="field !px-3 !py-2.5 text-sm"
                />
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={imageStyleNotes}
                    onChange={e => setImageStyleNotes(e.target.value)}
                    placeholder="Stilanteckningar..."
                    className="field !px-3 !py-2.5 text-sm sm:flex-1"
                  />
                  <input
                    value={layoutType}
                    onChange={e => setLayoutType(e.target.value)}
                    placeholder="Layouttyp..."
                    className="field !px-3 !py-2.5 text-sm sm:flex-1"
                  />
                </div>
                <button
                  onClick={handleSaveImage}
                  disabled={saving || !imageFile}
                  className="btn-primary !py-2.5 text-sm"
                >
                  {saving ? 'Laddar upp...' : 'Spara bild'}
                </button>
              </div>

              {/* Saved images grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {savedImages.map(img => (
                  <div key={img.id} className="border border-line rounded-2xl overflow-hidden">
                    <img
                      src={img.image_url}
                      alt={img.description || 'Referensbild'}
                      className="w-full aspect-[4/3] object-cover"
                    />
                    <div className="p-2 text-xs">
                      <p className="text-ink/80 truncate">{img.description || 'Ingen beskrivning'}</p>
                      {img.style_notes && (
                        <p className="text-ink/50 truncate">{img.style_notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── STYLE PROFILE TAB ─── */}
          {activeTab === 'profiles' && (
            <div className="space-y-4">
              <div className="p-4 bg-paper border border-line rounded-2xl space-y-3">
                <h3 className="font-heading font-semibold text-ink">
                  Stilprofil för {BOOK_SERIES_OPTIONS.find(o => o.value === bookSeries)?.label || currentSeries}
                </h3>
                <p className="text-xs text-ink/55">
                  Sammanfatta den typiska stilen för denna bokserie. Används som
                  grund när systemet genererar nya böcker.
                </p>
                <div>
                  <label className="text-xs font-medium text-ink/65">Textstil</label>
                  <textarea
                    value={profileTextStyle}
                    onChange={e => setProfileTextStyle(e.target.value)}
                    placeholder="Beskriv textstilen: t.ex. 'Korta meningar, mycket dialog, homoristisk ton, ordlekar...'"
                    rows={3}
                    className="field !px-3 !py-2.5 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/65">Bildstil</label>
                  <textarea
                    value={profileImageStyle}
                    onChange={e => setProfileImageStyle(e.target.value)}
                    placeholder="Beskriv bildstilen: t.ex. 'Comic/manga-stil, starka konturer, livfulla färger, pratbubblor...'"
                    rows={3}
                    className="field !px-3 !py-2.5 text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink/65">Övrigt</label>
                  <textarea
                    value={profileNotes}
                    onChange={e => setProfileNotes(e.target.value)}
                    placeholder="Andra anteckningar om serien..."
                    rows={2}
                    className="field !px-3 !py-2.5 text-sm mt-1"
                  />
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="btn-primary !py-2.5 text-sm"
                >
                  {saving ? 'Sparar...' : 'Spara stilprofil'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper: file to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // Remove data:image/...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
