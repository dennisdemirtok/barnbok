'use client';

import { ChangeEvent, DragEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Character, SavedCharacter } from '@/lib/types';
import { saveCharacter } from '@/lib/storage';
import { STYLE_PRESETS, composeStyleGuide, getStylePreset } from '@/lib/styles';
import { postJson } from '@/lib/fetch-json';
import StyleThumb from './StyleThumb';
import Icon from './Icon';

// Karaktär från foto: föräldern laddar upp foton på sitt barn, får utkast av
// barnet som figur i bokens bildstilar och sparar den stil hen gillar mest.
// Fotona finns bara i minnet medan panelen är öppen och sparas aldrig.

interface Props {
  onClose: () => void;
  onSaved: (c: SavedCharacter) => void;
}

type Step = 'photos' | 'about' | 'styles' | 'save';
type Role = 'main' | 'supporting';

interface Photo {
  id: string;
  // Samma fil ska inte kunna läggas till två gånger
  sourceKey: string;
  // Nerskalad JPEG i base64, utan data:-prefix
  data: string;
}

interface PhotoPayload {
  data: string;
  mimeType: 'image/jpeg';
}

interface Form {
  name: string;
  age: string;
  role: Role;
  appearance: string;
  normalClothes: string;
}

type AutoFields = Pick<Form, 'age' | 'appearance' | 'normalClothes'>;

type DraftStatus = 'queued' | 'generating' | 'done' | 'error';

interface Draft {
  status: DraftStatus;
  jobId: number;
  startedAt?: number;
  // Senaste lyckade bilden - ligger kvar medan en ny ritas och om den misslyckas
  image?: string;
  faceNotes?: string;
  error?: string;
  // Vilka foton och uppgifter bilden ritades med
  inputKey?: string;
}

interface Job {
  styleId: string;
  jobId: number;
  character: Character;
  photos: PhotoPayload[];
  inputKey: string;
}

const MAX_PHOTOS = 4;
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;
const PARALLEL = 3;
const SECONDS_PER_STYLE = 20;

const STEPS: { key: Step; label: string }[] = [
  { key: 'photos', label: 'Foton' },
  { key: 'about', label: 'Om barnet' },
  { key: 'styles', label: 'Stilar' },
  { key: 'save', label: 'Spara' },
];

const ROLE_LABEL: Record<Role, string> = {
  main: 'Huvudkaraktär',
  supporting: 'Bikaraktär',
};

const EMPTY_FORM: Form = { name: '', age: '', role: 'main', appearance: '', normalClothes: '' };

// ═══════════════════════════════════════════
//  Fotohantering i webbläsaren
// ═══════════════════════════════════════════

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

function photoErrorMessage(file: File): string {
  if (isHeic(file)) {
    return `${file.name} är sparad i iPhones HEIC-format, som den här webbläsaren inte kan öppna. Spara bilden som JPG och välj den igen.`;
  }
  return `${file.name} gick inte att öppna. Prova med en JPG- eller PNG-bild.`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bilden gick inte att avkoda'));
    img.src = url;
  });
}

// Skalar ner till högst 1024 px på längsta sidan och gör om till JPEG, så att
// anropen blir små. Webbläsaren vänder bilden rätt efter kamerans EXIF-uppgifter.
async function prepareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('Tom bild');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    // Halvera i steg: en enda kraftig nedskalning gör små detaljer i ansiktet kantiga
    let source: CanvasImageSource = img;
    let sw = w;
    let sh = h;
    while (sw >= tw * 2 && sh >= th * 2) {
      const half = document.createElement('canvas');
      canvases.push(half);
      half.width = Math.round(sw / 2);
      half.height = Math.round(sh / 2);
      const hctx = half.getContext('2d');
      if (!hctx) break;
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(source, 0, 0, half.width, half.height);
      source = half;
      sw = half.width;
      sh = half.height;
    }

    const canvas = document.createElement('canvas');
    canvases.push(canvas);
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas saknas');
    // Genomskinliga PNG:er får vit bakgrund i stället för svart
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tw, th);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, tw, th);
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (!data) throw new Error('Tom bild');
    return data;
  } finally {
    URL.revokeObjectURL(url);
    // Frigör minnet direkt - Safari på iPhone har en snål gräns för canvas
    for (const c of canvases) {
      c.width = 0;
      c.height = 0;
    }
  }
}

const toPayload = (p: Photo): PhotoPayload => ({ data: p.data, mimeType: 'image/jpeg' });

// Utkast som ritades med andra foton eller en annan beskrivning märks upp
const inputKeyOf = (photos: Photo[], f: Form) =>
  JSON.stringify([photos.map(p => p.id), f.age.trim(), f.appearance.trim(), f.normalClothes.trim()]);

function estimateText(count: number): string {
  const seconds = Math.ceil(count / PARALLEL) * SECONDS_PER_STYLE;
  if (seconds < 60) return `ca ${seconds} sekunder`;
  const minutes = Math.round(seconds / 60);
  return `ca ${minutes} ${minutes === 1 ? 'minut' : 'minuter'}`;
}

