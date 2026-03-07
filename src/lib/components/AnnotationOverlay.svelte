<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { marked } from 'marked';
  import { editorInstance, editorScrollTop } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { hoveredAnnotationId, expandAndScrollToId } from '$lib/stores/ui';
  import { annotationSummary } from '$lib/utils/summary';
  import type { Annotation } from '$lib/stores/annotations';

  $: editor = $editorInstance;
  $: scrollTop = $editorScrollTop;
  $: annotations = $annotationsStore;
  $: hoveredId = $hoveredAnnotationId;
  $: expandId = $expandAndScrollToId;

  let followUpInputs: Record<string, string> = {};
  let followUpSubmitting: Record<string, boolean> = {};
  let reExplainSubmitting: Record<string, boolean> = {};

  function rangesOverlap(
    a: { startLine: number; endLine: number },
    b: { startLine: number; endLine: number }
  ): boolean {
    return a.startLine <= b.endLine && b.startLine <= a.endLine;
  }

  $: positions = editor
    ? annotations.map((annotation, index) => {
        const baseTop =
          editor.getTopForLineNumber(annotation.selectionRange.startLine) - scrollTop;
        const stackOffset = annotations
          .slice(0, index)
          .filter((other) =>
            rangesOverlap(annotation.selectionRange, other.selectionRange)
          ).length;
        const top = baseTop + stackOffset * 40;
        const isHovered = hoveredId === annotation.id;
        const zIndex = 10 + (isHovered ? 100 : 0) + (annotations.length - index);
        return { annotation, top, zIndex };
      })
    : [];

  $: if (expandId) {
    const id = expandId;
    expandAndScrollToId.set(null);
    annotationsStore.expand(id);
    tick().then(() => {
      document.getElementById(`annotation-card-${id}`)?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });
  }

  function remove(id: string) {
    annotationsStore.remove(id);
  }

  function toggleCollapsed(id: string) {
    annotationsStore.toggleCollapsed(id);
  }

  function handleCardClick(annotation: Annotation, e: MouseEvent) {
    if (annotation.status === 'collapsed') {
      toggleCollapsed(annotation.id);
    }
    const target = e.target as HTMLElement;
    if (target.closest('.card-dismiss')) return;
  }

  function renderedHtml(text: string): string {
    if (!text.trim()) return '';
    return marked.parse(text, { async: false }) as string;
  }

  async function submitFollowUp(annotationId: string) {
    const q = (followUpInputs[annotationId] ?? '').trim();
    if (!q || followUpSubmitting[annotationId]) return;
    followUpInputs[annotationId] = '';
    followUpInputs = followUpInputs;
    followUpSubmitting[annotationId] = true;
    followUpSubmitting = followUpSubmitting;

    annotationsStore.appendUserMessage(annotationId, q);
    annotationsStore.startAssistantReply(annotationId);

    const list = get(annotationsStore);
    const ann = list.find((a) => a.id === annotationId);
    if (!ann) {
      followUpSubmitting[annotationId] = false;
      followUpSubmitting = followUpSubmitting;
      return;
    }
    // Thread now ends with [newUserMsg, emptyAssistant]; send history only for API
    const threadForApi = ann.thread.slice(0, -2).map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: ann.selectedText,
          explanation: ann.explanation,
          thread: threadForApi,
          question: q
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        annotationsStore.setThreadError(annotationId, err.error ?? res.statusText);
        followUpSubmitting[annotationId] = false;
        followUpSubmitting = followUpSubmitting;
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        annotationsStore.setThreadError(annotationId, 'No response body');
        followUpSubmitting[annotationId] = false;
        followUpSubmitting = followUpSubmitting;
        return;
      }
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value)
          annotationsStore.appendAssistantReplyChunk(
            annotationId,
            decoder.decode(value, { stream: true })
          );
      }
    } catch (err) {
      annotationsStore.setThreadError(
        annotationId,
        err instanceof Error ? err.message : 'Request failed'
      );
    }
    followUpSubmitting[annotationId] = false;
    followUpSubmitting = followUpSubmitting;
  }

  async function reExplain(annotationId: string) {
    if (reExplainSubmitting[annotationId]) return;
    const list = get(annotationsStore);
    const ann = list.find((a) => a.id === annotationId);
    if (!ann) return;
    const ed = get(editorInstance);
    const model = ed?.getModel();
    const code = model?.getValue() ?? ann.selectedText;
    const lineCount = model?.getLineCount() ?? 1;
    const contextFrom = Math.max(1, ann.selectionRange.startLine - 10);
    const contextTo = Math.min(lineCount, ann.selectionRange.endLine + 10);
    const fullContext =
      model?.getValueInRange({
        startLineNumber: contextFrom,
        startColumn: 1,
        endLineNumber: contextTo,
        endColumn: model.getLineMaxColumn(contextTo)
      }) ?? ann.selectedText;
    const language = model?.getLanguageId?.() ?? 'javascript';

    reExplainSubmitting[annotationId] = true;
    reExplainSubmitting = reExplainSubmitting;
    annotationsStore.setExplanation(annotationId, '');
    annotationsStore.setStatus(annotationId, 'loading');

    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          selection: ann.selectedText,
          fullContext,
          language,
          reExplain: 'different'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        annotationsStore.setError(annotationId, err.error ?? res.statusText);
        reExplainSubmitting[annotationId] = false;
        reExplainSubmitting = reExplainSubmitting;
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        annotationsStore.setError(annotationId, 'No response body');
        reExplainSubmitting[annotationId] = false;
        reExplainSubmitting = reExplainSubmitting;
        return;
      }
      const decoder = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value)
          annotationsStore.appendExplanation(
            annotationId,
            decoder.decode(value, { stream: true })
          );
      }
      annotationsStore.setStatus(annotationId, 'complete');
    } catch (err) {
      annotationsStore.setError(
        annotationId,
        err instanceof Error ? err.message : 'Request failed'
      );
    }
    reExplainSubmitting[annotationId] = false;
    reExplainSubmitting = reExplainSubmitting;
  }
