// Offscreen document: owns the MediaStream + MediaRecorder.
import { saveRecording } from './db.js';

// 32 kbps Opus is plenty for speech and keeps ~100 minutes under the 25 MB API limit.
const BITRATE = 32000;

let recorder = null;
let stream = null;
let audioCtx = null;
let chunks = [];
let meta = null;
let startedAt = 0;
let stopResolver = null;

async function start(streamId, recMeta) {
  if (recorder) throw new Error('กำลังอัดเสียงอยู่แล้ว');

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });

  // Capturing a tab mutes it for the user; route the audio back to the speakers.
  audioCtx = new AudioContext();
  audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);

  chunks = [];
  meta = recMeta;
  startedAt = Date.now();
  recorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: BITRATE,
  });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = finish;
  // Stream ends if the tab navigates away from capture or is closed.
  stream.getAudioTracks()[0].onended = () => recorder?.state === 'recording' && recorder.stop();
  recorder.start(1000);
}

async function finish() {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const rec = {
    id: crypto.randomUUID(),
    title: meta?.title || 'Untitled',
    url: meta?.url || '',
    createdAt: startedAt,
    duration: (Date.now() - startedAt) / 1000,
    size: blob.size,
    mimeType: blob.type,
    blob,
    transcript: null,
  };
  let result;
  try {
    await saveRecording(rec);
    result = { ok: true, id: rec.id };
  } catch (e) {
    result = { ok: false, error: e.message };
  }

  stream?.getTracks().forEach((t) => t.stop());
  await audioCtx?.close();
  recorder = stream = audioCtx = null;
  chunks = [];

  if (stopResolver) {
    stopResolver(result);
    stopResolver = null;
  } else {
    chrome.runtime.sendMessage({ target: 'background', type: 'recorder-ended', id: rec.id });
  }
}

function stop() {
  return new Promise((resolve) => {
    if (!recorder) return resolve({ ok: false, error: 'ไม่ได้อัดเสียงอยู่' });
    stopResolver = resolve;
    recorder.stop();
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    start(msg.streamId, msg.meta)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
  } else if (msg.type === 'stop') {
    stop().then(sendResponse);
  }
  return true;
});
