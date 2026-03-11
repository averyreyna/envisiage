import { get } from 'svelte/store';
import { annotationsStore } from '$lib/stores/annotations';

/**
 * Submit a follow-up question for an annotation. Updates the store and streams the response.
 * Caller is responsible for managing loading state (e.g. set true before, false after).
 */
export async function submitFollowUp(annotationId: string, question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;

  annotationsStore.appendUserMessage(annotationId, q);
  annotationsStore.startAssistantReply(annotationId);

  const list = get(annotationsStore);
  const ann = list.find((a) => a.id === annotationId);
  if (!ann) return;

  const threadForApi = ann.thread.slice(0, -2).map((m) => ({ role: m.role, content: m.content }));

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
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    annotationsStore.setThreadError(annotationId, 'No response body');
    return;
  }

  const decoder = new TextDecoder();
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) {
      annotationsStore.appendAssistantReplyChunk(
        annotationId,
        decoder.decode(value, { stream: true })
      );
    }
  }
}
