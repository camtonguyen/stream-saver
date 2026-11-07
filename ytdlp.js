'use strict';
// Builds yt-dlp commands. Pure: every shell-quoting decision lives here.
const shellQuote = (s, win) =>
  win ? '"' + String(s).replace(/"/g, '\\"') + '"' : "'" + String(s).replace(/'/g, "'\\''") + "'";

// A captured stream: replays the page's headers + exported cookies file.
function ytdlpStreamCommand({ item, tabUrl, title, ua, cookiePath, win }) {
  const q = (s) => shellQuote(s, win);
  const h = replayHeaders(item, tabUrl);
  const parts = ['yt-dlp'];
  if (h.referer) parts.push('--referer', q(h.referer));
  if (h.origin) parts.push('--add-header', q('Origin:' + h.origin));
  parts.push('--user-agent', q(h['user-agent'] || ua));
  for (const [k, v] of Object.entries(h)) {
    if (!['referer', 'origin', 'user-agent', 'cookie'].includes(k)) parts.push('--add-header', q(`${k}:${v}`));
  }
  if (cookiePath) parts.push('--cookies', q(cookiePath));
  parts.push('-N', '8', '-o', q(safe(title) + '.%(ext)s'), q(item.url));
  return parts.join(' ');
}

// A page on YouTube / Facebook / TikTok / X / Instagram / Drive: let yt-dlp extract it.
function ytdlpPageCommand({ url, win }) {
  const q = (s) => shellQuote(s, win);
  return ['yt-dlp', '--cookies-from-browser', 'chrome', '-f', q('bv*+ba/b'), '--merge-output-format', 'mp4', '-o', q('%(title).150B.%(ext)s'), q(url)].join(' ');
}
