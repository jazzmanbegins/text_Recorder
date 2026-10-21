// Speech-to-text. Four backends:
//  - browser: Whisper running inside Chrome (transformers.js) — no API, no server
//  - local:   OpenAI-compatible Whisper server on this PC (local-server/)
//  - openai / groq: cloud APIs
import { transcribeInBrowser } from './local-whisper.js';

export const PROVIDERS = {
  browser: {
    label: 'ในเบราว์เซอร์ (ไม่ต้องใช้ API)',
    models: [
      { id: 'onnx-community/whisper-large-v3-turbo', label: 'large-v3-turbo — แม่นสุด (~1.6 GB, ควรมีการ์ดจอ)' },
      { id: 'onnx-community/whisper-small', label: 'small — สมดุล (~410 MB)' },
      { id: 'onnx-community/whisper-base', label: 'base — เร็ว/เล็ก (~165 MB, ภาษาไทยไม่ค่อยแม่น)' },
    ],
    needsKey: false,
  },
  local: {
    label: 'Local Server (Whisper บนเครื่อง)',
    models: [
      { id: 'large-v3', label: 'large-v3 — แม่นสุด (ต้องใช้ GPU)' },
      { id: 'large-v3-turbo', label: 'large-v3-turbo — เร็วกว่า แม่นใกล้เคียง' },
      { id: 'medium', label: 'medium' },
      { id: 'small', label: 'small' },
    ],
    needsKey: false,
  },
  groq: {
    label: 'Groq API (มี free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [{ id: 'whisper-large-v3' }, { id: 'whisper-large-v3-turbo' }],
    needsKey: true,
  },
  openai: {
    label: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'whisper-1' }, { id: 'gpt-4o-transcribe' }, { id: 'gpt-4o-mini-transcribe' }],
    needsKey: true,
  },
};

export const DEFAULT_SETTINGS = {
  provider: 'browser',
  apiKeys: { openai: '', groq: '' },
  models: {},
  localUrl: 'http://127.0.0.1:8765/v1',
  language: '', // auto-detect; forcing the wrong language makes Whisper translate badly
};

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...settings?.apiKeys },
    models: { ...settings?.models },
  };
}

export function saveSettings(settings) {
  return chrome.storage.local.set({ settings });
}

export function modelFor(settings, provider = settings.provider) {
  const ids = PROVIDERS[provider].models.map((m) => m.id);
  const chosen = settings.models[provider];
  return ids.includes(chosen) ? chosen : ids[0];
}

/**
 * @param {(p: object) => void} [onProgress]
 * @returns {Promise<{text: string, segments: {start:number,end:number,text:string}[] | null}>}
 */
export async function transcribe(blob, settings, onProgress) {
  const model = modelFor(settings);
  if (settings.provider === 'browser') {
    return transcribeInBrowser(blob, { model, language: settings.language }, onProgress);
  }
  return transcribeHttp(blob, settings, model);
}

async function transcribeHttp(blob, settings, model) {
  const { provider } = settings;
  const info = PROVIDERS[provider];
  const baseUrl = provider === 'local' ? settings.localUrl.replace(/\/+$/, '') : info.baseUrl;
  const apiKey = settings.apiKeys[provider];

  if (info.needsKey && !apiKey) throw new Error(`ยังไม่ได้ใส่ API Key ของ ${info.label} (ไปที่หน้าตั้งค่า)`);
  if (provider !== 'local' && blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกิน 25 MB (${(blob.size / 1048576).toFixed(1)} MB) — ใช้โหมดในเบราว์เซอร์หรือ Local Server แทน`);
  }

  // gpt-4o-* models don't return timestamped segments (needed for .srt).
  const segmentsSupported = provider === 'local' || model.startsWith('whisper');
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  form.append('model', model);
  if (settings.language) form.append('language', settings.language);
  form.append('response_format', segmentsSupported ? 'verbose_json' : 'json');

  let res;
  try {
    res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: form,
    });
  } catch (e) {
    if (provider === 'local') throw new Error(`เชื่อมต่อ Local Server ไม่ได้ (${baseUrl}) — เปิด local-server\\start.bat แล้วหรือยัง?`);
    throw e;
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.error?.message || j.detail || detail; } catch {}
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  return {
    text: (data.text || '').trim(),
    segments: data.segments?.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })) || null,
  };
}

/** Ping the local server. Returns its info or throws. */
export async function checkLocalServer(localUrl) {
  const res = await fetch(`${localUrl.replace(/\/+$/, '')}/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(segments) {
  return segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n');
}
