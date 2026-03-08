<script lang="ts">
  import CodeEditor from '$lib/components/CodeEditor.svelte';
  import AnnotationOverlay from '$lib/components/AnnotationOverlay.svelte';
  import TopBar from '$lib/components/TopBar.svelte';
  import GranularityPicker from '$lib/components/GranularityPicker.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { editorInstance, selectionStore } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { languageStore } from '$lib/stores/language';
  import { panelVisible, activeAnnotationId } from '$lib/stores/ui';
  import { getSmartContext } from '$lib/utils/context';
  import type { Granularity } from '$lib/prompts/granularity';
  import type { SelectionRange } from '$lib/stores/editor';

  const initialCode = `// Select some code and press ⌘⇧E (Mac) or Ctrl+Shift+E (Win)
// to add an inline annotation.

function greet(name) {
  return \`Hello, \${name}!\`;
}

const result = [1, 2, 3].map((x) => x * 2);
console.log(result);
`;

  interface PendingTrigger {
    selection: SelectionRange;
    selectedText: string;
    code: string;
    smartContext: ReturnType<typeof getSmartContext>;
  }

  let pendingTrigger: PendingTrigger | null = null;

  function openGranularityPicker() {
    const editor = $editorInstance;
    const selection = $selectionStore;
    if (!editor || !selection) return;
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
    const language = $languageStore;

    const id = annotationsStore.add(selection, selectedText);

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
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="app">
  <TopBar />
  <main class="main">
    <section class="editor-section">
      <CodeEditor code={initialCode} language={$languageStore} />
      {#if $selectionStore && !pendingTrigger}
        <button
          type="button"
          class="trigger-btn"
          on:click={openGranularityPicker}
          title="Add annotation (⌘⇧E / Ctrl+Shift+E)"
        >
          Explain
        </button>
      {/if}
      {#if pendingTrigger}
        <div class="picker-popover" role="dialog" aria-label="Choose explanation style">
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
      <aside class="overlay-section">
        {#if $annotationsStore.length === 0}
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
    width: 320px;
    max-width: 35%;
    min-width: 280px;
    background: var(--bg-primary);
    border-left: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
  }

  @media (min-width: 1200px) {
    .editor-section {
      flex: 0 0 65%;
    }
    .overlay-section {
      flex: 0 0 35%;
      max-width: none;
      width: auto;
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
      flex: 0 0 40%;
      max-height: 40%;
      min-height: 200px;
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

  .trigger-btn {
    position: absolute;
    bottom: var(--space-lg);
    right: var(--space-lg);
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
    z-index: 10;
  }

  .trigger-btn:hover {
    background: #0b8278;
  }

  .trigger-btn:active {
    transform: scale(0.98);
  }

  .picker-popover {
    position: absolute;
    bottom: var(--space-lg);
    right: var(--space-lg);
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
