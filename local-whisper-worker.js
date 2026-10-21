// Web Worker: runs Whisper inside the browser with transformers.js (WebGPU, or WASM fallback).
import { pipeline, env } from './lib/transformers.min.js';

env.allowLocalModels = false;
// MV3 forbids remote code: load the ONNX runtime from the bundled copy, and skip the
// blob-URL wasm cache (blob: scripts are blocked by the extension CSP).
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('./lib/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  wasm: new URL('./lib/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
};
// Multi-threaded WASM needs cross-origin isolation, which we can't enable: COOP/COEP moves
// the offscreen document into another process and breaks tabCapture stream IDs.
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))
  : 1;

const SR = 16000;
const WINDOW = 30 * SR;      // Whisper's native context length
const SEARCH = 2 * SR;       // look back this far for a quiet spot to cut
const FRAME = SR / 10;
const SILENCE_RMS = 0.002;   // skip near-silent chunks (Whisper hallucinates on silence)

let asr = null;
let asrKey = '';

async function pickDevice() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { device: 'wasm' };
  return { device: 'webgpu', fp16: adapter.features.has('shader-f16') };
}

function dtypeFor(model, { device, fp16 }) {
  if (device === 'wasm') return { encoder_model: 'q8', decoder_model_merged: 'q8' };
  const bigModel = model.includes('large');
  return { encoder_model: fp16 ? 'fp16' : bigModel ? 'q4' : 'fp32', decoder_model_merged: 'q4' };
}

async function loadModel(model, post) {
  const dev = await pickDevice();
  const key = `${model}|${dev.device}`;
  if (asr && asrKey === key) return dev;
  await asr?.dispose?.();
  asr = null;

  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', model, {
    device: dev.device,
    dtype: dtypeFor(model, dev),
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: 'progress', stage: 'download', loaded, total });
    },
  });
  asrKey = key;
  return dev;
}

// Split into <=30 s windows, cutting at the quietest point near each boundary so words aren't chopped.
function cutPoints(audio) {
  const cuts = [0];
  let pos = 0;
  while (audio.length - pos > WINDOW) {
    const end = pos + WINDOW;
    let best = end, bestEnergy = Infinity;
    for (let f = end - SEARCH; f + FRAME <= end; f += FRAME / 2) {
      let e = 0;
      for (let i = f; i < f + FRAME; i++) e += audio[i] * audio[i];
      if (e < bestEnergy) { bestEnergy = e; best = f + FRAME / 2; }
    }
    pos = Math.floor(best);
    cuts.push(pos);
  }
  cuts.push(audio.length);
  return cuts;
}

function rms(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

async function run({ audio, model, language }, post) {
  const dev = await loadModel(model, post);
  post({ type: 'progress', stage: 'ready', device: dev.device });

  const cuts = cutPoints(audio);
  const total = cuts.length - 1;
  const segments = [];
  for (let i = 0; i < total; i++) {
    const chunk = audio.subarray(cuts[i], cuts[i + 1]);
    const offset = cuts[i] / SR;
    if (rms(chunk) >= SILENCE_RMS) {
      const out = await asr(chunk, {
        task: 'transcribe',
        return_timestamps: true,
        ...(language ? { language } : {}),
      });
      for (const c of out.chunks || [{ timestamp: [0, null], text: out.text }]) {
        const text = c.text.trim();
        if (!text) continue;
        segments.push({
          start: offset + (c.timestamp[0] ?? 0),
          end: offset + (c.timestamp[1] ?? chunk.length / SR),
          text,
        });
      }
    }
    post({ type: 'progress', stage: 'transcribe', done: i + 1, total, partialText: segments.map((s) => s.text).join(' ') });
  }
  return { text: segments.map((s) => s.text).join(' '), segments };
}

self.onmessage = async ({ data }) => {
  const post = (msg) => self.postMessage({ ...msg, id: data.id });
  try {
    post({ type: 'result', result: await run(data, post) });
  } catch (e) {
    post({ type: 'error', error: e?.message || String(e) });
  }
};
