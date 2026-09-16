'use client';

import { SpreadQualityCheck } from './types';

// Klientsidan av bakgrundsjobbet som illustrerar boken på servern.
// Den här filen pratar bara med /api/jobs - inga direkta anrop till databasen.

export type JobStatus = 'running' | 'done' | 'failed' | 'canceled';
export type JobItemStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobItem {
  spreadId: string;
  spreadNumber: number;
  label: string;
  status: JobItemStatus;
  imageUrl?: string;
  quality?: SpreadQualityCheck;
  error?: string;
}

export interface IllustrationJob {
  id: string;
  bookId: string;
  status: JobStatus;
  total: number;
  done: number;
  failed: number;
  message?: string;
  updatedAt: string;
  items: JobItem[];
}

// Så här länge räknar vi med att en bild tar, delat på hur många servern kör
// samtidigt. Grov gissning som bara används till tidsuppskattningen i UI:t.
const SECONDS_PER_IMAGE = 70;
const PARALLEL_IMAGES = 4;

// ===== Anrop mot API:t =====

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error || `Servern svarade inte (${res.status})`);
  }
  return data;
}

// Startar (eller hakar på) illustreringen av en bok. Boken måste vara sparad i
// molnet först - servern läser text, karaktärer och stil därifrån.
export async function startIllustrationJob(
  bookId: string
): Promise<{ jobId: string; total: number; alreadyRunning?: boolean }> {
  const res = await fetch('/api/jobs/illustrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId }),
  });
  return readJson<{ jobId: string; total: number; alreadyRunning?: boolean }>(res);
}

export async function fetchJob(jobId: string): Promise<IllustrationJob | null> {
  const res = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  const data = await readJson<{ job: IllustrationJob | null }>(res);
  return data.job ?? null;
}

// Senaste jobbet för en bok. Anropet får också servern att ta upp ett jobb som
// stannat av (t.ex. när användaren kommer tillbaka från mobilen).
export async function fetchBookJob(bookId: string): Promise<IllustrationJob | null> {
  const res = await fetch(`/api/jobs?bookId=${encodeURIComponent(bookId)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  const data = await readJson<{ job: IllustrationJob | null }>(res);
  return data.job ?? null;
}

export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`Kunde inte stoppa illustreringen (${res.status})`);
}

// ===== Minnesanteckning i webbläsaren =====
// Statusraden i toppmenyn behöver hitta jobbet igen efter en omladdning.

export interface JobRef {
  jobId: string;
  bookId: string;
  title: string;
}

const JOB_KEY = 'barnbok:job';
export const JOB_REF_EVENT = 'barnbok:job-ref';
export const JOB_UPDATE_EVENT = 'barnbok:job-update';

export function readJobRef(): JobRef | null {
  try {
    const raw = localStorage.getItem(JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JobRef>;
    if (!parsed?.jobId || !parsed?.bookId) return null;
    return { jobId: parsed.jobId, bookId: parsed.bookId, title: parsed.title || '' };
  } catch {
    return null;
  }
}

export function writeJobRef(ref: JobRef): void {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify(ref));
  } catch {
    // Lagring blockerad - statusraden hittar då jobbet först när boken öppnas
  }
  dispatch(JOB_REF_EVENT);
}

export function clearJobRef(): void {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    // Inget att rensa
  }
  dispatch(JOB_REF_EVENT);
}

function dispatch(name: string, detail?: unknown) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // Server-rendering - inget fönster att skicka till
  }
}

// Illustreringssidan pollar redan jobbet. Den delar med sig av svaret så att
// statusraden i toppmenyn slipper fråga servern samtidigt.
export function publishJob(job: IllustrationJob): void {
  dispatch(JOB_UPDATE_EVENT, job);
}

export function onJobUpdate(handler: (job: IllustrationJob) => void): () => void {
  const listener = (e: Event) => {
    const job = (e as CustomEvent<IllustrationJob>).detail;
    if (job?.id) handler(job);
  };
  window.addEventListener(JOB_UPDATE_EVENT, listener);
  return () => window.removeEventListener(JOB_UPDATE_EVENT, listener);
}

// ===== Notiser =====

// Fråga först när användaren startat en illustrering, aldrig vid sidladdning.
export function askNotificationPermission(): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    // Vissa webbläsare kastar i osäkra sammanhang - notiser är frivilliga
  }
}

export function notifyBookIllustrated(title: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification('Boken är färdigillustrerad', {
      body: title ? `${title} är klar att granska.` : 'Bilderna är klara att granska.',
      tag: 'barnbok-illustrering',
    });
  } catch {
    // Notisen är en bonus - strunta i fel
  }
}

// ===== Tidsuppskattning =====

// Ärlig grovuppskattning: servern kör flera bilder parallellt.
export function estimateMinutesLeft(remaining: number): number {
  if (remaining <= 0) return 0;
  return Math.max(1, Math.round((remaining * SECONDS_PER_IMAGE) / PARALLEL_IMAGES / 60));
}
