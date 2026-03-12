<script lang="ts">
  import { tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { marked } from 'marked';
  import { annotationsStore } from '$lib/stores/annotations';
  import { filesStore } from '$lib/stores/files';
  import { expandAndScrollToId, activeAnnotationId } from '$lib/stores/ui';
  import { annotationSummary } from '$lib/utils/summary';
  import { runReExplain } from '$lib/api/explain';
  import { submitFollowUp as submitFollowUpApi } from '$lib/api/followup';
  import FollowUpForm from '$lib/components/FollowUpForm.svelte';
  import type { Annotation } from '$lib/stores/annotations';
  import type { ReExplainVariant } from '$lib/api/explain';

  const flyParams = { x: 24, duration: 300, easing: cubicOut };
  const wordFadeParams = { duration: 100 };

  function streamingSegments(text: string): string[] {
    if (!text.trim()) return [];
    return text.split(/(\s+)/).filter(Boolean);
  }

  const activeFileIdStore = filesStore.activeFileId;
  $: activeFileId = $activeFileIdStore;
  $: annotations =
    activeFileId != null
      ? $annotationsStore.filter((a) => a.fileId === activeFileId)
      : [];
  $: expandId = $expandAndScrollToId;

  $: annotations, followUpSubmitting;
  $: if (annotations.length) {
    for (const ann of annotations) {
      if (followUpSubmitting[ann.id]) {
        const el = cardScrollRefs[ann.id];
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      }
    }
  }

  let followUpSubmitting: Record<string, boolean> = {};
  let reExplainSubmitting: Record<string, boolean> = {};
  let cardScrollRefs: Record<string, HTMLDivElement> = {};
  let cardRefs: Record<string, HTMLDivElement> = {};
  let resizeState: { id: string; startY: number; startHeight: number } | null = null;
  const DEFAULT_CARD_HEIGHT = 320;
  const MIN_CARD_HEIGHT = 120;
  const MAX_CARD_HEIGHT = 520;
  let cardHeights: Record<string, number> = {};

  function lineLabel(range: { startLine: number; endLine: number }): string {
    return range.startLine === range.endLine
      ? `Line ${range.startLine}`
      : `Lines ${range.startLine}–${range.endLine}`;
  }

  $: if (expandId) {
    const id = expandId;
    expandAndScrollToId.set(null);
    activeAnnotationId.set(id);
    annotationsStore.expand(id);
    tick().then(() => {
      document.getElementById(`annotation-card-${id}`)?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });
  }

  function remove(id: string) {
    if ($activeAnnotationId === id) activeAnnotationId.set(null);
    annotationsStore.remove(id);
  }

  function toggleCollapsed(annotation: Annotation) {
    const expanding = annotation.status === 'collapsed';
    annotationsStore.toggleCollapsed(annotation.id);
    if (expanding) {
      activeAnnotationId.set(annotation.id);
    } else {
      activeAnnotationId.set(null);
    }
  }

  function handleCardClick(annotation: Annotation, e: MouseEvent) {
    if (annotation.status === 'collapsed') {
      toggleCollapsed(annotation);
    }
    const target = e.target as HTMLElement;
    if (target.closest('.card-dismiss')) return;
  }

  function renderedHtml(text: string): string {
    if (!text.trim()) return '';
    return marked.parse(text, { async: false }) as string;
  }

  function scrollCardToBottom(annotationId: string) {
    const el = cardScrollRefs[annotationId];
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  async function submitFollowUp(annotationId: string, question: string) {
    const q = question.trim();
    if (!q || followUpSubmitting[annotationId]) return;
    followUpSubmitting[annotationId] = true;
    followUpSubmitting = followUpSubmitting;

    tick().then(() => scrollCardToBottom(annotationId));

    try {
      await submitFollowUpApi(annotationId, q);
    } finally {
      followUpSubmitting[annotationId] = false;
      followUpSubmitting = followUpSubmitting;
    }
  }

  async function handleReExplainVariant(annotationId: string, variant: ReExplainVariant) {
    if (reExplainSubmitting[annotationId]) return;
    reExplainSubmitting[annotationId] = true;
    reExplainSubmitting = reExplainSubmitting;
    try {
      await runReExplain(annotationId, variant);
    } finally {
      reExplainSubmitting[annotationId] = false;
      reExplainSubmitting = reExplainSubmitting;
    }
  }

  const REEXPLAIN_VARIANTS: { value: ReExplainVariant; label: string }[] = [
    { value: 'simpler', label: 'Simpler' },
    { value: 'technical', label: 'Technical' },
    { value: 'different', label: 'Different angle' }
  ];

  function getCardHeight(annotation: Annotation): number {
    if (annotation.status === 'collapsed') return 0;
    return cardHeights[annotation.id] ?? DEFAULT_CARD_HEIGHT;
  }

  function handleResizeStart(annotationId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const card = cardRefs[annotationId];
    if (!card) return;
    const rect = card.getBoundingClientRect();
    resizeState = {
      id: annotationId,
      startY: e.clientY,
      startHeight: rect.height
    };
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!resizeState || resizeState.id !== annotationId) return;
      const dy = moveEvent.clientY - resizeState.startY;
      let newHeight = Math.round(Math.min(MAX_CARD_HEIGHT, Math.max(MIN_CARD_HEIGHT, resizeState.startHeight + dy)));
      cardHeights[annotationId] = newHeight;
      cardHeights = cardHeights;
    };
    const onMouseUp = () => {
      resizeState = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
</script>

<div class="overlay">
  {#each annotations as annotation (annotation.id)}
    <div
      class="card-wrapper"
      in:fly={flyParams}
      out:fly={flyParams}
    >
      <div
        id="annotation-card-{annotation.id}"
        class="card"
        class:card-loading={annotation.status === 'loading'}
        class:card-streaming={annotation.status === 'streaming'}
        class:card-collapsed={annotation.status === 'collapsed'}
        style={annotation.status !== 'collapsed' ? `height: ${getCardHeight(annotation)}px` : ''}
        bind:this={cardRefs[annotation.id]}
        role={annotation.status === 'collapsed' ? 'button' : 'region'}
        aria-label="Annotation at line {annotation.selectionRange.startLine}"
        tabindex={annotation.status === 'collapsed' ? 0 : -1}
        on:click={(e) => handleCardClick(annotation, e)}
        on:keydown={(e) => {
          if (annotation.status === 'collapsed' && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            toggleCollapsed(annotation);
          }
        }}
      >
        {#if annotation.status === 'loading' || annotation.status === 'streaming'}
          <div class="card-energy" aria-hidden="true"></div>
        {/if}
        <div class="card-accent"></div>
        <div class="card-body">
          <span class="card-line-badge" aria-hidden="true">{lineLabel(annotation.selectionRange)}</span>
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
            <div class="card-scroll" bind:this={cardScrollRefs[annotation.id]}>
              <div class="card-content">
                {#if annotation.status === 'loading'}
                  <p class="card-loading-text">Thinking…</p>
                {:else if (annotation.status === 'streaming' && annotation.explanation)}
                  <div class="card-markdown card-markdown-streaming">
                    {#each streamingSegments(annotation.explanation) as segment, i (i)}
                      <span class="streaming-word" in:fade={wordFadeParams}>{segment}</span>
                    {/each}
                  </div>
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
                on:click|stopPropagation={() => toggleCollapsed(annotation)}
              >
                −
              </button>
              {#each REEXPLAIN_VARIANTS as { value, label }}
                <button
                  type="button"
                  class="card-reexplain-btn"
                  aria-label="Re-explain: {label}"
                  disabled={reExplainSubmitting[annotation.id]}
                  on:click|stopPropagation={() => handleReExplainVariant(annotation.id, value)}
                >
                  {reExplainSubmitting[annotation.id] ? '…' : label}
                </button>
              {/each}
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
            <FollowUpForm
              annotationId={annotation.id}
              disabled={followUpSubmitting[annotation.id]}
              on:submit={(e) => submitFollowUp(annotation.id, e.detail.question)}
            />
          {/if}
            {#if annotation.status !== 'collapsed'}
              <div
                class="card-resize-handle"
                aria-label="Resize annotation"
                title="Drag to resize"
                role="separator"
                on:mousedown|stopPropagation={(e) => handleResizeStart(annotation.id, e)}
              ></div>
            {/if}
        {/if}
      </div>
    </div>
    </div>
  {/each}
</div>

<style>
  .overlay {
    display: flex;
    flex-direction: column;
    gap: var(--space-md, 16px);
    padding: var(--space-md, 16px) var(--space-sm, 8px);
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 0;
    flex: 1;
    width: 100%;
    min-width: 200px;
  }

  .card-wrapper {
    flex-shrink: 0;
  }

  .card-line-badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted, #9b9b9b);
    margin-bottom: var(--space-xs, 4px);
  }

  .card {
    position: relative;
    left: 0;
    right: 0;
    height: 320px;
    max-height: 520px;
    min-height: 120px;
    background: var(--ai-teal-fill, rgba(204, 251, 241, 0.75));
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    display: flex;
    cursor: default;
    overflow: hidden;
  }

  @media (max-width: 767px) {
    .card:not(.card-collapsed) {
      max-height: 320px;
    }
  }

  .card-collapsed {
    height: auto;
    max-height: none;
    min-height: 40px;
    resize: none;
    overflow: visible;
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

  .card-energy {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    border-radius: 6px 6px 0 0;
    background: linear-gradient(
      90deg,
      var(--ai-teal-light, #ccfbf1) 0%,
      var(--ai-teal, #0d9488) 50%,
      var(--ai-teal-light, #ccfbf1) 100%
    );
    background-size: 200% 100%;
    animation: card-energy-shimmer var(--duration-slow, 400ms) ease-in-out infinite;
  }

  @keyframes card-energy-shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  .card-markdown-streaming {
    display: inline;
  }

  .card-markdown-streaming .streaming-word {
    display: inline;
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

  .card-resize-handle {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 10px;
    cursor: ns-resize;
    flex-shrink: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.06), transparent);
    border-radius: 0 0 6px 6px;
  }

  .card-resize-handle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 4px;
    transform: translateX(-50%);
    width: 24px;
    height: 3px;
    border-radius: 2px;
    background: var(--text-muted, #9b9b9b);
    opacity: 0.6;
  }

  .card-resize-handle:hover::after {
    opacity: 1;
  }
</style>
