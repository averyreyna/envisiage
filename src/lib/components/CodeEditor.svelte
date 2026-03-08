<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { editorInstance, selectionStore, editorScrollTop } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { hoveredAnnotationId, expandAndScrollToId, contextPreviewRanges } from '$lib/stores/ui';
  import { initMonacoWorkers } from '$lib/monaco-workers';
  import type { Annotation } from '$lib/stores/annotations';
  import type * as Monaco from 'monaco-editor';

  export let code: string = '';
  export let language: string = 'javascript';

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let disposables: { dispose: () => void }[] = [];
  let gutterDecorationIds: string[] = [];
  let highlightDecorationIds: string[] = [];
  let contextPreviewDecorationIds: string[] = [];

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

  $: editorRef = $editorInstance;
  $: annotations = $annotationsStore;
  $: hoveredId = $hoveredAnnotationId;
  $: contextPreview = $contextPreviewRanges;
  $: if (editorRef) {
    updateGutterDecorations(editorRef, annotations);
  }
  $: if (editorRef) {
    updateHighlightDecoration(editorRef, hoveredId, annotations);
  }
  $: if (editorRef) {
    updateContextPreviewDecoration(editorRef, contextPreview);
  }

  $: if (editorRef && monacoModule && language) {
    const model = editorRef.getModel();
    if (model) monacoModule.editor.setModelLanguage(model, language);
  }

  let monacoModule: typeof import('monaco-editor') | null = null;

  onMount(async () => {
    if (!browser || !container) return;

    const monaco = await import('monaco-editor');
    monacoModule = monaco;
    initMonacoWorkers();
    defineEnvisiageTheme(monaco);

    editor = monaco.editor.create(container, {
      value: code,
      language,
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
        const annotations = get(annotationsStore);
        const annotation = annotations.find((a) => a.selectionRange.startLine === lineNumber);
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
    if (editor) {
      editor.dispose();
      editor = null;
    }
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
</style>
