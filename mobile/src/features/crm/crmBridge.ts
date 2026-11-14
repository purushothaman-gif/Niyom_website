/**
 * The CRM inside the app.
 * -----------------------------------------------------------------------------
 * The CRM is the website's own `/crm`, opened in a WebView rather than rebuilt
 * natively. It is far too large to port screen by screen (HR, payroll, leads,
 * deals, bonds, MIS, marketing…), it already has a phone layout (the mobile
 * web kit), and running the real thing means admin 2FA, the employee PIN, the
 * role rules and every future CRM change reach the app with no app release.
 *
 * What a WebView does NOT do on its own is the browser's "download": jsPDF's
 * `.save()`, `XLSX.writeFile` and every `<a download href="blob:…">` simply do
 * nothing. So the script below is injected before the page runs. It catches a
 * click on any anchor that is a download (or points at a blob:/data: URL),
 * reads the bytes in the page, and posts them to the app as base64 — the app
 * then writes the file and opens the share sheet, exactly as the client
 * portal's own exports do.
 *
 * FileSaver (which jsPDF and SheetJS use) clicks a DETACHED anchor via
 * `dispatchEvent`, which never bubbles to the document — so both `click()` and
 * `dispatchEvent()` on anchors are wrapped, not just a document listener.
 */

export const CRM_ORIGIN = 'https://niyomwealth.com';
export const CRM_URL = `${CRM_ORIGIN}/crm`;

/** Hosts that are "inside" the CRM. Anything else opens outside the WebView. */
export const CRM_HOSTS = new Set(['niyomwealth.com', 'www.niyomwealth.com']);

export type BridgeMessage =
  | { type: 'download'; fileName: string; mimeType: string; base64: string }
  | { type: 'download-error'; message: string };

export const CRM_BRIDGE_SCRIPT = `
(function () {
  if (window.__niyomBridge) return;
  window.__niyomBridge = true;

  function post(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch (e) {}
  }

  function nameFor(a, mime) {
    var n = a.getAttribute('download');
    if (n) return n;
    var ext = /pdf/.test(mime) ? 'pdf' : /sheet|excel/.test(mime) ? 'xlsx' : /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : /csv/.test(mime) ? 'csv' : 'bin';
    return 'niyom-' + Date.now() + '.' + ext;
  }

  function isDownload(a) {
    if (!a || !a.href) return false;
    var href = String(a.href);
    return a.hasAttribute('download') || href.indexOf('blob:') === 0 || href.indexOf('data:') === 0;
  }

  function deliver(a) {
    var href = String(a.href);
    fetch(href)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var mime = blob.type || 'application/octet-stream';
        var reader = new FileReader();
        reader.onloadend = function () {
          var s = String(reader.result || '');
          var comma = s.indexOf(',');
          post({ type: 'download', fileName: nameFor(a, mime), mimeType: mime, base64: s.slice(comma + 1) });
        };
        reader.readAsDataURL(blob);
      })
      .catch(function (e) { post({ type: 'download-error', message: String(e && e.message || e) }); });
  }

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { deliver(this); return; }
    return origClick.apply(this, arguments);
  };

  var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && isDownload(this)) { deliver(this); return false; }
    return origDispatch.apply(this, arguments);
  };

  // Real taps on an attached <a download> link.
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var a = t && t.closest ? t.closest('a') : null;
    if (a && isDownload(a)) { ev.preventDefault(); ev.stopPropagation(); deliver(a); }
  }, true);
})();
true;
`;
