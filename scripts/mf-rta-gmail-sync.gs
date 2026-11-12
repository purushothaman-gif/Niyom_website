/**
 * Niyom — registrar mailback → MF feed sync (Google Apps Script).
 *
 * Runs on a daily time-driven trigger inside the Workspace account that RECEIVES
 * the CAMS + KFintech distributor mailback emails (ARN-362707). It forwards each
 * new feed to the Supabase `mf-rta-ingest` edge function, which decrypts and
 * imports it. Two delivery styles are handled:
 *
 *   - CAMS (donotreply@camsonline.com): the encrypted ZIP is an ATTACHMENT, so
 *     the script reads its bytes and posts them straight to the ingest function.
 *   - KFintech (distributorcare@kfintech.com): the email carries a download
 *     LINK, and KFintech's WAF ("Request Rejected") blocks this Apps Script run
 *     (a Google datacenter IP) from fetching it. So the script only DECODES the
 *     link (the real dss.kfintech.com URL is Caesar(+1)-encoded in its `u` param)
 *     and ENQUEUEs it; a residential-IP agent on the user's Mac
 *     (scripts/mf-rta-mac-agent.mjs) drains the queue, downloads the ZIP where
 *     the WAF allows, and posts the bytes to the same ingest function.
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
 *    It installs two triggers: `syncNow` daily ~18:00, and `monthEndSync` daily
 *    ~05:00 which only does work on the LAST DAY of the month (see below).
 *    Re-running `setup` after pasting a newer version adds any missing trigger.
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
  // transaction feeds are parsed; filter to those. Two flavours of the
  // transaction feed arrive, both WBTRN members in the same CSV layout:
  //   - the daily subscription  -> "Subscribed Transaction Feeds Report ..."
  //   - the on-demand Mail Back  -> "Transaction Report for Ref.no. ..." (used
  //     for the since-inception backfill of first-investment date + cost).
  // A "no data" feed email carries no download link, so it yields no feed and
  // is just marked Done.
  //   - Master AUM / Investor Master (WBMST) and SIP Termination (WSTPT) are
  //     forwarded too (added 2026-11-07). Until their parsers land, the ingest
  //     logs their column layout and treats them as handled — no retry loop.
  { email: 'distributorcare@kfintech.com', registrar: 'KFINTECH', mode: 'link',
    subjectMatch: /sip registration|subscribed sip|client-wise aum|transaction feeds|transaction report|master aum|investor master|sip termination/i },
];

var DONE_LABEL = 'NiyomRTA/Done';
var LOOKBACK = 'newer_than:3d'; // a few days of slack so a missed run self-heals
// Month-end sweep: brokerage (WBR77) and the scheme master (WBR39) arrive about
// once a month, whenever CAMS (or a request made through Wylth) sends them. On
// the last day of each month an early-morning run looks back over the whole
// month, so anything the daily run missed (a failed day, a mail that arrived
// outside the 3-day window) still lands before month-end MIS.
var MONTH_END_LOOKBACK = 'newer_than:35d';
var MONTH_END_HOUR = 5; // ~05:00 local, early morning

function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

function ingestUrl() {
  var base = prop('SUPABASE_URL').replace(/\/+$/, '');
  if (!base) throw new Error('Set the SUPABASE_URL script property.');
  return base + '/functions/v1/mf-rta-ingest';
}

/** Install the triggers + label. Safe to re-run: only adds what's missing. */
function setup() {
  GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var added = [];
  if (handlers.indexOf('syncNow') < 0) {
    ScriptApp.newTrigger('syncNow').timeBased().everyDays(1).atHour(18).create(); // ~18:00 local
    added.push('syncNow');
  }
  if (handlers.indexOf('monthEndSync') < 0) {
    // Apps Script has no "last day of month" trigger: fire daily early morning
    // and let monthEndSync() decide whether today is the last day.
    ScriptApp.newTrigger('monthEndSync').timeBased().everyDays(1).atHour(MONTH_END_HOUR).create();
    added.push('monthEndSync');
  }
  Logger.log('Setup complete. Triggers added: %s', added.join(', ') || 'none (already installed)');
}

