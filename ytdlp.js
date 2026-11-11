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
  parts.push('-N', '8', '-o', q(safe(title).replace(/%/g, '%%') + '.%(ext)s'), q(item.url));
  return parts.join(' ');
}

// A page on a site yt-dlp supports (see SITES in popup.js); audio=true gives MP3 instead of MP4.
function ytdlpPageCommand({ url, win, audio }) {
  const q = (s) => shellQuote(s, win);
  const fmtArgs = audio ? ['-x', '--audio-format', 'mp3'] : ['-f', q('bv*+ba/b'), '--merge-output-format', 'mp4'];
  return ['yt-dlp', '--no-playlist', '--cookies-from-browser', 'chrome', ...fmtArgs, '-o', q('%(title).150B.%(ext)s'), q(url)].join(' ');
}

// Dropbox / SharePoint file-share page -> direct-download URL (null for anything else, e.g. folders, home, http-less input).
// ponytail: query flag only; consumer OneDrive and 1drv.ms links need a redirect, so they are left to yt-dlp / the browser.
function shareDirectUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (/(^|\.)dropbox\.com$/.test(u.hostname) && /^\/(s|scl\/fi|sh)\//.test(u.pathname)) u.searchParams.set('dl', '1');
  else if (/\.sharepoint\.com$/.test(u.hostname) && /^\/:\w:\//.test(u.pathname)) u.searchParams.set('download', '1');
  else return null;
  return u.href;
}

// Sites where the browser can't fetch the video itself. 'only' = never (YouTube serves SABR streams), 'fallback' = when no direct link was found.
const YTDLP_SITES = /^https?:\/\/([^/]*\.)?(youtube\.com|youtu\.be|facebook\.com|fb\.watch|tiktok\.com|x\.com|twitter\.com|instagram\.com|xiaohongshu\.com|xhslink\.com|vimeo\.com|twitch\.tv|reddit\.com|bilibili\.com|dailymotion\.com|soundcloud\.com|pinterest\.com)(\/|$)/;
const ytdlpRoute = (url) => (/^https?:\/\/([^/]*\.)?(youtube\.com|youtu\.be)(\/|$)/.test(url) ? 'only' : YTDLP_SITES.test(url) ? 'fallback' : null);
// Install steps for all three systems, the user's own first. os: 'mac' | 'win' | 'linux' | 'other' (none marked).
function ytdlpInstall(os) {
  const all = [
    { os: 'mac', name: 'macOS', cmd: 'brew install yt-dlp ffmpeg' }, // needs Homebrew (brew.sh)
    { os: 'win', name: 'Windows', cmd: 'winget install yt-dlp.yt-dlp\nwinget install Gyan.FFmpeg' },
    { os: 'linux', name: 'Linux', cmd: '# Debian / Ubuntu\nsudo apt install ffmpeg pipx && pipx install yt-dlp\n# Arch\nsudo pacman -S yt-dlp ffmpeg\n# other: install yt-dlp and ffmpeg with your package manager' },
  ].map((x) => ({ ...x, mine: x.os === os }));
  return [...all.filter((x) => x.mine), ...all.filter((x) => !x.mine)];
}

// 'mac' | 'win' | 'linux' | 'other' (ChromeOS, Android, iOS, unknown: yt-dlp can't be installed the usual way there).
function detectOs({ uaPlatform, platform, ua } = {}) {
  const s = [uaPlatform, platform, ua].filter(Boolean).join(' ');
  return /cros|chrome os|android|iphone|ipad|ipod/i.test(s) ? 'other' : /windows|\bwin(32|64)?\b/i.test(s) ? 'win' : /mac/i.test(s) ? 'mac' : /linux|x11/i.test(s) ? 'linux' : 'other';
}

// youtube.com/embed/ID → the watch page (embeds can be restricted); anything else unchanged.
function ytdlpPageUrl(url) {
  const m = /^https?:\/\/([^/]*\.)?youtube\.com\/embed\/([\w-]+)/.exec(url);
  return m ? 'https://www.youtube.com/watch?v=' + m[2] : url;
}
