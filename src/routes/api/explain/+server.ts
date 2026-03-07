import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { getExplainSystemPrompt } from '$lib/prompts/explain';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  let body: {
    code: string;
    selection: string;
    fullContext: string;
    language: string;
    reExplain?: 'different' | 'simpler' | 'technical';
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { code, selection, fullContext, language, reExplain } = body;
  if (typeof selection !== 'string') {
    return json({ error: 'Missing or invalid selection' }, { status: 400 });
  }

  const userContent = [
    `Language: ${language || 'javascript'}`,
    '',
    'Selected code (explain only this):',
    '```',
    selection,
    '```',
    '',
    'Surrounding context (for reference only):',
    '```',
    fullContext || code || '',
    '```'
  ].join('\n');

  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: getExplainSystemPrompt(reExplain),
    messages: [{ role: 'user', content: userContent }]
  });

  const readable = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      stream.on('text', (text: string) => {
        controller.enqueue(encoder.encode(text));
      });
      stream
        .finalMessage()
        .then(() => controller.close())
        .catch((err) => controller.error(err));
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};