/** True on the last calendar day of the month (script time zone). */
function isLastDayOfMonth(d) {
  var t = new Date(d.getTime());
  t.setDate(t.getDate() + 1);
  return t.getDate() === 1;
}

/** Early-morning month-end sweep. Runs daily but only works on the last day. */
function monthEndSync() {
  if (!isLastDayOfMonth(new Date())) return;
  runSync(MONTH_END_LOOKBACK, 'month-end');
}

/** Run the month-end sweep right now, whatever the date (manual use). */
function monthEndSyncNow() { runSync(MONTH_END_LOOKBACK, 'month-end (manual)'); }

/** The daily job. Also safe to run by hand. */
function syncNow() { runSync(LOOKBACK, 'daily'); }

/**
 * Un-finish recent KFintech feed emails so the next run retries them.
 *
 * The old link-fetch dropped KFintech reports silently and still marked them
 * Done, so they will never be retried on their own. Run this once after pasting
 * this version (then run `syncNow`) to pull the reports that were skipped —
 * including a client's missed holdings/transactions. Defaults to the last 20
 * days; pass a Gmail age like '30d' to widen it.
 */
function reprocessKfintech(age) {
  var label = GmailApp.getUserLabelByName(DONE_LABEL);
  if (!label) return;
  var threads = GmailApp.search('from:distributorcare@kfintech.com label:' +
    DONE_LABEL.toLowerCase() + ' newer_than:' + (age || '20d'), 0, 200);
  threads.forEach(function (t) { t.removeLabel(label); });
  Logger.log('Cleared Done from %s KFintech thread(s); run syncNow to retry.', threads.length);
}

