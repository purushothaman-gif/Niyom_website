// The Anthropic call for content generation.
//
// Plain fetch against the REST endpoint, no SDK — which means nothing strips
// unsupported request fields for us, so every field below is deliberate. Read
// the comments before changing any of them; two of these settings were arrived
// at by watching generations fail.

import { DRAFT_SCHEMA, SYSTEM_PROMPT } from './prompt.ts';
import type { Usage } from './types.ts';

export const ANTHROPIC_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface AnthropicMessage {
  role: string;
  content: string;
}

/**
 * Read and sanity-check the API key.
 *
 * The raw secret goes straight into the x-api-key header, so paste artifacts
 * fail as a bare "invalid x-api-key" with nothing to point at. Two are common
 * enough to just absorb: surrounding whitespace (a trailing newline from a
 * shell) and surrounding quotes (from a dashboard field or an over-quoted CLI
 * call). Anything else is reported rather than guessed at.
 *
 * Returns the key, or a ready-to-send error message. No part of the value is
 * ever logged or returned.
 */
export function resolveApiKey(raw: string | undefined): { key: string } | { error: string } {
  const apiKey = raw
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim();

  if (!apiKey) {
    return {
      error: 'Content generation is not configured yet. An administrator needs to set the ANTHROPIC_API_KEY secret for this project.',
    };
  }

  // Shape check only. An Anthropic API key starts with "sk-ant-" and runs to
  // roughly 100+ characters. Reporting the length and a couple of structural
  // hints turns "invalid x-api-key" into something the admin can act on without
  // anyone having to read the secret back.
  if (!apiKey.startsWith('sk-ant-')) {
    const hints: string[] = [`length ${apiKey.length}`];
    if (apiKey.includes('=')) hints.push('contains "=" — the whole NAME=value line may have been stored');
    if (/\s/.test(apiKey)) hints.push('contains a space or line break');
    if (apiKey.startsWith('sk-')) hints.push('starts with "sk-" but not "sk-ant-" — may be another provider\'s key');

    return {
      error: 'The stored ANTHROPIC_API_KEY is not an Anthropic API key — it should begin ' +
        `with "sk-ant-" and be about 100 characters long. What is stored: ${hints.join('; ')}. ` +
        'Set the secret to the key value on its own, with no surrounding quotes and no ' +
        'NAME= prefix.',
    };
  }

  return { key: apiKey };
}

/**
 * Optional overrides, for callers generating something other than a social post.
 *
 * The email composer reuses this transport — the key handling, the error
 * mapping and the two hard-won request settings below are worth exactly one
 * implementation — but needs its own system prompt and output schema. Both
 * default to the social-post pair, so every existing caller is unchanged and
 * prompt.ts (whose SHA-256 is pinned by prompt.test.ts as a prompt-cache
 * contract) stays untouched.
 */
export interface AnthropicOverrides {
  system?: string;
  schema?: Record<string, unknown>;
}

export async function callAnthropic(
  apiKey: string,
  messages: AnthropicMessage[],
  overrides: AnthropicOverrides = {},
): Promise<{ draft: Record<string, unknown>; usage?: Usage }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      // max_tokens caps thinking AND response text together. Adaptive thinking
      // is on by default on this model, so a budget sized only for the JSON
      // would truncate mid-object once the model thinks — which surfaces as
      // stop_reason "max_tokens" and loses the whole generation. A carousel
      // draft with 10 slides plus a video script is the worst case; 16000
      // leaves comfortable room for it alongside the reasoning.
      max_tokens: 16000,
      system: overrides.system ?? SYSTEM_PROMPT,
      messages,
      // Thinking is stated explicitly rather than relied on as a default, and
      // its content is left omitted — nothing here surfaces reasoning to a UI.
      thinking: { type: 'adaptive' },
      // Guarantees schema-valid JSON. Note: this model REJECTS non-default
      // temperature / top_p / top_k with a 400, so none of them are sent.
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: overrides.schema ?? DRAFT_SCHEMA },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();

    // A 401 here is always the stored credential, never the caller — the admin
    // reading this message has already authenticated against the CRM. Say so
    // plainly instead of surfacing a raw API dump they can't act on.
    if (res.status === 401) {
      throw new Error(
        'The Anthropic API key was rejected. The ANTHROPIC_API_KEY secret for this project ' +
        'is missing, revoked, or malformed — set a fresh key from console.anthropic.com and ' +
        'redeploy is not required (the function reads the secret on each run).',
      );
    }
    if (res.status === 429) {
      throw new Error('Anthropic rate limit reached. Wait a moment and generate again.');
    }
    if (res.status >= 500) {
      throw new Error('Anthropic is temporarily unavailable. Try generating again shortly.');
    }

    throw new Error(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`);
  }

  const payload = await res.json();

  if (payload.stop_reason === 'refusal') {
    throw new Error('The model declined to generate this content. Try a different topic or wording.');
  }
  if (payload.stop_reason === 'max_tokens') {
    throw new Error('Generation was cut off before completing. Try a shorter format or fewer slides.');
  }

  const text = (payload.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');

  if (!text.trim()) throw new Error('The model returned an empty response.');

  let draft: Record<string, unknown>;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error('The model returned malformed JSON.');
  }
  return { draft, usage: payload.usage };
}
