# Niyom Wealth — mobile app

The native iOS and Android app for the client Wealth Portal and the partner
(DSA) portal. Expo SDK 57, React Native 0.86, expo-router.

**This is a frontend only.** Same Supabase project, same tables, same RLS, same
edge functions as niyomwealth.com — no migration, no schema change, no new
table. A client signs in with the PAN and password they already use on the
website; so does a partner.

## Running it

```bash
cd mobile && npm install && npx expo start
```

Then scan the QR with **Expo Go** on a phone (nothing else to install), or press
`i` / `a` for a simulator if Xcode / Android Studio are set up. `npx expo start --web`
opens it in a browser, which is useful for quick visual checks but does not
exercise Face ID, the keychain or haptics.

`npm run typecheck` must be green before anything ships — and so must
`npx expo export --platform ios`. They catch different things: TypeScript
resolves any path on disk, while Metro only sees what `metro.config.js` watches,
so a new import reaching outside `mobile/` and `shared/` typechecks fine and
fails to bundle.

## Where things live

```
mobile/
  app/                    expo-router routes — the file tree IS the navigation
    (auth)/               sign-in, PIN, OTP, password reset, forced change
    (client)/             the client tab navigator
    (partner)/            the partner tab navigator
    *.tsx                 pushed screens (transactions, documents, profile…)
  src/
    design/               tokens ported from src/theme/tokens.css + ThemeProvider
    ui/                   the native component kit
    features/             screen-level logic (auth, client, partner)
    platform/             Supabase clients, keychain storage, device id, biometrics
```

The portfolio, CAS, gains, XIRR and partner logic is **not** here. It lives in
`../shared/`, which this app and the website both import, so the two can never
show different numbers. See `shared/platform/db.ts` for how each platform hands
its own Supabase clients to that shared code.

## Two rules worth knowing before editing

**Never import `@supabase/supabase-js` and build a client.** Import the ones in
`src/platform/supabase.ts`. There are three, one per surface, with separate
keychain slots — a client and a partner can both be signed in on one handset,
and using the wrong client runs a query as the wrong identity.

**Never reimplement a calculation that `shared/` already does.** If a number is
on the website, the function that produced it is in `shared/` and should be
imported. The one that matters most: the DSA payout formula lives only in the
CRM's `DSAPayout.tsx` and must not be copied.

## Biometrics

Face ID does not replace the PIN, it releases it. An enrolled device keeps the
4-digit PIN in the keychain behind a biometric access-control flag; unlocking
retrieves it and sends it to the same `client-pin-login` / `partner-pin-login`
edge function the keypad uses. The server's cool-off, burn-after-ten and
kill-switch behaviour is untouched. See `src/platform/device.ts`.

## Building

EAS Build, bundle id `com.niyomwealth.app` on both platforms.

```bash
npx eas build --profile preview --platform all
```

**See [RELEASE.md](./RELEASE.md)** for the full path to the stores: which
accounts are needed, the build secret that must be set before a cloud build will
run, the Play data-safety answers, and what still blocks a first submission.

## No demo mode here

The website offers published demo credentials that mount the partner portal on
fixture data. The app deliberately does not — a working set of credentials
inside an app-store binary's own sign-in screen is a different exposure from a
link on a website. The demo code still exists in `shared/partner/demo/` for the
website; nothing in the app calls it.

The consequence worth knowing: **verifying partner screens at runtime now needs
a real DSA login.** There is no sandbox path in the app.

## What is built

Every planned screen is built. Nothing renders "Coming next" any more.

**Client:** sign-in (password, PIN, biometric, email code, reset, forced
change), sign-up, Dashboard, Portfolio, Allocation, Transactions, Documents,
Notifications, Support, Profile, Set PIN, Change password, Reports, Capital
Gains, SIP, KYC onboarding, CAS import, Mutual Funds, Fund detail, Order.

**Partner:** sign-in, enquiry, Dashboard, Clients, client detail, Payouts,
Leads, Submit-a-lead, Account, Set PIN.

## What has NOT been verified at runtime

Everything typechecks and bundles, and the partner dashboard was once driven
end to end against real figures. But most screens have never been rendered with
real data, because doing so needs a signed-in account and there is no sandbox in
the app. Expect the bugs that only data reveals — a null field, an empty state
that never shows, a date that arrives in an unexpected shape.

**A test client login and a test DSA login are what unblock that.**
