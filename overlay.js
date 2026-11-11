// Stream Saver — "Download MP4" button on every <video> (content script, all frames).
// One click downloads the whole video: the background maps the video to its captured source.
// HLS/DASH open the downloader tab (it starts by itself), plain files download directly, and
// MSE-only players are re-captured from 0 at 16x behind a full-page loading screen, merged into one MP4, then saved.
// ponytail: only light-DOM <video> elements are found (not inside shadow roots); add a deep query if a site needs it.
(() => {
  if (window.__ssOverlay) return;
  window.__ssOverlay = true;
  const MIN_W = 200, MIN_H = 110;
  let cfg = { off: [], tpl: '{title}' };
  let mse = { eme: false, tracks: [], blobs: [] };
  let busy = false; // one capture at a time per frame
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

  /* ------------------------- full-page loading screen ------------------------- */
  function loading() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>.w{position:fixed;inset:0;background:#000d;display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif;color:#fff}.c{background:#161616;border:1px solid #fff3;border-radius:12px;padding:22px 26px;width:min(340px,86vw);text-align:center}progress{width:100%;margin:14px 0}button{font:inherit;color:#fff;background:#333;border:1px solid #fff4;border-radius:8px;padding:6px 14px;cursor:pointer}small{display:block;opacity:.65;margin-bottom:12px}</style><div class="w"><div class="c"><div id="t"></div><progress id="p" max="1"></progress><small>Keep this tab open. The download starts when it finishes.</small><button id="x">Cancel</button></div></div>';
    parentEl().append(host);
    const api = {
      cancelled: false,
      set(text, frac) { root.getElementById('t').textContent = text; const p = root.getElementById('p'); frac == null ? p.removeAttribute('value') : (p.value = Math.min(1, Math.max(0, frac))); },
      close() { host.remove(); },
    };
    root.getElementById('x').onclick = () => { api.cancelled = true; };
    return api;
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

  const say = (it, text, ms = 3000) => { it.label = text; setTimeout(() => { if (it.label === text) it.label = '⬇ MP4'; }, ms); };

  async function click(v, it) {
    if (busy) return;
    say(it, '…', 60000);
    let r;
    try { r = await chrome.runtime.sendMessage({ type: MSG.OVERLAY_DL, src: v.currentSrc || v.src || '' }); } catch { r = { error: 'Extension reloaded: refresh this page' }; }
    if (!r || r.error) return say(it, '⚠ ' + ((r && r.error) || 'failed'));
    if (r.mode === 'tab') say(it, '✓ Downloading in a new tab');
    else if (r.mode === 'direct') say(it, '✓ Download started');
    else if (r.mode === 'drm') say(it, '🔒 Protected (DRM)');
    else if (r.mode === 'none') say(it, 'Press play first, then retry');
    else if (r.mode === 'mse') await captureAll(v, it);
  }

  /* ------------------- MSE-only players: capture, merge, save ------------------- */
  async function captureAll(v, it) {
    if (!isFinite(v.duration) || !v.duration) return say(it, 'Live video: can’t capture the whole thing', 5000);
    busy = true;
    const ui = loading();
    const name = fileNameFromTemplate(cfg.tpl, { title: document.title, host: topHost() });
    try {
      ui.set('Loading the whole video… 0%', 0);
      window.postMessage({ __mdlCmd: 'restart' }, '*');
      let last = -1, still = 0;
      while (!ui.cancelled && !v.ended && v.currentTime < v.duration - 0.5) {
        await new Promise((r) => setTimeout(r, 300));
        ui.set(`Loading the whole video… ${Math.floor((v.currentTime / v.duration) * 100)}%`, v.currentTime / v.duration);
        still = v.currentTime === last ? still + 300 : 0;
        last = v.currentTime;
        if (still > 30000) throw new Error('playback stalled');
        if (v.paused && !v.ended) v.play().catch(() => {});
      }
      v.playbackRate = 1; v.muted = false;
      if (ui.cancelled) return;
      ui.set('Merging into one MP4…', null);
      await mergeAndSave(name);
      say(it, '✓ Saved ' + name + '.mp4', 5000);
    } catch (e) {
      console.warn('[Stream Saver]', e);
      v.playbackRate = 1; v.muted = false;
      say(it, '⚠ ' + e.message, 6000);
    } finally {
      ui.close();
      busy = false;
    }
  }

  const exported = () => new Promise((res, rej) => { // ask inject.js (page world) for the captured buffers
    const t = setTimeout(() => rej(new Error('no capture data')), 5000);
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.__mdlOut !== 'export') return;
      clearTimeout(t); removeEventListener('message', on); res(e.data.tracks);
    };
    addEventListener('message', on);
    window.postMessage({ __mdlCmd: 'export' }, '*');
  });

  async function mergeAndSave(name) {
    try {
      const tracks = await exported();
      const vt = tracks.find((t) => /^video/i.test(t.mime)), at = tracks.find((t) => /^audio/i.test(t.mime));
      if (!vt && !at) throw new Error('nothing captured');
      const { remuxToMp4 } = await import(chrome.runtime.getURL('remux.mjs'));
      const { blob } = await remuxToMp4({ video: (vt || at).blob, audio: vt && at ? at.blob : undefined });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name + '.mp4';
      document.documentElement.append(a); a.click(); a.remove();
    } catch (e) { // fallback: the player's buffers as-is (separate video/audio files)
      console.warn('[Stream Saver] MP4 merge failed, saving raw buffers:', e);
      for (const t of mse.tracks || []) if (t.bytes > 0) window.postMessage({ __mdlCmd: 'save-track', id: t.id, name }, '*');
      for (const b of mse.blobs || []) window.postMessage({ __mdlCmd: 'save-blob', id: b.id, name }, '*');
    }
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
