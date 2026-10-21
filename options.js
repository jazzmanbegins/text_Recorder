import { PROVIDERS, loadSettings, saveSettings, modelFor, checkLocalServer } from './transcribe.js';

// Embedded in the popup's <iframe>: the host page already shows a "Settings" heading, so
// drop this page's own copy (CSP blocks inline <script> in <head>, so this runs here instead).
if (window.self !== window.top) document.documentElement.classList.add('embedded');

const $ = (id) => document.getElementById(id);

const NOTES = {
  browser: 'Transcribes in Chrome using your GPU (WebGPU) — no API key or install needed. The model downloads from Hugging Face the first time and is cached after that.',
  local: 'Sends audio to a local Whisper server on this machine — most accurate, and very fast with an NVIDIA GPU. Keep local-server\\start.bat running (see README).',
  groq: "Sends audio to Groq's cloud for transcription — get a free API key at console.groq.com/keys (25 MB file limit).",
  openai: "Sends audio to OpenAI's cloud for transcription — get an API key at platform.openai.com/api-keys (25 MB file limit).",
};

let settings;

// Keep unsaved edits when the user switches provider back and forth.
function captureFields(provider) {
  if (PROVIDERS[provider].needsKey) settings.apiKeys[provider] = $('apiKey').value.trim();
  settings.models[provider] = $('model').value;
  settings.localUrl = $('localUrl').value.trim() || settings.localUrl;
}

function showProvider() {
  const p = $('provider').value;
  const info = PROVIDERS[p];
  $('providerNote').textContent = NOTES[p];
  $('keyRow').hidden = !info.needsKey;
  $('localRow').hidden = p !== 'local';
  $('apiKey').value = settings.apiKeys[p] || '';

  const current = modelFor(settings, p);
  $('model').innerHTML = '';
  for (const m of info.models) $('model').add(new Option(m.label || m.id, m.id, false, m.id === current));
}

async function init() {
  settings = await loadSettings();
  for (const [id, p] of Object.entries(PROVIDERS)) $('provider').add(new Option(p.label, id));
  $('provider').value = settings.provider;
  $('language').value = settings.language;
  $('localUrl').value = settings.localUrl;
  showProvider();

  let shown = settings.provider;
  $('provider').onchange = () => {
    captureFields(shown);
    shown = $('provider').value;
    showProvider();
  };

  $('testLocal').onclick = async () => {
    $('localStatus').textContent = 'Connecting...';
    try {
      const info = await checkLocalServer($('localUrl').value.trim());
      $('localStatus').textContent = `Connected — device: ${info.device ?? '?'}`;
    } catch (e) {
      $('localStatus').textContent = `Could not connect (${e.message}) — have you started local-server\\start.bat?`;
    }
  };

  $('save').onclick = async () => {
    captureFields(shown);
    settings.provider = shown;
    settings.language = $('language').value;
    await saveSettings(settings);
    $('saved').textContent = 'Saved';
    setTimeout(() => ($('saved').textContent = ''), 2000);
  };
}

init();
