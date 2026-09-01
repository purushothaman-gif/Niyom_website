import { describe, expect, it } from 'vitest';
import { applyMerge, campaignContentHash, portalCta, renderCampaign, safeUrl } from './render.ts';
import { parseBlocks } from './blocks.ts';
import type { MailBlock } from './blocks.ts';

const base = {
  subject: 'Subject',
  preheader: '',
  blocks: [] as MailBlock[],
  audience: 'client' as const,
  ctaPortalEnabled: false,
  ctaPortalLabel: '',
  appUrl: 'https://niyomwealth.com',
  year: 2026,
};

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('https://niyomwealth.com/x')).toBe('https://niyomwealth.com/x');
    expect(safeUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects every other scheme', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd']) {
      expect(safeUrl(bad)).toBe('');
    }
  });

  it('rejects junk rather than guessing', () => {
    expect(safeUrl('not a url')).toBe('');
    expect(safeUrl('')).toBe('');
  });
});

describe('escaping', () => {
  it('never emits admin-authored markup', () => {
    const { html } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: '<script>alert(1)</script> & "quotes"' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('drops a javascript: link but keeps its label', () => {
    const { html, text } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: 'see [this](javascript:void) now' }],
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('see this now');
    expect(text).toContain('see this now');
  });

  it('leaks nothing even when the bad URL contains brackets', () => {
    // The link pattern stops at the first ')', so a URL carrying its own
    // parentheses parses oddly — but it must still never reach the output.
    const { html, text } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: 'see [this](javascript:alert(1)) now' }],
    });
    expect(html).not.toContain('javascript');
    expect(text).not.toContain('javascript');
    expect(html).toContain('see this'); // the label survives, the URL does not
  });

  it('drops a button and an image whose URL is unsafe', () => {
    const { html } = renderCampaign({
      ...base,
      blocks: [
        { type: 'button', label: 'Click', url: 'javascript:alert(1)' },
        { type: 'image', url: 'data:image/svg+xml,<svg onload=alert(1)>', alt: 'x' },
      ],
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('>Click<');
  });
});

describe('inline markdown', () => {
  it('renders the three supported forms', () => {
    const { html } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: '**bold** and *italic* and [link](https://a.com/)' }],
    });
    expect(html).toContain('<strong');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('href="https://a.com/"');
  });

  it('flattens to readable plain text', () => {
    const { text } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: '**bold** and [link](https://a.com/)' }],
    });
    expect(text).toContain('bold and link (https://a.com/)');
    expect(text).not.toContain('**');
  });
});

describe('merge fields', () => {
  it('substitutes known keys and leaves unknown ones alone', () => {
    expect(applyMerge('Hi {{first_name}}, ref {{code}} {{nope}}', { first_name: 'Asha', code: 'NW001' }))
      .toBe('Hi Asha, ref NW001 {{nope}}');
  });

  it('escapes a substituted value rather than trusting it', () => {
    const { html } = renderCampaign({
      ...base,
      blocks: [{ type: 'paragraph', text: 'Hi {{first_name}}' }],
      merge: { first_name: '<b>Mallory</b>' },
    });
    expect(html).not.toContain('<b>Mallory</b>');
    expect(html).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
  });

  it('substitutes into the subject and the preheader', () => {
    const { html, text } = renderCampaign({
      ...base,
      subject: 'Hello {{first_name}}',
      preheader: 'For {{code}}',
      merge: { first_name: 'Asha', code: 'NW001' },
    });
    expect(text).toContain('Hello Asha');
    expect(html).toContain('For NW001');
  });
});

describe('portal CTA', () => {
  it('resolves by audience', () => {
    expect(portalCta('client', 'https://niyomwealth.com', '')).toEqual({
      label: 'Open Client Portal', url: 'https://niyomwealth.com/client-login',
    });
    expect(portalCta('partner', 'https://niyomwealth.com/', '')).toEqual({
      label: 'Open Partner Portal', url: 'https://niyomwealth.com/partner-login',
    });
  });

  it('honours a custom label', () => {
    expect(portalCta('client', 'https://niyomwealth.com', 'View your portfolio').label)
      .toBe('View your portfolio');
  });

  it('is appended only when enabled', () => {
    const off = renderCampaign({ ...base, ctaPortalEnabled: false });
    expect(off.html).not.toContain('/client-login');

    const on = renderCampaign({ ...base, ctaPortalEnabled: true, audience: 'partner' });
    expect(on.html).toContain('https://niyomwealth.com/partner-login');
    expect(on.text).toContain('Open Partner Portal: https://niyomwealth.com/partner-login');
  });
});

describe('unsubscribe', () => {
  it('appears in both parts when supplied', () => {
    const { html, text } = renderCampaign({ ...base, unsubscribeUrl: 'https://x.co/u?t=abc' });
    expect(html).toContain('https://x.co/u?t=abc');
    expect(html).toContain('Unsubscribe');
    expect(text).toContain('Unsubscribe from these updates: https://x.co/u?t=abc');
  });

  it('is absent from a preview that has no token', () => {
    const { html } = renderCampaign(base);
    expect(html).not.toContain('Unsubscribe');
  });
});

describe('parseBlocks', () => {
  it('drops unrecognised shapes instead of trusting the column', () => {
    const parsed = parseBlocks([
      { type: 'paragraph', text: 'ok' },
      { type: 'bogus', text: 'x' },
      null,
      'string',
      { type: 'bullets', items: ['a', 3, 'b'] },
    ]);
    expect(parsed).toEqual([
      { type: 'paragraph', text: 'ok' },
      { type: 'bullets', items: ['a', 'b'] },
    ]);
  });

  it('returns an empty list for non-array input', () => {
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks({})).toEqual([]);
  });
});

describe('campaignContentHash', () => {
  const input = {
    subject: 'S', preheader: 'P', blocks: [{ type: 'paragraph', text: 'a' }] as MailBlock[],
    audience: 'client' as const, ctaPortalEnabled: true, ctaPortalLabel: '',
  };

  it('is stable for identical content', async () => {
    expect(await campaignContentHash(input)).toBe(await campaignContentHash({ ...input }));
  });

  it('changes when anything a recipient can see changes', async () => {
    const baseline = await campaignContentHash(input);
    expect(await campaignContentHash({ ...input, subject: 'S2' })).not.toBe(baseline);
    expect(await campaignContentHash({ ...input, blocks: [{ type: 'paragraph', text: 'b' }] })).not.toBe(baseline);
    expect(await campaignContentHash({ ...input, ctaPortalEnabled: false })).not.toBe(baseline);
    expect(await campaignContentHash({ ...input, audience: 'partner' })).not.toBe(baseline);
  });
});
