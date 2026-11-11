/**
 * What a client authorises when importing a portfolio, and the exact words they
 * are shown.
 *
 * ## Why the wording lives in a constant and not in the component
 *
 * Under the DPDP Act the question that matters later is not "did they consent?"
 * but "what were they shown when they did?". Every grant is stored against a
 * `policy_version`, and that is only meaningful if the text for a version is
 * pinned somewhere a diff can find it. Copy edited directly in JSX would
 * silently rewrite what past consents appear to have said.
 *
 * **Bump `CONSENT_POLICY_VERSION` whenever any wording below changes.** Existing
 * rows keep their old version and remain a truthful record.
 *
 * ## Why four consents and not one checkbox
 *
 * They are genuinely separable and a client may reasonably want some and not
 * others — most obviously, plenty will import a statement by hand while
 * refusing us any access to their email. Bundling them would make the refusal
 * impossible to express, which is precisely what "freely given, specific"
 * consent is supposed to prevent.
 */

export const CONSENT_POLICY_VERSION = 'v1';

export const CONSENT = {
  casRequest: 'cas_request',
  emailRead: 'email_read',
  tempStorage: 'temp_storage',
  portfolioImport: 'portfolio_import',
  arnMigration: 'arn_migration',
} as const;

export type ConsentType = (typeof CONSENT)[keyof typeof CONSENT];

export interface ConsentCopy {
  label: string;
  detail: string;
  /** Required consents cannot be unticked; the import cannot proceed without them. */
  required: boolean;
}

export const CONSENT_COPY: Record<ConsentType, ConsentCopy> = {
  [CONSENT.casRequest]: {
    label: 'I am requesting my own statement',
    detail:
      'You will request the statement yourself on the registrar’s website. We cannot request it for you — only the investor can.',
    required: true,
  },
  [CONSENT.portfolioImport]: {
    label: 'Read my statement and show it as my portfolio',
    detail:
      'We read the holdings and transactions it contains and show them here, including funds you did not buy through us.',
    required: true,
  },
  [CONSENT.tempStorage]: {
    label: 'Handle the file while it is being read',
    detail:
      'The PDF is opened in memory on our own servers and discarded once read. The file itself is never stored, and neither is its password.',
    required: true,
  },
  [CONSENT.emailRead]: {
    label: 'Look for the statement in my email (optional)',
    detail:
      'Only messages from the registrar carrying a statement. Nothing else in your mailbox is read, and you can disconnect at any time.',
    required: false,
  },
  [CONSENT.arnMigration]: {
    label: 'Show me funds held with other distributors',
    detail:
      'Your statement names the distributor for each holding. We use it to show which funds sit elsewhere. Nothing is moved without a separate instruction from you.',
    required: false,
  },
};

/**
 * The wording used when WE place the statement request for the client, through
 * a service provider, instead of sending them to the registrar's website.
 *
 * It is a different promise from v1's "you will request it yourself", so it is
 * a different policy version rather than an edit: a v1 row must keep meaning
 * what it said. Which one a client sees depends on whether the server can place
 * requests (`CasRequestService.mode`), and the version travels with the request
 * so the stored consent names the text that was actually on screen.
 */
export const CONSENT_POLICY_VERSION_AUTO = 'v2';

export const CAS_REQUEST_AUTO_COPY: ConsentCopy = {
  label: 'Request my statement for me',
  detail:
    'We place the request with the registrar on your behalf through our service provider, sharing your email address, PAN and a one-time file password with them. The statement is emailed only to you.',
  required: true,
};

/** The copy for a consent under a given mode — only the request differs. */
export const consentCopy = (type: ConsentType, autoSubmit: boolean): ConsentCopy =>
  autoSubmit && type === CONSENT.casRequest ? CAS_REQUEST_AUTO_COPY : CONSENT_COPY[type];

/** The consents the import wizard asks for, in the order they are shown. */
export const IMPORT_CONSENTS: ConsentType[] = [
  CONSENT.casRequest,
  CONSENT.portfolioImport,
  CONSENT.tempStorage,
];

export const requiredConsents = (): ConsentType[] =>
  IMPORT_CONSENTS.filter((c) => CONSENT_COPY[c].required);

/** True when every required consent has been ticked. */
export const hasRequiredConsents = (granted: Iterable<ConsentType>): boolean => {
  const set = new Set(granted);
  return requiredConsents().every((c) => set.has(c));
};
