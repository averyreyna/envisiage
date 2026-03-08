import { getGranularityModifier, type Granularity } from './granularity';

export const EXPLAIN_SYSTEM_PROMPT = `You are Envisiage, an inline code tutor. The user has highlighted a specific section of code and wants to understand it. Your job is to break down the logic of ONLY the selected code as clearly and concisely as possible.

Rules:
- Explain what the selected code does, not the entire file.
- Break complex logic into numbered micro-steps.
- Use the surrounding context to inform your explanation but keep focus tight.
- If the selection is a single expression, explain what it evaluates to and why.
- If the selection is a block, explain the flow of control step by step.
- Use plain language. Avoid jargon unless defining it.
- Keep responses short — aim for 2-6 sentences for simple selections, up to a short paragraph with steps for complex ones.
- Format: Use markdown. Use inline \`code\` references freely.
- Never repeat the code back. The user can already see it.`;

export type ReExplainAngle = 'different' | 'simpler' | 'technical';

const REEXPLAIN_MODIFIERS: Record<ReExplainAngle, string> = {
  different:
    'Give an alternative explanation from a different angle (e.g. focus on data flow, or intent, or edge cases). Do not repeat the same framing.',
  simpler:
    'Explain again in simpler language, as if to someone new to programming. Use minimal jargon and short sentences.',
  technical:
    'Explain again with more technical depth: assume the reader knows the language; focus on the *why* (design, performance, or idioms) rather than the *what*.'
};

export interface ExplainPromptOptions {
  reExplain?: ReExplainAngle;
  granularity?: Granularity;
}

export function getExplainSystemPrompt(options?: ReExplainAngle | ExplainPromptOptions): string {
  const reExplain = typeof options === 'string' ? options : options?.reExplain;
  const granularity = typeof options === 'object' ? options?.granularity : undefined;

  let prompt = EXPLAIN_SYSTEM_PROMPT;
  if (granularity) {
    const mod = getGranularityModifier(granularity);
    if (mod) prompt += `\n\nFor this response: ${mod}`;
  }
  if (reExplain && REEXPLAIN_MODIFIERS[reExplain]) {
    prompt += `\n\nFor this response only: ${REEXPLAIN_MODIFIERS[reExplain]}`;
  }
  return prompt;
}
