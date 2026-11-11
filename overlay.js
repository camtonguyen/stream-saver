// Stream Saver — "Download MP4" button on every <video> (content script, all frames).
// One click downloads the whole video: the background maps the video to its captured source.
// HLS/DASH open the downloader tab (it starts by itself), plain files download directly, and
// players that expose no fetchable URL (MSE only) get a message instead; nothing is played back or recorded.
// ponytail: only light-DOM <video> elements are found (not inside shadow roots); add a deep query if a site needs it.
(() => {
  if (window.__ssOverlay) return;
  window.__ssOverlay = true;
  const MIN_W = 200, MIN_H = 110;
  let cfg = { off: [], tpl: '{title}' };
  let visible = 0; // buttons currently shown in this frame: with several videos we never guess which source is whose
  const items = new Map(); // video → { host, btn, label, k }

  const load = () => { try { chrome.storage.sync.get(cfg).then((v) => (cfg = v)).catch(() => {}); } catch {} };
  load();
  try { chrome.storage.onChanged.addListener(load); } catch {}

  const topHost = () => {
    try { return top.location.hostname; } catch {}
    try { return new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch {}
    return location.hostname;
  };
  const parentEl = () => document.fullscreenElement || document.documentElement; // visible in fullscreen too

  /* --------------- yt-dlp dialog (sites the browser can't fetch directly) --------------- */
  function ytdlpDialog(url) {
    const os = detectOs({ uaPlatform: navigator.userAgentData && navigator.userAgentData.platform, platform: navigator.platform, ua: navigator.userAgent });
    const cmd = ytdlpPageCommand({ url, win: os === 'win' });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>.w{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;font:14px/1.45 system-ui,sans-serif;color:#fff}.c{background:#161616;border:1px solid #fff3;border-radius:12px;padding:20px 24px;width:min(560px,92vw)}h3{margin:0 0 8px;font-size:16px}.warn{background:#7c2d12;border:1px solid #fdba7466;border-radius:8px;padding:10px 12px;margin:10px 0}code,textarea{display:block;width:100%;box-sizing:border-box;font:12px ui-monospace,monospace;background:#000;color:#9fe;border:1px solid #fff3;border-radius:6px;padding:8px;margin-top:6px;resize:none}button{font:inherit;color:#fff;background:#2563eb;border:0;border-radius:8px;padding:7px 14px;cursor:pointer;margin:12px 8px 0 0}button.g{background:#333}small{opacity:.7}</style><div class="w"><div class="c"><h3>This site needs yt-dlp</h3><div>The browser can’t download this video by itself. Run the command below in a terminal to get one MP4.<span id="o"></span></div><div class="warn"><b>⚠ Install the tools first</b> (once). Without them the command fails:<div id="i"></div><small>Needs both <b>yt-dlp</b> and <b>ffmpeg</b> (ffmpeg merges video and audio into one MP4). Then open a new terminal and check: <b>yt-dlp --version</b> and <b>ffmpeg -version</b>.</small></div><div>Download command (copied):</div><textarea id="c" rows="3" readonly></textarea><small>Uses your Chrome login (private / age-gated videos). On Edge or Firefox, change <code style="display:inline;padding:0">chrome</code> to your browser. Only download what you have the right to save.</small><br><button id="copy">Copy command</button><button id="x" class="g">Close</button></div></div>';
    for (const s of ytdlpInstall(os)) {
      const h = document.createElement('div'), c = document.createElement('code');
      h.style.cssText = 'margin-top:8px;font-weight:600';
      h.textContent = s.name + (s.mine ? ' · detected on this computer' : '') + (s.os === 'mac' ? ' · needs Homebrew, brew.sh' : '');
      c.textContent = s.cmd; c.style.whiteSpace = 'pre-wrap';
      if (!s.mine) c.style.opacity = '.7';
      root.getElementById('i').append(h, c);
    }
    if (os === 'other') root.getElementById('o').textContent = ' This device isn’t macOS, Windows or Linux: run it on a desktop computer.';
    root.getElementById('c').value = cmd;
    const copy = () => navigator.clipboard.writeText(cmd).then(() => (root.getElementById('copy').textContent = 'Copied ✓')).catch(() => root.getElementById('c').select());
    root.getElementById('copy').onclick = copy;
    root.getElementById('x').onclick = () => host.remove();
    (document.fullscreenElement || document.documentElement).append(host);
    copy();
  }

  /* -------------------------------- the button -------------------------------- */
  function make(v) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483646;left:0;top:0;pointer-events:none;display:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>button{pointer-events:auto;font:600 12px system-ui,sans-serif;color:#fff;background:#2563ebdd;border:1px solid #fff5;border-radius:999px;padding:5px 11px;cursor:pointer;box-shadow:0 2px 8px #0006}button:hover{background:#1d4ed8}button:disabled{background:#555d;cursor:not-allowed}</style><button></button>';
    const it = { host, btn: root.querySelector('button'), label: '⬇ MP4' };
    it.btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); click(v, it); };
    for (const t of ['mousedown', 'mouseup', 'dblclick']) it.btn.addEventListener(t, (e) => e.stopPropagation());
    return it;
  }

  const say = (it, text, ms = 3000) => { const k = (it.k = (it.k || 0) + 1); it.label = text; if (ms) setTimeout(() => { if (it.k === k) it.label = '⬇ MP4'; }, ms); };
  const showYtdlp = () => { // the dialog lives in the top frame, so an iframe player doesn't clip it
    const url = ytdlpPageUrl(location.href);
    if (window === top) ytdlpDialog(url); else chrome.runtime.sendMessage({ type: MSG.YTDLP_DIALOG, url }).catch(() => {});
  };
  try { chrome.runtime.onMessage.addListener((m) => { if (m.type === MSG.YTDLP_DIALOG && window === top) ytdlpDialog(m.url); }); } catch {}

  async function click(v, it) {
    const route = ytdlpRoute(location.href);
    if (route === 'only') return showYtdlp(); // YouTube: no fetchable URL, ever
    say(it, '…', 60000);
    let r;
    try { r = await chrome.runtime.sendMessage({ type: MSG.OVERLAY_DL, src: v.currentSrc || v.src || '', guess: route !== 'fallback' && visible <= 1 }); } catch { r = { error: 'Extension reloaded: refresh this page' }; }
    if (!r || r.error) return say(it, '⚠ ' + ((r && r.error) || 'failed'));
    if (r.mode === 'tab') say(it, '✓ Downloading in a new tab');
    else if (r.mode === 'direct') say(it, '✓ Download started');
    else if (r.mode === 'drm') say(it, '🔒 Protected (DRM)');
    else if (route === 'fallback') { say(it, '⬇ MP4', 0); showYtdlp(); }
    else if (visible > 1) say(it, 'Couldn’t tell which video this is', 6000);
    else if (r.mode === 'none') say(it, 'Press play first, then retry');
    else if (r.mode === 'mse') say(it, 'No direct video link found on this site', 6000);
  }

  /* ------------------------------ keep buttons placed ------------------------------ */
  // The video's rect minus whatever scrolling/overflow-hidden ancestors cut off, so a card in a list
  // that is half scrolled out keeps its button on the visible part of that very video.
  function clipped(v) {
    let { left, top, right, bottom, width, height } = v.getBoundingClientRect();
    for (let p = v.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const c = p.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    // full size is kept for the MIN check so a clipped-but-big video still counts; position uses the clipped box
    return { left, top, right, bottom, width: Math.min(width, right - left), height: Math.min(height, bottom - top) };
  }
  function tick() {
    const off = siteOff(cfg.off, topHost());
    const live = new Set(off ? [] : document.querySelectorAll('video'));
    for (const [v, it] of items) if (!live.has(v) || !v.isConnected) { it.host.remove(); items.delete(v); }
    visible = 0;
    for (const v of live) {
      let it = items.get(v);
      if (!it) items.set(v, (it = make(v)));
      const r = clipped(v);
      const show = r.width >= MIN_W && r.height >= MIN_H && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(v).visibility !== 'hidden';
      it.host.style.display = show ? '' : 'none';
      if (!show) continue;
      visible++;
      if (it.host.parentNode !== parentEl()) parentEl().append(it.host);
      const drm = !!v.mediaKeys; // this video's own DRM state (EME keys attached)
      it.btn.textContent = drm ? '🔒 DRM' : it.label;
      it.btn.disabled = drm;
      it.btn.title = drm ? 'Protected (DRM) video can’t be saved' : ytdlpRoute(location.href) === 'only' ? 'Needs yt-dlp + ffmpeg installed' : 'Download this video as one MP4';
      // Inside the top-left corner; below the video instead when it touches the top edge (sticky headers, toolbars).
      const below = r.top < 36 && r.bottom + 34 < innerHeight;
      it.host.style.transform = `translate(${Math.max(r.left, 0) + 8}px,${below ? r.bottom + 6 : Math.max(r.top, 0) + 8}px)`;
    }
  }
  // ponytail: polling (cheap when a page has no video). Swap for Mutation/IntersectionObserver if idle CPU ever shows up.
  let raf = 0; // scrolling/resizing moves videos between polls: re-place the buttons on the next frame
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (items.size) tick(); }); };
  addEventListener('scroll', soon, { capture: true, passive: true });
  addEventListener('resize', soon, { passive: true });
  const loop = () => { if (!document.hidden) tick(); setTimeout(loop, items.size ? 400 : 1500); };
  loop();
})();
