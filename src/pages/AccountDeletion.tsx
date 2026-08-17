import { UserX } from 'lucide-react';
import {
  LegalDocumentLayout,
  LegalSection,
  LegalSubsection,
  LegalList,
  AlertBox,
  ContactBox,
} from '../components/LegalDocumentLayout';

interface AccountDeletionProps {
  onClose: () => void;
}

/**
 * Account & data deletion.
 *
 * Google Play requires a publicly reachable URL — no login, no app install —
 * that names the app, says how to ask for deletion, and states exactly what is
 * erased, what is kept, and for how long. Apple asks for the same route from
 * inside the app. This page is that URL, and it is deliberately reachable
 * without an account.
 *
 * ## Why it cannot promise to erase everything
 *
 * Niyom is an AMFI-registered mutual fund distributor. Once someone has
 * transacted, KYC and transaction records fall under statutory retention — the
 * PMLA and SEBI rules require them to be kept for five years, and that duty
 * survives the client asking us to forget them. Writing "we delete everything"
 * would be the easy sentence and a false one; the stores accept a documented
 * legal-retention carve-out, and a client is better served by knowing which of
 * their data actually goes.
 *
 * The distinction that matters here: an account that never transacted CAN be
 * removed in full, and that case is stated separately rather than buried.
 */
export function AccountDeletion({ onClose }: AccountDeletionProps) {
  return (
    <LegalDocumentLayout
      title="Delete Your Account"
      subtitle="Niyom Wealth — client and partner accounts"
      effectiveDate="August 15, 2026"
      icon={<UserX className="w-16 h-16 text-text-secondary" strokeWidth={1.5} />}
      onClose={onClose}
    >
      <LegalSection number="1" title="Which accounts this covers">
        <p>
          This page explains how to request deletion of your{' '}
          <strong>Niyom Wealth</strong> account and the personal data held with it. It applies
          to accounts used through the Niyom Wealth mobile app (Android and iOS) and through
          the client and partner portals on niyomwealth.com. They are the same account —
          deleting it removes your access everywhere.
        </p>
      </LegalSection>

      <LegalSection number="2" title="How to request deletion">
        <LegalSubsection number="2.1" title="By email (fastest)">
          <p>
            Send a request from the email address registered on your account to{' '}
            <strong>support@niyomwealth.com</strong> with the subject{' '}
            <strong>“Account deletion request”</strong>, including:
          </p>
          <LegalList
            items={[
              'Your full name as registered with us',
              'Your client code or partner code, if you have one to hand',
              'Whether you want the account closed entirely, or only the app access removed',
            ]}
          />
          <p className="mt-4">
            Sending from your registered email is how we confirm the request is yours. If you no
            longer have access to that address, call us on the number below and we will verify you
            another way. Please do not send your PAN, bank details or any password by email.
          </p>
        </LegalSubsection>

        <LegalSubsection number="2.2" title="From inside the app or portal">
          <p>
            Open <strong>Profile → Support</strong>, raise a ticket under the{' '}
            <strong>General</strong> category, and write “Account deletion request”. Your
            relationship manager receives it immediately and it is tracked until it is closed.
          </p>
        </LegalSubsection>

        <LegalSubsection number="2.3" title="By phone">
          <p>
            Call <strong>+91 8939433113</strong> on a working day and ask for account deletion.
            We will confirm your identity on the call and record the request for you.
          </p>
        </LegalSubsection>
      </LegalSection>

      <LegalSection number="3" title="What happens, and when">
        <p>
          We acknowledge every request within <strong>2 working days</strong> and complete it
          within <strong>30 days</strong>. If anything is holding it up — an open transaction, a
          pending settlement — we will tell you what and why rather than letting the request go
          quiet.
        </p>
      </LegalSection>

      <LegalSection number="4" title="What is deleted">
        <p>On completion, the following are erased from our active systems:</p>
        <LegalList
          items={[
            'Your login and password, and any device PIN or biometric unlock you had set',
            'Your app sessions on every device, which are signed out immediately',
            'Your contact details — email address, phone number and postal address',
            'KYC documents you uploaded (PAN card, bank proof, demat/CML statements)',
            'Bank account details held for payouts and redemptions',
            'Support tickets, notifications and your saved preferences',
            'Any imported Consolidated Account Statement data and the holdings derived from it',
            'For partners: your referral link, and it stops attributing new signups',
          ]}
        />
      </LegalSection>

      <LegalSection number="5" title="What we must keep, and why">
        <AlertBox type="warning">
          Niyom Wealth Distribution LLP is an AMFI-registered mutual fund distributor. Indian law
          requires us to retain certain records even after you close your account. We cannot waive
          this, and no firm in our position can.
        </AlertBox>

        <p className="mt-4">
          If you have <strong>ever transacted</strong> through us, the following is retained for{' '}
          <strong>five years</strong> from the date of the transaction or from the end of our
          relationship, whichever is later — as required by the Prevention of Money Laundering Act,
          2002 and the rules made under it, and by SEBI regulations applicable to distributors:
        </p>
        <LegalList
          items={[
            'Transaction records — purchases, redemptions, switches and systematic plans',
            'The identity and KYC verification record behind those transactions',
            'Commission, payout and statement records, which are also accounting records',
            'Communications we are obliged to preserve, such as signed confirmations',
          ]}
        />

        <p className="mt-4">
          This retained record is <strong>locked away from ordinary use</strong>. It is not used to
          contact you, not used for marketing, and not visible to your relationship manager in
          day-to-day work. It is produced only if a regulator or a court requires it. Once the
          statutory period expires, it is deleted.
        </p>

        <AlertBox type="info">
          <strong>If you have never transacted</strong> — for example you opened an account and did
          not complete KYC, or completed KYC but never invested — nothing needs to be retained, and
          your record is deleted in full.
        </AlertBox>
      </LegalSection>

      <LegalSection number="6" title="Things worth knowing before you ask">
        <LegalList
          items={[
            'Deletion is permanent. We cannot restore an account afterwards; you would open a new one and complete KYC again.',
            'Your investments are not affected. Units you hold are registered with the fund houses and the registrars (CAMS/KFintech), not with us — closing your Niyom account does not sell, transfer or touch them. It ends our servicing relationship.',
            'Active systematic plans should be stopped first. A SIP registered through BSE keeps collecting until it is cancelled with them, so tell us if you want those stopped as part of the request.',
            'Partners with unpaid statements: any payout already raised is settled before the account is closed.',
            'Deleting the app alone deletes nothing. Removing it from your phone signs you out; it does not reach our records. This request does.',
          ]}
        />
      </LegalSection>

      <LegalSection number="7" title="If you only want to stop using the app">
        <p>
          You do not have to close your account to leave the app. Uninstalling it removes your
          device PIN and biometric unlock from that phone and signs you out; your portfolio and your
          relationship with us continue unchanged, and you can still use the portal on
          niyomwealth.com. Ask us instead to remove only your app access if that is what you want.
        </p>
      </LegalSection>

      <LegalSection number="8" title="Contact">
        <p>
          For anything about deleting your account or the data we hold, including a complaint about
          how a request was handled:
        </p>
        <ContactBox
          company="Niyom Wealth Distribution LLP"
          email="support@niyomwealth.com"
          phone="+91 8939433113"
        />
        <p className="mt-4">
          Our{' '}
          <a href="/privacy" className="text-accent underline">
            Privacy Policy
          </a>{' '}
          describes everything we collect and why.
        </p>
      </LegalSection>
    </LegalDocumentLayout>
  );
}
