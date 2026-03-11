<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { editorInstance, selectionStore, editorScrollTop } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { filesStore } from '$lib/stores/files';
  import { hoveredAnnotationId, expandAndScrollToId, contextPreviewRanges } from '$lib/stores/ui';
  import { initMonacoWorkers } from '$lib/monaco-workers';
  import { annotationSummary } from '$lib/utils/summary';
  import type { Annotation } from '$lib/stores/annotations';
  import type { FileEntry } from '$lib/stores/files';
  import type * as Monaco from 'monaco-editor';

  export let files: FileEntry[] = [];
  export let activeFileId: string | null = null;

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monacoModule: typeof import('monaco-editor') | null = null;
  let modelByFileId = new Map<string, Monaco.editor.ITextModel>();
  let contentDisposableByFileId = new Map<string, { dispose: () => void }>();
  let disposables: { dispose: () => void }[] = [];
  let gutterDecorationIds: string[] = [];
  let highlightDecorationIds: string[] = [];
  let contextPreviewDecorationIds: string[] = [];
  let stickyWidgetsByAnnotationId = new Map<
    string,
    Monaco.editor.IContentWidget & { updateAnnotation: (a: Annotation) => void }
  >();

  const ENVISIAGE_THEME = 'envisiage-light';
  const GUTTER_CLASS = 'envisiage-gutter-dot';
  const HIGHLIGHT_CLASS = 'envisiage-line-highlight';
  const CONTEXT_WINDOW_CLASS = 'envisiage-context-window';
  const CONTEXT_ENCLOSING_CLASS = 'envisiage-context-enclosing';

  function defineEnvisiageTheme(monaco: typeof import('monaco-editor')) {
    monaco.editor.defineTheme(ENVISIAGE_THEME, {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#1A1A1A',
        'editor.lineHighlightBackground': '#FAFAFA',
        'editor.selectionBackground': 'rgba(13, 148, 136, 0.12)',
        'editorGutter.background': '#FFFFFF'
      }
    });
  }

  function updateGutterDecorations(editor: Monaco.editor.IStandaloneCodeEditor, annotations: Annotation[]) {
    const model = editor.getModel();
    if (!model) return;
    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = annotations.map((a) => ({
      range: {
        startLineNumber: a.selectionRange.startLine,
        startColumn: 1,
        endLineNumber: a.selectionRange.startLine,
        endColumn: 1
      },
      options: { glyphMarginClassName: GUTTER_CLASS }
    }));
    gutterDecorationIds = model.deltaDecorations(gutterDecorationIds, newDecorations);
  }

  function updateHighlightDecoration(
    editor: Monaco.editor.IStandaloneCodeEditor,
    hoveredId: string | null,
    annotations: Annotation[]
  ) {
    const model = editor.getModel();
    if (!model) return;
    const ann = hoveredId ? annotations.find((a) => a.id === hoveredId) : null;
    const newDecorations: Monaco.editor.IModelDeltaDecoration[] = ann
      ? [
          {
            range: {
              startLineNumber: ann.selectionRange.startLine,
              startColumn: ann.selectionRange.startCol,
              endLineNumber: ann.selectionRange.endLine,
              endColumn: ann.selectionRange.endCol
            },
            options: { className: HIGHLIGHT_CLASS, isWholeLine: false }
          }
        ]
      : [];
    highlightDecorationIds = model.deltaDecorations(highlightDecorationIds, newDecorations);
  }

  function updateContextPreviewDecoration(
    editor: Monaco.editor.IStandaloneCodeEditor,
    ranges: import('$lib/stores/ui').ContextPreviewRanges | null
  ) {
    const model = editor.getModel();
    if (!model) return;
    if (!ranges) {
      contextPreviewDecorationIds = model.deltaDecorations(contextPreviewDecorationIds, []);
      return;
    }
    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    if (ranges.window) {
      decos.push({
        range: {
          startLineNumber: ranges.window.startLine,
          startColumn: 1,
          endLineNumber: ranges.window.endLine,
          endColumn: model.getLineMaxColumn(ranges.window.endLine)
        },
        options: { className: CONTEXT_WINDOW_CLASS, isWholeLine: true }
      });
    }
    if (ranges.enclosing) {
      decos.push({
        range: {
          startLineNumber: ranges.enclosing.startLine,
          startColumn: 1,
          endLineNumber: ranges.enclosing.endLine,
          endColumn: model.getLineMaxColumn(ranges.enclosing.endLine)
        },
        options: { className: CONTEXT_ENCLOSING_CLASS, isWholeLine: true }
      });
    }
    contextPreviewDecorationIds = model.deltaDecorations(contextPreviewDecorationIds, decos);
  }

  function createStickyContentWidget(
    annotation: Annotation,
    getCurrentFileId: () => string | null,
    monaco: typeof import('monaco-editor')
  ): Monaco.editor.IContentWidget & { updateAnnotation: (a: Annotation) => void } {
    let currentAnnotation = annotation;
    const id = `sticky-${annotation.id}`;
    const root = document.createElement('div');
    root.className = 'envisiage-sticky-widget';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', `Sticky note at line ${annotation.selectionRange.startLine}`);
    root.tabIndex = 0;

    function lineLabel(range: { startLine: number; endLine: number }): string {
      return range.startLine === range.endLine
        ? `Line ${range.startLine}`
        : `Lines ${range.startLine}–${range.endLine}`;
    }

    function render() {
      const summary =
        currentAnnotation.status === 'complete' || currentAnnotation.status === 'collapsed'
          ? annotationSummary(currentAnnotation.explanation)
          : currentAnnotation.status === 'loading'
            ? 'Thinking…'
            : currentAnnotation.explanation
              ? annotationSummary(currentAnnotation.explanation) + '…'
              : '…';
      root.innerHTML = `
        <div class="envisiage-sticky-inner">
          <span class="envisiage-sticky-line">${lineLabel(currentAnnotation.selectionRange)}</span>
          <p class="envisiage-sticky-summary">${escapeHtml(summary)}</p>
          <div class="envisiage-sticky-actions">
            <button type="button" class="envisiage-sticky-open" data-action="open" aria-label="Open in panel">Open</button>
            <button type="button" class="envisiage-sticky-unpin" data-action="unpin" aria-label="Unpin from editor">Unpin</button>
          </div>
        </div>
      `;
      const openBtn = root.querySelector('[data-action="open"]');
      const unpinBtn = root.querySelector('[data-action="unpin"]');
      if (openBtn) {
        openBtn.addEventListener('click', () => {
          expandAndScrollToId.set(currentAnnotation.id);
        });
      }
      if (unpinBtn) {
        unpinBtn.addEventListener('click', () => {
          annotationsStore.togglePinned(currentAnnotation.id);
        });
      }
    }

    function escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    render();

    const widget: Monaco.editor.IContentWidget & { updateAnnotation: (a: Annotation) => void } = {
      getId: () => id,
      getDomNode: () => root,
      getPosition: () => {
        const fileId = getCurrentFileId();
        if (fileId === null || currentAnnotation.fileId !== fileId) return null;
        return {
          position: {
            lineNumber: currentAnnotation.selectionRange.startLine,
            column: 1
          },
          preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE]
        };
      },
      updateAnnotation(a: Annotation) {
        currentAnnotation = a;
        render();
      }
    };
    return widget;
  }

  $: editorRef = $editorInstance;
  $: annotations = $annotationsStore;
  $: annotationsForActiveFile =
    activeFileId != null ? annotations.filter((a) => a.fileId === activeFileId) : [];
  $: pinnedForActiveFile = annotationsForActiveFile.filter((a) => a.pinned);
  $: hoveredId = $hoveredAnnotationId;
  $: contextPreview = $contextPreviewRanges;
  $: if (editorRef) {
    updateGutterDecorations(editorRef, annotationsForActiveFile);
  }
  $: if (editorRef) {
    updateHighlightDecoration(editorRef, hoveredId, annotationsForActiveFile);
  }
  $: if (editorRef) {
    updateContextPreviewDecoration(editorRef, contextPreview);
  }
  $: if (editorRef && monacoModule) {
    const monaco = monacoModule;
    const pinnedSet = new Set(pinnedForActiveFile.map((a) => a.id));
    for (const [annId, widget] of stickyWidgetsByAnnotationId) {
      if (!pinnedSet.has(annId)) {
        editorRef.removeContentWidget(widget);
        stickyWidgetsByAnnotationId.delete(annId);
      }
    }
    for (const ann of pinnedForActiveFile) {
      const existing = stickyWidgetsByAnnotationId.get(ann.id);
      if (existing) {
        existing.updateAnnotation(ann);
        editorRef.layoutContentWidget(existing);
      } else {
        const widget = createStickyContentWidget(
          ann,
          () => activeFileId,
          monaco
        );
        stickyWidgetsByAnnotationId.set(ann.id, widget);
        editorRef.addContentWidget(widget);
      }
    }
  }

  $: if (editor && monacoModule && files) {
    const monaco = monacoModule;
    const fileIds = new Set(files.map((f) => f.id));
    for (const [id, model] of modelByFileId) {
      if (!fileIds.has(id)) {
        const d = contentDisposableByFileId.get(id);
        if (d) {
          d.dispose();
          contentDisposableByFileId.delete(id);
        }
        model.dispose();
        modelByFileId.delete(id);
      }
    }
    for (const file of files) {
      if (!modelByFileId.has(file.id)) {
        const uri = monaco.Uri.parse('file:///workspace/' + file.path);
        const model = monaco.editor.createModel(file.content, file.language, uri);
        modelByFileId.set(file.id, model);
        const d = model.onDidChangeContent(() => {
          filesStore.updateFileContent(file.id, model.getValue());
        });
        contentDisposableByFileId.set(file.id, d);
      }
    }
    const activeModel = activeFileId ? modelByFileId.get(activeFileId) ?? null : null;
    if (editor.getModel() !== activeModel) {
      editor.setModel(activeModel);
      gutterDecorationIds = [];
      highlightDecorationIds = [];
      contextPreviewDecorationIds = [];
    }
    if (activeModel && activeFileId) {
      const file = files.find((f) => f.id === activeFileId);
      if (file) monaco.editor.setModelLanguage(activeModel, file.language);
    }
  }

  onMount(async () => {
    if (!browser || !container) return;

    const monaco = await import('monaco-editor');
    monacoModule = monaco;
    initMonacoWorkers();
    defineEnvisiageTheme(monaco);

    for (const file of files) {
      const uri = monaco.Uri.parse('file:///workspace/' + file.path);
      const model = monaco.editor.createModel(file.content, file.language, uri);
      modelByFileId.set(file.id, model);
      const d = model.onDidChangeContent(() => {
        filesStore.updateFileContent(file.id, model.getValue());
      });
      contentDisposableByFileId.set(file.id, d);
    }
    const activeModel = activeFileId ? modelByFileId.get(activeFileId) ?? null : null;
    const firstModel = files[0] ? modelByFileId.get(files[0].id) ?? null : null;

    editor = monaco.editor.create(container, {
      model: activeModel || firstModel || undefined,
      theme: ENVISIAGE_THEME,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      folding: true,
      renderLineHighlight: 'line',
      glyphMargin: true,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false
      }
    });

    editorInstance.set(editor);

    const selectionDisposable = editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      selectionStore.set({
        startLine: sel.startLineNumber,
        startCol: sel.startColumn,
        endLine: sel.endLineNumber,
        endCol: sel.endColumn
      });
    });

    const scrollDisposable = editor.onDidScrollChange(() => {
      const scrollTop = editor?.getScrollTop() ?? 0;
      editorScrollTop.set(scrollTop);
    });

    const mouseDownDisposable = editor.onMouseDown((e) => {
      const target = e.target;
      if (target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && target.position) {
        const lineNumber = target.position.lineNumber;
        const currentActiveId = get(filesStore.activeFileId);
        const annotations = get(annotationsStore);
        const annotation = annotations.find(
          (a) => a.fileId === currentActiveId && a.selectionRange.startLine === lineNumber
        );
        if (annotation) expandAndScrollToId.set(annotation.id);
      }
    });

    disposables = [selectionDisposable, scrollDisposable, mouseDownDisposable];

    // sync scroll position so overlay cards can align with visible lines
    editorScrollTop.set(editor.getScrollTop());
  });

  onDestroy(() => {
    disposables.forEach((d) => d.dispose());
    disposables = [];
    contentDisposableByFileId.forEach((d) => d.dispose());
    contentDisposableByFileId.clear();
    if (editor) {
      for (const widget of stickyWidgetsByAnnotationId.values()) {
        editor.removeContentWidget(widget);
      }
      stickyWidgetsByAnnotationId.clear();
      editor.dispose();
      editor = null;
    }
    modelByFileId.forEach((m) => m.dispose());
    modelByFileId.clear();
    monacoModule = null;
    editorInstance.set(null);
    selectionStore.set(null);
  });

