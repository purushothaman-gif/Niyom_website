// The generation pipeline, shared by the manual studio and the daily batch.
//
// One implementation on purpose. `mkt-generate-content` (admin JWT, returns the
// draft to the browser) and the automated batch (secret-gated, writes rows) are
// different entry points onto the same behaviour — history, prompt, model call,
// lint, corrective retry, duplicate check. Two copies of this would drift, and
// the drift would be discovered by something non-compliant reaching a feed.

import { callAnthropic, ANTHROPIC_MODEL } from './anthropic.ts';
import type { AnthropicMessage } from './anthropic.ts';
import { lint, structuralFlags, entityLeakageFlags, REF_PLACEHOLDER } from './compliance.ts';
import { duplicateFlags, loadHistory } from './history.ts';
import { buildUserMessage } from './prompt.ts';
import type { SbConfig } from '../cas/db.ts';
import type { Brief, Flag, GenerateResult, TrendItem } from './types.ts';

export interface GenerateOptions {
  cfg: SbConfig;
  apiKey: string;
  brief: Brief;
  /** Sanitised news headlines. Empty for the manual studio. */
  trends?: TrendItem[];
  /**
   * Skip the same-category duplicate query. The automated path runs its own,
   * stricter uniqueness pass and does not need this one repeated.
   */
  skipDuplicateCheck?: boolean;
}

export async function generateDraft(opts: GenerateOptions): Promise<GenerateResult> {
  const { cfg, apiKey, brief, trends = [] } = opts;
  const headlines = trends.map(t => t.title);

  const history = await loadHistory(cfg, brief.category);
  const messages: AnthropicMessage[] = [
    { role: 'user', content: buildUserMessage(brief, history, trends) },
  ];

  let { draft, usage } = await callAnthropic(apiKey, messages);
  let flags: Flag[] = [
    ...lint(draft),
    ...structuralFlags(draft),
    ...entityLeakageFlags(draft, headlines),
  ];

  // One corrective retry, quoting the exact violations. Kept only if it is
  // actually cleaner — a retry that trades two flags for two different ones is
  // not progress, and the first draft is at least the one the admin has already
  // waited for.
  //
  // NOTE — behaviour fix during extraction. The original compared the first
  // draft's full flag set against a retry scored on `lint` plus the caption
  // placeholder ONLY, leaving the hashtag and keyword count checks out of the
  // retry. A first draft flagged solely for a short hashtag list therefore
  // scored 1, its equally-short retry scored 0, and the retry was accepted with
  // `flags` reset to empty — silently dropping a structural finding the admin
  // was supposed to see. Both sides are now scored identically.
  if (flags.length) {
    const complaints = flags.map(f => `- ${f.field}: "${f.phrase}" (${f.label})`).join('\n');

    messages.push({ role: 'assistant', content: JSON.stringify(draft) });
    messages.push({
      role: 'user',
      content:
        `That draft breaks the rules in these places:\n${complaints}\n\n` +
        `Rewrite it completely. Remove every flagged phrase and anything similar. ` +
        `Keep it purely educational, keep the caption's single ${REF_PLACEHOLDER} token, ` +
        `and do not reintroduce any promise, recommendation or purchase prompt.`,
    });

    try {
      const retry = await callAnthropic(apiKey, messages);
      const retryFlags = [
        ...lint(retry.draft),
        ...structuralFlags(retry.draft),
        ...entityLeakageFlags(retry.draft, headlines),
      ];
      if (retryFlags.length < flags.length) {
        draft = retry.draft;
        flags = retryFlags;
        usage = retry.usage;
      }
    } catch {
      // Retry failed — fall through and return the first draft with its flags
      // so the admin can fix it by hand rather than losing the work.
    }
  }

  if (!opts.skipDuplicateCheck) {
    flags = [...flags, ...(await duplicateFlags(cfg, draft, brief.category))];
  }

  return { draft, flags, usage, model: ANTHROPIC_MODEL };
}
