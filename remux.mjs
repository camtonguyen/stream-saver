// Merge downloaded media into ONE MP4 without re-encoding. Streams to `writable` (e.g. a FileSystemWritableFileStream).
import { Input, Output, Conversion, Mp4OutputFormat, StreamTarget, BufferTarget, BlobSource, ALL_FORMATS } from './vendor/mediabunny.min.mjs';

const input = (parts) => new Input({ source: new BlobSource(new Blob([].concat(parts))), formats: ALL_FORMATS });

// video: Blob | Uint8Array | array of them (e.g. HLS segments in order). audio: optional separate track, same types.
export async function remuxToMp4({ video, audio, writable, onProgress }) {
  // No `writable` → build in memory and return { blob } (fine for already-in-memory captures).
  let bytes = 0; const w = writable && writable.getWriter(); // file size = furthest byte written (the MP4 header is patched in place)
  const counted = w && new WritableStream({ write: (c) => (bytes = Math.max(bytes, c.position + c.data.byteLength), w.write(c)), close: () => w.close(), abort: (e) => w.abort(e) });
  const output = new Output({ format: new Mp4OutputFormat(), target: counted ? new StreamTarget(counted) : new BufferTarget() });
  try {
  const jobs = [await Conversion.init({ input: input(video), output, ...(audio && { audio: { discard: true } }), composable: !!audio })];
  if (audio) jobs.push(await Conversion.init({ input: input(audio), output, video: { discard: true }, composable: true }));
  await output.start();
  await Promise.all(jobs.map((j) => j.execute()));
  await output.finalize();
  if (w) return { bytes };
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  return { bytes: blob.size, blob };
  } catch (e) { if (w) await w.abort(e).catch(() => {}); throw e; }
}
