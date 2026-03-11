<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import { editorInstance, selectionStore, editorScrollTop } from '$lib/stores/editor';
  import { annotationsStore } from '$lib/stores/annotations';
  import { filesStore } from '$lib/stores/files';
  import { hoveredAnnotationId, expandAndScrollToId, contextPreviewRanges, activeAnnotationId, floatingExplainRect, annotationCardOffsets } from '$lib/stores/ui';
  import { initMonacoWorkers } from '$lib/monaco-workers';
  import { runReExplain } from '$lib/api/explain';
  import type { ReExplainVariant } from '$lib/api/explain';
  import { submitFollowUp } from '$lib/api/followup';
  import { annotationSummary } from '$lib/utils/summary';
  import { marked } from 'marked';
  import type { SelectionRange } from '$lib/stores/editor';
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
  let overlayCardsByAnnotationId = new Map<
    string,
    {
      wrapper: HTMLDivElement;
      root: HTMLDivElement;
      updateAnnotation: (a: Annotation) => void;
      updatePosition: () => void;
      annotationId: string;
    }
  >();
  let cardsOverlay: HTMLDivElement | null = null;
  const CARD_WIDTH = 360;
  const CARD_MARGIN = 24;
  const FLOATING_BTN_WIDTH = 90;
  const FLOATING_BTN_GAP = 12;
  let followUpInputs: Record<string, string> = {};
  let followUpSubmitting: Record<string, boolean> = {};

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
        'editor.selectionBackground': 'rgba(13, 148, 136, 0.2)',
        'editor.inactiveSelectionBackground': 'rgba(13, 148, 136, 0.1)',
        'editor.selectionHighlightBackground': 'rgba(13, 148, 136, 0.12)',
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

  function createInlineContentWidget(
    annotation: Annotation,
    getCurrentFileId: () => string | null,
    monaco: typeof import('monaco-editor'),
    options: {
      getFollowUpInput?: (id: string) => string;
      setFollowUpInput?: (id: string, value: string) => void;
      isFollowUpSubmitting?: (id: string) => boolean;
      onFollowUpSubmit?: (id: string, question: string) => void;
      onDragStart?: (annotationId: string, e: MouseEvent) => void;
    } = {}
  ): Monaco.editor.IContentWidget & { updateAnnotation: (a: Annotation) => void } {
    let currentAnnotation = annotation;
    const id = `inline-${annotation.id}`;
    const root = document.createElement('div');
    root.className = 'envisiage-inline-widget';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', `Explanation at line ${annotation.selectionRange.startLine}`);
    root.tabIndex = 0;

    function lineLabel(range: { startLine: number; endLine: number }): string {
      return range.startLine === range.endLine
        ? `Line ${range.startLine}`
        : `Lines ${range.startLine}–${range.endLine}`;
    }

    function escapeHtml(text: string): string {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderedHtml(text: string): string {
      if (!text.trim()) return '';
      return marked.parse(text, { async: false }) as string;
    }

    function buildThreadHtml(thread: Annotation['thread']): string {
      if (!thread.length) return '';
      return thread
        .map((msg) => {
          if (msg.role === 'user') {
            return `<div class="envisiage-inline-thread-msg envisiage-inline-thread-msg-user"><div class="envisiage-inline-thread-content">${escapeHtml(msg.content)}</div></div>`;
          }
          return `<div class="envisiage-inline-thread-msg envisiage-inline-thread-msg-assistant"><div class="envisiage-inline-thread-content envisiage-inline-thread-markdown">${renderedHtml(msg.content || '…')}</div></div>`;
        })
        .join('');
    }

    function handleCollapsedClick(e: Event) {
      if (currentAnnotation.status !== 'collapsed') return;
      e.stopPropagation();
      annotationsStore.toggleCollapsed(currentAnnotation.id);
    }

    function render() {
      const ann = currentAnnotation;
      const loading = ann.status === 'loading';
      const hasExplanation = !!ann.explanation.trim();
      const disableVariants = loading;
      const collapsed = ann.status === 'collapsed';
      const inputValue = (options.getFollowUpInput && options.getFollowUpInput(ann.id)) ?? '';
      const submitting = (options.isFollowUpSubmitting && options.isFollowUpSubmitting(ann.id)) ?? false;

      if (collapsed) {
        const summary = annotationSummary(ann.explanation);
        const threadBadge =
          ann.thread.length > 0
            ? `<span class="envisiage-inline-thread-badge" aria-label="${ann.thread.length} follow-up messages">${ann.thread.length}</span>`
            : '';
        root.innerHTML = `
          <div class="envisiage-inline-inner envisiage-inline-collapsed" data-action="expand">
            <div class="envisiage-inline-header" data-drag-handle>
              <span class="envisiage-inline-line">${lineLabel(ann.selectionRange)}</span>
              <span class="envisiage-inline-drag-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>
            </div>
            <div class="envisiage-inline-summary-row">
              <p class="envisiage-inline-summary">${escapeHtml(summary)}</p>
              ${threadBadge}
            </div>
          </div>
        `;
        root.setAttribute('role', 'button');
        root.setAttribute('aria-label', 'Expand annotation');
        root.addEventListener('click', handleCollapsedClick);
        const dragHandleCollapsed = root.querySelector('[data-drag-handle]');
        if (dragHandleCollapsed && options.onDragStart) {
          (dragHandleCollapsed as HTMLElement).addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            options.onDragStart!(ann.id, e as MouseEvent);
          });
        }
        return;
      }

      root.removeEventListener('click', handleCollapsedClick);

      root.setAttribute('role', 'region');
      root.removeAttribute('aria-label');
      root.setAttribute('aria-label', `Explanation at line ${ann.selectionRange.startLine}`);

      let bodyHtml: string;
      if (loading && !hasExplanation) {
        bodyHtml = '<p class="envisiage-inline-loading">Thinking…</p>';
      } else if (hasExplanation) {
        const rendered = marked.parse(ann.explanation, { async: false }) as string;
        bodyHtml = `<div class="envisiage-inline-content">${rendered}</div>`;
      } else {
        bodyHtml = '<p class="envisiage-inline-loading">…</p>';
      }

      const variantButtons = [
        { value: 'simpler' as ReExplainVariant, label: 'Simpler' },
        { value: 'technical' as ReExplainVariant, label: 'Technical' },
        { value: 'different' as ReExplainVariant, label: 'Different angle' }
      ]
        .map(
          (v) =>
            `<button type="button" class="envisiage-inline-variant-btn" data-variant="${v.value}" aria-label="Re-explain: ${escapeHtml(v.label)}" ${disableVariants ? 'disabled' : ''}>${escapeHtml(v.label)}</button>`
        )
        .join('');

      const threadHtml = buildThreadHtml(ann.thread);
      const threadSection = threadHtml
        ? `<div class="envisiage-inline-thread">${threadHtml}</div>`
        : '';

      const formHtml =
        ann.status === 'complete'
          ? `
        <form class="envisiage-inline-thread-form" data-annotation-id="${escapeHtml(ann.id)}">
          <input type="text" class="envisiage-inline-thread-input" placeholder="Ask a follow-up..." value="${escapeHtml(inputValue)}" ${submitting ? 'disabled' : ''} aria-label="Follow-up question" />
          <button type="submit" class="envisiage-inline-thread-submit" ${submitting || !inputValue.trim() ? 'disabled' : ''} aria-label="Send follow-up">${submitting ? '…' : 'Send'}</button>
        </form>
      `
          : '';

      root.innerHTML = `
        <div class="envisiage-inline-inner">
          <div class="envisiage-inline-header" data-drag-handle>
            <span class="envisiage-inline-line">${lineLabel(ann.selectionRange)}</span>
            <span class="envisiage-inline-drag-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>
          </div>
          <div class="envisiage-inline-body">${bodyHtml}</div>
          ${threadSection}
          <div class="envisiage-inline-actions">
            <button type="button" class="envisiage-inline-collapse-btn" data-action="collapse" aria-label="Collapse annotation">−</button>
            ${variantButtons}
            <button type="button" class="envisiage-inline-dismiss" data-action="dismiss" aria-label="Remove annotation">×</button>
          </div>
          ${formHtml}
        </div>
      `;

      root.querySelector('[data-action="collapse"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        annotationsStore.toggleCollapsed(ann.id);
      });
      root.querySelector('[data-action="dismiss"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        annotationsStore.remove(ann.id);
      });
      const dragHandle = root.querySelector('[data-drag-handle]');
      if (dragHandle && options.onDragStart) {
        (dragHandle as HTMLElement).addEventListener('mousedown', (e) => {
          e.preventDefault();
          options.onDragStart!(ann.id, e as MouseEvent);
        });
      }
      root.querySelectorAll('.envisiage-inline-variant-btn').forEach((btn) => {
        const v = (btn as HTMLElement).dataset.variant as ReExplainVariant;
        if (v && !btn.hasAttribute('disabled')) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            runReExplain(ann.id, v);
          });
        }
      });

      const form = root.querySelector('.envisiage-inline-thread-form');
      if (form && options.onFollowUpSubmit && options.setFollowUpInput) {
        const input = root.querySelector('.envisiage-inline-thread-input') as HTMLInputElement;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const q = (input?.value ?? '').trim();
          if (!q || submitting) return;
          options.setFollowUpInput!(ann.id, '');
          options.onFollowUpSubmit!(ann.id, q);
        });
        input?.addEventListener('input', () => {
          options.setFollowUpInput!(ann.id, input.value);
        });
      }
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
          preference: [monaco.editor.ContentWidgetPositionPreference.BELOW]
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
  $: selection = $selectionStore;
  $: hoveredId = $hoveredAnnotationId;
  $: contextPreview = $contextPreviewRanges;
  $: scrollTop = $editorScrollTop;
  $: if (editorRef && selection && container) {
    const hasSelection =
      selection.startLine !== selection.endLine || selection.startCol !== selection.endCol;
    if (!hasSelection) {
      floatingExplainRect.set(null);
    } else {
      try {
        const lineTop = editorRef.getTopForLineNumber(selection.startLine);
        const top = lineTop - scrollTop - 6;
        const left = container.offsetWidth - FLOATING_BTN_WIDTH - CARD_MARGIN - FLOATING_BTN_GAP;
        floatingExplainRect.set({ top, left });
      } catch {
        floatingExplainRect.set(null);
      }
    }
  } else {
    if ($floatingExplainRect != null) floatingExplainRect.set(null);
  }
  $: if (editorRef) {
    updateGutterDecorations(editorRef, annotationsForActiveFile);
  }
  $: if (editorRef) {
    updateHighlightDecoration(editorRef, hoveredId, annotationsForActiveFile);
  }
  $: if (editorRef) {
    updateContextPreviewDecoration(editorRef, contextPreview);
  }
  $: if (editorRef && monacoModule && cardsOverlay) {
    void followUpSubmitting;
    const monaco = monacoModule;
    const idsInList = new Set(annotationsForActiveFile.map((a) => a.id));

    function makeUpdatePosition(annotationId: string, wrapper: HTMLDivElement) {
      return () => {
        const ed = editorRef;
        const cont = container;
        const offs = get(annotationCardOffsets);
        if (!ed || !cont || !cardsOverlay) return;
        const ann = annotations.find((a) => a.id === annotationId);
        if (!ann || ann.fileId !== activeFileId) return;
        const lineNum = ann.selectionRange.startLine;
        const defaultTop = ed.getTopForLineNumber(lineNum) - ed.getScrollTop();
        const defaultLeft = Math.max(CARD_MARGIN, cont.offsetWidth - CARD_WIDTH - CARD_MARGIN);
        const offset = offs[annotationId];
        wrapper.style.top = `${defaultTop + (offset?.y ?? 0)}px`;
        wrapper.style.left = `${defaultLeft + (offset?.x ?? 0)}px`;
        wrapper.style.width = `${CARD_WIDTH}px`;
      };
    }

    function startDrag(annotationId: string, e: MouseEvent) {
      const offs = get(annotationCardOffsets);
      const startX = e.clientX;
      const startY = e.clientY;
      const startOx = offs[annotationId]?.x ?? 0;
      const startOy = offs[annotationId]?.y ?? 0;
      const onMove = (e2: MouseEvent) => {
        const dx = e2.clientX - startX;
        const dy = e2.clientY - startY;
        annotationCardOffsets.update((o) => ({
          ...o,
          [annotationId]: { x: startOx + dx, y: startOy + dy }
        }));
        overlayCardsByAnnotationId.get(annotationId)?.updatePosition();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    for (const ann of annotationsForActiveFile) {
      const latest = annotations.find((a) => a.id === ann.id) ?? ann;
      const existing = overlayCardsByAnnotationId.get(ann.id);
      if (existing) {
        existing.updateAnnotation(latest);
        existing.updatePosition();
      } else {
        const widget = createInlineContentWidget(latest, () => activeFileId, monaco, {
          getFollowUpInput: (id) => followUpInputs[id] ?? '',
          setFollowUpInput: (id, value) => {
            followUpInputs[id] = value;
            followUpInputs = followUpInputs;
          },
          isFollowUpSubmitting: (id) => followUpSubmitting[id] ?? false,
          onFollowUpSubmit: (id, question) => {
            followUpSubmitting[id] = true;
            followUpSubmitting = followUpSubmitting;
            submitFollowUp(id, question).finally(() => {
              followUpSubmitting[id] = false;
              followUpSubmitting = followUpSubmitting;
            });
          },
          onDragStart: startDrag
        });
        const wrapper = document.createElement('div');
        wrapper.className = 'envisiage-card-wrapper';
        wrapper.setAttribute('data-annotation-id', ann.id);
        wrapper.appendChild(widget.getDomNode());
        cardsOverlay.appendChild(wrapper);
        const updatePosition = makeUpdatePosition(ann.id, wrapper);
        overlayCardsByAnnotationId.set(ann.id, {
          wrapper,
          root: widget.getDomNode(),
          updateAnnotation: widget.updateAnnotation,
          updatePosition,
          annotationId: ann.id
        });
        updatePosition();
      }
    }
    const toRemove: string[] = [];
    for (const id of overlayCardsByAnnotationId.keys()) {
      if (!idsInList.has(id)) toRemove.push(id);
    }
    for (const id of toRemove) {
      const card = overlayCardsByAnnotationId.get(id);
      if (card) {
        card.wrapper.remove();
        overlayCardsByAnnotationId.delete(id);
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
      for (const card of overlayCardsByAnnotationId.values()) card.updatePosition();
    });

    function updateFloatingRect() {
      const sel = get(selectionStore);
      if (!sel || !container) {
        floatingExplainRect.set(null);
        return;
      }
      const hasSelection =
        sel.startLine !== sel.endLine || sel.startCol !== sel.endCol;
      if (!hasSelection) {
        floatingExplainRect.set(null);
        return;
      }
      try {
        const lineTop = editor.getTopForLineNumber(sel.startLine);
        const top = lineTop - editor.getScrollTop() - 6;
        const left = container.offsetWidth - FLOATING_BTN_WIDTH - CARD_MARGIN - FLOATING_BTN_GAP;
        floatingExplainRect.set({ top, left });
      } catch {
        floatingExplainRect.set(null);
      }
    }

    const layoutDisposable = editor.onDidLayoutChange(() => {
      updateFloatingRect();
      for (const card of overlayCardsByAnnotationId.values()) card.updatePosition();
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
        if (annotation) {
          annotationsStore.expand(annotation.id);
          expandAndScrollToId.set(annotation.id);
        }
      }
    });

    disposables = [selectionDisposable, scrollDisposable, layoutDisposable, mouseDownDisposable];

    // sync scroll position so overlay cards can align with visible lines
    editorScrollTop.set(editor.getScrollTop());
  });

  onDestroy(() => {
    disposables.forEach((d) => d.dispose());
    disposables = [];
    contentDisposableByFileId.forEach((d) => d.dispose());
    contentDisposableByFileId.clear();
    if (editor) {
      for (const card of overlayCardsByAnnotationId.values()) {
        card.wrapper.remove();
      }
      overlayCardsByAnnotationId.clear();
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

<div class="editor-wrapper">
  <div class="editor-container" bind:this={container}></div>
  <div class="envisiage-cards-overlay" bind:this={cardsOverlay} role="presentation"></div>
</div>

<style>
  .editor-wrapper {
    width: 100%;
    height: 100%;
    min-height: 0;
    position: relative;
  }
  .editor-container {
    position: absolute;
    inset: 0;
  }
  .envisiage-cards-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .envisiage-cards-overlay :global(.envisiage-card-wrapper) {
    position: absolute;
    pointer-events: auto;
    max-width: 360px;
    z-index: 10;
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

  /* inline explanation content widget */
  .editor-wrapper :global(.envisiage-inline-widget) {
    max-width: min(420px, 90%);
    cursor: default;
  }
  .editor-wrapper :global(.envisiage-inline-inner) {
    background: var(--ai-teal-fill, rgba(204, 251, 241, 0.75));
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    padding: var(--space-sm, 8px) var(--space-md, 12px);
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: var(--font-size-sm, 13px);
  }
  .editor-wrapper :global(.envisiage-inline-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs, 4px);
    margin-bottom: var(--space-xs, 4px);
  }
  .editor-wrapper :global(.envisiage-inline-drag-grip) {
    cursor: grab;
    color: var(--text-muted, #9b9b9b);
    font-size: 12px;
    user-select: none;
    padding: 2px 4px;
  }
  .editor-wrapper :global(.envisiage-inline-drag-grip:active) {
    cursor: grabbing;
  }
  .editor-wrapper :global(.envisiage-inline-line) {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted, #9b9b9b);
    margin-bottom: var(--space-xs, 4px);
  }
  .editor-wrapper :global(.envisiage-inline-body) {
    margin-bottom: var(--space-sm, 8px);
    color: var(--text-primary, #1a1a1a);
    line-height: 1.4;
  }
  .editor-wrapper :global(.envisiage-inline-content) {
    max-height: 200px;
    overflow-y: auto;
  }
  .editor-wrapper :global(.envisiage-inline-content p) {
    margin: 0 0 0.5em;
  }
  .editor-wrapper :global(.envisiage-inline-content p:last-child) {
    margin-bottom: 0;
  }
  .editor-wrapper :global(.envisiage-inline-content code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--bg-secondary, #f2f2f2);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  .editor-wrapper :global(.envisiage-inline-loading) {
    margin: 0;
    color: var(--text-secondary, #6b6b6b);
  }
  .editor-wrapper :global(.envisiage-inline-actions) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs, 4px);
    align-items: center;
  }
  .editor-wrapper :global(.envisiage-inline-open),
  .editor-wrapper :global(.envisiage-inline-variant-btn) {
    padding: 2px 8px;
    font-size: 11px;
    font-family: inherit;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 4px;
    color: var(--text-primary, #1a1a1a);
    cursor: pointer;
  }
  .editor-wrapper :global(.envisiage-inline-open:hover),
  .editor-wrapper :global(.envisiage-inline-variant-btn:hover:not(:disabled)) {
    background: var(--bg-tertiary, #eee);
  }
  .editor-wrapper :global(.envisiage-inline-variant-btn:disabled) {
    opacity: 0.6;
    cursor: wait;
  }
  .editor-wrapper :global(.envisiage-inline-collapsed) {
    cursor: pointer;
  }
  .editor-wrapper :global(.envisiage-inline-summary-row) {
    display: flex;
    align-items: center;
    gap: var(--space-sm, 8px);
    min-width: 0;
  }
  .editor-wrapper :global(.envisiage-inline-summary) {
    margin: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-muted, #9b9b9b);
    font-size: var(--font-size-sm, 13px);
  }
  .editor-wrapper :global(.envisiage-inline-thread-badge) {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted, #9b9b9b);
    flex-shrink: 0;
  }
  .editor-wrapper :global(.envisiage-inline-thread) {
    margin-bottom: var(--space-sm, 8px);
    max-height: 160px;
    overflow-y: auto;
  }
  .editor-wrapper :global(.envisiage-inline-thread-msg) {
    margin-bottom: var(--space-xs, 4px);
  }
  .editor-wrapper :global(.envisiage-inline-thread-msg-user .envisiage-inline-thread-content) {
    color: var(--text-primary, #1a1a1a);
  }
  .editor-wrapper :global(.envisiage-inline-thread-msg-assistant .envisiage-inline-thread-markdown) {
    font-size: 12px;
    line-height: 1.4;
  }
  .editor-wrapper :global(.envisiage-inline-thread-form) {
    display: flex;
    gap: var(--space-xs, 4px);
    margin-top: var(--space-sm, 8px);
  }
  .editor-wrapper :global(.envisiage-inline-thread-input) {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    font-size: 12px;
    font-family: inherit;
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 4px;
  }
  .editor-wrapper :global(.envisiage-inline-thread-submit) {
    padding: 4px 10px;
    font-size: 12px;
    font-family: inherit;
    background: var(--ai-teal, #0d9488);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .editor-wrapper :global(.envisiage-inline-thread-submit:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .editor-wrapper :global(.envisiage-inline-collapse-btn),
  .editor-wrapper :global(.envisiage-inline-dismiss) {
    padding: 2px 6px;
    font-size: 12px;
    font-family: inherit;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-default, #e5e5e5);
    border-radius: 4px;
    color: var(--text-primary, #1a1a1a);
    cursor: pointer;
  }
  .editor-wrapper :global(.envisiage-inline-dismiss) {
    margin-left: auto;
  }
</style>
