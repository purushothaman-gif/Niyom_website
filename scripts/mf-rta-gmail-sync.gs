/**
 * Niyom — registrar mailback → MF feed sync (Google Apps Script).
 *
 * Runs on a daily time-driven trigger inside the Workspace account that RECEIVES
 * the CAMS/KFintech distributor mailback emails (ARN-362707). It finds each new
 * feed email, base64-encodes the encrypted ZIP attachment, and POSTs it to the
 * Supabase `mf-rta-ingest` edge function, which decrypts and imports it. No file
 * ever leaves Google except as an HTTPS POST to our own function; the ZIP stays
 * encrypted and the mailback password lives only as a Supabase server secret —
 * this script never holds it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP
 * 1. script.google.com → New project → paste this file. Rename it "Niyom RTA Sync".
 * 2. Project Settings (gear) → Script properties → add:
 *       INGEST_SECRET   = the value printed by scripts/mf-rta-set-ingest-secret.sh
 *       SUPABASE_URL    = https://jlmwazuwjnhoqqloyeoj.supabase.co
 *       ANON_KEY        = (the project's publishable/anon key — public, optional)
 *       ALERT_EMAIL     = who to email if a run hits errors (optional)
 * 3. Run `setup` once (authorise Gmail + external-request scopes when asked).
 *    It installs the daily trigger and creates the "NiyomRTA/Done" label.
 * 4. Run `syncNow` once to backfill today and confirm it works (View → Logs).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Idempotency: a processed message is tagged with the NiyomRTA/Done label and
 * excluded from the next search, and the ingest function also dedupes by file
 * content — so an overlap or a retry is a no-op, never a double import.
 */

// Distributor senders and the registrar each maps to.
var SENDERS = [
  { email: 'donotreply@camsonline.com', registrar: 'CAMS' },
  // KFintech feeds (enable once KFintech-serviced funds appear, and set
  // RTA_KFINTECH_PASSWORD on the server):
  // { email: 'donotreply@kfintech.com', registrar: 'KFINTECH' },
  // { email: 'WBR@kfintech.com',        registrar: 'KFINTECH' },
];

var DONE_LABEL = 'NiyomRTA/Done';
var LOOKBACK = 'newer_than:3d'; // a few days of slack so a missed run self-heals

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function ingestUrl() {
  var base = prop('SUPABASE_URL').replace(/\/+$/, '');
  if (!base) throw new Error('Set the SUPABASE_URL script property.');
  return base + '/functions/v1/mf-rta-ingest';
}

/** Install the daily trigger + label. Run once. */
function setup() {
  GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var have = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'syncNow'; });
  if (!have) {
    ScriptApp.newTrigger('syncNow').timeBased().everyDays(1).atHour(18).create(); // ~18:00 local, after feeds land
  }
  Logger.log('Setup complete. Trigger installed: %s', !have);
}

/** The daily job. Also safe to run by hand. */
function syncNow() {
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var url = ingestUrl();
  var secret = prop('INGEST_SECRET');
  if (!secret) throw new Error('Set the INGEST_SECRET script property.');
  var anon = prop('ANON_KEY');

  var totals = { files: 0, ok: 0, skipped: 0, errors: 0, holdings: 0, sips: 0, matched: 0 };
  var problems = [];

  SENDERS.forEach(function (sender) {
    var query = 'from:' + sender.email + ' has:attachment ' + LOOKBACK + ' -label:' + DONE_LABEL.toLowerCase();
    var threads = GmailApp.search(query, 0, 50);
    threads.forEach(function (thread) {
      var allHandled = true;
      thread.getMessages().forEach(function (msg) {
        msg.getAttachments().forEach(function (att) {
          var name = att.getName() || '';
          if (!/\.zip$/i.test(name)) return;
          totals.files++;
          try {
            var res = postZip(url, secret, anon, {
              fileName: name,
              registrar: sender.registrar,
              messageId: msg.getId(),
              dataBase64: Utilities.base64Encode(att.getBytes()),
            });
            if (res.ok && res.skipped) { totals.skipped++; }
            else if (res.ok) {
              totals.ok++;
              totals.holdings += res.holdingsUpserted || 0;
              totals.sips += res.sipsUpserted || 0;
              totals.matched += res.matched || 0;
            } else if (res.permanent) {
              // Unrecognised / "No Data" placeholder — nothing to import, but
              // don't keep retrying it. Counted, not alerted.
              totals.skipped++;
            } else {
              totals.errors++; allHandled = false;
              problems.push(name + ': ' + res.error);
            }
          } catch (e) {
            totals.errors++; allHandled = false;
            problems.push(name + ': ' + e);
          }
        });
      });
      // Only mark the thread done when every attachment in it was handled, so a
      // transient failure is retried on the next run.
      if (allHandled) thread.addLabel(label);
    });
  });

  Logger.log('RTA sync: %s', JSON.stringify(totals));
  if (problems.length) {
    Logger.log('Problems:\n' + problems.join('\n'));
    var alert = prop('ALERT_EMAIL');
    if (alert) {
      MailApp.sendEmail(alert, 'Niyom RTA sync: ' + problems.length + ' problem(s)',
        JSON.stringify(totals, null, 2) + '\n\n' + problems.join('\n'));
    }
  }
}

/** POST one attachment to the ingest function; classify the response. */
function postZip(url, secret, anon, body) {
  var headers = { 'X-Ingest-Secret': secret };
  if (anon) headers['apikey'] = anon; // satisfies the gateway; anon key is public
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var json = {};
  try { json = JSON.parse(resp.getContentText()); } catch (e) { /* non-JSON */ }
  if (code >= 200 && code < 300 && json.ok) return json;            // ok or {ok,skipped}
  // 4xx (except 429) is permanent for this file: bad/empty/unrecognised.
  json.permanent = (code >= 400 && code < 500 && code !== 429);
  json.error = json.error || ('HTTP ' + code);
  json.ok = false;
  return json;
}
