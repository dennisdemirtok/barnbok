'use client';

import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Character, SavedCharacter } from '@/lib/types';
import { saveCharacter, listSavedCharacters, deleteSavedCharacter } from '@/lib/storage';
import { STYLE_PRESETS, composeStyleGuide, getStylePreset } from '@/lib/styles';
import { CHARACTER_TEMPLATES, CharacterTemplate } from '@/lib/character-templates';
import Icon from './Icon';
import StepHeader from './StepHeader';
import StylePicker from './StylePicker';

interface Props {
  onBack: () => void;
}

// Stilen som referensbilden skapades i sparas på karaktären. IndexedDB lagrar
// hela objektet, så fältet följer med även innan SavedCharacter-typen har det.
type StudioCharacter = SavedCharacter & { stylePresetId?: string };

const ROLE_LABEL: Record<SavedCharacter['role'], string> = {
  main: 'Huvudkaraktär',
  supporting: 'Bikaraktär',
  villain: 'Skurk',
};

const LAST_STYLE_KEY = 'barnbok:character-studio-style';

function readLastStyle(): string {
  try {
    const id = localStorage.getItem(LAST_STYLE_KEY);
    if (id && getStylePreset(id)) return id;
  } catch {
    // localStorage kan vara blockerat - använd standardstilen
  }
  return STYLE_PRESETS[0].id;
}

function writeLastStyle(id: string) {
  try {
    localStorage.setItem(LAST_STYLE_KEY, id);
  } catch {
    // ignorera
  }
}

function emptyCharacter(): StudioCharacter {
  return {
    id: crypto.randomUUID(),
    name: '',
    heroName: '',
    age: '',
    appearance: '',
    normalClothes: '',
    heroCostume: '',
    personality: '',
    power: '',
    role: 'main',
    savedAt: '',
  };
}

// Tomma strängar sparas som undefined så att bildprompten inte får tomma rader
const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function hasHeroFields(c: StudioCharacter) {
  return !!(clean(c.heroName) || clean(c.heroCostume) || clean(c.power));
}

