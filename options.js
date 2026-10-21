import { PROVIDERS, loadSettings, saveSettings, modelFor, checkLocalServer } from './transcribe.js';

const $ = (id) => document.getElementById(id);

const NOTES = {
  browser: 'ถอดเสียงใน Chrome ด้วยการ์ดจอ (WebGPU) — ไม่ต้องใช้ API Key หรือติดตั้งอะไรเพิ่ม ครั้งแรกจะดาวน์โหลดโมเดลจาก Hugging Face แล้วเก็บไว้ใช้ครั้งต่อไป',
  local: 'ส่งเสียงไปถอดที่โปรแกรม Whisper บนเครื่องนี้ — แม่นที่สุดและเร็วมากถ้ามีการ์ดจอ NVIDIA ต้องเปิด local-server\\start.bat ค้างไว้ (ดู README)',
  groq: 'ส่งเสียงไปถอดบนคลาวด์ของ Groq — สร้าง API Key ฟรีได้ที่ console.groq.com/keys (จำกัดไฟล์ 25 MB)',
  openai: 'ส่งเสียงไปถอดบนคลาวด์ของ OpenAI — สร้าง API Key ที่ platform.openai.com/api-keys (จำกัดไฟล์ 25 MB)',
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
    $('localStatus').textContent = '⏳ กำลังเชื่อมต่อ...';
    try {
      const info = await checkLocalServer($('localUrl').value.trim());
      $('localStatus').textContent = `✅ เชื่อมต่อได้ — device: ${info.device ?? '?'}`;
    } catch (e) {
      $('localStatus').textContent = `❌ เชื่อมต่อไม่ได้ (${e.message}) — เปิด local-server\\start.bat แล้วหรือยัง?`;
    }
  };

  $('save').onclick = async () => {
    captureFields(shown);
    settings.provider = shown;
    settings.language = $('language').value;
    await saveSettings(settings);
    $('saved').textContent = '✅ บันทึกแล้ว';
    setTimeout(() => ($('saved').textContent = ''), 2000);
  };
}

init();
