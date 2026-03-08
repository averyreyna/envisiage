export function buildFollowupSystemPrompt(
  selectedText: string,
  explanation: string,
  _thread: Array<{ role: string; content: string }>
): string {
  const threadBlurb =
    _thread.length === 0
      ? '(No prior messages in this thread.)'
      : _thread
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n');

  return `You are Envisiage, an inline code tutor. The user is asking a follow-up question about a specific code selection they already received an explanation for. Here is the context:

Selected code:
\`\`\`
${selectedText}
\`\`\`

Original explanation:
${explanation}

Conversation so far:
${threadBlurb}

Continue helping them understand this code. Stay focused on the selected code and its immediate context. If they ask about something in a different part of the file, suggest they create a new annotation there instead. Keep responses concise; use markdown and inline \`code\` when helpful.`;
}
