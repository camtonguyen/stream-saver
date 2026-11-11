// Run: node test.js   (no framework; loads the extension's classic scripts into one shared context)
const assert = require('assert'), vm = require('vm'), fs = require('fs'), cp = require('child_process');
const ctx = vm.createContext({ console, URL, TextDecoder });
for (const f of ['common.js', 'captures.js', 'replay.js', 'fetcher.js', 'ytdlp.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
const g = (n) => vm.runInContext(n, ctx);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- replay (A)
test('replayHeaders derives Referer and Origin (browser downloads used to miss Origin)', () => {
  const h = g('replayHeaders')({ page: 'https://site.dev/course', hdr: { cookie: 'a=1' } });
  assert.equal(h.referer, 'https://site.dev/course/');
  assert.equal(h.origin, 'https://site.dev');
  assert.equal(h.cookie, 'a=1');
});
test('replayRules: cookie only to host; anyHost sends the rest everywhere', () => {
  const r = g('replayRules')({ cookie: 'a=1', referer: 'https://x/' }, { tabId: 7, host: 'cdn.x', anyHost: true });
  assert.equal(r.length, 2);
  const general = r.find((x) => x.priority === 1), scoped = r.find((x) => x.priority === 2);
  assert.deepEqual(general.condition, { tabIds: [7] });
  assert.deepEqual(scoped.condition, { tabIds: [7], requestDomains: ['cdn.x'] });
  assert.equal(scoped.action.requestHeaders[0].header, 'cookie');
  assert.equal(g('replayRules')({ referer: 'https://x/' }, { tabId: -1, host: 'cdn.x' })[0].condition.requestDomains[0], 'cdn.x');
});

// --- captures (C)
test('captures: cleanUrl merges range requests; store is fakeable', async () => {
  const cu = g('cleanUrl');
  assert.equal(cu('https://d/videoplayback?id=1&range=0-99&rn=3#x'), 'https://d/videoplayback?id=1');
  const mem = {}, store = { get: async (k) => ({ [k]: mem[k] }), set: async (o) => Object.assign(mem, o) };
  const d = await g('readTab')(5, store);
  d.items['https://d/videoplayback?id=1'] = { kind: 'mp4' };
  await g('writeTab')(5, d, store);
  const back = await g('readTab')(5, store);
  assert.ok(g('itemFor')(back, 'https://d/videoplayback?id=1&range=0-9'));
});

// --- fetcher (B)
const E = (status) => Object.assign(new Error('HTTP ' + status), { status });
const ok = (s) => ({ data: new TextEncoder().encode(s), status: 200 });
const mk = (ext, page) => g('createFetcher')({ ext, page, getMaster: () => 'https://h/m.m3u8?sig=1', log() {}, sleep: async () => {} });
test('fetcher: 403 on direct switches to the video tab and stays there', async () => {
  let ec = 0; const f = mk(async () => { ec++; throw E(403); }, async () => ok('hi'));
  assert.equal(await f.get('https://h/a', { type: 'text' }), 'hi');
  await f.get('https://h/b');
  assert.equal(ec, 1); assert.equal(f.mode, 'page');
});
test('fetcher: retries 5xx, gives up on 404', async () => {
  let n = 0; const f = mk(async () => { if (++n < 3) throw E(503); return ok('x'); }, null);
  await f.get('https://h/a'); assert.equal(n, 3);
  await assert.rejects(mk(async () => { throw E(404); }, null).get('https://h/a'), { status: 404 });
});
test('fetcher: inherits the manifest query after a 403', async () => {
  const seen = []; const f = mk(async (u) => { seen.push(u); if (!u.includes('sig=1')) throw E(403); return ok('s'); }, null);
  await f.get('https://h/seg1.ts'); await f.get('https://h/seg2.ts');
  assert.deepEqual(seen, ['https://h/seg1.ts', 'https://h/seg1.ts?sig=1', 'https://h/seg2.ts?sig=1']);
});

// --- yt-dlp (D)
test('ytdlp: page URL can not inject shell code', () => {
  const c = g('ytdlpPageCommand')({ url: "https://y.com/watch?v=$(touch pwn)`id`'", win: false });
  assert.ok(c.includes("'https://y.com/watch?v=$(touch pwn)`id`'\\'''"), c);
});
test('ytdlp: audio flag and share links', () => {
  assert.ok(g('ytdlpPageCommand')({ url: 'https://v.com/1', win: false, audio: true }).includes('-x --audio-format mp3'));
  assert.equal(g('shareDirectUrl')('https://www.dropbox.com/s/a/f.mp4?dl=0'), 'https://www.dropbox.com/s/a/f.mp4?dl=1');
  assert.ok(g('shareDirectUrl')('https://x.sharepoint.com/:v:/s/t/abc').endsWith('download=1'));
  const s = g('shareDirectUrl');
  assert.equal(s('https://youtube.com/watch'), null);
  assert.equal(s('https://www.dropbox.com/home'), null);
  assert.equal(s('https://x.sharepoint.com/sites/team'), null);
  assert.equal(s('javascript:alert(1)'), null);
  assert.equal(s('nope'), null);
  assert.equal(s('https://www.dropbox.com/scl/fi/a/f.mp4?rlkey=k&dl=0#x'), 'https://www.dropbox.com/scl/fi/a/f.mp4?rlkey=k&dl=1#x');
});
test('ytdlp: stream command carries referer/origin/cookies', () => {
  const c = g('ytdlpStreamCommand')({ item: { url: 'https://cdn/x.m3u8', page: 'https://s.dev/p', hdr: {} }, tabUrl: '', title: 'T/1', ua: 'UA', cookiePath: '/c.txt', win: false });
  assert.ok(c.includes("--referer 'https://s.dev/p/'") && c.includes("'Origin:https://s.dev'") && c.includes("--cookies '/c.txt'") && c.includes("'T 1.%(ext)s'"), c);
});

test('ytdlp: % in the title is escaped for the -o template', () => {
  const c = g('ytdlpStreamCommand')({ item: { url: 'https://c/x' }, tabUrl: '', title: '100% Real', ua: 'UA', win: false });
  assert.ok(c.includes("'100%% Real.%(ext)s'"), c);
});

// --- overlay logic (F)
test('fileNameFromTemplate fills {title} {site} {date}, strips unsafe chars, never empty', () => {
  const f = g('fileNameFromTemplate');
  assert.equal(f('{title} - {site}', { title: 'My: Clip', host: 'a.dev', date: '2026-01-02' }), 'My Clip - a.dev');
  assert.equal(f('{date}_{title}', { title: 'x', host: '', date: '2026-01-02' }), '2026-01-02_x');
  assert.equal(f('', { title: 'T' }), 'T');
  assert.equal(f('{site}', { title: 'T', host: '' }), 'video');
});
test('siteOff matches the host and its subdomains only', () => {
  const s = g('siteOff');
  assert.ok(s(['youtube.com'], 'www.youtube.com') && s(['youtube.com'], 'youtube.com'));
  assert.ok(!s(['youtube.com'], 'notyoutube.com') && !s([], 'a.dev') && !s(undefined, 'a.dev'));
});
test('extFor trusts the path extension, then the MIME type (Drive videoplayback), then the kind', () => {
  const e = g('extFor');
  assert.equal(e({ url: 'https://h/a/b.webm', kind: 'webm' }), 'webm');
  assert.equal(e({ url: 'https://d/videoplayback?id=1', kind: 'mp4', ct: 'video/x-matroska' }), 'mkv');
  assert.equal(e({ url: 'https://d/videoplayback?mime=audio%2Fmp4', kind: 'audio' }), 'm4a');
  assert.equal(e({ url: 'https://d/x', kind: 'mp4' }), 'mp4');
});
test('pickSource: exact src match wins, else newest HLS/DASH, else MSE, DRM or none', () => {
  const p = g('pickSource');
  const d = { items: { 'https://h/a.mp4': { url: 'https://h/a.mp4', kind: 'mp4', t: 1 }, 'https://h/m.m3u8': { url: 'https://h/m.m3u8', kind: 'hls', t: 2 }, 'https://h/old.m3u8': { url: 'https://h/old.m3u8', kind: 'hls', t: 1 }, 'https://h/s.mp3': { url: 'https://h/s.mp3', kind: 'audio', t: 9 } }, mse: {} };
  assert.equal(p(d, 'https://h/a.mp4').item.url, 'https://h/a.mp4');
  assert.equal(p(d, 'blob:https://h/xyz').item.url, 'https://h/m.m3u8');
  assert.equal(p({ items: {}, mse: { 0: { tracks: [{ bytes: 5 }] } } }, 'blob:x').kind, 'mse');
  assert.equal(p({ items: {}, mse: { 0: { eme: true, tracks: [] } } }, '').kind, 'drm');
  assert.equal(p({ items: { 'https://h/s.mp3': { kind: 'audio', t: 1 } }, mse: {} }, '').kind, 'none');
});

test('ytdlpRoute: YouTube always needs yt-dlp, other known sites only as a fallback, the rest never', () => {
  const r = g('ytdlpRoute');
  assert.equal(r('https://www.youtube.com/watch?v=1'), 'only');
  assert.equal(r('https://youtu.be/abc'), 'only');
  assert.equal(r('https://www.tiktok.com/@a/video/1'), 'fallback');
  assert.equal(r('https://example.com/watch'), null);
  assert.equal(r('https://notyoutube.com/x'), null);
});
test('ytdlpInstallHint gives the right install command per OS', () => {
  const h = g('ytdlpInstallHint');
  assert.equal(h('mac'), 'brew install yt-dlp ffmpeg');
  assert.equal(h('win'), 'winget install yt-dlp ffmpeg');
  assert.ok(h('linux').includes('yt-dlp') && h('linux').includes('ffmpeg'));
});
test('ytdlp page command downloads one video, not the playlist', () => {
  assert.ok(g('ytdlpPageCommand')({ url: 'https://youtube.com/watch?v=1&list=PL', win: false }).includes('--no-playlist'));
});

// --- remux (E): ffmpeg makes the fixtures, ffprobe judges the output (independent of our code)
const os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'));
const ff = (...a) => cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const probe = (f) => cp.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,duration', '-of', 'json', f]).toString();
const sink = (f) => { const fd = fs.openSync(f, 'w'); return new WritableStream({ write(c) { fs.writeSync(fd, c.data, 0, c.data.byteLength, c.position); }, close() { fs.closeSync(fd); } }); };
const blob = (f) => new Blob([fs.readFileSync(f)]);
test('remux: .ts video+audio becomes one MP4 with the same codecs, no re-encode', async () => {
  const ts = path.join(tmp, 'in.ts'), out = path.join(tmp, 'out.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', ts);
  const { remuxToMp4 } = await import('./remux.mjs');
  const r = await remuxToMp4({ video: [blob(ts)], writable: sink(out) });
  const s = JSON.parse(probe(out)).streams;
  assert.deepEqual(s.map((x) => x.codec_name).sort(), ['aac', 'h264']);
  assert.ok(Math.abs(+s.find((x) => x.codec_type === 'video').duration - 3) < 0.2);
  assert.equal(r.bytes, fs.statSync(out).size);
});

test('remux: separate video and audio files merge into one MP4 with both tracks', async () => {
  const v = path.join(tmp, 'v.mp4'), a = path.join(tmp, 'a.m4a'), out = path.join(tmp, 'merged.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v);
  ff('-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:a', 'aac', a);
  const { remuxToMp4 } = await import('./remux.mjs');
  await remuxToMp4({ video: blob(v), audio: blob(a), writable: sink(out) });
  const s = JSON.parse(probe(out)).streams;
  assert.deepEqual(s.map((x) => x.codec_type).sort(), ['audio', 'video']);
  assert.deepEqual(s.map((x) => x.codec_name).sort(), ['aac', 'h264']);
});
test('remux: separate VP9 and Opus WebM tracks (MSE capture) become one MP4, returned as a blob when no writable is given', async () => {
  const v = path.join(tmp, 'v.webm'), a = path.join(tmp, 'a.webm'), out = path.join(tmp, 'webm2mp4.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-t', '3', '-c:v', 'libvpx-vp9', '-an', v);
  ff('-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:a', 'libopus', a);
  const { remuxToMp4 } = await import('./remux.mjs');
  const r = await remuxToMp4({ video: blob(v), audio: blob(a) });
  assert.ok(r.blob.size > 0 && r.blob.size === r.bytes);
  fs.writeFileSync(out, Buffer.from(await r.blob.arrayBuffer()));
  const s = JSON.parse(probe(out)).streams;
  assert.deepEqual(s.map((x) => x.codec_name).sort(), ['opus', 'vp9']);
});
test('remux: non-media input rejects instead of writing a broken file', async () => {
  const { remuxToMp4 } = await import('./remux.mjs');
  await assert.rejects(remuxToMp4({ video: [new Blob(['not a video'])], writable: sink(path.join(tmp, 'bad.mp4')) }));
});

// --- all files parse
test('all scripts pass node --check', () => {
  for (const f of fs.readdirSync('.').filter((x) => x.endsWith('.js') && x !== 'test.js')) cp.execFileSync('node', ['--check', f]);
});

(async () => {
  let bad = 0;
  for (const [n, fn] of tests) {
    try { await fn(); console.log('ok  ', n); } catch (e) { bad++; console.log('FAIL', n, '\n    ', e.message); }
  }
  process.exit(bad ? 1 : 0);
})();
