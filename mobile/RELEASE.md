# Releasing the Niyom Wealth app

Everything here that can be done without an Apple or Google account is done.
What remains needs credentials only you have, and is marked **YOU**.

---

## 1. Accounts (YOU — start these first, they gate everything)

| | |
|---|---|
| **Apple Developer Program** | $99/yr. Must be an **Organization** account, not Individual — Apple rejects Individual accounts in the **Finance** category, which is where this app belongs. An org account needs a **D-U-N-S number** for Niyom Wealth Distribution LLP; the free D-U-N-S lookup can take 1–2 weeks, so request it before anything else. |
| **Google Play Console** | $25 one-time. Also needs the developer to be verified as an organisation, and Play requires a **Financial Features declaration** for investment apps (see §5). |
| **Expo account** | Free. `npx eas login`, then `npx eas init` from `mobile/` — this writes `extra.eas.projectId` into `app.json`. Nothing can be built in the cloud until that exists. |

---

## 2. Build secrets (YOU, once, after `eas login`)

`mobile/.env` is git-ignored, so EAS's cloud builders do not have it. The
Supabase URL and the BSE proxy are already in `eas.json`; the anon key is not,
deliberately — it is publishable and ships inside the binary, but committing
keys to a repository teaches the wrong habit. Set it once:

```bash
npx eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --scope project --visibility sensitive
```

Paste the same value that is in `mobile/.env`. Without it a cloud build compiles
and then throws "Missing Supabase credentials" on first launch.

---

## 3. Building

```bash
# A dev build you can install and hot-reload against (simulator on iOS).
npx eas build --profile development --platform all

# An installable .apk / internal-distribution .ipa for testers.
npx eas build --profile preview --platform all

# Store-ready: .aab for Play, .ipa for App Store. Auto-increments build numbers.
npx eas build --profile production --platform all
```

Profiles live in `eas.json`. `production` uses `appVersionSource: "remote"`, so
EAS owns the build number and you never hand-edit one.

### Over-the-air updates

`runtimeVersion` uses the **fingerprint** policy: an update only reaches a build
whose native code can actually run it. A JS-only fix therefore ships instantly;
anything touching a native module correctly requires a new store build.

```bash
npx eas update --branch production --message "Fix the SIP debit-day picker"
```

Channels are wired in `eas.json` (`development` / `preview` / `production`).

---

## 4. App Store (YOU)

- **Category**: Finance. **Age rating**: 4+.
- **Encryption**: `usesNonExemptEncryption` is already `false` in `app.json` —
  the app uses only HTTPS and the OS keychain, which is exempt.
- **Privacy manifest**: already declared in `app.json` (`ios.privacyManifests`)
  — the required-reason APIs and every data type collected. Nothing is used for
  tracking, so App Tracking Transparency does not apply.
- **Privacy nutrition label**: mirror §5 below.
- **Demo account for review**: Apple *will* reject a login-only app without one.
  Create a real client with a small dummy portfolio and put the PAN and password
  in App Review notes, along with: *"PAN is the username. This app has no public
  content; both portals require an account issued by Niyom Wealth."*
- **Export compliance**, **Content rights**, **Advertising identifier**: no.

### Screenshots needed
6.7" iPhone (1290×2796) and 6.5" — Dashboard, Portfolio, Mutual Funds, Capital
Gains, Partner Dashboard. Capture from a simulator once the account exists.

---

## 5. Play Console — Data safety (YOU)

The app **collects** and **does not share** the following. All of it is
encrypted in transit, all of it is required for the app to function, and users
can request deletion through their relationship manager.

| Data type | Collected | Purpose | Optional |
|---|---|---|---|
| Name | Yes | Account management | No |
| Email address | Yes | Account management, sign-in codes | No |
| Phone number | Yes | Account management, verification | No |
| Other IDs (PAN, DOB, address) | Yes | Regulatory KYC | No |
| Financial info (portfolio, transactions) | Yes | App functionality | No |
| Photos / documents | Yes | KYC document upload | No |
| App activity / analytics | **No** | — | — |
| Location | **No** | — | — |
| Contacts | **No** | — | — |
| Advertising ID | **No** | — | — |

Also declare:
- **Financial Features**: "Personal investment management" — Play requires
  proof of AMFI registration for Niyom Wealth Distribution LLP. Have the ARN
  certificate ready.
- **Account deletion URL**: Play mandates one for any app with accounts.
  A page on niyomwealth.com explaining how to request deletion is enough — **this
  does not exist yet and will block submission.**

---

## 6. Before the first store submission

- [ ] D-U-N-S number obtained, Apple org account approved
- [ ] `eas init` run, `projectId` committed
- [ ] `EXPO_PUBLIC_SUPABASE_ANON_KEY` set as an EAS env var
- [ ] Apple IDs filled into `eas.json` → `submit.production.ios`
- [ ] Play service-account JSON saved outside the repo, path set in `eas.json`
- [ ] Account-deletion page published on niyomwealth.com
- [ ] Review demo account created, credentials in App Review notes
- [ ] **The app driven end to end with a real client and a real DSA login** —
      most screens have never been rendered with live data

---

## What is deliberately NOT set up

- **Push notifications.** The web portal has none, so the app has none. Adding
  them means a device-token table and a sender — a separate piece of work.
- **Crash reporting / analytics.** Nothing is instrumented, which is why the
  data-safety table above can honestly say no analytics are collected. Adding
  Sentry later means revisiting that declaration.
