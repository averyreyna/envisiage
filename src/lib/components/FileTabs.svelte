<script lang="ts">
  import { tick } from 'svelte';
  import { filesStore } from '$lib/stores/files';
  import type { FileEntry } from '$lib/stores/files';

  const filesStoreFiles = filesStore.files;
  const filesStoreActiveId = filesStore.activeFileId;
  $: files = $filesStoreFiles;
  $: activeFileId = $filesStoreActiveId;

  let editingFileId: string | null = null;
  let editValue = '';
  let editInputRef: HTMLInputElement | null = null;

  function fileName(path: string): string {
    const segments = path.split(/[/\\]/);
    return segments[segments.length - 1] || path;
  }

  function fileExtension(path: string): string {
    const name = fileName(path);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  const EXTENSION_STYLES: Record<string, { color: string }> = {
    js: { color: '#f7df1e' },
    jsx: { color: '#61dafb' },
    ts: { color: '#3178c6' },
    tsx: { color: '#3178c6' },
    css: { color: '#264de4' },
    scss: { color: '#cc6699' },
    sass: { color: '#cc6699' },
    html: { color: '#e34f26' },
    json: { color: '#cbcb41' },
    md: { color: '#083fa1' },
    mdx: { color: '#f9ac00' },
    py: { color: '#3776ab' },
    vue: { color: '#42b883' },
    svelte: { color: '#ff3e00' },
    yaml: { color: '#cb171e' },
    yml: { color: '#cb171e' },
    svg: { color: '#ffb13b' },
  };

  function getExtensionStyle(path: string): { color: string } {
    const ext = fileExtension(path);
    return EXTENSION_STYLES[ext] ?? { color: 'var(--text-muted)' };
  }

  function sanitizePath(value: string): string {
    return value.trim().replace(/[/\\]/g, '') || 'untitled.js';
  }

  function selectFile(file: FileEntry) {
    if (editingFileId === file.id) return;
    filesStore.setActiveFile(file.id);
  }

  function closeFile(e: MouseEvent, file: FileEntry) {
    e.stopPropagation();
    if (editingFileId === file.id) {
      editingFileId = null;
    }
    filesStore.removeFile(file.id);
  }

  function startEdit(e: MouseEvent, file: FileEntry) {
    e.preventDefault();
    e.stopPropagation();
    editingFileId = file.id;
    editValue = file.path;
    tick().then(() => {
      editInputRef?.focus();
      editInputRef?.select();
    });
  }

  function commitEdit(file: FileEntry) {
    if (editingFileId !== file.id) return;
    const next = sanitizePath(editValue);
    if (next !== file.path) {
      filesStore.renameFile(file.id, next);
    }
    editingFileId = null;
  }

  function cancelEdit() {
    editingFileId = null;
  }

  function handleEditKeydown(e: KeyboardEvent, file: FileEntry) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(file);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editValue = file.path;
      cancelEdit();
    }
  }

  function addFile() {
    const path = `file-${Date.now()}.js`;
    filesStore.addFile(path, '');
  }
</script>

<div class="file-tabs">
  <div class="tabs-list" role="tablist">
    {#each files as file (file.id)}
      <button
        type="button"
        class="tab"
        class:active={file.id === activeFileId}
        class:editing={editingFileId === file.id}
        role="tab"
        aria-selected={file.id === activeFileId}
        aria-label="Switch to {file.path}"
        on:click={() => selectFile(file)}
        on:dblclick={(e) => startEdit(e, file)}
      >
        {#if editingFileId === file.id}
          <input
            bind:this={editInputRef}
            class="tab-edit-input"
            type="text"
            bind:value={editValue}
            on:blur={() => commitEdit(file)}
            on:keydown={(e) => handleEditKeydown(e, file)}
            on:click|stopPropagation
          />
        {:else}
          <span
            class="tab-icon"
            style="--icon-color: {getExtensionStyle(file.path).color}"
            aria-hidden="true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="16" viewBox="0 0 14 16" fill="none">
              <path d="M1 2a1 1 0 0 1 1-1h7l3 3v10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2Z" fill="var(--icon-color)" opacity="0.2" />
              <path d="M9 1v3a1 1 0 0 0 1 1h3" stroke="var(--icon-color)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
            </svg>
          </span>
          <span class="tab-label">{fileName(file.path)}</span>
        {/if}
        <button
          type="button"
          class="tab-close"
          aria-label="Close {file.path}"
          on:click={(e) => closeFile(e, file)}
        >
          ×
        </button>
      </button>
    {/each}
  </div>
  <button
    type="button"
    class="add-file"
    aria-label="Add file"
    on:click={addFile}
  >
    + New file
  </button>
</div>

<style>
  .file-tabs {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0 var(--space-md);
    min-height: 40px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-default);
    flex-shrink: 0;
  }

  .tabs-list {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-sm) var(--space-sm) var(--space-md);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 6px 6px 0 0;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color var(--duration-fast), background var(--duration-fast);
  }

  .tab:hover {
    color: var(--text-secondary);
    background: var(--bg-primary);
  }

  .tab.active {
    color: var(--text-primary);
    background: var(--bg-editor);
    font-weight: 500;
  }

  .tab-label {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  .tab-icon svg {
    display: block;
  }

  .tab.editing {
    padding-left: var(--space-sm);
  }

  .tab-edit-input {
    min-width: 80px;
    max-width: 160px;
    padding: 2px 4px;
    font-size: inherit;
    font-family: var(--font-ui);
    color: inherit;
    background: var(--bg-editor);
    border: 1px solid var(--ai-teal);
    border-radius: 4px;
    outline: none;
  }

  .tab-edit-input:focus {
    box-shadow: 0 0 0 2px var(--ai-teal-glow);
  }

  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    font-size: 16px;
    line-height: 1;
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: color var(--duration-fast), background var(--duration-fast);
  }

  .tab-close:hover {
    color: var(--text-primary);
    background: var(--border-subtle);
  }

  .add-file {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-muted);
    background: transparent;
    border: 1px dashed var(--border-default);
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--duration-fast), border-color var(--duration-fast);
  }

  .add-file:hover {
    color: var(--ai-teal);
    border-color: var(--ai-teal);
  }
</style>
