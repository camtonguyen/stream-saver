# In-browser download, remux and compress for an MV3 extension

Researched 2026-11-11. Primary sources only. "UNVERIFIED" marks anything I could not confirm from an owner's page.
Note: the fetch tool summarises pages, so quotes are as returned by it; re-check any load-bearing one before building on it.

## Short answer

- **Download without yt-dlp: partly.** Extension code in the page can capture what the player itself fetches (what Stream Saver already does: progressive MP4, HLS, DASH, MSE buffers). Re-implementing yt-dlp's extraction in an extension is not realistic for YouTube, and it is policy-risky.
- **YouTube is the hard one.** yt-dlp needs a JS runtime to solve YouTube challenges, PO tokens for most clients, and the web client now only offers SABR streaming URLs.
- **TikTok, Instagram, Facebook:** yt-dlp parses page JSON/APIs and gets plain MP4 or DASH/HLS URLs. This is reproducible in extension code but breaks often.
- **Remux/merge/HLS-to-MP4:** doable in-browser. Prefer **Mediabunny (WebCodecs-based, MPL-2.0)** over ffmpeg.wasm: no 2 GB wasm limit, streams to disk, reads MPEG-TS/HLS, merges separate A/V, and needs no wasm CSP change. (Mediabunny's own parsing is plain JS; WebCodecs is only used when transcoding.)
- **Run it in an extension tab or offscreen document (reason `WORKERS`/`BLOBS`), not the service worker.**

## Per-site feasibility

| Site | What yt-dlp does (source) | Feasible in an extension without yt-dlp? |
|---|---|---|
| YouTube | Needs a JS engine for challenges: "yt-dlp needs to solve JavaScript challenges presented by YouTube" ([EJS wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS)); README calls yt-dlp-ejs "Required for full YouTube support" ([README](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md)). PO Token "is a parameter that YouTube requires to be sent with requests from some clients"; without it format URLs may give HTTP 403 ([PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)). Web client: only SABR formats ([PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)); YouTube "removed all https formats (adaptiveFormats) and only has SABR protocol streaming url", and yt-dlp could not yet download SABR ([issue 12482](https://github.com/yt-dlp/yt-dlp/issues/12482)). | **Only by capturing the player's own MSE buffer** (existing Turbo/MSE path). Own extraction: no. Also a policy risk (below). Anything newer than those pages (SABR downloader status) is UNVERIFIED. |
| TikTok | Parses `__UNIVERSAL_DATA_FOR_REHYDRATION__` from the video page, reads `video.playAddr`, `bitrateInfo[].PlayAddr.UrlList`, `downloadAddr` (watermarked, low preference); sends `Referer`; may solve a SHA-256 proof-of-work cookie challenge ([tiktok.py](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/tiktok.py)). | **Yes, plausible.** Content script can read the same page JSON; extension already replays Referer/cookies. Fragile to site changes. |
| Instagram | Logged-in: `media/{id}/info/` API with `X-IG-App-ID`; logged-out: GraphQL `doc_id` or `data-sjs` blobs; formats from `video_versions` and `video_dash_manifest`; some posts login-gated ([instagram.py](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/instagram.py)). | **Yes for public/logged-in-as-user content**, with hard-coded app IDs and doc IDs that rotate. DASH means separate A/V, so merge needed. |
| Facebook | `hd_src`/`sd_src`, `progressive_urls`, `dash_manifest_xml_string`/MPD URLs, `hls_playlist_urls`; may require login ([facebook.py](https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/yt_dlp/extractor/facebook.py)). | **Yes, plausible**, same caveats. The file does not show how separate audio is merged (that is left to yt-dlp's ffmpeg merge). |

Policy: Chrome Web Store says "Do not encourage, facilitate, or enable the unauthorized access, download, or streaming of copyrighted content or media." and "Do not facilitate unauthorized access to content on websites, such as circumventing paywalls or login restrictions." It does not name YouTube ([CWS policies](https://developer.chrome.com/docs/webstore/program-policies/policies)). The claim that YouTube downloaders are specifically banned came only from secondary sites; UNVERIFIED. Stream Saver is a local unpacked extension, so this matters only if you publish.

## ffmpeg.wasm vs WebCodecs + muxer

| Aspect | ffmpeg.wasm | WebCodecs + Mediabunny |
|---|---|---|
| What it is | "pure Webassembly / Javascript port of FFmpeg", MIT ([README](https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/main/README.md)) | WebCodecs only does codec work: it "does not provide a built-in way to read `EncodedVideoChunk` objects from a video file, or write them to a playable video file"; Mediabunny is the named muxing/demuxing library ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)). Mediabunny is MPL-2.0 ([README](https://raw.githubusercontent.com/Vanilagy/mediabunny/main/README.md)). |
| Extension CSP | Needs WebAssembly, which is disabled under the default `script-src 'self'; object-src 'self'`; add `'wasm-unsafe-eval'` ([manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)). | No CSP change for remux. WebCodecs is a browser API, not wasm. |
| Bundling | Docs load the core from a jsDelivr CDN via `toBlobURL` ([usage](https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/main/apps/website/docs/getting-started/usage.md)). In MV3 "all of your extension's logic must be part of the extension package" ([MV3 security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)), so you must ship core `.js` + `.wasm` in the package and point at them with `chrome.runtime.getURL`. (This inference is mine; I found no ffmpeg.wasm-in-extension guide. UNVERIFIED that it runs cleanly.) | Pure JS, bundled with the extension. |
| Size limit | "2 GB, which is a hard limit in WebAssembly. Might become 4 GB" ([FAQ](https://ffmpegwasm.netlify.app/docs/faq)). A ~1 GB input is under that, but input plus output copies in wasm memory can approach it (my inference; UNVERIFIED). | "Handle reading & writing files of any size with memory-efficient streaming" ([README](https://raw.githubusercontent.com/Vanilagy/mediabunny/main/README.md)). `BufferTarget` suits "small-ish files (< 100 MB)"; use `StreamTarget` for large files ([writing](https://mediabunny.dev/guide/writing-media-files)). |
| Speed | Native 5.2 s vs 128.8 s single-thread vs 60.4 s multi-thread for webm to mp4; "won't perform as good as FFmpeg" ([performance](https://ffmpegwasm.netlify.app/docs/performance)). | Hardware-accelerated codecs via WebCodecs ([README](https://raw.githubusercontent.com/Vanilagy/mediabunny/main/README.md)). Copy (remux) mode needs no codec at all ([converting](https://mediabunny.dev/guide/converting-media-files)). |
| Multithread | `core-mt` ~2x faster, less stable, "consume a lot more memory and cpu" ([FAQ](https://ffmpegwasm.netlify.app/docs/faq)); needs SharedArrayBuffer ([usage](https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/main/apps/website/docs/getting-started/usage.md)). Whether an extension page is cross-origin isolated by default: UNVERIFIED (would need `cross_origin_embedder_policy`/`cross_origin_opener_policy` manifest keys, not checked). | n/a |
| Codec coverage | Anything FFmpeg builds in. | Browser-dependent. Mediabunny lists 25+ codecs; MP4 can hold H.264, HEVC, VP8, VP9, AV1 video and AAC, Opus, MP3 audio. If no encodable codec fits the output, the track is discarded (`no_encodable_target_codec`) ([formats](https://mediabunny.dev/guide/supported-formats-and-codecs), [converting](https://mediabunny.dev/guide/converting-media-files)). |
| Inputs | Whatever FFmpeg demuxes (not checked in detail). | Reads MP4, MOV, Matroska, WebM, MP3, WAVE, Ogg, ADTS, FLAC, **MPEG-TS and HLS** ([input formats](https://mediabunny.dev/guide/input-formats)). |
| Maintenance | Active repo. | `mp4-muxer` is deprecated: "has been deprecated in favor of Mediabunny, which entirely supersedes it" and gets no fixes ([mp4-muxer README](https://raw.githubusercontent.com/Vanilagy/mp4-muxer/main/README.md)). Use Mediabunny, not mp4-muxer. |

## MV3 constraints

- **CSP:** default `script-src 'self'; object-src 'self'`; WASM needs `'wasm-unsafe-eval'` and `'unsafe-eval'` is not allowed on extension pages. Sandbox pages are more lenient ([manifest CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)). Allowed `script-src` values are `self`, `none`, `wasm-unsafe-eval` (+ localhost when unpacked) ([MV3 security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)).
- **No remote code:** external resources "must not contain any logic" ([CWS MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)). Do not load the ffmpeg core from a CDN. The page does not mention WASM specifically.
- **Service worker is the wrong host:** it is killed after 30 s idle, a single request over 5 min, or a fetch response over 30 s ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)). Long remuxes cannot live there. WebCodecs availability: "Dedicated Web Workers" listed by MDN; service workers are not listed there ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)).
- **Offscreen document:** needs the `offscreen` permission; reasons include `WORKERS` and `BLOBS`; only one open at a time; no focus; only the `runtime` messaging API; non-audio reasons have no lifetime limit ([offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)). Fine for a background remux. For a user-initiated big job an extension tab (like the existing `downloader.html`) is simpler: it has the full extension API and shows progress, and it has no one-at-a-time limit (my inference from the above).
- **Writing the result:** `showSaveFilePicker` needs a secure context and transient user activation ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)), so call it from a tab on a click, not from the offscreen document (no focus, no user gesture there; inference). Mediabunny's `StreamTarget` accepts a `FileSystemWritableFileStream` ([writing](https://mediabunny.dev/guide/writing-media-files)). Alternative: OPFS in a worker (`createSyncAccessHandle`), subject to origin storage quota, not user-visible ([MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)), then hand to `chrome.downloads` or a blob URL. Whether `downloads.download` accepts large `blob:` URLs is not stated in the API docs ([downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)); UNVERIFIED, test it with ~1 GB.
- **Memory for ~1 GB:** no official per-tab limit found. Treat in-memory `BufferTarget` or a 1 GB `Blob` as risky and stream to disk (UNVERIFIED numbers; test).

## Remux recipes

All Mediabunny; API names from its docs, exact signatures not re-verified against current release.

**1. Merge separate video + audio into one MP4 (no re-encode).** Documented pattern: two composable conversions into one `Output` ([converting](https://mediabunny.dev/guide/converting-media-files)).
```ts
const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable) });
const v = await Conversion.init({ input: videoInput, output, audio: { discard: true }, composable: true });
const a = await Conversion.init({ input: audioInput, output, video: { discard: true }, composable: true });
await output.start();
await Promise.all([v.execute(), a.execute()]);
await output.finalize();
```
Inputs can be `BlobSource`/`UrlSource`/`ReadableStreamSource` ([reading](https://mediabunny.dev/guide/reading-media-files)). Check `isValid` and `discardedTracks` first: copy only works if the codec fits MP4 (e.g. Opus-in-WebM audio to MP4 is allowed per the codec table; VP9/AV1 video likewise). For multi-track writes the docs advise interleaving chunks (e.g. 10 s video then 10 s audio) to keep buffering low ([writing](https://mediabunny.dev/guide/writing-media-files)).

**2. HLS `.ts` to MP4.** Either concatenate the downloaded segments into one `.ts` Blob (what the extension already does) and open it as an MPEG-TS `Input`, or give Mediabunny the HLS playlist (both listed as readable, [input formats](https://mediabunny.dev/guide/input-formats)). Then a plain `Conversion.init({ input, output })`: it copies by default and only transcodes if copy is impossible ([converting](https://mediabunny.dev/guide/converting-media-files)). AAC in TS to MP4 is a copy. Details of Mediabunny's HLS reader (AES-128 key handling, live playlists, header replay) are UNVERIFIED; the extension already does fetching and decryption, so feed it the concatenated `.ts`.

**3. Compress.** Set `video: { codec: 'avc', bitrate, width/height }` in the `Conversion` options to force a transcode via WebCodecs (option names UNVERIFIED, see [converting](https://mediabunny.dev/guide/converting-media-files)). Output depends on what the user's Chrome can encode. `ffmpeg.wasm` gives x264 with CRF control, but at the 20-60x slower speeds measured above ([performance](https://ffmpegwasm.netlify.app/docs/performance)).

## Recommendation

1. Add Mediabunny (bundled, MPL-2.0: modifications to its own files must stay MPL) for **remux/merge only**. This replaces the "run ffmpeg yourself" hints in `README.md` and `downloader.js` (lines ~216, ~378) with a button. No manifest CSP change, no 2 GB cap, bounded memory through `StreamTarget`.
2. Host it in the existing `downloader.html` tab, not the service worker. Use `showSaveFilePicker` + `StreamTarget` for ~1 GB outputs, with a `chrome.downloads` fallback after testing blob size limits.
3. Skip ffmpeg.wasm unless you need codecs WebCodecs cannot encode or filters. If you do add it, ship the core inside the package, add `'wasm-unsafe-eval'`, use the single-thread core, and cap input well below 2 GB.
4. Keep the yt-dlp button for YouTube. Do not attempt in-extension YouTube extraction. For TikTok/Instagram/Facebook, a page-JSON reader is possible but treat it as high-maintenance; the player-capture path you already have covers most cases.
5. Before building: spike a 1 GB MP4 merge and a 1 GB `.ts` remux in a tab and watch memory.

## Spike results (2026-11-11, Node 24, mediabunny 1.65.2, throwaway code, not committed)

Ran with `StreamTarget` wrapping a positional-write `WritableStream` (same shape as `FileSystemWritableFileStream`). Outputs checked with ffprobe.
- **Merge video + audio, no re-encode:** works (`composable: true`, nothing discarded). Result: h264 + aac, 20 s.
- **`.ts` to MP4:** works, copy mode, h264 + aac.
- **AES-128 HLS:** works two ways: (a) decrypt segments, concat to `.ts`, remux; (b) `HLS_FORMATS` + `UrlSource` on the encrypted playlist (key fetched from its URI, no custom headers).
- **863 MB `.ts` to MP4:** 6 s, peak RSS 328 MB, output 843 MB, valid.
- **Still untested:** a real browser `showSaveFilePicker` run, `chrome.downloads` with large `blob:` URLs, live HLS, header replay through Mediabunny's own HLS reader.
