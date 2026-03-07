<script lang="ts">
  import CodeEditor from '$lib/components/CodeEditor.svelte';
  import AnnotationOverlay from '$lib/components/AnnotationOverlay.svelte';
  import { editorInstance, selectionStore } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';

  const initialCode = `// Select some code and press ⌘⇧E (Mac) or Ctrl+Shift+E (Win)
// to add an inline annotation.

function greet(name) {
  return \`Hello, \${name}!\`;
}

const result = [1, 2, 3].map((x) => x * 2);
console.log(result);
`;

  async function triggerAnnotation() {
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

    const lineCount = model.getLineCount();
    const contextFrom = Math.max(1, selection.startLine - 10);
    const contextTo = Math.min(lineCount, selection.endLine + 10);
    const fullContext = model.getValueInRange({
      startLineNumber: contextFrom,
      startColumn: 1,
      endLineNumber: contextTo,
      endColumn: model.getLineMaxColumn(contextTo)
    });

    const language = model.getLanguageId?.() ?? 'javascript';
    const id = annotationsStore.add(selection, selectedText);

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          selection: selectedText,
          fullContext,
          language
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
      triggerAnnotation();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<main class="app">
  <section class="editor-section">
    <CodeEditor code={initialCode} language="javascript" />
    {#if $selectionStore}
      <button
        type="button"
        class="trigger-btn"
        on:click={triggerAnnotation}
        title="Add annotation (⌘⇧E / Ctrl+Shift+E)"
      >
        Explain
      </button>
    {/if}
  </section>
  <aside class="overlay-section">
    <AnnotationOverlay />
  </aside>
</main>

<style>
  .app {
    display: flex;
    height: 100vh;
    width: 100%;
    overflow: hidden;
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
    background: var(--bg-primary);
    border-left: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
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
</style>
