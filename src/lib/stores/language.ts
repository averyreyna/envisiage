import { writable } from 'svelte/store';

export const SUPPORTED_LANGUAGES = [
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' }
] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number]['id'];

export const languageStore = writable<LanguageId>('javascript');
