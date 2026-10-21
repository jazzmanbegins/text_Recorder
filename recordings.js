import { listRecordings, deleteRecording, updateRecording, getRecording } from './db.js';
import { loadSettings, transcribe, toSrt } from './transcribe.js';

const list = document.getElementById('list');
const tpl = document.getElementById('item');
const objectUrls = [];

function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')} นาที`;
}

function safeName(title) {
  return (title || 'recording').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80).trim();
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: true }, () => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

function progressText(p) {
  switch (p.stage) {
    case 'decode': return '⏳ กำลังเตรียมไฟล์เสียง...';
    case 'download': return `⬇️ กำลังโหลดโมเดล ${Math.round((p.loaded / p.total) * 100)}% (${(p.total / 1e6).toFixed(0)} MB — โหลดครั้งแรกครั้งเดียว)`;
    case 'ready': return `⏳ กำลังถอดเสียงด้วย ${p.device === 'webgpu' ? 'การ์ดจอ (WebGPU)' : 'CPU (ช้ากว่า — Chrome ยังใช้การ์ดจอไม่ได้ ดูวิธีเปิดใน README)'}...`;
    case 'transcribe': return `⏳ ถอดเสียงแล้ว ${p.done}/${p.total} ช่วง (${Math.round((p.done / p.total) * 100)}%)`;
    default: return '⏳ กำลังถอดเสียง...';
  }
}

function showTranscript(el, transcript) {
  el.querySelector('.transcript').hidden = !transcript;
  if (!transcript) return;
  el.querySelector('textarea').value = transcript.text;
  el.querySelector('[data-act="download-srt"]').hidden = !transcript.segments?.length;
  el.querySelector('[data-act="transcribe"]').textContent = '🔁 ถอดใหม่';
}

function renderItem(rec) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.id = rec.id;
  el.querySelector('.title').textContent = rec.title;
  el.querySelector('.meta').textContent =
    `${new Date(rec.createdAt).toLocaleString('th-TH')} · ${fmtDuration(rec.duration)} · ${(rec.size / 1048576).toFixed(2)} MB`;

  const url = URL.createObjectURL(rec.blob);
  objectUrls.push(url);
  el.querySelector('audio').src = url;
  showTranscript(el, rec.transcript);

  const status = el.querySelector('.status');
  const error = el.querySelector('.error');
  const base = safeName(rec.title);

  el.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    error.textContent = '';

    if (act === 'delete') {
      if (!confirm('ลบไฟล์นี้?')) return;
      await deleteRecording(rec.id);
      el.remove();
      if (!list.children.length) document.getElementById('empty').hidden = false;
    } else if (act === 'download-audio') {
      download(rec.blob, `${base}.webm`);
    } else if (act === 'transcribe') {
      e.target.disabled = true;
      status.textContent = '⏳ กำลังถอดเสียง... (อาจใช้เวลาสักครู่)';
      try {
        const transcript = await transcribe(rec.blob, await loadSettings(), (p) => {
          status.textContent = progressText(p);
          if (p.partialText) {
            el.querySelector('.transcript').hidden = false;
            el.querySelector('textarea').value = p.partialText;
          }
        });
        await updateRecording(rec.id, { transcript });
        rec.transcript = transcript;
        showTranscript(el, transcript);
        status.textContent = '✅ เสร็จแล้ว';
      } catch (err) {
        status.textContent = '';
        error.textContent = err.message;
      } finally {
        e.target.disabled = false;
      }
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(rec.transcript.text);
      status.textContent = '📋 คัดลอกแล้ว';
    } else if (act === 'download-txt') {
      download(new Blob([rec.transcript.text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
    } else if (act === 'download-srt') {
      download(new Blob([toSrt(rec.transcript.segments)], { type: 'text/plain;charset=utf-8' }), `${base}.srt`);
    }
  });
  return el;
}

async function render() {
  objectUrls.splice(0).forEach(URL.revokeObjectURL);
  const recs = await listRecordings();
  list.replaceChildren(...recs.map(renderItem));
  document.getElementById('empty').hidden = recs.length > 0;

  const focusId = location.hash.slice(1);
  if (focusId && (await getRecording(focusId))) {
    const el = document.getElementById(focusId);
    el.classList.add('highlight');
    el.scrollIntoView({ block: 'center' });
  }
}

render();
