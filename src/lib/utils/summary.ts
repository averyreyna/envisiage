const MAX_PREVIEW_LEN = 120;

export function annotationSummary(explanation: string): string {
  const trimmed = explanation.trim();
  if (!trimmed) return 'No explanation yet.';
  const plain = trimmed
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .trim();
  // first sentence or truncate for collapsed card preview (no markdown)
  const firstSentence = plain.split(/[.!?]\s+/)[0]?.trim() ?? plain;
  if (firstSentence.length <= MAX_PREVIEW_LEN) return firstSentence;
  return firstSentence.slice(0, MAX_PREVIEW_LEN).trim() + '…';
}
