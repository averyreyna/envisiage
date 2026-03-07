/** First sentence or truncated preview for collapsed annotation, plain text (no markdown). */
const MAX_PREVIEW_LEN = 120;

export function annotationSummary(explanation: string): string {
  const trimmed = explanation.trim();
  if (!trimmed) return 'No explanation yet.';
  // Strip markdown for preview: remove code backticks, take first sentence or chunk
  const plain = trimmed
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .trim();
  const firstSentence = plain.split(/[.!?]\s+/)[0]?.trim() ?? plain;
  if (firstSentence.length <= MAX_PREVIEW_LEN) return firstSentence;
  return firstSentence.slice(0, MAX_PREVIEW_LEN).trim() + '…';
}
