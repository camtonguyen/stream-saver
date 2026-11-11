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
  let mse = { eme: false, tracks: [], blobs: [] };
  const items = new Map(); // video → { host, btn, label }

  const load = () => { try { chrome.storage.sync.get(cfg).then((v) => (cfg = v)).catch(() => {}); } catch {} };
  load();
  try { chrome.storage.onChanged.addListener(load); } catch {}
  window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.__mdl === 'state') mse = e.data.state; });

  const topHost = () => {
    try { return top.location.hostname; } catch {}
    try { return new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch {}
    return location.hostname;
  };
  const parentEl = () => document.fullscreenElement || document.documentElement; // visible in fullscreen too

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

  const say = (it, text, ms = 3000) => { it.label = text; setTimeout(() => { if (it.label === text) it.label = '⬇ MP4'; }, ms); };

  async function click(v, it) {
    say(it, '…', 60000);
    let r;
    try { r = await chrome.runtime.sendMessage({ type: MSG.OVERLAY_DL, src: v.currentSrc || v.src || '' }); } catch { r = { error: 'Extension reloaded: refresh this page' }; }
    if (!r || r.error) return say(it, '⚠ ' + ((r && r.error) || 'failed'));
    if (r.mode === 'tab') say(it, '✓ Downloading in a new tab');
    else if (r.mode === 'direct') say(it, '✓ Download started');
    else if (r.mode === 'drm') say(it, '🔒 Protected (DRM)');
    else if (r.mode === 'none') say(it, 'Press play first, then retry');
    else if (r.mode === 'mse') say(it, 'No direct video link found on this site yet', 6000);
  }

  /* ------------------------------ keep buttons placed ------------------------------ */
  function tick() {
    const off = siteOff(cfg.off, topHost());
    const live = new Set(off ? [] : document.querySelectorAll('video'));
    for (const [v, it] of items) if (!live.has(v) || !v.isConnected) { it.host.remove(); items.delete(v); }
    for (const v of live) {
      let it = items.get(v);
      if (!it) items.set(v, (it = make(v)));
      const r = v.getBoundingClientRect();
      const show = r.width >= MIN_W && r.height >= MIN_H && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(v).visibility !== 'hidden';
      it.host.style.display = show ? '' : 'none';
      if (!show) continue;
      if (it.host.parentNode !== parentEl()) parentEl().append(it.host);
      it.btn.textContent = mse.eme ? '🔒 DRM' : it.label;
      it.btn.disabled = !!mse.eme;
      it.btn.title = mse.eme ? 'Protected (DRM) video can’t be saved' : 'Download this video as one MP4';
      // Inside the top-left corner; below the video instead when it touches the top edge (sticky headers, toolbars).
      const below = r.top < 36 && r.bottom + 34 < innerHeight;
      it.host.style.transform = `translate(${Math.max(r.left, 0) + 8}px,${below ? r.bottom + 6 : Math.max(r.top, 0) + 8}px)`;
    }
  }
  setInterval(tick, 400);
})();
