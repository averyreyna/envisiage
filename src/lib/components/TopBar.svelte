<script lang="ts">
  import { get } from 'svelte/store';
  import { languageStore, SUPPORTED_LANGUAGES, type LanguageId } from '$lib/stores/language';
  import { filesStore, pathWithExtension } from '$lib/stores/files';

  let showOnboarding = false;

  const filesStoreFiles = filesStore.files;
  const filesStoreActiveId = filesStore.activeFileId;
  $: files = $filesStoreFiles;
  $: activeFileId = $filesStoreActiveId;
  $: activeFile = activeFileId != null ? files.find((f) => f.id === activeFileId) ?? null : null;
  $: languageValue = activeFile?.language ?? 'javascript';

  function handleLanguageChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement)?.value;
    const lang = (value as LanguageId) || 'javascript';
    const currentActiveId = get(filesStore.activeFileId);
    const currentFiles = get(filesStore.files);
    const currentFile = currentActiveId
      ? currentFiles.find((f) => f.id === currentActiveId)
      : null;
    if (currentActiveId && currentFile) {
      const newPath = pathWithExtension(currentFile.path, lang);
      filesStore.renameFile(currentActiveId, newPath);
    } else {
      languageStore.set(lang);
    }
  }

  function toggleOnboarding() {
    showOnboarding = !showOnboarding;
  }

  function closeOnboarding(e: MouseEvent) {
    const target = e.target as Node;
    if (showOnboarding && !document.getElementById('onboarding-tooltip')?.contains(target) && !(e.target as HTMLElement)?.closest('.help-btn')) {
      showOnboarding = false;
    }
  }
</script>

<svelte:window on:click={closeOnboarding} />

<header class="topbar">
  <div class="header-block">
    <span class="wordmark">Envisiage</span>
    <span class="subheader">Powered by Sonnet 4.5</span>
  </div>
  <div class="controls">
    <label for="lang-select" class="sr-only">Language</label>
    <select
      id="lang-select"
      class="lang-select"
      aria-label="Code language"
      value={languageValue}
      on:change={handleLanguageChange}
    >
      {#each SUPPORTED_LANGUAGES as { id, label }}
        <option value={id}>{label}</option>
      {/each}
    </select>
    <button
      type="button"
      class="help-btn"
      aria-label="Keyboard shortcuts and help"
      aria-expanded={showOnboarding}
      on:click|stopPropagation={toggleOnboarding}
    >
      ?
    </button>
    {#if showOnboarding}
      <div id="onboarding-tooltip" class="onboarding-tooltip" role="tooltip">
        <p><strong>Shortcuts</strong></p>
        <p>⌘⇧E — Explain selected code</p>
        <p>⌘⇧A — Toggle annotation panel</p>
        <p>Escape — Collapse active annotation</p>
        <p class="onboarding-hint">Select code, then use the Explain button or ⌘⇧E to add an inline explanation. Ask follow-ups in the card.</p>
      </div>
    {/if}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    padding: 0 var(--space-md);
    background: var(--bg-primary);
    flex-shrink: 0;
  }

  .wordmark {
    font-size: var(--font-size-lg);
    font-weight: 500;
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }

  .header-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .subheader {
    font-size: var(--font-size-base);
    color: var(--text-muted);
    font-family: var(--font-ui);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    position: relative;
  }

  .help-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-base);
    font-family: var(--font-ui);
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
    cursor: pointer;
    transition: color var(--duration-fast), border-color var(--duration-fast);
  }

  .help-btn:hover {
    color: var(--text-secondary);
    border-color: var(--border-default);
  }

  .help-btn:focus {
    outline: none;
    border-color: var(--ai-teal);
    color: var(--ai-teal);
  }

  .onboarding-tooltip {
    position: absolute;
    top: calc(100% + var(--space-sm));
    right: 0;
    width: 280px;
    padding: var(--space-md);
    background: var(--bg-editor);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    z-index: 200;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }

  .onboarding-tooltip p {
    margin: 0 0 var(--space-xs);
  }

  .onboarding-tooltip p:last-child {
    margin-bottom: 0;
  }

  .onboarding-hint {
    margin-top: var(--space-sm);
    padding-top: var(--space-sm);
    border-top: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .lang-select {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-primary);
    background: var(--bg-editor);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    cursor: pointer;
  }

  .lang-select:hover {
    border-color: var(--border-default);
  }

  .lang-select:focus {
    outline: none;
    border-color: var(--ai-teal);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
