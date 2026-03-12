import { writable, derived } from 'svelte/store';
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import type { LanguageId } from './language';

const DEFAULT_INITIAL_CODE = `// Select some code and press ⌘⇧E (Mac) or Ctrl+Shift+E (Win) to add an inline annotation.

function createMultiplier(factor) {
  return (n) => n * factor;
}
const double = createMultiplier(2);
const triple = createMultiplier(3);

const config = { theme: { dark: true }, limit: 10 };
const limit = config?.pagination?.limit ?? 25;

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

function memoize(fn) {
  const cache = new Map();
  return function (...args) {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn.apply(this, args));
    return cache.get(key);
  };
}

const items = [{ id: 1, qty: 2 }, { id: 2, qty: 1 }];
const total = items.reduce((acc, { qty, ...rest }) => acc + qty, 0);
`;

const DEFAULT_PYTHON_CODE = `# Select some code and press ⌘⇧E (Mac) or Ctrl+Shift+E (Win) to add an inline annotation.

name = "World"
print(f"Hello, {name}!")

def greet(who):
    return f"Hi, {who}"

for i in range(3):
    print(greet(name))

squares = [n * n for n in range(10)]
evens = [x for x in squares if x % 2 == 0]

from contextlib import contextmanager

@contextmanager
def managed_file(path):
    f = open(path, "w")
    try:
        yield f
    finally:
        f.close()

from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def distance(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5

import asyncio
from typing import Iterator, TypeVar

T = TypeVar("T")

async def fetch_all(urls: list[str]) -> list[str]:
    async def one(url: str) -> str:
        await asyncio.sleep(0.1)
        return url.upper()
    return await asyncio.gather(*[one(u) for u in urls])

def fib(n: int) -> Iterator[int]:
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

def memoize(fn):
    cache: dict = {}
    def wrapper(*args):
        key = tuple(args)
        if key not in cache:
            cache[key] = fn(*args)
        return cache[key]
    return wrapper

@memoize
def expensive(n: int) -> int:
    return n * n
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

export const LANGUAGE_TO_EXTENSION: Record<LanguageId, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  html: 'html',
  css: 'css',
  json: 'json'
};

export function pathWithExtension(path: string, language: LanguageId): string {
  const base = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : path;
  const ext = LANGUAGE_TO_EXTENSION[language];
  return base ? `${base}.${ext}` : `untitled.${ext}`;
}

function generateId(): string {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultFiles(): FileEntry[] {
  const jsFile: FileEntry = {
    id: generateId(),
    path: 'index.js',
    content: DEFAULT_INITIAL_CODE,
    language: 'javascript'
  };
  const pyFile: FileEntry = {
    id: generateId(),
    path: 'example.py',
    content: DEFAULT_PYTHON_CODE,
    language: 'python'
  };
  return [jsFile, pyFile];
}

function languageFromPath(path: string): LanguageId {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TO_LANGUAGE[ext] ?? 'javascript';
}

function loadFromStorage(): { files: FileEntry[]; activeFileId: string | null } {
  if (!browser || typeof localStorage === 'undefined') {
    const defaultFiles = getDefaultFiles();
    return { files: defaultFiles, activeFileId: defaultFiles[0].id };
  }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) {
      const defaultFiles = getDefaultFiles();
      return { files: defaultFiles, activeFileId: defaultFiles[0].id };
    }
    const parsed = JSON.parse(s) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { files?: unknown }).files)
    ) {
      const defaultFiles = getDefaultFiles();
      return { files: defaultFiles, activeFileId: defaultFiles[0].id };
    }
    const { files, activeFileId } = parsed as { files: unknown[]; activeFileId: string | null };
    const validFiles = files.filter(
      (f): f is FileEntry =>
        f != null &&
        typeof f === 'object' &&
        typeof (f as FileEntry).id === 'string' &&
        typeof (f as FileEntry).path === 'string' &&
        typeof (f as FileEntry).content === 'string' &&
        typeof (f as FileEntry).language === 'string'
    );
    const defaultFiles = getDefaultFiles();
    if (validFiles.length < defaultFiles.length) {
      return { files: defaultFiles, activeFileId: defaultFiles[0].id };
    }
    const activeId =
      typeof activeFileId === 'string' && validFiles.some((f) => f.id === activeFileId)
        ? activeFileId
        : validFiles[0].id;
    const hasOldPythonPlaceholder = (content: string) =>
      /# --- (Easy|Medium|Hard):/i.test(content);
    const hasOldJsPlaceholder = (content: string) =>
      content.includes('// closure and higher-order function') ||
      content.includes('// memoization (cache');
    const migratedFiles = validFiles.map((f) => {
      if (f.path === 'example.py' && f.language === 'python' && hasOldPythonPlaceholder(f.content))
        return { ...f, content: DEFAULT_PYTHON_CODE };
      if (f.path === 'index.js' && f.language === 'javascript' && hasOldJsPlaceholder(f.content))
        return { ...f, content: DEFAULT_INITIAL_CODE };
      return f;
    });
    if (migratedFiles.some((f, i) => f.content !== validFiles[i].content)) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ files: migratedFiles, activeFileId: activeId }));
      } catch {
        // ignore storage errors
      }
    }
    return { files: migratedFiles, activeFileId: activeId };
  } catch {
    const defaultFiles = getDefaultFiles();
    return { files: defaultFiles, activeFileId: defaultFiles[0].id };
  }
}

function saveToStorage(files: FileEntry[], activeFileId: string | null) {
  if (!browser || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, activeFileId }));
  } catch {
    // ignore storage errors
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
