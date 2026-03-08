export type Granularity = 'eli5' | 'step-through' | 'technical' | 'debug';

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  eli5: 'ELI5',
  'step-through': 'Step-through',
  technical: 'Technical',
  debug: 'Debug'
};

const GRANULARITY_MODIFIERS: Record<Granularity, string> = {
  eli5:
    "Explain like I'm a beginner. No assumed programming knowledge. Use simple analogies and avoid jargon. If you must use a technical term, define it in one sentence.",
  'step-through':
    'Walk through the logic line by line, step by step. Number each step. Describe what happens at each line and how it leads to the next.',
  technical:
    "Assume I know the language. Explain the *why* — design choices, performance implications, or idioms — not the *what*. Be concise and precise.",
  debug:
    "I think something might be wrong here. Help me find it. Consider edge cases, off-by-one errors, and common pitfalls. Suggest what to check or log."
};

export function getGranularityModifier(granularity: Granularity): string {
  return GRANULARITY_MODIFIERS[granularity] ?? '';
}
