import { writable } from 'svelte/store';
import type * as Monaco from 'monaco-editor';

export interface SelectionRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export const editorInstance = writable<Monaco.editor.IStandaloneCodeEditor | null>(null);
export const selectionStore = writable<SelectionRange | null>(null);
export const editorScrollTop = writable<number>(0);
