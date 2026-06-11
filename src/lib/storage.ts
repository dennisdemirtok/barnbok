import { BookProject, SavedCharacter, SavedText } from './types';
import { saveBookToCloud, deleteBookFromCloud } from './supabase-db';

const DB_NAME = 'book-creator-db';
const DB_VERSION = 3;
const BOOKS_STORE = 'books';
const CHARACTERS_STORE = 'characters';
const TEXTS_STORE = 'texts';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHARACTERS_STORE)) {
        db.createObjectStore(CHARACTERS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TEXTS_STORE)) {
        db.createObjectStore(TEXTS_STORE, { keyPath: 'id' });
      }
    };
  });
}

// Check if Supabase is configured
function isCloudEnabled(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Older books were created with short random ids, but Supabase columns are uuid.
// Regenerate ids so cloud sync works; returns the old book id when it changed
// so the stale IndexedDB record can be removed.
function migrateBookIds(book: BookProject): { book: BookProject; oldId?: string } {
  const needsMigration =
    !isUuid(book.id) ||
    book.characters.some(c => !isUuid(c.id)) ||
    book.spreads.some(s => !isUuid(s.id));
  if (!needsMigration) return { book };

  const oldId = !isUuid(book.id) ? book.id : undefined;
  return {
    book: {
      ...book,
      id: isUuid(book.id) ? book.id : crypto.randomUUID(),
      characters: book.characters.map(c => (isUuid(c.id) ? c : { ...c, id: crypto.randomUUID() })),
      spreads: book.spreads.map(s => (isUuid(s.id) ? s : { ...s, id: crypto.randomUUID() })),
    },
    oldId,
  };
}

// ===== Book operations =====

export interface SaveResult {
  cloud: 'synced' | 'failed' | 'disabled' | 'skipped';
  cloudError?: string;
}

export async function saveBook(
  book: BookProject,
  options?: { cloud?: boolean }
): Promise<SaveResult> {
  const db = await openDB();
  const bookWithTimestamp = {
    ...book,
    updatedAt: new Date().toISOString(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    store.put(bookWithTimestamp);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });

  // Cloud sync: explicit saves await the result so the UI can show it.
  // Auto-saves pass cloud:false - syncing every keystroke would re-upload all images.
  if (options?.cloud === false) return { cloud: 'skipped' };
  if (!isCloudEnabled()) return { cloud: 'disabled' };

  try {
    await saveBookToCloud(bookWithTimestamp);
    return { cloud: 'synced' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Cloud-synk misslyckades:', message);
    return { cloud: 'failed', cloudError: message };
  }
}

export async function loadBook(id: string): Promise<BookProject | null> {
  const db = await openDB();
  const loaded = await new Promise<BookProject | null>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readonly');
    const store = tx.objectStore(BOOKS_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });

  if (!loaded) return null;

  // Migrate pre-UUID books on load so cloud sync starts working for them
  const { book: migrated, oldId } = migrateBookIds(loaded);
  if (migrated !== loaded) {
    await saveBook(migrated, { cloud: false });
    if (oldId) await deleteLocalBookRecord(oldId);
  }
  return migrated;
}

// Remove only the local IndexedDB record (used after id migration - the old
// short id never existed in the cloud, so no cloud delete is needed)
async function deleteLocalBookRecord(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function listBooks(): Promise<BookProject[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readonly');
    const store = tx.objectStore(BOOKS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteBook(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();

      // Delete from Supabase in background
      if (isCloudEnabled()) {
        deleteBookFromCloud(id).catch(err =>
          console.warn('Cloud-radering misslyckades:', err.message)
        );
      }

      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ===== Character registry operations =====

export async function saveCharacter(character: SavedCharacter): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTERS_STORE, 'readwrite');
    const store = tx.objectStore(CHARACTERS_STORE);
    store.put(character);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function listSavedCharacters(): Promise<SavedCharacter[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTERS_STORE, 'readonly');
    const store = tx.objectStore(CHARACTERS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteSavedCharacter(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTERS_STORE, 'readwrite');
    const store = tx.objectStore(CHARACTERS_STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ===== Saved text operations =====

export async function saveText(text: SavedText): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXTS_STORE, 'readwrite');
    const store = tx.objectStore(TEXTS_STORE);
    store.put(text);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function listSavedTexts(): Promise<SavedText[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXTS_STORE, 'readonly');
    const store = tx.objectStore(TEXTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteSavedText(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXTS_STORE, 'readwrite');
    const store = tx.objectStore(TEXTS_STORE);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
