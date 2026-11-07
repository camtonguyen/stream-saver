# Stream Saver

A local Chrome / Edge extension (Manifest V3) that finds video on the page you're watching and saves it.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder. After code changes, press the ↻ button instead.
3. **Reload the video tab**, then press play. The extension only sees requests made after it loads.

## How to save a video
Click the extension icon while the video plays. What you see depends on the site:

| Row in the popup | What to do |
|---|---|
| **HLS / DASH** (`.m3u8`, `.mpd`) | Click **Open**, then **Start**. If there are several, pick the highest quality (e.g. `1080`). |
| **MP4 / WebM / audio** | Click **Download**. |
| **MSE / BLOB** (under *Captured from player*) | Last resort. Click **Turbo 16×** to buffer the video fast, then **Save**. Video and audio come as separate files. |
| **This page** (YouTube, Facebook, TikTok, X, Instagram, Xiaohongshu/RedNote) | Click **Copy yt-dlp command** and paste it into a terminal. |

Other buttons: **yt-dlp** copies a command with the page's headers and saves a `stream-saver-cookies.txt`. **Copy** copies the stream URL.

## Good to know
- HLS downloads are saved as `.ts`. Convert to MP4 without re-encoding:
  `ffmpeg -i in.ts -c copy out.mp4`
- Separate video and audio files (from MSE or DASH) merge the same way:
  `ffmpeg -i video.mp4 -i audio.m4a -c copy out.mp4`
- For YouTube and similar sites, install the tools first: `brew install yt-dlp ffmpeg`.
- The cookies file holds your login. Keep it private and delete it afterwards.

## Fixing 403 Forbidden
The extension already replays the page's Referer, cookies and headers, refreshes expired signed links, and falls back to fetching through the video tab. So:
- **Keep the video tab open** while downloading.
- With yt-dlp, run the command within a few minutes, on the same computer and network.
- Still 403? Use `pip install -U "yt-dlp[default,curl-cffi]"` and add `--impersonate chrome`.

## Supported
Progressive MP4 / WebM / audio, HLS (including AES-128 and live), static DASH, and blob/MSE buffers.

## Not supported
DRM (Widevine, PlayReady, FairPlay, SAMPLE-AES) is detected and refused. Geo-blocks, expired subscriptions and IP bans can't be fixed from the client.

Only download content you have the right to save.

## Development
`node test.js` runs the tests (no dependencies). Shared code: `common.js` (helpers, message tags), `captures.js` (per-tab record), `replay.js` (header replay), `fetcher.js` (403 fallback), `ytdlp.js` (command builder).
