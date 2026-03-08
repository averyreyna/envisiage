<script lang="ts">
  import { GRANULARITY_LABELS, type Granularity } from '$lib/prompts/granularity';
  import { contextPreviewRanges } from '$lib/stores/ui';
  import type { SmartContext } from '$lib/utils/context';

  export let contextRanges: SmartContext | null = null;
  export let disabled = false;

  function select(value: string) {
    if (disabled) return;
    dispatch('select', { granularity: value as Granularity });
  }

  function handleMouseEnter() {
    if (contextRanges) {
      contextPreviewRanges.set({
        enclosing: contextRanges.enclosingScopeRange,
        window: contextRanges.contextWindowRange
      });
    }
  }

  function handleMouseLeave() {
    contextPreviewRanges.set(null);
  }

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{ select: { granularity: Granularity } }>();
</script>

<div
  class="picker"
  role="group"
  aria-label="Explanation style"
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
>
  <span class="picker-label">Explain:</span>
  <div class="pills">
    {#each Object.entries(GRANULARITY_LABELS) as [value, label]}
      <button
        type="button"
        class="pill"
        disabled={disabled}
        aria-pressed="false"
        aria-label="{label}"
        on:click={() => select(value)}
      >
        {label}
      </button>
    {/each}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .picker-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .pill {
    padding: var(--space-xs) var(--space-sm);
    font-size: 12px;
    font-family: var(--font-ui);
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    cursor: pointer;
    transition:
      border-color var(--duration-fast),
      background var(--duration-fast),
      color var(--duration-fast);
  }

  .pill:hover:not(:disabled) {
    border-color: var(--ai-teal);
    background: var(--ai-teal-muted);
    color: var(--ai-teal);
  }

  .pill:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
