<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import CodeEditor from '$lib/components/CodeEditor.svelte';
  import AnnotationOverlay from '$lib/components/AnnotationOverlay.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import FileTabs from '$lib/components/FileTabs.svelte';
  import GranularityPicker from '$lib/components/GranularityPicker.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { editorInstance, selectionStore } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { filesStore } from '$lib/stores/files';
  import { languageStore } from '$lib/stores/language';
  import { panelVisible, activeAnnotationId, panelWidth, setPanelWidth, floatingExplainRect, contextPreviewRanges } from '$lib/stores/ui';
  import { getSmartContext } from '$lib/utils/context';
  import type { Granularity } from '$lib/prompts/granularity';
  import type { SelectionRange } from '$lib/stores/editor';

  const filesStoreFiles = filesStore.files;
  const filesStoreActiveId = filesStore.activeFileId;
  $: files = $filesStoreFiles;
  $: activeFileId = $filesStoreActiveId;
  $: selection = $selectionStore;
  $: annotations = $annotationsStore;
  $: hasAnnotationForSelection =
    activeFileId != null &&
    selection != null &&
    annotations.some(
      (a) =>
        a.fileId === activeFileId &&
        a.selectionRange.startLine === selection.startLine &&
        a.selectionRange.startCol === selection.startCol &&
        a.selectionRange.endLine === selection.endLine &&
        a.selectionRange.endCol === selection.endCol
    );

  interface PendingTrigger {
    selection: SelectionRange;
    selectedText: string;
    code: string;
    smartContext: ReturnType<typeof getSmartContext>;
  }

  let pendingTrigger: PendingTrigger | null = null;
  let pickerDragOffset = { x: 0, y: 0 };
  let pickerDragging = false;
  let explainBtnOffset = { x: 0, y: 0 };
  let explainBtnDragging = false;

  function openGranularityPicker() {
    const editor = $editorInstance;
    const selection = $selectionStore;
    if (!editor || !selection || !activeFileId) return;
    const hasSelection =
      selection.startLine !== selection.endLine ||
      selection.startCol !== selection.endCol;
    if (!hasSelection) return;

    const model = editor.getModel();
    if (!model) return;

    const code = model.getValue();
    const range = {
      startLineNumber: selection.startLine,
      startColumn: selection.startCol,
      endLineNumber: selection.endLine,
      endColumn: selection.endCol
    };
    const selectedText = model.getValueInRange(range);
    const smartContext = getSmartContext(code, selection);

    contextPreviewRanges.set(null);
    pickerDragOffset = { x: 0, y: 0 };
    pendingTrigger = { selection, selectedText, code, smartContext };
  }

  function cancelPending() {
    pendingTrigger = null;
  }

  async function runExplain(granularity: Granularity) {
    const pending = pendingTrigger;
    pendingTrigger = null;
    if (!pending) return;

    const { selection, selectedText, code, smartContext } = pending;
    const language = files.find((f) => f.id === activeFileId)?.language ?? $languageStore;

    const id = annotationsStore.add(activeFileId, selection, selectedText);

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          selection: selectedText,
          language,
          granularity,
          contextAbove: smartContext.contextAbove,
          contextBelow: smartContext.contextBelow,
          enclosingScope: smartContext.enclosingScope || undefined
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        annotationsStore.setError(id, err.error ?? res.statusText);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        annotationsStore.setError(id, 'No response body');
        return;
      }
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) annotationsStore.appendExplanation(id, decoder.decode(value, { stream: true }));
      }
      annotationsStore.setStatus(id, 'complete');
    } catch (err) {
      annotationsStore.setError(id, err instanceof Error ? err.message : 'Request failed');
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      openGranularityPicker();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'A') {
      e.preventDefault();
      panelVisible.update((v) => !v);
    }
    if (e.key === 'Escape') {
      if (pendingTrigger) {
        pendingTrigger = null;
      } else {
        const activeId = $activeAnnotationId;
        if (activeId) {
          annotationsStore.toggleCollapsed(activeId);
          activeAnnotationId.set(null);
        }
      }
    }
  }

  function handleGranularitySelect(e: CustomEvent<{ granularity: Granularity }>) {
    runExplain(e.detail.granularity);
  }

  function startPickerDrag(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startOffset = { ...pickerDragOffset };
    function onMove(moveEvent: MouseEvent) {
      pickerDragOffset = {
        x: startOffset.x + (moveEvent.clientX - startX),
        y: startOffset.y + (moveEvent.clientY - startY)
      };
    }
    function onUp() {
      pickerDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (browser) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    pickerDragging = true;
    if (browser) {
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startExplainBtnDrag(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startOffset = { ...explainBtnOffset };
    function onMove(moveEvent: MouseEvent) {
      explainBtnOffset = {
        x: startOffset.x + (moveEvent.clientX - startX),
        y: startOffset.y + (moveEvent.clientY - startY)
      };
    }
    function onUp() {
      explainBtnDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (browser) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }
    explainBtnDragging = true;
    if (browser) {
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  let resizing = false;
  function startResize() {
    resizing = true;
  }
  function onResizeMove(e: MouseEvent) {
    if (!resizing) return;
    const main = document.querySelector('.main');
    if (!main) return;
    const rect = main.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const widthFromRight = rect.width - x;
    setPanelWidth(widthFromRight);
  }
  function stopResize() {
    resizing = false;
  }
  onMount(() => {
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', onResizeMove);
      window.removeEventListener('mouseup', stopResize);
    };
  });
  onDestroy(() => {
    if (browser) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
  $: if (browser) {
    if (resizing) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else if (pickerDragging || explainBtnDragging) {
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="app">
  <TopBar />
  <FileTabs />
  <main class="main">
    <section class="editor-section">
      <CodeEditor {files} {activeFileId} />
      {#if $floatingExplainRect && !pendingTrigger && !hasAnnotationForSelection}
        <div
          class="trigger-toolbar"
          style="top: {$floatingExplainRect.top + explainBtnOffset.y}px; left: {$floatingExplainRect.left + explainBtnOffset.x}px;"
          role="toolbar"
          aria-label="Explain selection"
        >
          <div
            class="trigger-toolbar-drag"
            role="button"
            tabindex="-1"
            aria-label="Drag to move"
            title="Drag to move"
            on:mousedown|preventDefault={startExplainBtnDrag}
          >
            <span class="trigger-toolbar-drag-grip" aria-hidden="true">⋮⋮</span>
          </div>
          <button
            type="button"
            class="trigger-btn"
            on:click={openGranularityPicker}
            title="Add annotation (⌘⇧E / Ctrl+Shift+E)"
          >
            Explain
          </button>
        </div>
      {/if}
      {#if pendingTrigger}
        <div
          class="picker-popover"
          class:picker-popover-anchored={$floatingExplainRect != null}
          style={$floatingExplainRect != null ? `top: ${$floatingExplainRect.top + 44 + pickerDragOffset.y}px; left: ${$floatingExplainRect.left - 288 + pickerDragOffset.x}px;` : ''}
          role="dialog"
          aria-label="Choose explanation style"
        >
          {#if $floatingExplainRect != null}
            <div
              class="picker-popover-drag"
              role="button"
              tabindex="-1"
              aria-label="Drag to move"
              title="Drag to move"
              on:mousedown|preventDefault={startPickerDrag}
            >
              <span class="picker-popover-drag-grip" aria-hidden="true">⋮⋮</span>
            </div>
          {/if}
          <GranularityPicker
            contextRanges={pendingTrigger.smartContext}
            on:select={handleGranularitySelect}
          />
          <button
            type="button"
            class="picker-cancel"
            aria-label="Cancel"
            on:click={cancelPending}
          >
            Cancel
          </button>
        </div>
      {/if}
    </section>
    {#if $panelVisible}
      <button
        type="button"
        class="resize-handle"
        aria-label="Resize explanation panel"
        on:mousedown|preventDefault={startResize}
      ></button>
      <aside class="overlay-section" style="--panel-width: {$panelWidth}px;">
        {#if activeFileId != null && $annotationsStore.filter((a) => a.fileId === activeFileId).length === 0}
          <EmptyState />
        {:else if activeFileId == null}
          <EmptyState />
        {:else}
          <AnnotationOverlay />
        {/if}
      </aside>
    {/if}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    overflow: hidden;
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: row;
  }

  .editor-section {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .overlay-section {
    flex-shrink: 0;
    width: var(--panel-width, 400px);
    max-width: 50%;
    min-width: 280px;
    min-height: 0;
    background: var(--bg-primary);
    border-left: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
  }

  .resize-handle {
    flex-shrink: 0;
    width: 6px;
    min-width: 6px;
    background: transparent;
    border: none;
    cursor: col-resize;
    padding: 0;
    margin: 0;
    position: relative;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
    background: var(--border-subtle, #efefef);
    border-radius: 1px;
    transition: background var(--duration-fast);
  }

  .resize-handle:hover::after,
  .resize-handle:focus-visible::after {
    background: var(--ai-teal, #0d9488);
  }

  @media (min-width: 1200px) {
    .editor-section {
      flex: 1;
      min-width: 0;
    }
    .overlay-section {
      max-width: 720px;
    }
  }

  @media (max-width: 1200px) and (min-width: 768px) {
    .main {
      flex-direction: column;
    }
    .editor-section {
      flex: 1;
      min-height: 60%;
    }
    .overlay-section {
      flex: 0 0 50%;
      max-height: 50%;
      min-height: 280px;
      width: 100%;
      max-width: none;
      border-left: none;
      border-top: 1px solid var(--border-default);
    }
  }

  @media (max-width: 767px) {
    .main {
      flex-direction: column;
    }
    .editor-section {
      flex: 1;
      min-height: 0;
    }
    .overlay-section {
      position: fixed;
      top: auto;
      bottom: 0;
      left: 0;
      right: 0;
      max-height: 70%;
      width: 100%;
      max-width: none;
      min-width: 0;
      border-left: none;
      border-top: 1px solid var(--border-default);
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
      z-index: 100;
      border-radius: 12px 12px 0 0;
    }
  }

  .trigger-toolbar {
    position: absolute;
    display: flex;
    align-items: center;
    padding: 4px 6px;
    background: var(--bg-editor);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    z-index: 10;
    gap: 4px;
  }

  .trigger-toolbar-drag {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    cursor: grab;
    color: var(--text-muted, #9b9b9b);
    border-radius: 4px;
  }

  .trigger-toolbar-drag:active {
    cursor: grabbing;
  }

  .trigger-toolbar-drag-grip {
    font-size: 12px;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .trigger-btn {
    padding: var(--space-sm) var(--space-md);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    font-weight: 500;
    color: white;
    background: var(--ai-teal);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(13, 148, 136, 0.35);
  }

  .trigger-btn:hover {
    background: #0b8278;
  }

  .trigger-btn:active {
    transform: scale(0.98);
  }

  .picker-popover {
    position: absolute;
    padding: var(--space-md);
    background: var(--bg-editor);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    max-width: 280px;
  }

  .picker-popover-drag {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: calc(-1 * var(--space-md)) calc(-1 * var(--space-md)) 0;
    padding: var(--space-xs) var(--space-md);
    cursor: grab;
    border-radius: 8px 8px 0 0;
    background: var(--bg-secondary, #f2f2f2);
    color: var(--text-muted, #9b9b9b);
  }

  .picker-popover-drag:active {
    cursor: grabbing;
  }

  .picker-popover-drag-grip {
    font-size: 12px;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .picker-popover:not(.picker-popover-anchored) {
    bottom: var(--space-lg);
    right: var(--space-lg);
  }

  .picker-cancel {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    align-self: flex-end;
  }

  .picker-cancel:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }
</style>
