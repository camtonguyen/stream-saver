# Stream Saver

A local Chrome / Edge extension (Manifest V3) that finds video on the page you're watching and saves it.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder. After code changes, press the ↻ button instead.
3. **Reload the video tab**, then press play. The extension only sees requests made after it loads.

## How to save a video
Play the video, then click the **⬇ MP4** button that appears on it (top-left of the video, or just below it when the video touches the top of the window).

| Video type | What happens |
|---|---|
| **HLS / DASH** | One click. A downloader tab opens at the highest quality, starts by itself, shows progress, merges video and audio into one MP4 (no re-encoding) and saves it to Downloads. Keep the tab open. |
| **Live HLS** | Not auto-started: the downloader tab waits for you to press **Start**, then **Stop & save** (it also stops at ~1 GB). |
| **MP4 / WebM / audio files** | Downloads straight away. |
| **YouTube**, and other known sites with no fetchable URL (TikTok, Instagram, Facebook, X, Vimeo…) | The button opens a dialog with a yt-dlp command (copied for you) that produces one MP4. **Install the tools first** (the dialog lists steps for macOS, Windows and Linux): macOS `brew install yt-dlp ffmpeg`; Windows `winget install yt-dlp.yt-dlp` and `winget install Gyan.FFmpeg`; Linux `sudo apt install ffmpeg pipx && pipx install yt-dlp` (Debian/Ubuntu) or `sudo pacman -S yt-dlp ffmpeg` (Arch). Without them the command fails. |
| **Other players with no fetchable URL** | The button says no direct link was found. Nothing is played back or recorded. |
| **DRM-protected** | The button is disabled (🔒). |

Click the extension icon for settings: the **file name template** (`{title}`, `{site}`, `{date}`) and a **per-site switch** that hides the button on the current site.

## Good to know
- If the MP4 merge fails, the raw `.ts` / `.mp4` / `.m4a` files are saved instead. Merge them with `ffmpeg -i video.mp4 -i audio.m4a -c copy out.mp4`.
- Segments and the finished MP4 are held in memory before saving, so very long videos (multi-GB) need free RAM.
- YouTube serves only SABR streams, so a browser extension can't fetch it; that is why it uses yt-dlp. 

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
`node test.js` runs the tests (no dependencies). Shared code: `common.js` (helpers, message tags), `captures.js` (per-tab record), `replay.js` (header replay), `fetcher.js` (403 fallback), `ytdlp.js` (yt-dlp command builder and site routing), `remux.mjs` (merge into one MP4, uses vendored Mediabunny, MPL-2.0), `overlay.js` (the on-page button).
