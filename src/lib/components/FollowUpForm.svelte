<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let annotationId: string;
  export let disabled = false;

  const dispatch = createEventDispatcher<{ submit: { question: string } }>();

  let value = '';

  function handleSubmit() {
    const q = value.trim();
    if (!q || disabled) return;
    value = '';
    value = value; // trigger svelte reactivity so submit button disabled state updates
    dispatch('submit', { question: q });
  }
</script>

<form
  class="thread-form"
  on:submit|preventDefault={handleSubmit}
>
  <input
    type="text"
    class="thread-input"
    placeholder="Ask a follow-up..."
    bind:value
    {disabled}
    aria-label="Follow-up question"
  />
  <button
    type="submit"
    class="thread-submit"
    disabled={disabled || !value.trim()}
    aria-label="Send follow-up"
  >
    {disabled ? '…' : 'Send'}
  </button>
</form>

<style>
  .thread-form {
    display: flex;
    gap: var(--space-xs, 4px);
    margin-top: var(--space-sm, 8px);
    flex-shrink: 0;
  }

  .thread-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-size: var(--font-size-sm, 13px);
    font-family: var(--font-ui, system-ui, sans-serif);
    border: 1px solid var(--border-subtle, #efefef);
    border-radius: 6px;
    background: var(--bg-editor, #fff);
    color: var(--text-primary, #1a1a1a);
    transition: border-color var(--duration-fast, 150ms);
  }

  .thread-input:focus {
    outline: none;
    border-color: var(--ai-teal, #0d9488);
  }

  .thread-input::placeholder {
    color: var(--text-muted, #9b9b9b);
  }

  .thread-submit {
    flex-shrink: 0;
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-size: var(--font-size-sm, 13px);
    font-family: var(--font-ui, system-ui, sans-serif);
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
</style>
