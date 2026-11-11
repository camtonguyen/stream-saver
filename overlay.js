// Stream Saver — "Download MP4" button on every <video> (content script, all frames).
// One click: the background maps the video to its captured source. HLS/DASH open the downloader tab,
// plain files download directly, and MSE-only players are captured with Turbo, then saved on click/end.
// ponytail: only light-DOM <video> elements are found (not inside shadow roots); add a deep query if a site needs it.
(() => {
  if (window.__ssOverlay) return;
  window.__ssOverlay = true;
  const MIN_W = 200, MIN_H = 110;
  let cfg = { off: [], tpl: '{title}' };
  let mse = { eme: false, tracks: [], blobs: [] };
  const items = new Map(); // video → { host, btn, capturing }

  const load = () => { try { chrome.storage.sync.get(cfg).then((v) => (cfg = v)).catch(() => {}); } catch {} };
  load();
  try { chrome.storage.onChanged.addListener(load); } catch {}
  window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.__mdl === 'state') mse = e.data.state; });

  const topHost = () => {
    try { return top.location.hostname; } catch {}
    try { return new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch {}
    return location.hostname;
  };

  function make(v) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;display:none';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>button{pointer-events:auto;font:600 12px system-ui,sans-serif;color:#fff;background:#2563ebdd;border:1px solid #fff5;border-radius:999px;padding:5px 11px;cursor:pointer;box-shadow:0 2px 8px #0006}button:hover{background:#1d4ed8}button:disabled{background:#555d;cursor:not-allowed}</style><button></button>';
    const btn = root.querySelector('button');
    const it = { host, btn, capturing: false, label: '⬇ MP4' };
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); click(v, it); };
    for (const t of ['mousedown', 'mouseup', 'dblclick']) btn.addEventListener(t, (e) => e.stopPropagation());
    return it;
  }

  const say = (it, text, ms = 3000) => { it.label = text; setTimeout(() => { if (it.label === text) it.label = it.capturing ? '⏺ Capturing… click to save' : '⬇ MP4'; }, ms); };

  async function click(v, it) {
    if (it.capturing) return saveMse(v, it);
    say(it, '…', 60000);
    let r;
    try { r = await chrome.runtime.sendMessage({ type: MSG.OVERLAY_DL, src: v.currentSrc || v.src || '' }); } catch { r = { error: 'Extension reloaded: refresh this page' }; }
    if (!r || r.error) return say(it, '⚠ ' + ((r && r.error) || 'failed'));
    if (r.mode === 'tab') say(it, '✓ Opened downloader');
    else if (r.mode === 'direct') say(it, '✓ Download started');
    else if (r.mode === 'drm') say(it, '🔒 Protected (DRM)');
    else if (r.mode === 'none') say(it, 'Press play first, then retry');
    else if (r.mode === 'mse') { // no URL to fetch: record what the player loads, at 16x
      it.capturing = true;
      say(it, '⏺ Capturing… click to save', 0);
      window.postMessage({ __mdlCmd: 'turbo' }, '*');
      v.addEventListener('ended', () => it.capturing && saveMse(v, it), { once: true });
    }
  }

  const rawSave = (name) => { // fallback: the player's buffers as-is (separate video/audio files)
    for (const t of mse.tracks || []) if (t.bytes > 0) window.postMessage({ __mdlCmd: 'save-track', id: t.id, name }, '*');
    for (const b of mse.blobs || []) window.postMessage({ __mdlCmd: 'save-blob', id: b.id, name }, '*');
  };
  const exported = () => new Promise((res, rej) => { // ask inject.js (page world) for the captured buffers
    const t = setTimeout(() => rej(new Error('no capture data')), 5000);
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.__mdlOut !== 'export') return;
      clearTimeout(t); removeEventListener('message', on); res(e.data.tracks);
    };
    addEventListener('message', on);
    window.postMessage({ __mdlCmd: 'export' }, '*');
  });

  async function saveMse(v, it) {
    it.capturing = false; v.playbackRate = 1; v.muted = false;
    const name = fileNameFromTemplate(cfg.tpl, { title: document.title, host: topHost() });
    say(it, 'Merging into MP4…', 120000);
    try {
      const tracks = await exported();
      const vt = tracks.find((t) => /^video/i.test(t.mime)), at = tracks.find((t) => /^audio/i.test(t.mime));
      if (!vt && !at) throw new Error('nothing captured');
      const { remuxToMp4 } = await import(chrome.runtime.getURL('remux.mjs'));
      const { blob } = await remuxToMp4({ video: (vt || at).blob, audio: vt && at ? at.blob : undefined });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name + '.mp4';
      document.documentElement.append(a); a.click(); a.remove();
      say(it, '✓ Saved ' + name + '.mp4', 5000);
    } catch (e) {
      console.warn('[Stream Saver] MP4 merge failed, saving raw buffers:', e);
      rawSave(name);
      say(it, '✓ Saved raw files (MP4 merge failed)', 5000);
    }
  }

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
      const parent = document.fullscreenElement || document.documentElement; // visible in fullscreen too
      if (it.host.parentNode !== parent) parent.append(it.host);
      it.btn.textContent = mse.eme && !it.capturing ? '🔒 DRM' : it.label;
      it.btn.disabled = !!mse.eme && !it.capturing;
      it.btn.title = it.btn.disabled ? 'Protected (DRM) video can’t be saved' : 'Save this video as one MP4';
      // Inside the top-left corner; below the video instead when it touches the top edge (sticky headers, toolbars).
      const below = r.top < 36 && r.bottom + 34 < innerHeight;
      it.host.style.transform = `translate(${Math.max(r.left, 0) + 8}px,${below ? r.bottom + 6 : Math.max(r.top, 0) + 8}px)`;
    }
  }
  setInterval(tick, 400);
})();
