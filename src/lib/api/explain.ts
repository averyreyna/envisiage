import { get } from 'svelte/store';
import { editorInstance } from '$lib/stores/editor';
import { annotationsStore } from '$lib/stores/annotations';

export type ReExplainVariant = 'different' | 'simpler' | 'technical';

export async function runReExplain(
  annotationId: string,
  variant: ReExplainVariant
): Promise<void> {
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
        reExplain: variant
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      annotationsStore.setError(annotationId, err.error ?? res.statusText);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      annotationsStore.setError(annotationId, 'No response body');
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
}
