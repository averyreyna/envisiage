import { writable } from 'svelte/store';
import type { LineRange } from '$lib/utils/context';

export const panelVisible = writable<boolean>(true);
export const hoveredAnnotationId = writable<string | null>(null);
export const expandAndScrollToId = writable<string | null>(null);
export const activeAnnotationId = writable<string | null>(null);

// ranges shown in the editor when hovering the granularity picker (enclosing scope + context window)
export interface ContextPreviewRanges {
  enclosing: LineRange | null;
  window: LineRange;
}
export const contextPreviewRanges = writable<ContextPreviewRanges | null>(null);
