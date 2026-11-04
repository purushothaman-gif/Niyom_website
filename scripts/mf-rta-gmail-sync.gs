/**
 * Niyom — registrar mailback → MF feed sync (Google Apps Script).
 *
 * Runs on a daily time-driven trigger inside the Workspace account that RECEIVES
 * the CAMS + KFintech distributor mailback emails (ARN-362707). It forwards each
 * new feed to the Supabase `mf-rta-ingest` edge function, which decrypts and
 * imports it. Two delivery styles are handled:
 *
 *   - CAMS (donotreply@camsonline.com): the encrypted ZIP is an ATTACHMENT.
 *   - KFintech (distributorcare@kfintech.com): the email carries a download
 *     LINK; the script follows it (it re-mints a fresh 1-hour S3 URL on each
 *     click, so the run time doesn't matter) and forwards the bytes.
 *
 * The ZIP stays encrypted in flight; the mailback passwords live only as Supabase
 * server secrets (RTA_CAMS_PASSWORD / RTA_KFINTECH_PASSWORD) — never here.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ONE-TIME SETUP
 * 1. script.google.com → New project → paste this file. Rename it "Niyom RTA Sync".
 * 2. Project Settings (gear) → Script properties → add:
 *       INGEST_SECRET   = the value printed by scripts/mf-rta-set-ingest-secret.sh
 *       SUPABASE_URL    = https://jlmwazuwjnhoqqloyeoj.supabase.co
 *       ALERT_EMAIL     = who to email if a run hits errors (optional)
 * 3. Run `setup` once (authorise Gmail + external-request scopes when asked).
 * 4. Run `syncNow` once to backfill and confirm it works (View → Executions).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Idempotency: a handled message gets the NiyomRTA/Done label and is excluded
 * next run, and the ingest function also dedupes by file content — so an overlap
 * or retry is a no-op, never a double import.
 */

// Feed sources. `mode`: 'attachment' (CAMS) or 'link' (KFintech). `subjectMatch`
// (optional) limits which of a sender's emails we process.
var SENDERS = [
  { email: 'donotreply@camsonline.com', registrar: 'CAMS', mode: 'attachment' },
  // KFintech: SIP registration (WSREG), Client-wise AUM holdings (WBCUM) and
  // Transaction Feeds (WBTRN) are parsed; filter to those. A "no data" WBTRN
  // email carries no download link, so it yields no feed and is just marked Done.
  { email: 'distributorcare@kfintech.com', registrar: 'KFINTECH', mode: 'link',
    subjectMatch: /sip registration|subscribed sip|client-wise aum|transaction feeds/i },
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
    ScriptApp.newTrigger('syncNow').timeBased().everyDays(1).atHour(18).create(); // ~18:00 local
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

  var totals = { files: 0, ok: 0, skipped: 0, errors: 0, holdings: 0, sips: 0, txns: 0, matched: 0 };
  var problems = [];

  SENDERS.forEach(function (sender) {
    var query = 'from:' + sender.email + ' ' + LOOKBACK + ' -label:' + DONE_LABEL.toLowerCase();
    if (sender.mode === 'attachment') query += ' has:attachment';
    GmailApp.search(query, 0, 50).forEach(function (thread) {
      var allHandled = true;
      thread.getMessages().forEach(function (msg) {
        if (sender.subjectMatch && !sender.subjectMatch.test(msg.getSubject() || '')) return;
        var feeds = sender.mode === 'link' ? linkFeeds(msg) : attachmentFeeds(msg);
        feeds.forEach(function (feed) {
          totals.files++;
          try {
            var res = postZip(url, secret, anon, {
              fileName: feed.name, registrar: sender.registrar,
              messageId: msg.getId(), dataBase64: Utilities.base64Encode(feed.bytes),
            });
            if (res.ok && res.skipped) totals.skipped++;
            else if (res.ok) {
              totals.ok++;
              totals.holdings += res.holdingsUpserted || 0;
              totals.sips += res.sipsUpserted || 0;
              totals.txns += res.txnsUpserted || 0;
              totals.matched += res.matched || 0;
            } else if (res.permanent) {
              totals.skipped++; // unrecognised / empty — handled, don't retry
            } else {
              totals.errors++; allHandled = false; problems.push(feed.name + ': ' + res.error);
            }
          } catch (e) {
            totals.errors++; allHandled = false; problems.push(feed.name + ': ' + e);
          }
        });
      });
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

/** CAMS: each .zip attachment, as {name, bytes}. */
function attachmentFeeds(msg) {
  var out = [];
  msg.getAttachments().forEach(function (att) {
    if (/\.zip$/i.test(att.getName() || '')) out.push({ name: att.getName(), bytes: att.getBytes() });
  });
  return out;
}

/** KFintech: follow the email's download link(s) and return the fetched ZIP(s).
    The body has several scdelivery links (report, product-codes, a tracking
    pixel); we take the /c/ links that aren't the product-codes one and keep the
    response only if it's actually a ZIP (starts with the "PK" magic). */
function linkFeeds(msg) {
  var html = msg.getBody() || '';
  var hrefs = html.match(/https:\/\/scdelivery\.kfintech\.com\/c\/\?[^"'\s<>]+/g) || [];
  var out = [];
  for (var i = 0; i < hrefs.length; i++) {
    var href = hrefs[i].replace(/&amp;/g, '&');
    if (/GVODPEFT|QSPEDPEF|epxompbet/.test(href)) continue; // encoded "FUNCODES/PRODCODE/downloads"
    var resp = UrlFetchApp.fetch(href, { followRedirects: true, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) continue;
    var bytes = resp.getContent();
    if (bytes.length > 2 && bytes[0] === 80 && bytes[1] === 75) { // 'PK'
      out.push({ name: reportName(msg, href), bytes: bytes });
      break; // one report per email
    }
  }
  return out;
}

/** A filename hint for the log (the pipeline reads the real member name inside). */
function reportName(msg, href) {
  var m = (msg.getSubject() || '').match(/W[A-Z]+\d+/);
  return 'kfintech_' + (m ? m[0] : 'report') + '.zip';
}

/** POST one ZIP to the ingest function; classify the response. */
function postZip(url, secret, anon, body) {
  var headers = { 'X-Ingest-Secret': secret };
  if (anon) headers['apikey'] = anon;
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var json = {};
  try { json = JSON.parse(resp.getContentText()); } catch (e) { /* non-JSON */ }
  if (code >= 200 && code < 300 && json.ok) return json;
  json.permanent = (code >= 400 && code < 500 && code !== 429);
  json.error = json.error || ('HTTP ' + code);
  json.ok = false;
  return json;
}
