import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { buildFollowupSystemPrompt } from '$lib/prompts/followup';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
  }

  let body: {
    selectedText: string;
    explanation: string;
    thread: Array< { role: string; content: string; id?: string; timestamp?: number } >;
    question: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { selectedText, explanation, thread, question } = body;
  if (typeof question !== 'string' || !question.trim()) {
    return json({ error: 'Missing or invalid question' }, { status: 400 });
  }

  const system = buildFollowupSystemPrompt(selectedText ?? '', explanation ?? '', thread ?? []);

  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of thread ?? []) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content });
    }
  }
  messages.push({ role: 'user', content: question });

  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system,
    messages: messages as { role: 'user' | 'assistant'; content: string }[]
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
