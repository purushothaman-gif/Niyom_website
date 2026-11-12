#!/usr/bin/env node
/**
 * Niyom — KFintech mailback downloader (runs on a RESIDENTIAL network).
 *
 * KFintech delivers its feeds as download links, and its WAF ("Request
 * Rejected") blocks every datacenter IP — Google Apps Script, the droplet,
 * Supabase. A home/office connection is allowed, so this tiny agent runs on a
 * Mac: it asks the mf-rta-ingest edge function for the links the Gmail sync
 * queued, downloads each ZIP from here (where the WAF lets it through), and posts
 * the bytes straight back to the same ingest function — which decrypts, parses
 * and marks the queue row done. CAMS is untouched; it stays fully automatic on
 * Apps Script because its ZIP is an email attachment, not a link.
 *
 * Needs Node 18+ (global fetch). No dependencies.
 *
 * Environment:
 *   SUPABASE_URL       e.g. https://jlmwazuwjnhoqqloyeoj.supabase.co
 *   RTA_INGEST_SECRET  the same secret Apps Script uses (X-Ingest-Secret)
 *   SUPABASE_ANON_KEY  optional; sent as apikey if your project needs it
 *
 * Run once:   node scripts/mf-rta-mac-agent.mjs
 * Scheduled:  via launchd (see scripts/com.niyom.mfrta-agent.plist).
 */

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SECRET = process.env.RTA_INGEST_SECRET || '';
const ANON = process.env.SUPABASE_ANON_KEY || '';
if (!BASE || !SECRET) {
  console.error('Set SUPABASE_URL and RTA_INGEST_SECRET in the environment.');
  process.exit(1);
}
const INGEST = `${BASE}/functions/v1/mf-rta-ingest`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

function post(body) {
  const headers = { 'Content-Type': 'application/json', 'X-Ingest-Secret': SECRET };
  if (ANON) headers.apikey = ANON;
  return fetch(INGEST, { method: 'POST', headers, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

function isZip(buf) {
  return buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b; // 'PK'
}

/** Download one URL from this (allowed) network; return a Buffer ZIP or throw. */
async function download(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await r.arrayBuffer());
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (r.status === 200 && isZip(buf)) return buf;
  const peek = ct.includes('html') ? ` — ${buf.slice(0, 120).toString('latin1').replace(/\s+/g, ' ')}` : '';
  throw new Error(`HTTP ${r.status} ct=${ct || '?'} bytes=${buf.length}${peek}`);
}

async function main() {
  const listed = await post({ listPending: true });
  const pending = listed.json?.pending || [];
  if (!pending.length) {
    console.log(new Date().toISOString(), 'nothing pending.');
    return;
  }
  let ok = 0, failed = 0;
  for (const row of pending) {
    const name = row.report_hint || `kfintech_${row.message_id}.zip`;
    try {
      let buf;
      try { buf = await download(row.direct_url); }
      catch (e1) {
        if (!row.tracker_url) throw e1;
        buf = await download(row.tracker_url); // fall back to the /c/ tracker link
      }
      const res = await post({
        dataBase64: buf.toString('base64'),
        fileName: name,
        registrar: row.registrar || 'KFINTECH',
        messageId: row.message_id,
      });
      if (res.json?.ok) { ok++; console.log('ok  ', name, JSON.stringify({ holdings: res.json.holdingsUpserted, txns: res.json.txnsUpserted, sips: res.json.sipsUpserted })); }
      else { failed++; console.log('warn', name, res.status, res.json?.error || ''); }
    } catch (e) {
      failed++;
      console.log('fail', name, String(e.message || e));
      await post({ markError: { messageId: row.message_id, error: String(e.message || e).slice(0, 300) } });
    }
  }
  console.log(new Date().toISOString(), `done — ${ok} ingested, ${failed} failed, of ${pending.length}.`);
}

main().catch((e) => { console.error('agent error:', e); process.exit(1); });
