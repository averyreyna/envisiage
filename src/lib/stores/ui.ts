import { writable } from 'svelte/store';

/** Annotation id when user hovers a card — used for code highlight and z-index */
export const hoveredAnnotationId = writable<string | null>(null);

/** When set, overlay should expand this annotation and scroll it into view, then clear */
export const expandAndScrollToId = writable<string | null>(null);
