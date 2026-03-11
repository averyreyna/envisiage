import { writable, derived } from 'svelte/store';
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import type { LanguageId } from './language';

const DEFAULT_INITIAL_CODE = `// Select some code and press ⌘⇧E (Mac) or Ctrl+Shift+E (Win) to add an inline annotation.

// closure and higher-order function
function createMultiplier(factor) {
  return (n) => n * factor;
}
const double = createMultiplier(2);
const triple = createMultiplier(3);

// optional chaining and nullish coalescing
const config = { theme: { dark: true }, limit: 10 };
const limit = config?.pagination?.limit ?? 25;

// async/await with error handling and AbortController
async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.json();
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
}

// memoization (cache by arguments)
function memoize(fn) {
  const cache = new Map();
  return function (...args) {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn.apply(this, args));
    return cache.get(key);
  };
}

// reducer and destructuring with rest
const items = [{ id: 1, qty: 2 }, { id: 2, qty: 1 }];
const total = items.reduce((acc, { qty, ...rest }) => acc + qty, 0);
`;

export interface FileEntry {
  id: string;
  path: string;
  content: string;
  language: LanguageId;
}

const STORAGE_KEY = 'envisiage-files';

const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  html: 'html',
  htm: 'html',
  css: 'css',
  json: 'json'
};

/** Preferred file extension per language (for syncing path when language changes). */
export const LANGUAGE_TO_EXTENSION: Record<LanguageId, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  html: 'html',
  css: 'css',
  json: 'json'
};

/** Returns path with extension replaced for the given language (e.g. "index.js" + python → "index.py"). */
export function pathWithExtension(path: string, language: LanguageId): string {
  const base = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : path;
  const ext = LANGUAGE_TO_EXTENSION[language];
  return base ? `${base}.${ext}` : `untitled.${ext}`;
}

function generateId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function languageFromPath(path: string): LanguageId {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TO_LANGUAGE[ext] ?? 'javascript';
}

function loadFromStorage(): { files: FileEntry[]; activeFileId: string | null } {
  if (!browser || typeof localStorage === 'undefined') {
    const defaultFile: FileEntry = {
      id: generateId(),
      path: 'index.js',
      content: DEFAULT_INITIAL_CODE,
      language: 'javascript'
    };
    return { files: [defaultFile], activeFileId: defaultFile.id };
  }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) {
      const defaultFile: FileEntry = {
        id: generateId(),
        path: 'index.js',
        content: DEFAULT_INITIAL_CODE,
        language: 'javascript'
      };
      return { files: [defaultFile], activeFileId: defaultFile.id };
    }
    const parsed = JSON.parse(s) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { files?: unknown }).files)
    ) {
      const defaultFile: FileEntry = {
        id: generateId(),
        path: 'index.js',
        content: DEFAULT_INITIAL_CODE,
        language: 'javascript'
      };
      return { files: [defaultFile], activeFileId: defaultFile.id };
    }
    const { files, activeFileId } = parsed as { files: unknown[]; activeFileId: string | null };
    const validFiles = files.filter(
      (f): f is FileEntry =>
        f &&
        typeof f === 'object' &&
        typeof (f as FileEntry).id === 'string' &&
        typeof (f as FileEntry).path === 'string' &&
        typeof (f as FileEntry).content === 'string' &&
        typeof (f as FileEntry).language === 'string'
    );
    if (validFiles.length === 0) {
      const defaultFile: FileEntry = {
        id: generateId(),
        path: 'index.js',
        content: DEFAULT_INITIAL_CODE,
        language: 'javascript'
      };
      return { files: [defaultFile], activeFileId: defaultFile.id };
    }
    const activeId =
      typeof activeFileId === 'string' && validFiles.some((f) => f.id === activeFileId)
        ? activeFileId
        : validFiles[0].id;
    return { files: validFiles, activeFileId: activeId };
  } catch {
    const defaultFile: FileEntry = {
      id: generateId(),
      path: 'index.js',
      content: DEFAULT_INITIAL_CODE,
      language: 'javascript'
    };
    return { files: [defaultFile], activeFileId: defaultFile.id };
  }
}

function saveToStorage(files: FileEntry[], activeFileId: string | null) {
  if (!browser || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, activeFileId }));
  } catch {
    // ignore
  }
}

function createFilesStore() {
  const { files: initialFiles, activeFileId: initialActiveId } = loadFromStorage();
  const files = writable<FileEntry[]>(initialFiles);
  const activeFileId = writable<string | null>(initialActiveId);

  const save = (fileList: FileEntry[], activeId: string | null) => {
    saveToStorage(fileList, activeId);
  };

  return {
    files: { subscribe: files.subscribe },
    activeFileId: { subscribe: activeFileId.subscribe },

    addFile(path: string, content = '', language?: LanguageId): string {
      const id = generateId();
      const lang = language ?? languageFromPath(path);
      const entry: FileEntry = { id, path, content, language: lang };
      files.update((list) => {
        const next = [...list, entry];
        save(next, id);
        return next;
      });
      activeFileId.set(id);
      return id;
    },

    removeFile(id: string) {
      let newActiveId: string | null = null;
      files.update((list) => {
        const idx = list.findIndex((f) => f.id === id);
        if (idx === -1) return list;
        const next = list.filter((f) => f.id !== id);
        if (next.length > 0) {
          const current = get(activeFileId);
          newActiveId =
            current === id ? (list[idx - 1]?.id ?? next[0].id) : current;
        }
        save(next, newActiveId);
        return next;
      });
      activeFileId.set(newActiveId);
    },

    setActiveFile(id: string | null) {
      activeFileId.set(id);
      files.update((list) => {
        save(list, id);
        return list;
      });
    },

    updateFileContent(id: string, content: string) {
      files.update((list) => {
        const next = list.map((f) => (f.id === id ? { ...f, content } : f));
        save(next, get(activeFileId));
        return next;
      });
    },

    renameFile(id: string, newPath: string) {
      const lang = languageFromPath(newPath);
      files.update((list) => {
        const next = list.map((f) =>
          f.id === id ? { ...f, path: newPath, language: lang } : f
        );
        save(next, get(activeFileId));
        return next;
      });
    },

    updateFileLanguage(id: string, language: LanguageId) {
      files.update((list) => {
        const next = list.map((f) => (f.id === id ? { ...f, language } : f));
        save(next, get(activeFileId));
        return next;
      });
    }
  };
}

const store = createFilesStore();

export const filesStore = store;
export const activeFileIdStore = store.activeFileId;

export const activeFile = derived(
  [store.files, store.activeFileId],
  ([$files, $activeId]) => $files.find((f) => f.id === $activeId) ?? null
);
