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

// ===== Book operations =====

export async function saveBook(book: BookProject): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    const store = tx.objectStore(BOOKS_STORE);
    const bookWithTimestamp = {
      ...book,
      updatedAt: new Date().toISOString(),
    };
    store.put(bookWithTimestamp);
    tx.oncomplete = () => {
      db.close();

      // Sync to Supabase in background (don't block the UI)
      if (isCloudEnabled()) {
        saveBookToCloud(bookWithTimestamp).catch(err =>
          console.warn('Cloud-synk misslyckades:', err.message)
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

export async function loadBook(id: string): Promise<BookProject | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
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