</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</svelte:head>

<div class="editor-wrapper" bind:this={container}></div>

<style>
  .editor-wrapper {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .editor-wrapper :global(.monaco-editor) {
    padding-top: var(--space-sm, 8px);
    outline: none;
  }
  .editor-wrapper :global(.monaco-editor:focus-within) {
    outline: none;
  }
  .editor-wrapper :global(.envisiage-gutter-dot) {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--ai-teal, #0d9488);
    margin-left: 2px;
  }
  .editor-wrapper :global(.envisiage-line-highlight) {
    background: var(--ai-teal-glow, rgba(13, 148, 136, 0.12));
    opacity: 0;
    animation: envisiage-highlight-fade-in var(--duration-fast, 150ms) var(--ease-out) forwards;
  }

  @keyframes envisiage-highlight-fade-in {
    to {
      opacity: 1;
    }
  }

  /* context sent to api when user hovers granularity picker: window = lines above/below, enclosing = scope */
  .editor-wrapper :global(.envisiage-context-window) {
    background: rgba(13, 148, 136, 0.06);
    transition: background var(--duration-fast);
  }
  .editor-wrapper :global(.envisiage-context-enclosing) {
    background: var(--ai-teal-glow, rgba(13, 148, 136, 0.12));
    transition: background var(--duration-fast);
  }

  /* sticky note content widget */
  .editor-wrapper :global(.envisiage-sticky-widget) {
    max-width: min(400px, 90%);
    cursor: default;
  }
  .editor-wrapper :global(.envisiage-sticky-inner) {
    background: var(--ai-teal-fill, rgba(204, 251, 241, 0.75));
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: var(--font-size-sm, 13px);
  }
  .editor-wrapper :global(.envisiage-sticky-line) {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted, #9b9b9b);
    margin-bottom: var(--space-xs, 4px);
  }
  .editor-wrapper :global(.envisiage-sticky-summary) {
    margin: 0 0 var(--space-sm, 8px);
    color: var(--text-primary, #1a1a1a);
    line-height: 1.4;
  }
  .editor-wrapper :global(.envisiage-sticky-actions) {
    display: flex;
    gap: var(--space-xs, 4px);
  }
  .editor-wrapper :global(.envisiage-sticky-open),
  .editor-wrapper :global(.envisiage-sticky-unpin) {
    padding: 2px 8px;
    font-size: 11px;
    font-family: inherit;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 4px;
    color: var(--text-primary, #1a1a1a);
    cursor: pointer;
  }
  .editor-wrapper :global(.envisiage-sticky-open:hover),
  .editor-wrapper :global(.envisiage-sticky-unpin:hover) {
    background: var(--bg-tertiary, #eee);
  }
</style>