// Serverns fel kan vara ett långt tekniskt svar från bildmodellen - visa det bara om det är kort och läsbart
function readableError(message?: string): string {
  const m = (message || '').replace(/^Kunde inte generera karaktärsbild:\s*/i, '').trim();
  return m && m.length <= 100 && !/[{}<>]/.test(m) ? m : '';
}

// Ett överhoppat utkast försvinner, eller visar sin tidigare bild igen
function withoutQueued(drafts: Record<string, Draft>, ids: string[]): Record<string, Draft> {
  const next = { ...drafts };
  for (const id of ids) {
    const d = next[id];
    if (!d || d.status !== 'queued') continue;
    if (d.image) next[id] = { ...d, status: 'done', error: undefined };
    else delete next[id];
  }
  return next;
}

// ═══════════════════════════════════════════
//  Panelen
// ═══════════════════════════════════════════

export default function PhotoCharacter({ onClose, onSaved }: Props) {
  const [characterId] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<Step>('photos');

  // Foton
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [photoNotice, setPhotoNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Om barnet
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [describing, setDescribing] = useState(false);
  const [describeState, setDescribeState] = useState<'idle' | 'done' | 'failed'>('idle');
  const describeReq = useRef(0);
  const describedKey = useRef('');
  // Senaste värdena från avläsningen - fält som föräldern ändrat skrivs aldrig över
  const lastAuto = useRef<AutoFields>({ age: '', appearance: '', normalClothes: '' });

  // Stilar och utkast
  const [selected, setSelected] = useState<string[]>(() => STYLE_PRESETS.map(s => s.id));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const queueRef = useRef<Job[]>([]);
  const activeRef = useRef(0);
  // Stil -> jobb som väntar eller pågår, så att samma stil aldrig ritas två gånger samtidigt
  const busyRef = useRef(new Map<string, number>());
  const jobCounter = useRef(0);
  const aliveRef = useRef(true);

  // Spara och stäng
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const name = form.name.trim();
  const hasPhotos = photos.length > 0;
  const aboutReady = name !== '' && form.appearance.trim() !== '';
  const chosen = chosenId ? drafts[chosenId] : undefined;
  const chosenStyle = getStylePreset(chosenId ?? undefined);
  const chosenReady = !!chosen?.image && chosen.status !== 'queued' && chosen.status !== 'generating';
  const reachable: Record<Step, boolean> = {
    photos: true,
    about: hasPhotos,
    styles: hasPhotos && aboutReady,
    save: hasPhotos && aboutReady && chosenReady,
  };
  const stepIndex = STEPS.findIndex(s => s.key === step);

  const draftList = STYLE_PRESETS.filter(s => drafts[s.id]);
  const restStyles = STYLE_PRESETS.filter(s => !drafts[s.id]);
  const hasDrafts = draftList.length > 0;
  const draftValues = Object.values(drafts);
  // Klara = har en bild att välja (även om ett nytt försök på den misslyckades)
  const doneCount = draftValues.filter(d => !!d.image && d.status !== 'queued' && d.status !== 'generating').length;
  const finishedCount = draftValues.filter(d => d.status === 'done' || d.status === 'error').length;
  const queuedCount = draftValues.filter(d => d.status === 'queued').length;
  const running = draftValues.some(d => d.status === 'queued' || d.status === 'generating');
  const anyGenerating = draftValues.some(d => d.status === 'generating');
  const currentInputKey = inputKeyOf(photos, form);
  const inputsChanged = draftValues.some(d => d.status === 'done' && !!d.inputKey && d.inputKey !== currentInputKey);
  const selectedInOrder = STYLE_PRESETS.filter(s => selected.includes(s.id));
  const dirty = hasPhotos || name !== '' || hasDrafts;

  // ── Livscykel ──
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      queueRef.current = [];
    };
  }, []);

  // Sidan bakom scrollar inte medan panelen är öppen
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // Klocka för utkast som ritas
  useEffect(() => {
    if (!anyGenerating) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyGenerating]);

  // ── Stäng (med bekräftelse om något är gjort) ──
  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  }, [saving, dirty, confirmClose, onClose]);

  useEffect(() => {
    if (!confirmClose) return;
    const t = window.setTimeout(() => setConfirmClose(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const goTo = (s: Step) => {
    if (reachable[s] && !saving) setStep(s);
  };

  // ── Foton ──
  const addFiles = async (incoming: File[]) => {
    if (preparing || incoming.length === 0) return;
    const notices: string[] = [];
    const known = new Set(photos.map(p => p.sourceKey));
    let room = MAX_PHOTOS - photos.length;
    let skipped = 0;
    const added: Photo[] = [];
    setPreparing(true);
    for (const file of incoming) {
      const sourceKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(sourceKey)) continue;
      if (room <= 0) {
        skipped++;
        continue;
      }
      if (file.type && !file.type.startsWith('image/')) {
        notices.push(`${file.name} är ingen bild.`);
        continue;
      }
      try {
        const data = await prepareImage(file);
        added.push({ id: crypto.randomUUID(), sourceKey, data });
        known.add(sourceKey);
        room--;
      } catch (err) {
        console.warn('Kunde inte läsa fotot:', file.name, err);
        notices.push(photoErrorMessage(file));
      }
    }
    if (skipped > 0) {
      notices.push(`Högst ${MAX_PHOTOS} foton går att använda, så ${skipped} ${skipped === 1 ? 'bild' : 'bilder'} lades inte till.`);
    }
    if (!aliveRef.current) return;
    setPreparing(false);
    if (added.length > 0) setPhotos(prev => [...prev, ...added].slice(0, MAX_PHOTOS));
    setPhotoNotice(notices.join(' '));
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Samma fil ska gå att välja igen efter att den tagits bort
    e.target.value = '';
    void addFiles(files);
  };

  // Foton kan släppas var som helst - annars öppnar webbläsaren filen och allt försvinner
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = step === 'photos' ? 'copy' : 'none';
    if (step === 'photos') setDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragOver(false);
    if (step === 'photos') void addFiles(Array.from(e.dataTransfer.files || []));
  };

  const removePhoto = (id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
    setPhotoNotice('');
  };

  // ── Avläsning av fotona ──
  const photoKey = photos.map(p => p.id).join('|');

  const describe = useCallback(async (list: Photo[], key: string) => {
    const req = ++describeReq.current;
    describedKey.current = key;
    setDescribing(true);
    setDescribeState('idle');
    try {
      const { ok, data } = await postJson<Partial<AutoFields>>('/api/character/photo-describe', {
        photos: list.map(toPayload),
      });
      if (!ok) throw new Error(data.error || 'Kunde inte läsa av fotona');
      if (req !== describeReq.current || !aliveRef.current) return;
      const next: AutoFields = {
        age: (data.age || '').trim(),
        appearance: (data.appearance || '').trim(),
        normalClothes: (data.normalClothes || '').trim(),
      };
      const prevAuto = lastAuto.current;
      const pick = (current: string, field: keyof AutoFields) =>
        next[field] && (!current.trim() || current === prevAuto[field]) ? next[field] : current;
      setForm(prev => ({
        ...prev,
        age: pick(prev.age, 'age'),
        appearance: pick(prev.appearance, 'appearance'),
        normalClothes: pick(prev.normalClothes, 'normalClothes'),
      }));
      lastAuto.current = {
        age: next.age || prevAuto.age,
        appearance: next.appearance || prevAuto.appearance,
        normalClothes: next.normalClothes || prevAuto.normalClothes,
      };
      setDescribeState(next.appearance ? 'done' : 'failed');
    } catch (err) {
      if (req !== describeReq.current || !aliveRef.current) return;
      console.warn('Kunde inte läsa av fotona:', err);
      // Samma foton ska kunna provas igen
      describedKey.current = '';
      setDescribeState('failed');
    } finally {
      if (req === describeReq.current && aliveRef.current) setDescribing(false);
    }
  }, []);

  // Läs av när fotona är valda. Vänta en stund, föräldern lägger ofta till flera i rad.
  useEffect(() => {
    if (photos.length === 0) {
      describeReq.current++;
      describedKey.current = '';
      setDescribing(false);
      return;
    }
    if (photoKey === describedKey.current) return;
    const t = window.setTimeout(() => describe(photos, photoKey), 600);
    return () => window.clearTimeout(t);
  }, [photoKey, photos, describe]);

  const update = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // ── Utkast: högst tre samtidigt ──
  const runJob = async (job: Job) => {
    const preset = getStylePreset(job.styleId);
    setDrafts(prev => {
      const d = prev[job.styleId];
      if (!d || d.jobId !== job.jobId) return prev;
      return { ...prev, [job.styleId]: { ...d, status: 'generating', startedAt: Date.now(), error: undefined } };
    });
    try {
      if (!preset) throw new Error('Okänd stil');
      const { ok, data } = await postJson<{ image?: string; faceNotes?: string }>(
        '/api/generate-character',
        { character: job.character, styleGuide: composeStyleGuide(preset), photos: job.photos },
        // Inget automatiskt nytt försök: det skulle rita (och kosta) en bild till
        0,
      );
      if (!ok || !data.image) throw new Error(data.error || 'Ingen bild kom tillbaka');
      if (!aliveRef.current) return;
      const image = data.image;
      const faceNotes = data.faceNotes || '';
      setDrafts(prev => {
        const d = prev[job.styleId];
        if (!d || d.jobId !== job.jobId) return prev;
        return { ...prev, [job.styleId]: { status: 'done', jobId: job.jobId, image, faceNotes, inputKey: job.inputKey } };
      });
    } catch (err) {
      if (!aliveRef.current) return;
      console.error(`Utkastet i ${preset?.label || job.styleId} misslyckades:`, err);
      const message = err instanceof Error ? err.message : 'Okänt fel';
      setDrafts(prev => {
        const d = prev[job.styleId];
        if (!d || d.jobId !== job.jobId) return prev;
        return { ...prev, [job.styleId]: { ...d, status: 'error', error: message } };
      });
    } finally {
      if (busyRef.current.get(job.styleId) === job.jobId) busyRef.current.delete(job.styleId);
    }
  };

  const pump = () => {
    while (aliveRef.current && activeRef.current < PARALLEL && queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      activeRef.current++;
      void runJob(job).finally(() => {
        activeRef.current--;
        pump();
      });
    }
  };

  const enqueue = (styleIds: string[]) => {
    const ids = styleIds.filter(id => !busyRef.current.has(id) && getStylePreset(id));
    if (ids.length === 0) return;
    const character: Character = {
      id: characterId,
      name: name || 'Barnet',
      age: form.age.trim() || undefined,
      appearance: form.appearance.trim(),
      normalClothes: form.normalClothes.trim() || undefined,
      role: form.role,
      approved: false,
    };
    const payload = photos.map(toPayload);
    const jobs: Job[] = ids.map(styleId => ({
      styleId,
      jobId: ++jobCounter.current,
      character,
      photos: payload,
      inputKey: currentInputKey,
    }));
    for (const j of jobs) busyRef.current.set(j.styleId, j.jobId);
    setDrafts(prev => {
      const next = { ...prev };
      for (const j of jobs) {
        next[j.styleId] = { ...prev[j.styleId], status: 'queued', jobId: j.jobId, error: undefined, startedAt: undefined };
      }
      return next;
    });
    queueRef.current.push(...jobs);
    pump();
  };

  const startDrafts = () => {
    if (selectedInOrder.length === 0) return;
    enqueue(selectedInOrder.map(s => s.id));
    contentRef.current?.scrollTo({ top: 0 });
  };

  const skip = (styleId: string) => {
    const idx = queueRef.current.findIndex(j => j.styleId === styleId);
    if (idx < 0) return;
    queueRef.current.splice(idx, 1);
    busyRef.current.delete(styleId);
    setDrafts(prev => withoutQueued(prev, [styleId]));
  };

  const stopQueued = () => {
    const ids = queueRef.current.map(j => j.styleId);
    queueRef.current = [];
    for (const id of ids) busyRef.current.delete(id);
    setDrafts(prev => withoutQueued(prev, ids));
  };

  const toggleStyle = (id: string) => {
    setSelected(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
  };

  const allSelected = selected.length === STYLE_PRESETS.length;
  const toggleAll = () => setSelected(allSelected ? [] : STYLE_PRESETS.map(s => s.id));

  const choose = (styleId: string) => {
    const d = drafts[styleId];
    if (!d?.image || d.status === 'queued' || d.status === 'generating') return;
    setChosenId(styleId);
    setSaveError('');
    setStep('save');
  };

  // ── Spara ──
  const save = async () => {
    if (!chosenId || !chosen?.image || !chosenReady || saving) return;
    if (!name || !form.appearance.trim()) {
      setSaveError('Fyll i namn och utseende först.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const character: SavedCharacter = {
      id: characterId,
      name,
      age: form.age.trim() || undefined,
      appearance: form.appearance.trim(),
      normalClothes: form.normalClothes.trim() || undefined,
      role: form.role,
      referenceImage: chosen.image,
      faceNotes: chosen.faceNotes || undefined,
      stylePresetId: chosenId,
      // Böcker med karaktären publiceras aldrig automatiskt i bokhandeln
      fromPhoto: true,
      savedAt: new Date().toISOString(),
    };
    try {
      await saveCharacter(character);
      // Utkast som fortfarande väntar behövs inte längre
      queueRef.current = [];
      onSaved(character);
    } catch (err) {
      console.error('Kunde inte spara karaktären:', err);
      setSaveError('Kunde inte spara karaktären. Försök igen.');
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════════
  //  Vyer
  // ═══════════════════════════════════════════

  const title =
    step === 'photos' ? 'Ladda upp foton'
    : step === 'about' ? 'Om barnet'
    : step === 'styles' ? (hasDrafts ? 'Välj det bästa utkastet' : 'Välj stilar')
    : 'Spara karaktären';

  const fileInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      onChange={onInputChange}
      disabled={preparing}
      aria-label="Välj foton"
    />
  );

  const photoStep = (
    <div className="space-y-5">
      <p className="text-sm text-ink/60 leading-relaxed">
        Ladda upp foton på barnet, så ritar vi hen som en figur i bokens bildstilar. Sedan väljer du den du gillar mest.
      </p>

      {photos.length === 0 ? (
        <label
          className={`relative block cursor-pointer rounded-3xl border-2 border-dashed px-6 py-10 sm:py-12 text-center transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/20 ${
            dragOver ? 'border-brand bg-brand/5' : 'border-ink/20 bg-paper/60 hover:border-ink/35'
          }`}
        >
          {fileInput}
          <span className="w-14 h-14 mx-auto rounded-2xl bg-white border border-line text-brand flex items-center justify-center shadow-soft">
            {preparing ? <span className="spinner" /> : <Icon name="add_a_photo" size={28} />}
          </span>
          <span className="mt-4 block font-heading text-lg font-bold text-ink">
            {preparing ? 'Förbereder fotona...' : 'Välj foton'}
          </span>
          <span className="mt-1 block text-sm text-ink/55">
            1-4 bilder på barnet<span className="hidden sm:inline">, eller dra in dem hit</span>
          </span>
        </label>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <div key={p.id} className="relative aspect-square rounded-2xl overflow-hidden bg-paper border border-line animate-pop">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${p.data}`}
                alt={`Foto ${i + 1}`}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                aria-label={`Ta bort foto ${i + 1}`}
                title="Ta bort"
                className="absolute top-1.5 right-1.5 w-8 h-8 rounded-full bg-white/95 text-ink/70 hover:text-red-600 shadow-soft flex items-center justify-center transition-colors"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label
              className={`relative aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 px-2 text-center cursor-pointer transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/20 ${
                dragOver ? 'border-brand bg-brand/5 text-brand' : 'border-ink/20 text-ink/55 hover:border-ink/35 hover:text-ink'
              }`}
            >
              {fileInput}
              {preparing ? <span className="spinner" /> : <Icon name="add_a_photo" size={26} />}
              <span className="text-xs font-semibold">{preparing ? 'Förbereder...' : 'Lägg till'}</span>
            </label>
          )}
        </div>
      )}

      {photoNotice && (
        <div className="note-warning flex items-start gap-2">
          <Icon name="info" size={18} className="shrink-0 mt-px" />
          <span>{photoNotice}</span>
        </div>
      )}

      <div className="rounded-2xl bg-paper border border-line p-4 space-y-1.5">
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
          <Icon name="lightbulb" size={18} className="text-brand" /> Vilka foton blir bäst?
        </p>
        <p className="text-sm text-ink/65 leading-relaxed">
          Ett foto räcker. Bäst blir det med 2-3: ett tydligt porträtt rakt framifrån i bra ljus (som ett skolfoto), en
          helfigur, och gärna ett där barnet skrattar. Undvik solglasögon, kepsar, suddiga eller mörka bilder och foton där
          barnet är litet i bild.
        </p>
      </div>

      <p className="flex items-start gap-2 text-xs text-ink/55 leading-relaxed">
        <Icon name="lock" size={16} className="shrink-0 mt-px text-ink/45" />
        <span>
          Fotona används bara för att rita karaktären. De sparas inte, varken i appen eller hos oss. Böcker med karaktären
          publiceras aldrig automatiskt i bokhandeln.
        </span>
      </p>
    </div>
  );

  const aboutStep = (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.id}
            src={`data:image/jpeg;base64,${p.data}`}
            alt={`Foto ${i + 1}`}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl object-cover border border-line"
          />
        ))}
        <button
          type="button"
          onClick={() => goTo('photos')}
          className="ml-1 text-xs font-semibold text-brand/80 hover:text-brand"
        >
          Ändra foton
        </button>
      </div>

      <div aria-live="polite" className="min-h-[1.25rem]">
        {describing ? (
          <p className="flex items-center gap-2 text-sm font-medium text-brand">
            <span className="spinner !w-4 !h-4" /> Läser av fotona...
          </p>
        ) : describeState === 'failed' ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink/65">
            <Icon name="info" size={18} className="text-amber-600" />
            <span>Fotona kunde inte läsas av automatiskt. Fyll i utseendet själv.</span>
            <button
              type="button"
              onClick={() => describe(photos, photoKey)}
              className="font-semibold text-brand/80 hover:text-brand"
            >
              Försök igen
            </button>
          </p>
        ) : describeState === 'done' ? (
          <p className="flex items-center gap-1.5 text-sm text-ink/60">
            <Icon name="auto_awesome" size={17} className="text-brand" /> Ifyllt från fotona. Ändra gärna om något inte stämmer.
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_7rem] gap-3">
          <Field label="Namn">
            <input
              type="text"
              value={form.name}
              onChange={e => update('name', e.target.value)}
              className="field py-2.5"
              placeholder="T.ex. Alva"
              autoComplete="off"
            />
          </Field>
          <Field label="Ålder">
            <input
              type="text"
              value={form.age}
              onChange={e => update('age', e.target.value)}
              className="field py-2.5"
              placeholder={describing ? 'Läser av...' : '6 år'}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label="Roll" group>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROLE_LABEL) as Role[]).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => update('role', r)}
                className={`${form.role === r ? 'chip-on' : 'chip'} !px-3 !py-1.5`}
                aria-pressed={form.role === r}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Utseende" hint="Hår, ögon, hy och det som gör barnet igenkännbart, som fräknar, tandlucka eller glasögon.">
          <textarea
            value={form.appearance}
            onChange={e => update('appearance', e.target.value)}
            className="field py-2.5 h-28 resize-y text-sm"
            placeholder={describing ? 'Fylls i från fotona...' : 'T.ex. axellångt ljusbrunt hår med lugg, blå ögon och fräknar över näsan'}
          />
        </Field>

        <Field label="Kläder">
          <input
            type="text"
            value={form.normalClothes}
            onChange={e => update('normalClothes', e.target.value)}
            className="field py-2.5 text-sm"
            placeholder={describing ? 'Fylls i från fotona...' : 'T.ex. randig tröja, blå jeans och gympaskor'}
            autoComplete="off"
          />
        </Field>
      </div>
    </div>
  );

  const pickStyles = (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm text-ink/60 leading-relaxed">
          Vi ritar {name || 'barnet'} i varje stil du väljer. Sedan väljer du den du gillar mest.
        </p>
        <button type="button" onClick={toggleAll} className="shrink-0 text-xs font-semibold text-brand/80 hover:text-brand">
          {allSelected ? 'Välj bort alla' : 'Välj alla'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STYLE_PRESETS.map(style => {
          const on = selected.includes(style.id);
          return (
            <label
              key={style.id}
              className={`flex items-center gap-3 p-2.5 rounded-2xl cursor-pointer transition-all ${
                on ? 'bg-white ring-1 ring-ink/25 shadow-soft' : 'bg-paper/60 ring-1 ring-line hover:ring-ink/25'
              }`}
            >
              <StyleThumb styleId={style.id} size={44} className={on ? '' : 'opacity-50'} />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold leading-tight ${on ? 'text-ink' : 'text-ink/55'}`}>{style.label}</span>
                <span className="block text-xs text-ink/50 leading-snug mt-0.5 line-clamp-2">{style.concept}</span>
              </span>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggleStyle(style.id)}
                className="w-5 h-5 shrink-0 accent-brand cursor-pointer"
                aria-label={style.label}
              />
            </label>
          );
        })}
      </div>

      <p className="flex items-start gap-2 text-xs text-ink/55 leading-relaxed">
        <Icon name="schedule" size={16} className="shrink-0 mt-px" />
        <span>
          Ungefär {SECONDS_PER_STYLE} sekunder per stil, tre görs åt gången.
          {selectedInOrder.length > 0 &&
            ` ${selectedInOrder.length} ${selectedInOrder.length === 1 ? 'stil tar' : 'stilar tar'} ${estimateText(selectedInOrder.length)}.`}
        </span>
      </p>
    </div>
  );

  const draftGrid = (
    <div className="space-y-4">
      <div className="glass rounded-3xl p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span
            className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center text-white ${
              running ? 'bg-ink' : doneCount > 0 ? 'bg-emerald-600' : 'bg-ink/40'
            }`}
          >
            {running ? <span className="spinner !w-5 !h-5" /> : <Icon name={doneCount > 0 ? 'check' : 'error'} size={22} />}
          </span>
          <div className="min-w-0 flex-1" aria-live="polite">
            <p className="text-sm font-semibold text-ink">
              {running ? `Ritar ${name || 'barnet'}... ${doneCount} av ${draftList.length} klara` : `${doneCount} av ${draftList.length} utkast klara`}
            </p>
            <p className="text-xs text-ink/55">
              {running
                ? `Ungefär ${SECONDS_PER_STYLE} sekunder per stil, tre görs åt gången.`
                : doneCount > 0
                  ? 'Tryck på Välj under den du gillar mest.'
                  : 'Försök igen på stilarna nedan.'}
            </p>
          </div>
          {queuedCount > 0 && (
            <button type="button" onClick={stopQueued} className="btn-ghost shrink-0 !px-3 !py-1.5 text-xs">
              Stoppa resten
            </button>
          )}
        </div>
        {running && (
          <div className="bg-ink/10 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-brand h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(4, Math.round((finishedCount / Math.max(1, draftList.length)) * 100))}%` }}
            />
          </div>
        )}
      </div>

      {inputsChanged && (
        <div className="note-warning text-xs">
          Du har ändrat foton eller beskrivning sedan utkasten ritades. Tryck på Gör om för att rita en stil med de nya uppgifterna.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {draftList.map(style => {
          const d = drafts[style.id];
          const busy = d.status === 'queued' || d.status === 'generating';
          const isChosen = chosenId === style.id;
          const secs = d.startedAt ? Math.max(0, Math.round((now - d.startedAt) / 1000)) : 0;
          const detail = d.status === 'error' ? readableError(d.error) : '';
          return (
            <div
              key={style.id}
              className={`card-glass hover:!shadow-soft overflow-hidden flex flex-col animate-pop ${isChosen ? 'ring-2 ring-brand' : ''}`}
            >
              {/* Fast höjd för två rader, så att bilderna i samma rad hamnar i linje */}
              <div className="flex items-center gap-2 px-2.5 h-12 min-w-0">
                <StyleThumb styleId={style.id} size={22} />
                <p className="text-[13px] font-semibold text-ink leading-tight line-clamp-2" title={style.label}>{style.label}</p>
              </div>

              <div className={`relative aspect-[3/4] border-y border-line overflow-hidden ${d.image ? 'bg-white' : 'bg-paper'}`}>
                {d.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${d.image}`}
                    alt={`${name || 'Barnet'} i stilen ${style.label}`}
                    className={`absolute inset-0 w-full h-full object-contain transition-opacity ${busy ? 'opacity-25' : ''}`}
                  />
                )}
                {d.image && !busy && (
                  <button
                    type="button"
                    onClick={() => choose(style.id)}
                    className="absolute inset-0 cursor-zoom-in"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                )}
                {isChosen && !busy && (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand text-white text-[11px] font-semibold pointer-events-none">
                    <Icon name="check" size={13} /> Vald
                  </span>
                )}

                {d.status === 'generating' && (
                  <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${d.image ? '' : 'skeleton !rounded-none'}`}>
                    <StyleThumb styleId={style.id} size={40} className="relative z-10 opacity-80" />
                    <span className="relative z-10 text-xs font-medium text-ink/60">{d.image ? 'Ritar om...' : 'Ritar...'}</span>
                  </div>
                )}
                {d.status === 'queued' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink/45">
                    <Icon name="hourglass_empty" size={24} />
                    <span className="text-xs font-medium">Väntar på tur</span>
                  </div>
                )}
                {d.status === 'error' && !d.image && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center" title={d.error}>
                    <Icon name="broken_image" size={28} className="text-red-400" />
                    <p className="text-xs font-medium text-red-700">Det gick inte att rita den här stilen.</p>
                    {detail && <p className="text-[11px] text-ink/45 leading-snug line-clamp-3">{detail}</p>}
                  </div>
                )}
                {d.status === 'error' && d.image && (
                  <p
                    className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-red-50/95 border-t border-red-200 text-[11px] font-medium text-red-700 text-center"
                    title={d.error}
                  >
                    Nytt försök misslyckades
                  </p>
                )}
              </div>

              <div className="p-2 min-h-[3.25rem] flex items-center gap-1.5">
                {d.status === 'queued' ? (
                  <button type="button" onClick={() => skip(style.id)} className="btn-ghost w-full !px-2 !py-1.5 text-xs">
                    Hoppa över
                  </button>
                ) : d.status === 'generating' ? (
                  <p className="w-full flex items-center justify-center gap-2 text-xs text-ink/55">
                    <span className="spinner !w-3.5 !h-3.5 text-brand" /> {secs} s
                  </p>
                ) : d.status === 'error' ? (
                  d.image ? (
                    <>
                      <button type="button" onClick={() => choose(style.id)} className="btn-action flex-1 !px-2 !py-2 text-sm">
                        Välj
                      </button>
                      <button
                        type="button"
                        onClick={() => enqueue([style.id])}
                        className="btn-ghost shrink-0 !w-9 !h-9 !p-0"
                        aria-label={`Försök igen med ${style.label}`}
                        title="Försök igen"
                      >
                        <Icon name="refresh" size={18} />
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => enqueue([style.id])} className="btn-ghost w-full !px-2 !py-2 text-sm">
                      Försök igen
                    </button>
                  )
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => choose(style.id)}
                      className="btn-action flex-1 !px-2 !py-2 text-sm"
                      aria-label={`Välj ${style.label}`}
                    >
                      Välj
                    </button>
                    <button
                      type="button"
                      onClick={() => enqueue([style.id])}
                      className="btn-ghost flex-1 !px-2 !py-2 text-sm"
                      aria-label={`Gör om ${style.label}`}
                    >
                      Gör om
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {restStyles.length > 0 && (
        <div className="space-y-2 pt-1">
          <p className="text-xs font-semibold text-ink/55">Prova fler stilar</p>
          <div className="flex flex-wrap gap-2">
            {restStyles.map(style => (
              <button
                key={style.id}
                type="button"
                onClick={() => enqueue([style.id])}
                className="chip !py-1 !pl-1 !pr-3 !text-xs"
              >
                <StyleThumb styleId={style.id} size={24} /> {style.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const saveStep = chosenId && chosen?.image && chosenStyle ? (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px] md:items-start">
      <div className="relative bg-white rounded-2xl border border-line overflow-hidden h-[48vh] sm:h-[58vh] max-h-[680px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${chosen.image}`}
          alt={`${name || 'Barnet'} i stilen ${chosenStyle.label}`}
          className="absolute inset-0 w-full h-full object-contain"
        />
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <StyleThumb styleId={chosenStyle.id} size={44} />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink/50">Vald stil</p>
            <p className="font-heading font-semibold text-ink leading-tight">{chosenStyle.label}</p>
          </div>
        </div>
        <div className="rounded-2xl bg-paper border border-line p-4">
          <p className="font-heading text-lg font-bold text-ink leading-tight break-words">{name}</p>
          <p className="text-xs text-ink/55 mt-0.5">{[form.age.trim(), ROLE_LABEL[form.role]].filter(Boolean).join(' · ')}</p>
          {form.appearance.trim() && (
            <p className="text-sm text-ink/70 mt-2 leading-relaxed line-clamp-4">{form.appearance.trim()}</p>
          )}
        </div>
        <p className="flex items-start gap-2 text-xs text-ink/55 leading-relaxed">
          <Icon name="palette" size={16} className="shrink-0 mt-px" />
          <span>Välj samma stil när du gör boken, så ser {name} ut precis så här.</span>
        </p>
        <p className="flex items-start gap-2 text-xs text-ink/55 leading-relaxed">
          <Icon name="lock" size={16} className="shrink-0 mt-px" />
          <span>Böcker med {name} publiceras aldrig automatiskt i bokhandeln.</span>
        </p>
        {saveError && <div className="note-error">{saveError}</div>}
      </div>
    </div>
  ) : null;

  // ── Fot: föregående steg till vänster, nästa till höger ──
  const backButton = (label: string, target: Step) => (
    <button
      type="button"
      onClick={() => goTo(target)}
      disabled={saving}
      className="btn-ghost shrink-0 !px-3 sm:!px-4"
      aria-label={label}
    >
      <Icon name="arrow_back" size={18} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  let footerHint: ReactNode = null;
  let footerButtons: ReactNode = null;

  if (step === 'photos') {
    footerHint = hasPhotos ? `${photos.length} av ${MAX_PHOTOS} foton` : 'Lägg till minst ett foto.';
    footerButtons = (
      <>
        <button type="button" onClick={requestClose} disabled={saving} className="btn-ghost shrink-0">
          Avbryt
        </button>
        <button
          type="button"
          onClick={() => goTo('about')}
          disabled={!reachable.about || preparing}
          className="btn-action flex-1 sm:flex-none"
        >
          Fortsätt <Icon name="arrow_forward" size={18} />
        </button>
      </>
    );
  } else if (step === 'about') {
    footerHint = !name
      ? 'Skriv barnets namn för att gå vidare.'
      : !form.appearance.trim()
        ? describing ? 'Väntar på att fotona ska läsas av...' : 'Fyll i utseendet för att gå vidare.'
        : null;
    footerButtons = (
      <>
        {backButton('Tillbaka', 'photos')}
        <button
          type="button"
          onClick={() => goTo('styles')}
          disabled={!reachable.styles}
          className="btn-action flex-1 sm:flex-none"
        >
          {describing && !form.appearance.trim() ? (
            <><span className="spinner !w-4 !h-4" /> Läser av fotona...</>
          ) : (
            <>Välj stilar <Icon name="arrow_forward" size={18} /></>
          )}
        </button>
      </>
    );
  } else if (step === 'styles') {
    footerHint = !hasDrafts && selectedInOrder.length === 0 ? 'Välj minst en stil.' : null;
    footerButtons = (
      <>
        {backButton('Tillbaka', 'about')}
        {!hasDrafts && (
          <button
            type="button"
            onClick={startDrafts}
            disabled={selectedInOrder.length === 0}
            className="btn-action flex-1 sm:flex-none whitespace-nowrap"
          >
            <Icon name="auto_fix_high" filled size={19} />
            Skapa utkast i {selectedInOrder.length} {selectedInOrder.length === 1 ? 'stil' : 'stilar'}
          </button>
        )}
      </>
    );
  } else {
    footerButtons = (
      <>
        {backButton('Tillbaka till utkasten', 'styles')}
        <button
          type="button"
          onClick={save}
          disabled={saving || !chosenReady}
          className="btn-action flex-1 sm:flex-none whitespace-nowrap"
        >
          {saving ? <span className="spinner !w-4 !h-4" /> : <Icon name="bookmark_add" filled size={19} />}
          Spara karaktären
        </button>
      </>
    );
  }

  return (
    <div
      className="fixed inset-0 !m-0 bg-ink/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={requestClose}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="dialog"
      aria-modal="true"
      aria-label="Karaktär från foto"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bg-white w-full sm:max-w-4xl max-h-[94vh] sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl shadow-lift flex flex-col overflow-hidden animate-pop outline-none"
        onClick={e => e.stopPropagation()}
      >
        {/* Huvud */}
        <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-3 border-b border-line space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow max-w-full">
                <Icon name="photo_camera" size={15} />
                <span className="min-w-0 truncate">Karaktär från foto</span>
              </p>
              <h3 className="font-heading text-xl font-bold text-ink truncate">{title}</h3>
            </div>
            {confirmClose ? (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 inline-flex items-center h-9 px-3 sm:px-3.5 rounded-full bg-red-600 text-white text-xs sm:text-sm font-semibold animate-pop"
              >
                Stäng utan att spara?
              </button>
            ) : (
              <button type="button" onClick={requestClose} className="btn-icon shrink-0" aria-label="Stäng" disabled={saving}>
                <Icon name="close" size={22} />
              </button>
            )}
          </div>

          <nav aria-label="Steg">
            <ol className="flex items-center gap-1 sm:gap-2">
              {STEPS.map((s, idx) => {
                const isCurrent = s.key === step;
                const isDone = idx < stepIndex;
                const canGo = !isCurrent && reachable[s.key] && !saving;
                return (
                  <li key={s.key} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none">
                    <button
                      type="button"
                      onClick={() => goTo(s.key)}
                      disabled={!canGo}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={`flex items-center gap-2 rounded-full pl-1 pr-1 sm:pr-3 py-1 transition-colors disabled:cursor-default ${
                        isCurrent ? 'bg-ink text-white !pr-3' : reachable[s.key] ? 'text-ink hover:bg-ink/5' : 'text-ink/40'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                          isCurrent ? 'bg-white/15' : isDone ? 'bg-emerald-600 text-white' : 'bg-ink/[0.06]'
                        }`}
                      >
                        {isDone ? <Icon name="check" size={15} /> : idx + 1}
                      </span>
                      <span className={`text-sm font-medium whitespace-nowrap ${isCurrent ? '' : 'hidden sm:inline'}`}>{s.label}</span>
                    </button>
                    {idx < STEPS.length - 1 && (
                      <span className={`h-px flex-1 min-w-3 ${isDone ? 'bg-emerald-600/40' : 'bg-line'}`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>

        {/* Innehåll */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {step === 'photos' && photoStep}
          {step === 'about' && aboutStep}
          {step === 'styles' && (hasDrafts ? draftGrid : pickStyles)}
          {step === 'save' && saveStep}
        </div>

        {/* Fot */}
        <div className="border-t border-line px-4 sm:px-6 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-xs text-ink/50 min-h-[1rem]">{footerHint}</div>
          <div className="flex gap-2">{footerButtons}</div>
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
