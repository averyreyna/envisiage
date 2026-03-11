import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { SelectionRange } from './editor';

export type AnnotationStatus = 'loading' | 'streaming' | 'complete' | 'collapsed';

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Annotation {
  id: string;
  fileId: string;
  selectionRange: SelectionRange;
  selectedText: string;
  explanation: string;
  status: AnnotationStatus;
  timestamp: number;
  thread: ThreadMessage[];
}

const STORAGE_KEY = 'envisiage-annotations';

function generateId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateThreadMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadFromSession(): Annotation[] {
  if (!browser || typeof sessionStorage === 'undefined') return [];
  try {
    const s = sessionStorage.getItem(STORAGE_KEY);
    if (!s) return [];
    const parsed = JSON.parse(s) as unknown;
    if (!Array.isArray(parsed)) return [];
    const LEGACY_DEFAULT_FILE_ID = 'default';
    return parsed
      .filter(
        (a): a is Annotation & { fileId?: string } =>
          a &&
          typeof a === 'object' &&
          typeof a.id === 'string' &&
          a.selectionRange &&
          typeof a.selectedText === 'string' &&
          typeof a.explanation === 'string' &&
          typeof a.status === 'string' &&
          typeof a.timestamp === 'number' &&
          Array.isArray(a.thread)
      )
      .map((a) => ({
        ...a,
        fileId: typeof a.fileId === 'string' ? a.fileId : LEGACY_DEFAULT_FILE_ID
      }));
  } catch {
    return [];
  }
}

function saveToSession(list: Annotation[]) {
  if (!browser || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
  }
}

function createAnnotationsStore() {
  const initial = loadFromSession();
  const { subscribe, set, update } = writable<Annotation[]>(initial);

  const save = (list: Annotation[]) => {
    saveToSession(list);
  };

  return {
    subscribe,
    add: (fileId: string, selectionRange: SelectionRange, selectedText: string): string => {
      const id = generateId();
      update((list) => {
        const next = [
          ...list,
          {
            id,
            fileId,
            selectionRange,
            selectedText,
            explanation: '',
            status: 'loading' as AnnotationStatus,
            timestamp: Date.now(),
            thread: []
          }
        ];
        save(next);
        return next;
      });
      return id;
    },
    remove: (id: string) => {
      update((list) => {
        const next = list.filter((a) => a.id !== id);
        save(next);
        return next;
      });
    },
    appendExplanation: (id: string, chunk: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === id
            ? {
                ...a,
                explanation: a.explanation + chunk,
                status: 'streaming' as AnnotationStatus
              }
            : a
        );
        save(next);
        return next;
      });
    },
    setStatus: (id: string, status: AnnotationStatus) => {
      update((list) => {
        const next = list.map((a) => (a.id === id ? { ...a, status } : a));
        save(next);
        return next;
      });
    },
    setError: (id: string, message: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === id
            ? { ...a, explanation: `Error: ${message}`, status: 'complete' as AnnotationStatus }
            : a
        );
        save(next);
        return next;
      });
    },
    toggleCollapsed: (id: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === id
            ? {
                ...a,
                status: (a.status === 'collapsed' ? 'complete' : 'collapsed') as AnnotationStatus
              }
            : a
        );
        save(next);
        return next;
      });
    },
    expand: (id: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === id ? { ...a, status: 'complete' as AnnotationStatus } : a
        );
        save(next);
        return next;
      });
    },
    appendUserMessage: (annotationId: string, content: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === annotationId
            ? {
                ...a,
                thread: [
                  ...a.thread,
                  {
                    id: generateThreadMessageId(),
                    role: 'user' as const,
                    content,
                    timestamp: Date.now()
                  }
                ]
              }
            : a
        );
        save(next);
        return next;
      });
    },
    startAssistantReply: (annotationId: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === annotationId
            ? {
                ...a,
                thread: [
                  ...a.thread,
                  {
                    id: generateThreadMessageId(),
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now()
                  }
                ]
              }
            : a
        );
        save(next);
        return next;
      });
    },
    appendAssistantReplyChunk: (annotationId: string, chunk: string) => {
      update((list) => {
        const next = list.map((a) => {
          if (a.id !== annotationId || a.thread.length === 0) return a;
          const last = a.thread[a.thread.length - 1];
          if (last.role !== 'assistant') return a;
          const newThread = [...a.thread];
          newThread[newThread.length - 1] = { ...last, content: last.content + chunk };
          return { ...a, thread: newThread };
        });
        save(next);
        return next;
      });
    },
    setThreadError: (annotationId: string, message: string) => {
      update((list) => {
        const next = list.map((a) => {
          if (a.id !== annotationId || a.thread.length === 0) return a;
          const last = a.thread[a.thread.length - 1];
          if (last.role !== 'assistant') return a;
          const newThread = [...a.thread];
          newThread[newThread.length - 1] = { ...last, content: `Error: ${message}` };
          return { ...a, thread: newThread };
        });
        save(next);
        return next;
      });
    },
    setExplanation: (annotationId: string, explanation: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === annotationId ? { ...a, explanation } : a
        );
        save(next);
        return next;
      });
    },
    replaceExplanation: (annotationId: string, explanation: string) => {
      update((list) => {
        const next = list.map((a) =>
          a.id === annotationId ? { ...a, explanation, status: 'complete' as AnnotationStatus } : a
        );
        save(next);
        return next;
      });
    },
    clear: () => {
      set([]);
      save([]);
    }
  };
}

export const annotationsStore = createAnnotationsStore();

export type PlaceholderAnnotation = Annotation;
