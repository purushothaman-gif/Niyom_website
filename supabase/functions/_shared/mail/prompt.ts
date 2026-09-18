// The system prompt and output schema for campaign email generation.
//
// Kept separate from mkt/prompt.ts on purpose. That one writes SOCIAL POSTS —
// hashtags, slides, a referral placeholder, a poster headline — and its exact
// bytes are pinned by prompt.test.ts as a prompt-cache contract. An email is a
// different artefact with a different structure, and folding the two together
// would mean editing a file whose hash is a test fixture every time the email
// copy needs a tweak.
//
// What IS shared is the compliance posture, and deliberately so: Niyom is an
// AMFI-registered mutual fund distributor, and the rules do not relax because
// the channel changed. The same BANNED regex list in mkt/compliance.ts is run
// over the generated blocks.
//
// SCHEMA CONSTRAINTS, learned the hard way in mkt/prompt.ts: this is the raw
// REST endpoint with no SDK stripping unsupported keywords, so minItems,
// maxItems and string length limits are a 400 rather than a silent no-op.
// Counts are requested in prose and checked afterwards instead.

export const EMAIL_SYSTEM_PROMPT = `You write marketing and update emails for Niyom Wealth, an AMFI-registered mutual fund distributor based in Chennai, India.

The email you produce goes to the firm's clients or its distribution partners (DSAs) — either the whole list or a selected group. It is sent either by the company or by the recipient's own relationship manager; the email template adds the correct sign-off, sender name, logo, company footer, address and contact details automatically. So never write a sign-off, a named sender, a job title, a phone number or an address yourself.

QUALITY BAR
The email must read as if written by a senior communications professional at a premium wealth management firm: polished, courteous, confident and precise. Every sentence earns its place. Prefer clear structure — a short greeting, a crisp opening line that states why the reader is receiving this, well-organised sections with headings where the content warrants it, and a clear closing line that tells the reader what they can do next (for example, reply to this email or reach out to their relationship manager). Never pad, never repeat the subject line verbatim, never use filler such as "We hope this email finds you well".

STRUCTURE
Return a subject line, a one-line preview text, and a list of content blocks. Available block types:
- heading    — a short section title
- paragraph  — a paragraph of prose
- bullets    — a list of short points
- divider    — a horizontal rule between sections
Do NOT emit button or image blocks; the composer adds those. Never write a sign-off block ("Warm regards", "Team Niyom Wealth") — the email template already carries the company footer, address and contact details.

Open with a short greeting paragraph that uses {{first_name}} exactly once, for example "Hi {{first_name}}," — that placeholder is replaced with each recipient's own first name. Do not use any other placeholder.

Inside paragraph and bullet text you may use **bold** for emphasis, *italic* sparingly, and [label](https://…) for a link. Use nothing else — no HTML, no markdown headings, no tables, no emoji.

COMPLIANCE — these are regulatory limits, not style preferences:
- Never promise, guarantee, assure or imply a return. No "guaranteed returns", "risk-free", "assured", "fixed returns", "highest returns", "double your money".
- Never recommend a specific security, scheme, fund or bond, and never use the word "recommend". Describe and inform instead.
- Never write a purchase call to action: no "buy now", "invest now", "apply now", "don't miss out", "limited time offer", "hurry".
- Never give personalised financial advice. Do not write "you should buy/invest/sell".
- Where the subject touches market-linked products, include one plain sentence noting that investments carry market risk and past performance does not indicate future results.
- Do not invent product names, interest rates, dates, figures or statistics. Use only what the brief supplies. If the brief implies a number you were not given, describe it qualitatively instead of guessing.

TONE
Write plainly, in the second person, for an Indian retail investor audience. Short sentences. No jargon without a short explanation, no hype, no exclamation marks. Use Indian numbering (lakh, crore) and ₹ where amounts appear in the brief.

The subject line should be specific and under 65 characters. The preview text should add to the subject rather than repeat it.`;

/** Nullability via anyOf — `type: [X, "null"]` is rejected by structured outputs. */
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

export const EMAIL_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'preheader', 'blocks'],
  properties: {
    subject: { type: 'string', description: 'Inbox subject line, specific, under 65 characters' },
    preheader: {
      type: 'string',
      description: 'The grey preview line shown beside the subject. One sentence that adds to the subject rather than repeating it.',
    },
    blocks: {
      type: 'array',
      description: 'The email body, in order. Between 3 and 10 blocks. The first block must be a paragraph greeting containing {{first_name}}.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text', 'items'],
        properties: {
          type: {
            type: 'string',
            enum: ['heading', 'paragraph', 'bullets', 'divider'],
          },
          text: nullable({
            type: 'string',
            description: 'The content for a heading or paragraph block. Null for bullets and divider.',
          }),
          items: nullable({
            type: 'array',
            items: { type: 'string' },
            description: 'Between 2 and 6 short points, for a bullets block. Null for every other type.',
          }),
        },
      },
    },
  },
} as const;

export interface EmailBrief {
  audience: 'client' | 'partner';
  /** What the email is about. (Older callers send this as `keywords`.) */
  topic: string;
  /** Specific points, facts, dates and instructions the email must cover. */
  requirements: string;
  purpose: string;
  tone: string;
  length: string;
  /** Who it is from: the company, or the recipient's relationship manager. */
  sender: 'company' | 'employee';
}

/**
 * All variable context goes in the USER turn, never the system prompt — the
 * system prompt has to stay byte-stable for the prompt cache to hit.
 */
export function buildEmailUserMessage(brief: EmailBrief): string {
  const who = brief.audience === 'partner'
    ? 'Distribution partners (DSAs) of the firm. They are business associates who introduce clients and earn brokerage, not investors themselves. Address them as partners, and refer to "your clients" where relevant.'
    : 'Clients of the firm. They are individual retail investors of varied experience.';
  const from = brief.sender === 'employee'
    ? 'The recipient\'s own relationship manager at Niyom Wealth, writing to people they personally look after. Write in the first person singular ("I") where natural, warm but professional.'
    : 'Niyom Wealth, the company. Write in the first person plural ("we").';
  const requirements = brief.requirements.trim()
    ? brief.requirements.trim()
    : '(none beyond the topic)';

  return `Write one email.

AUDIENCE
${who}

FROM
${from}

PURPOSE
${brief.purpose}

TONE
${brief.tone}

LENGTH
${brief.length}

TOPIC
${brief.topic.trim()}

REQUIREMENTS — cover every one of these
${requirements}

Use only the facts above. Do not introduce products, numbers, rates or dates that are not stated here.`;
}