function runSync(lookback, kind) {
  var label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  var url = ingestUrl();
  var secret = prop('INGEST_SECRET');
  if (!secret) throw new Error('Set the INGEST_SECRET script property.');
  var anon = prop('ANON_KEY');

  var totals = { run: kind, files: 0, ok: 0, queued: 0, skipped: 0, errors: 0, holdings: 0, sips: 0,
    txns: 0, brokerageLines: 0, brokerageAmount: 0, schemes: 0, matched: 0 };
  var problems = [];

  SENDERS.forEach(function (sender) {
    var query = 'from:' + sender.email + ' ' + lookback + ' -label:' + DONE_LABEL.toLowerCase();
    if (sender.mode === 'attachment') query += ' has:attachment';
    GmailApp.search(query, 0, lookback === LOOKBACK ? 50 : 200).forEach(function (thread) {
      var allHandled = true;
      thread.getMessages().forEach(function (msg) {
        if (sender.subjectMatch && !sender.subjectMatch.test(msg.getSubject() || '')) return;

        /*
         * KFintech delivers a download LINK, and its WAF ("Request Rejected")
         * blocks this Apps Script run (a Google datacenter IP) from fetching it —
         * as it blocks every server we have. So we do NOT download here: we decode
         * the direct dss.kfintech.com URL and ENQUEUE it, and a residential-IP
         * agent (the user's Mac, see scripts/mf-rta-mac-agent.mjs) pulls the queue
         * and downloads it where the WAF allows. A "No data found" email carries
         * nothing and is simply finished.
         */
        if (sender.mode === 'link') {
          if (isNoData(msg)) { totals.skipped++; return; }
          var urls = downloadUrls(msg.getBody() || '');
          var direct = urls.length ? directUrl(urls[0]) : null;
          if (!direct) {
            totals.errors++; allHandled = false;
            problems.push((msg.getSubject() || 'KFintech report') + ': no decodable download link');
            return;
          }
          var q = enqueue(url, secret, anon, {
            messageId: msg.getId(), directUrl: direct, trackerUrl: urls[0],
            reportHint: reportName(msg, direct), registrar: sender.registrar, subject: msg.getSubject() || '',
          });
          if (q.ok) totals.queued = (totals.queued || 0) + 1;
          else { totals.errors++; allHandled = false; problems.push((msg.getSubject() || 'KFintech report') + ': enqueue failed — ' + (q.error || '')); }
          return;
        }

        attachmentFeeds(msg).forEach(function (feed) {
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
              totals.brokerageLines += res.brokerageUpserted || 0;
              totals.brokerageAmount += res.amountTotal || 0;
              totals.schemes += res.schemesUpserted || 0;
              totals.matched += res.matched || 0;
            } else if (res.permanent) {
              totals.skipped++; // unrecognised / empty — handled, don't retry
              // ...but a feed we DO recognise that was rejected (wrong password —
              // e.g. a report requested through Wylth with its own password — or a
              // truncated brokerage file) needs a human: report it.
              if (!/unrecognised/i.test(res.error || '')) problems.push(feed.name + ' (not retried): ' + res.error);
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

/** A "No data found for the given period" email — nothing to download. */
function isNoData(msg) {
  return /no\s*data\s*found/i.test(msg.getPlainBody() || msg.getBody() || '');
}

/** The report download URL(s) from the email HTML, the real report link first. */
function downloadUrls(html) {
  // Product-codes and the /downloads path are decoy links (Caesar+1 encoded
  // "FUNCODES"/"PRODCODE"/"downloads"); the tracking pixel is on /o/ not /c/.
  var keep = function (h) { return !/GVODPEFT|QSPEDPEF|epxompbet/.test(h); };
  var find = function (s) {
    return (s.match(/https:\/\/scdelivery\.kfintech\.com\/c\/\?[^"'\s<>]+/g) || [])
      .map(function (h) { return h.replace(/&amp;/g, '&'); })
      .filter(keep);
  };
  var all = find(html);
  // Prefer the link immediately before "to download the report".
  var marker = html.search(/to\s*download\s*the\s*report/i);
  if (marker > -1) {
    var pref = find(html.slice(0, marker));
    if (pref.length) {
      var best = pref[pref.length - 1];
      all = [best].concat(all.filter(function (h) { return h !== best; }));
    }
  }
  return all;
}

/**
 * The direct download URL hidden in a KFintech /c/ tracker link.
 *
 * The real file lives on dss.kfintech.com; the tracker encodes it in the `u`
 * parameter with a Caesar(+1) shift (e.g. "iuuqt" = "https"). The /c/ link
 * itself now answers with an HTML landing page, but the decoded dss URL returns
 * the ZIP straight away (verified: content-type application/zip, "PK" magic).
 * Returns null when there is no decodable http URL.
 */
function directUrl(trackerUrl) {
  var m = trackerUrl.match(/[?&]u=([^&]+)/);
  if (!m) return null;
  var enc;
  try { enc = decodeURIComponent(m[1]); } catch (e) { return null; }
  var real = '';
  for (var i = 0; i < enc.length; i++) real += String.fromCharCode(enc.charCodeAt(i) - 1);
  return /^https?:\/\/\S+/i.test(real) ? real : null;
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

/**
 * Queue a KFintech download link for the residential-IP Mac agent to fetch.
 *
 * We can't download it from here (Google's IP is WAF-blocked), so the decoded
 * dss URL + the tracker link are stored in mf_rta_pending_downloads via the
 * ingest function; the agent drains the queue and posts the bytes back.
 */
function enqueue(url, secret, anon, item) {
  var headers = { 'X-Ingest-Secret': secret };
  if (anon) headers['apikey'] = anon;
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify({ enqueue: [item] }), muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var json = {};
  try { json = JSON.parse(resp.getContentText()); } catch (e) { /* non-JSON */ }
  if (code >= 200 && code < 300 && json.ok) return json;
  return { ok: false, error: json.error || ('HTTP ' + code) };
}