export default function CharacterStudio({ onBack }: Props) {
  const [characters, setCharacters] = useState<StudioCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // Editor
  const [editor, setEditor] = useState<{ draft: StudioCharacter; isNew: boolean; templateId?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const saved = (await listSavedCharacters()) as StudioCharacter[];
      saved.sort((a, b) => new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime());
      setCharacters(saved);
      setLoadError('');
    } catch (err) {
      console.error('Kunde inte ladda sparade karaktärer:', err);
      setLoadError('Kunde inte ladda dina karaktärer.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(prev => (prev === message ? '' : prev)), 3000);
  };

  const openNew = (template?: CharacterTemplate) => {
    const draft = emptyCharacter();
    setEditor({ draft: template ? applyTemplate(draft, template, '') : draft, isNew: true, templateId: template?.id });
  };

  const openEdit = (c: StudioCharacter) => {
    setEditor({ draft: { ...c }, isNew: false });
  };

  const handleDuplicate = async (c: StudioCharacter) => {
    const copy: StudioCharacter = {
      ...c,
      id: crypto.randomUUID(),
      name: `${c.name} (kopia)`,
      savedAt: new Date().toISOString(),
    };
    try {
      await saveCharacter(copy);
      await load();
      flash(`${c.name} kopierades`);
    } catch (err) {
      console.error('Kunde inte kopiera karaktären:', err);
      flash('Kunde inte kopiera karaktären');
    }
  };

  // Tvåstegsbekräftelse i stället för window.confirm
  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(prev => (prev === id ? null : prev)), 4000);
      return;
    }
    setConfirmDeleteId(null);
    try {
      await deleteSavedCharacter(id);
      setCharacters(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Kunde inte ta bort karaktären:', err);
      flash('Kunde inte ta bort karaktären');
    }
  };

  const handleSaved = async (saved: StudioCharacter) => {
    setEditor(null);
    await load();
    flash(`${saved.name} är sparad`);
  };

  return (
    <div className="space-y-8">
      <StepHeader
        eyebrow="Karaktärer"
        title="Dina karaktärer"
        description="Skapa figurer med egen referensbild, spara dem och återanvänd dem i vilken bok som helst."
        onBack={onBack}
        actions={
          <button onClick={() => openNew()} className="btn-action">
            <Icon name="add" size={20} /> Ny karaktär
          </button>
        }
      />

      {/* Snabbstart */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink/70 inline-flex items-center gap-1.5">
            <Icon name="bolt" size={18} className="text-brand" /> Snabbstart från mall
          </h3>
        </div>
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:flex-wrap gap-2 overflow-x-auto no-scrollbar pb-1">
          {CHARACTER_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => openNew(t)}
              className="chip shrink-0"
              title={t.description}
            >
              <Icon name={t.icon} size={18} /> {t.label}
            </button>
          ))}
        </div>
      </section>

      {notice && <div className="note-success animate-pop">{notice}</div>}
      {loadError && <div className="note-error">{loadError}</div>}

      {/* Sparade karaktärer */}
      <section className="space-y-4">
        {!loading && characters.length > 0 && (
          <p className="text-sm text-ink/50">
            {characters.length} {characters.length === 1 ? 'sparad karaktär' : 'sparade karaktärer'}
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton aspect-[4/5] rounded-3xl" />)}
          </div>
        ) : characters.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-ink/20 bg-white/60 px-6 py-14 text-center">
            <span className="w-14 h-14 mx-auto rounded-2xl bg-ink/[0.05] text-ink/60 flex items-center justify-center">
              <Icon name="groups" size={28} />
            </span>
            <h3 className="mt-4 text-xl font-heading font-bold text-ink">Inga karaktärer än</h3>
            <p className="mt-1 text-ink/55 max-w-md mx-auto">
              Börja från en mall ovan eller från noll. Karaktärer du sparar här - eller från en bok - kan du sedan välja när du skapar nya böcker.
            </p>
            <button onClick={() => openNew()} className="btn-primary mt-6">
              <Icon name="add" size={19} /> Skapa din första karaktär
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
            {characters.map(c => {
              const style = getStylePreset(c.stylePresetId);
              return (
                <div key={c.id} className="card-glass overflow-hidden flex flex-col">
                  <button
                    onClick={() => openEdit(c)}
                    className="relative block w-full aspect-[4/3] bg-paper overflow-hidden"
                    title={`Redigera ${c.name}`}
                  >
                    {c.referenceImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/png;base64,${c.referenceImage}`}
                        alt={c.name}
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    ) : (
                      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-ink/35">
                        <Icon name="person" size={34} />
                        <span className="text-xs font-medium">Ingen bild än</span>
                      </span>
                    )}
                    {style && (
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-white/90 border border-line text-[11px] font-medium text-ink/70">
                        <span className={`w-3 h-3 rounded-full bg-gradient-to-br ${style.swatch}`} />
                        <span className="max-w-[7rem] truncate">{style.label}</span>
                      </span>
                    )}
                  </button>

                  <div className="p-3 sm:p-4 flex-1 flex flex-col">
                    <h3 className="font-heading font-semibold text-ink leading-snug truncate" title={c.name}>
                      {c.name}
                      {c.heroName && <span className="text-brand font-normal"> ({c.heroName})</span>}
                    </h3>
                    <p className="text-xs text-ink/55 mt-0.5 truncate">
                      {[c.age, ROLE_LABEL[c.role]].filter(Boolean).join(' · ')}
                    </p>
                    {c.fromBookTitle && (
                      <p className="text-[11px] text-ink/40 mt-1 truncate inline-flex items-center gap-1" title={`Från boken ${c.fromBookTitle}`}>
                        <Icon name="auto_stories" size={13} /> {c.fromBookTitle}
                      </p>
                    )}

                    <div className="mt-auto pt-2 flex items-center justify-end -mr-1.5 gap-0.5">
                      <button onClick={() => openEdit(c)} title="Redigera" aria-label={`Redigera ${c.name}`} className="btn-icon !w-8 !h-8">
                        <Icon name="edit" size={17} />
                      </button>
                      <button onClick={() => handleDuplicate(c)} title="Duplicera" aria-label={`Duplicera ${c.name}`} className="btn-icon !w-8 !h-8">
                        <Icon name="content_copy" size={17} />
                      </button>
                      {confirmDeleteId === c.id ? (
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="px-2.5 h-8 rounded-full bg-red-600 text-white text-xs font-semibold animate-pop"
                        >
                          Ta bort?
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDelete(c.id)}
                          title="Ta bort"
                          aria-label={`Ta bort ${c.name}`}
                          className="btn-icon !w-8 !h-8 hover:!text-red-600 hover:!bg-red-50"
                        >
                          <Icon name="delete" size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editor && (
        <CharacterEditor
          key={editor.draft.id}
          initial={editor.draft}
          isNew={editor.isNew}
          initialTemplateId={editor.templateId}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// Fyller i alla fält från mallen. Namnet skrivs bara över om det är tomt eller
// fortfarande är föregående malls förslag (så ett eget namn inte försvinner).
function applyTemplate(draft: StudioCharacter, t: CharacterTemplate, previousTemplateName: string): StudioCharacter {
  const f = t.fields;
  const keepName = draft.name.trim() !== '' && draft.name !== previousTemplateName;
  return {
    ...draft,
    name: keepName ? draft.name : f.name,
    heroName: f.heroName || '',
    age: f.age,
    role: f.role,
    appearance: f.appearance,
    normalClothes: f.normalClothes,
    personality: f.personality,
    heroCostume: f.heroCostume || '',
    power: f.power || '',
  };
}

// ═══════════════════════════════════════════
//  Redigerare (modal)
// ═══════════════════════════════════════════

interface EditorProps {
  initial: StudioCharacter;
  isNew: boolean;
  initialTemplateId?: string;
  onClose: () => void;
  onSaved: (c: StudioCharacter) => void;
}

function CharacterEditor({ initial, isNew, initialTemplateId, onClose, onSaved }: EditorProps) {
  const [draft, setDraft] = useState<StudioCharacter>(initial);
  const [templateId, setTemplateId] = useState<string | undefined>(initialTemplateId);
  const [styleId, setStyleId] = useState<string>(() => initial.stylePresetId && getStylePreset(initial.stylePresetId) ? initial.stylePresetId : readLastStyle());
  const [showStyles, setShowStyles] = useState(false);
  const [showHero, setShowHero] = useState(() => hasHeroFields(initial));
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  // Osparade ändringar - varna innan redigeraren stängs
  const [dirty, setDirty] = useState(false);
  const requestRef = useRef(0);

  const style = getStylePreset(styleId) || STYLE_PRESETS[0];
  const imageStyle = getStylePreset(draft.stylePresetId);
  const styleMismatch = !!draft.referenceImage && !!draft.stylePresetId && draft.stylePresetId !== styleId;

  const update = <K extends keyof StudioCharacter>(field: K, value: StudioCharacter[K]) => {
    setDraft(prev => ({ ...prev, [field]: value }));
    setDirty(true);
    setSaveError('');
  };

  const pickTemplate = (t: CharacterTemplate) => {
    const prevName = CHARACTER_TEMPLATES.find(x => x.id === templateId)?.fields.name ?? '';
    setDraft(prev => applyTemplate(prev, t, prevName));
    setTemplateId(t.id);
    setDirty(true);
    setShowHero(!!(t.fields.heroCostume || t.fields.heroName || t.fields.power));
  };

  const requestClose = useCallback(() => {
    if (generating || saving) return;
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 4000);
      return;
    }
    requestRef.current++; // ignorera ev. pågående svar
    onClose();
  }, [dirty, confirmClose, generating, saving, onClose]);

  // Esc stänger, och sidan bakom scrollar inte medan modalen är öppen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const canGenerate = draft.appearance.trim().length > 0 && !generating;
  const canSave = draft.name.trim().length > 0 && draft.appearance.trim().length > 0 && !saving && !generating;

  const generateImage = async () => {
    if (!canGenerate) return;
    const reqId = ++requestRef.current;
    const usedStyle = style;
    setGenerating(true);
    setGenError('');

    const character: Character = {
      id: draft.id,
      name: clean(draft.name) || 'Karaktär',
      heroName: clean(draft.heroName),
      age: clean(draft.age),
      appearance: draft.appearance.trim(),
      normalClothes: clean(draft.normalClothes),
      heroCostume: clean(draft.heroCostume),
      personality: clean(draft.personality),
      power: clean(draft.power),
      role: draft.role,
      approved: false,
    };

    try {
      const res = await fetch('/api/generate-character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character, styleGuide: composeStyleGuide(usedStyle) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Generering misslyckades');
      if (!data.image) throw new Error('Ingen bild kom tillbaka');
      if (reqId !== requestRef.current) return;
      setDraft(prev => ({ ...prev, referenceImage: data.image, stylePresetId: usedStyle.id }));
      setDirty(true);
      writeLastStyle(usedStyle.id);
    } catch (err) {
      if (reqId !== requestRef.current) return;
      setGenError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      if (reqId === requestRef.current) setGenerating(false);
    }
  };

  const save = async () => {
    if (!canSave) {
      if (!draft.name.trim() || !draft.appearance.trim()) setSaveError('Fyll i namn och utseende först.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const toSave: StudioCharacter = {
      ...draft,
      name: draft.name.trim(),
      heroName: clean(draft.heroName),
      age: clean(draft.age),
      appearance: draft.appearance.trim(),
      normalClothes: clean(draft.normalClothes),
      heroCostume: clean(draft.heroCostume),
      personality: clean(draft.personality),
      power: clean(draft.power),
      // Utan bild: kom ihåg vald stil så nästa bild skapas i den
      stylePresetId: draft.referenceImage ? draft.stylePresetId || styleId : styleId,
      savedAt: new Date().toISOString(),
    };
    try {
      await saveCharacter(toSave);
      writeLastStyle(styleId);
      onSaved(toSave);
    } catch (err) {
      console.error('Kunde inte spara karaktären:', err);
      setSaveError('Kunde inte spara karaktären. Försök igen.');
      setSaving(false);
    }
  };

  const title = isNew ? 'Ny karaktär' : draft.name.trim() || 'Redigera karaktär';

  const imagePanel = (
    <div className="space-y-3">
      <div className="relative bg-paper rounded-2xl border border-line overflow-hidden aspect-[4/3]">
        {generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-brand">
            <span className="spinner !w-8 !h-8" />
            <p className="text-sm text-ink/55">Skapar referensbild... (~30 sek)</p>
          </div>
        ) : draft.referenceImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${draft.referenceImage}`}
            alt={draft.name || 'Referensbild'}
            className="absolute inset-0 w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center text-ink/40">
            <Icon name="portrait" size={36} />
            <p className="text-sm">Ingen referensbild än</p>
            <p className="text-xs text-ink/35">Beskriv utseendet och tryck på Skapa bild</p>
          </div>
        )}
      </div>

      {genError && !generating && <div className="note-error">{genError}</div>}
      {styleMismatch && !generating && (
        <div className="note-warning text-xs">
          Bilden är skapad i {imageStyle?.label || 'en annan stil'}. Skapa en ny bild för att få den i {style.label}.
        </div>
      )}

      <button
        onClick={generateImage}
        disabled={!canGenerate}
        className="btn-primary w-full"
        title={draft.appearance.trim() ? undefined : 'Fyll i utseende först'}
      >
        {generating ? (
          <><span className="spinner !w-4 !h-4" /> Skapar bild...</>
        ) : draft.referenceImage ? (
          <><Icon name="refresh" size={19} /> Skapa ny bild</>
        ) : (
          <><Icon name="auto_fix_high" filled size={19} /> Skapa bild</>
        )}
      </button>
      {!draft.appearance.trim() && (
        <p className="text-xs text-ink/45 text-center">Fyll i utseende för att kunna skapa en bild.</p>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 !m-0 bg-ink/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="bg-white w-full sm:max-w-4xl max-h-[94vh] sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl shadow-lift flex flex-col overflow-hidden animate-pop"
        onClick={e => e.stopPropagation()}
      >
        {/* Huvud */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-line">
          <div className="min-w-0">
            <p className="eyebrow">{isNew ? 'Skapa karaktär' : 'Redigera karaktär'}</p>
            <h3 className="font-heading text-xl font-bold text-ink truncate">{title}</h3>
          </div>
          <button onClick={requestClose} className="btn-icon shrink-0" aria-label="Stäng" disabled={generating || saving}>
            <Icon name="close" size={22} />
          </button>
        </div>

        {/* Innehåll */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
          {/* Mallar */}
          <section className="space-y-2">
            <p className="text-xs font-semibold text-ink/55 uppercase tracking-wide">Börja från en mall</p>
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:flex-wrap gap-2 overflow-x-auto no-scrollbar pb-1">
              {CHARACTER_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => pickTemplate(t)}
                  className={`${templateId === t.id ? 'chip-on' : 'chip'} shrink-0 !px-3 !py-1.5`}
                  title={t.description}
                  aria-pressed={templateId === t.id}
                >
                  <Icon name={t.icon} size={17} /> {t.label}
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            {/* Fält */}
            <div className="space-y-3 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-3">
                <Field label="Namn">
                  <input
                    type="text"
                    value={draft.name}
                    onChange={e => update('name', e.target.value)}
                    className="field py-2.5"
                    placeholder="T.ex. Elsa"
                    autoFocus={isNew && !initialTemplateId}
                  />
                </Field>
                <Field label="Ålder">
                  <input
                    type="text"
                    value={draft.age || ''}
                    onChange={e => update('age', e.target.value)}
                    className="field py-2.5"
                    placeholder="7 år"
                  />
                </Field>
              </div>

              <Field label="Roll" group>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(ROLE_LABEL) as SavedCharacter['role'][]).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => update('role', r)}
                      className={`${draft.role === r ? 'chip-on' : 'chip'} !px-3 !py-1.5`}
                      aria-pressed={draft.role === r}
                    >
                      {ROLE_LABEL[r]}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Utseende" hint="Hår, ögon, hy, kroppsbyggnad och speciella drag. För djur: art, päls/fjäll och färger.">
                <textarea
                  value={draft.appearance}
                  onChange={e => update('appearance', e.target.value)}
                  className="field py-2.5 h-28 resize-y text-sm"
                  placeholder="T.ex. flicka med rufsigt brunt hår i tofsar, gröna ögon och fräknar"
                />
              </Field>

              <Field label="Kläder">
                <input
                  type="text"
                  value={draft.normalClothes || ''}
                  onChange={e => update('normalClothes', e.target.value)}
                  className="field py-2.5 text-sm"
                  placeholder="T.ex. gul regnjacka, randig tröja och röda stövlar"
                />
              </Field>

              <Field label="Personlighet">
                <input
                  type="text"
                  value={draft.personality || ''}
                  onChange={e => update('personality', e.target.value)}
                  className="field py-2.5 text-sm"
                  placeholder="T.ex. modig, nyfiken, lite busig"
                />
              </Field>

              {/* Hjältefält, hopfällda */}
              <div className="rounded-2xl border border-line">
                <button
                  type="button"
                  onClick={() => setShowHero(v => !v)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-ink/75"
                  aria-expanded={showHero}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="bolt" size={18} className="text-brand" /> Hjälteläge
                    {!showHero && hasHeroFields(draft) && <span className="magic-chip !py-0.5">Ifyllt</span>}
                  </span>
                  <Icon name={showHero ? 'expand_less' : 'expand_more'} size={20} />
                </button>
                {showHero && (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-xs text-ink/50">Med en hjältedräkt ritas referensbilden i både vanliga kläder och dräkt.</p>
                    <Field label="Hjältenamn">
                      <input
                        type="text"
                        value={draft.heroName || ''}
                        onChange={e => update('heroName', e.target.value)}
                        className="field py-2.5 text-sm"
                        placeholder="T.ex. Blixten"
                      />
                    </Field>
                    <Field label="Hjältedräkt">
                      <input
                        type="text"
                        value={draft.heroCostume || ''}
                        onChange={e => update('heroCostume', e.target.value)}
                        className="field py-2.5 text-sm"
                        placeholder="T.ex. blå cape med blixtlogga"
                      />
                    </Field>
                    <Field label="Kraft/förmåga">
                      <input
                        type="text"
                        value={draft.power || ''}
                        onChange={e => update('power', e.target.value)}
                        className="field py-2.5 text-sm"
                        placeholder="T.ex. kan flyga"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>

            {/* Bild */}
            <div className="md:sticky md:top-0 md:self-start space-y-3">
              {imagePanel}
              <div className="rounded-2xl border border-line p-3 flex items-center gap-3">
                <span className={`w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br ${style.swatch}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-ink/45 leading-none">Bildstil</p>
                  <p className="text-sm font-semibold text-ink truncate mt-1">{style.label}</p>
                </div>
                <button type="button" onClick={() => setShowStyles(v => !v)} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0" aria-expanded={showStyles}>
                  {showStyles ? 'Klar' : 'Byt'}
                </button>
              </div>
            </div>
          </div>

          {showStyles && (
            <section className="space-y-2">
              <p className="text-xs font-semibold text-ink/55 uppercase tracking-wide">Stil för referensbilden</p>
              <StylePicker
                value={styleId}
                onChange={id => {
                  setStyleId(id);
                  setShowStyles(false);
                }}
              />
              <p className="text-xs text-ink/45">Välj samma stil som boken du tänker använda karaktären i, så blir figuren mest lik.</p>
            </section>
          )}
        </div>

        {/* Fot */}
        <div className="border-t border-line px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs min-h-[1rem]">
            {saveError ? (
              <span className="text-red-700 font-medium">{saveError}</span>
            ) : !draft.referenceImage ? (
              <span className="text-ink/45">Du kan spara utan bild och skapa den senare.</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              onClick={requestClose}
              disabled={generating || saving}
              className={`flex-1 sm:flex-none ${confirmClose ? 'inline-flex items-center justify-center px-4 py-2.5 rounded-full bg-red-600 text-white font-semibold text-sm animate-pop' : 'btn-ghost'}`}
            >
              {confirmClose ? 'Släng ändringar?' : 'Avbryt'}
            </button>
            <button onClick={save} disabled={saving || generating} className="btn-action flex-1 sm:flex-none">
              {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name="bookmark_add" filled size={19} />}
              Spara karaktär
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// group: knapprader får inte ligga i <label> (ett klick på etiketten skulle trycka på första knappen)
function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className="block" {...(group ? { role: 'group', 'aria-label': label } : {})}>
      <span className="block text-xs font-semibold text-ink/60 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink/40 mt-1 leading-snug">{hint}</span>}
    </Tag>
  );
}