</script>

<div class="overlay">
  {#each positions as { annotation, top, zIndex } (annotation.id)}
    <div
      id="annotation-card-{annotation.id}"
      class="card"
      class:card-loading={annotation.status === 'loading'}
      class:card-streaming={annotation.status === 'streaming'}
      class:card-collapsed={annotation.status === 'collapsed'}
      style="top: {top}px; z-index: {zIndex}"
      role="region"
      aria-label="Annotation at line {annotation.selectionRange.startLine}"
      tabindex={annotation.status === 'collapsed' ? 0 : undefined}
      on:mouseenter={() => hoveredAnnotationId.set(annotation.id)}
      on:mouseleave={() => hoveredAnnotationId.set(null)}
      on:click={(e) => handleCardClick(annotation, e)}
      on:keydown={(e) => {
        if (annotation.status === 'collapsed' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          toggleCollapsed(annotation.id);
        }
      }}
    >
      <div class="card-accent"></div>
      <div class="card-body">
        {#if annotation.status === 'collapsed'}
          <div class="card-summary-row">
            <p class="card-summary">{annotationSummary(annotation.explanation)}</p>
            {#if annotation.thread.length > 0}
              <span class="card-thread-badge" aria-label="{annotation.thread.length} follow-up messages">
                {annotation.thread.length}
              </span>
            {/if}
          </div>
        {:else}
          <div class="card-scroll">
            <div class="card-content">
              {#if annotation.status === 'loading'}
                <p class="card-loading-text">Thinking…</p>
              {:else if annotation.explanation}
                <div class="card-markdown">{@html renderedHtml(annotation.explanation)}</div>
              {/if}
            </div>
            {#if annotation.thread.length > 0}
              <div class="card-thread">
                {#each annotation.thread as msg (msg.id)}
                  {#if msg.role === 'user'}
                    <div class="thread-msg thread-msg-user">
                      <div class="thread-msg-content">{msg.content}</div>
                    </div>
                  {:else}
                    <div class="thread-msg thread-msg-assistant">
                      <div class="thread-msg-accent"></div>
                      <div class="thread-msg-content thread-msg-markdown">
                        {@html renderedHtml(msg.content || '…')}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
          <div class="card-actions">
            {#if annotation.status !== 'loading'}
              <button
                type="button"
                class="card-collapse-btn"
                aria-label="Collapse annotation"
                on:click|stopPropagation={() => toggleCollapsed(annotation.id)}
              >
                −
              </button>
              <button
                type="button"
                class="card-reexplain-btn"
                aria-label="Re-explain from a different angle"
                disabled={reExplainSubmitting[annotation.id]}
                on:click|stopPropagation={() => reExplain(annotation.id)}
              >
                {reExplainSubmitting[annotation.id] ? '…' : 'Re-explain'}
              </button>
            {/if}
            <button
              type="button"
              class="card-dismiss"
              aria-label="Remove annotation"
              on:click|stopPropagation={() => remove(annotation.id)}
            >
              ×
            </button>
          </div>
          {#if annotation.status === 'complete'}
            <form
              class="thread-form"
              on:submit|preventDefault={() => submitFollowUp(annotation.id)}
            >
              <input
                type="text"
                class="thread-input"
                placeholder="Ask a follow-up..."
                bind:value={followUpInputs[annotation.id]}
                disabled={followUpSubmitting[annotation.id]}
                aria-label="Follow-up question"
              />
              <button
                type="submit"
                class="thread-submit"
                disabled={followUpSubmitting[annotation.id] || !(followUpInputs[annotation.id] ?? '').trim()}
                aria-label="Send follow-up"
              >
                {followUpSubmitting[annotation.id] ? '…' : 'Send'}
              </button>
            </form>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .overlay {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    flex-shrink: 0;
  }

  .card {
    position: absolute;
    left: var(--space-sm, 8px);
    right: var(--space-sm, 8px);
    max-height: 320px;
    min-height: 48px;
    background: var(--bg-editor, #fff);
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: flex;
    transition: top var(--duration-normal, 250ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
    cursor: default;
  }

  .card-collapsed {
    max-height: none;
    min-height: 40px;
    border-color: var(--border-subtle, #efefef);
    cursor: pointer;
  }

  .card-collapsed .card-accent {
    background: var(--text-muted, #9b9b9b);
  }

  .card-summary-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    flex: 1;
    min-width: 0;
  }

  .card-summary {
    margin: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-muted, #9b9b9b);
    font-size: var(--font-size-sm, 13px);
  }

  .card-thread-badge {
    flex-shrink: 0;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 500;
    color: var(--ai-teal, #0d9488);
    background: var(--ai-teal-muted, #f0fdfa);
    border-radius: 10px;
  }

  .card-loading {
    border-color: var(--ai-teal-light, #ccfbf1);
    box-shadow: 0 0 0 1px var(--ai-teal-light);
    animation: pulse-border var(--duration-slow, 400ms) ease-in-out infinite;
  }

  .card-streaming {
    border-color: var(--ai-teal-light, #ccfbf1);
  }

  @keyframes pulse-border {
    0%,
    100% {
      box-shadow: 0 0 0 1px var(--ai-teal-light);
    }
    50% {
      box-shadow: 0 0 0 3px var(--ai-teal-light), 0 0 12px var(--ai-teal-glow);
    }
  }

  .card-accent {
    width: 3px;
    background: var(--ai-teal, #0d9488);
    border-radius: 3px 0 0 3px;
    flex-shrink: 0;
  }

  .card-body {
    flex: 1;
    min-width: 0;
    padding: var(--space-sm, 8px) var(--space-md, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
  }

  .card-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
  }

  .card-content {
    flex-shrink: 0;
    font-size: var(--font-size-sm, 13px);
    color: var(--text-primary, #1a1a1a);
  }

  .card-loading-text {
    margin: 0;
    color: var(--text-secondary, #6b6b6b);
  }

  .card-markdown :global(p) {
    margin: 0 0 0.5em;
  }

  .card-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .card-markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-secondary, #f2f2f2);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }

  .card-markdown :global(pre) {
    margin: 0.5em 0;
    padding: var(--space-sm);
    background: var(--bg-secondary);
    border-radius: 4px;
    overflow-x: auto;
  }

  .card-markdown :global(pre code) {
    background: none;
    padding: 0;
  }

  .card-markdown :global(ol),
  .card-markdown :global(ul) {
    margin: 0.5em 0;
    padding-left: 1.25em;
  }

  .card-thread {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm, 8px);
    flex-shrink: 0;
  }

  .thread-msg {
    font-size: var(--font-size-sm, 13px);
    border-radius: 6px;
    padding: var(--space-sm, 8px) var(--space-md, 12px);
  }

  .thread-msg-user {
    align-self: flex-end;
    max-width: 90%;
    background: var(--bg-secondary, #f2f2f2);
    color: var(--text-primary, #1a1a1a);
  }

  .thread-msg-assistant {
    align-self: flex-start;
    max-width: 100%;
    display: flex;
    gap: var(--space-xs, 4px);
    background: var(--bg-editor, #fff);
    border: 1px solid var(--border-subtle, #efefef);
    border-left: 3px solid var(--ai-teal, #0d9488);
  }

  .thread-msg-accent {
    flex-shrink: 0;
    width: 0;
  }

  .thread-msg-content {
    flex: 1;
    min-width: 0;
  }

  .thread-msg-markdown :global(p) {
    margin: 0 0 0.35em;
  }

  .thread-msg-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .thread-msg-markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-secondary);
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }

  .thread-form {
    display: flex;
    gap: var(--space-xs, 4px);
    flex-shrink: 0;
  }

  .thread-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-size: var(--font-size-sm, 13px);
    font-family: var(--font-ui);
    border: 1px solid var(--border-subtle, #efefef);
    border-radius: 6px;
    background: var(--bg-editor, #fff);
    color: var(--text-primary, #1a1a1a);
    transition: border-color var(--duration-fast, 150ms);
  }

  .thread-input::placeholder {
    color: var(--text-muted, #9b9b9b);
  }

  .thread-input:focus {
    outline: none;
    border-color: var(--ai-teal, #0d9488);
  }

  .thread-submit {
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-size: var(--font-size-sm, 13px);
    font-family: var(--font-ui);
    font-weight: 500;
    color: white;
    background: var(--ai-teal, #0d9488);
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .thread-submit:hover:not(:disabled) {
    background: #0b8278;
  }

  .thread-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs, 4px);
    flex-shrink: 0;
  }

  .card-collapse-btn,
  .card-reexplain-btn,
  .card-dismiss {
    background: none;
    border: none;
    padding: var(--space-xs, 4px) var(--space-sm, 8px);
    font-size: 13px;
    line-height: 1;
    color: var(--text-muted, #9b9b9b);
    cursor: pointer;
    border-radius: 4px;
  }

  .card-collapse-btn {
    font-size: 16px;
    padding: var(--space-xs, 4px);
  }

  .card-reexplain-btn {
    font-size: 12px;
  }

  .card-collapse-btn:hover,
  .card-reexplain-btn:hover:not(:disabled),
  .card-dismiss:hover {
    color: var(--text-primary, #1a1a1a);
    background: var(--bg-secondary, #f2f2f2);
  }

  .card-reexplain-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }
</style>
