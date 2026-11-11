'use strict';
// The per-tab record of captured media: { items: {url → item}, mse: {frameId → state} }.
// Only this file knows the storage key and shape. `store` is injectable (tests pass a fake).

const tabKey = (id) => `tab_${id}`;
const emptyTab = () => ({ items: {}, mse: {} });

// Drive/YouTube-style players fetch one URL in many ranges; drop the range params so they merge into one item.
function cleanUrl(u) {
  u = u.split('#')[0];
  if (!/\/videoplayback/.test(u)) return u;
  try { const x = new URL(u); for (const k of ['range', 'rn', 'rbuf']) x.searchParams.delete(k); return x.href; } catch { return u; }
}

async function readTab(id, store = chrome.storage.session) {
  return (await store.get(tabKey(id)))[tabKey(id)] || emptyTab();
}
const writeTab = (id, d, store = chrome.storage.session) => store.set({ [tabKey(id)]: d });
const removeTab = (id, store = chrome.storage.session) => store.remove(tabKey(id));
// Look an item up by any spelling of its URL.
const itemFor = (d, url) => d.items[cleanUrl(url)] || d.items[url];

// What does the on-page button download? {kind:'item', item} | {kind:'mse'} | {kind:'drm'} | {kind:'none'}.
// An item whose URL is the video's own src wins. Otherwise, only if `guess` is true, the newest HLS, DASH, MP4, WebM (in that order);
// pass guess=false when the tab has several videos or the site is yt-dlp territory, so we never save the wrong video.
function pickSource(d, src, guess = true) {
  const own = src && itemFor(d, src);
  if (own && own.kind !== 'audio') return { kind: 'item', item: own };
  const rank = { hls: 0, dash: 1, mp4: 2, webm: 3 };
  const best = !guess ? null : Object.values(d.items).filter((i) => i.kind in rank).sort((a, b) => rank[a.kind] - rank[b.kind] || (b.t || 0) - (a.t || 0))[0];
  if (best) return { kind: 'item', item: best };
  const st = Object.values(d.mse || {});
  if (st.some((s) => s.eme)) return { kind: 'drm' };
  if (st.some((s) => (s.tracks || []).some((t) => t.bytes > 0) || (s.blobs || []).length)) return { kind: 'mse' };
  return { kind: 'none' };
}
