import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { LineRange } from '$lib/utils/context';

const PANEL_WIDTH_KEY = 'envisiage-panel-width';
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 720;

function loadPanelWidth(): number {
  if (!browser || typeof localStorage === 'undefined') return DEFAULT_PANEL_WIDTH;
  try {
    const v = localStorage.getItem(PANEL_WIDTH_KEY);
    if (v == null) return DEFAULT_PANEL_WIDTH;
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return DEFAULT_PANEL_WIDTH;
    return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, n));
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

function savePanelWidth(w: number) {
  if (!browser || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)));
  } catch {}
}

export const panelVisible = writable<boolean>(false);
export const panelWidth = writable<number>(loadPanelWidth());

export function setPanelWidth(w: number) {
  const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, w));
  panelWidth.set(clamped);
  savePanelWidth(clamped);
}

export const hoveredAnnotationId = writable<string | null>(null);
export const expandAndScrollToId = writable<string | null>(null);
export const activeAnnotationId = writable<string | null>(null);

/** Pixel position for the floating Explain button, relative to the editor container. Set by CodeEditor when selection is non-empty. */
export const floatingExplainRect = writable<{ top: number; left: number } | null>(null);

/** Per-annotation drag offset for in-editor cards (delta from default position). */
export const annotationCardOffsets = writable<Record<string, { x: number; y: number }>>({});

// ranges shown in the editor when hovering the granularity picker (enclosing scope + context window)
export interface ContextPreviewRanges {
  enclosing: LineRange | null;
  window: LineRange;
}
export const contextPreviewRanges = writable<ContextPreviewRanges | null>(null);
