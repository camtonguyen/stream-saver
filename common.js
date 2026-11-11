'use strict';
// Shared by popup.js and downloader.js (loaded first via <script>).
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) =>
  !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB';
const safe = (s) =>
  (s || 'video').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'video';
// Expiry of a signed URL in ms (CloudFront "Expires", Akamai/Bunny "exp"/"expires", …), or 0.
function expiryOf(u) {
  try {
    const sp = new URL(u).searchParams;
    for (const k of ['Expires', 'expires', 'exp', 'Expiry', 'expiry', 'e']) {
      const v = sp.get(k);
      if (v && /^\d{10}$/.test(v)) return +v * 1000;
    }
  } catch {}
  return 0;
}

// "{title} - {site}" → a safe file name (no extension). Tokens: {title} {site} {date}.
function fileNameFromTemplate(tpl, { title, host, date } = {}) {
  const v = { title, site: host, date: date || new Date().toISOString().slice(0, 10) };
  const out = (tpl || '{title}').replace(/\{(title|site|date)\}/g, (_, k) => v[k] || '');
  return safe(out.trim() ? out : title); // a template that renders to nothing falls back to the title
}
// Is the overlay switched off for this host (or a parent domain in the list)?
const siteOff = (list, host) => (list || []).some((d) => host === d || host.endsWith('.' + d));
const MIME_EXT = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv' };
// File extension for a captured item: URL path, else MIME (response header or ?mime=, e.g. Drive /videoplayback), else its kind.
function extFor(it) {
  const u = new URL(it.url), m = /\.([a-z0-9]{2,4})$/i.exec(u.pathname);
  const mime = (it.ct || u.searchParams.get('mime') || '').split(';')[0].trim().toLowerCase();
  return m ? m[1] : MIME_EXT[mime] || { mp4: 'mp4', webm: 'webm', audio: 'm4a' }[it.kind] || 'mp4';
}

// chrome.runtime message tags (popup / background / bridge / downloader). One place to spell them.
const MSG = {
  MSE_STATE: 'mse-state', MSE_CMD: 'mse-cmd', PAGE_FETCH: 'page-fetch',
  DOM_MEDIA: 'dom-media', OVERLAY_DL: 'overlay-dl', YTDLP_DIALOG: 'ytdlp-dialog', CLEAR: 'clear', DIRECT_DOWNLOAD: 'direct-download',
};
