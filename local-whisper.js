// Page-side wrapper around local-whisper-worker.js: decodes audio and talks to the worker.

let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./local-whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === 'progress') job.onProgress(data);
    else {
      pending.delete(data.id);
      data.type === 'result' ? job.resolve(data.result) : job.reject(new Error(data.error));
    }
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'Worker error'));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Decode any browser-playable audio to 16 kHz mono Float32 (Whisper's input format). */
async function decodeTo16kMono(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    // Copy so the buffer can be transferred to the worker.
    if (buf.numberOfChannels === 1) return new Float32Array(buf.getChannelData(0));
    const out = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < data.length; i++) out[i] += data[i] / buf.numberOfChannels;
    }
    return out;
  } finally {
    ctx.close();
  }
}

export async function transcribeInBrowser(blob, { model, language }, onProgress = () => {}) {
  onProgress({ stage: 'decode' });
  const audio = await decodeTo16kMono(blob);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, audio, model, language }, [audio.buffer]);
  });
}
