import { listRecordings, deleteRecording, updateRecording, getRecording } from './db.js';
import { loadSettings, transcribe, toSrt } from './transcribe.js';

// Embedded in the popup's <iframe>: the host page already shows a heading and a settings
// link, so drop this page's own copies (inline <script> in <head> would do this earlier, but
// the extension's CSP — script-src 'self' — blocks inline scripts, so it has to happen here).
if (window.self !== window.top) document.documentElement.classList.add('embedded');

const list = document.getElementById('list');
const tpl = document.getElementById('item');
const objectUrls = [];

function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
    case 'decode': return 'Preparing audio...';
    case 'download': return `Downloading model ${Math.round((p.loaded / p.total) * 100)}% (${(p.total / 1e6).toFixed(0)} MB — one-time download)`;
    case 'ready': return `Transcribing with ${p.device === 'webgpu' ? 'GPU (WebGPU)' : 'CPU (slower — WebGPU not available in Chrome yet, see README)'}...`;
    case 'transcribe': return `Transcribed ${p.done}/${p.total} chunks (${Math.round((p.done / p.total) * 100)}%)`;
    default: return 'Transcribing...';
  }
}

function showTranscript(el, transcript) {
  el.querySelector('.transcript').hidden = !transcript;
  if (!transcript) return;
  el.querySelector('.transcript > textarea').value = transcript.text;
  el.querySelector('[data-act="download-srt"]').hidden = !transcript.segments?.length;
  el.querySelector('[data-act="transcribe"]').textContent = 'Re-transcribe';
}

function renderItem(rec) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.id = rec.id;
  el.querySelector('.title').textContent = rec.title;
  el.querySelector('.meta').textContent =
    `${new Date(rec.createdAt).toLocaleString('en-US')} · ${fmtDuration(rec.duration)} · ${(rec.size / 1048576).toFixed(2)} MB`;

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
      if (!confirm('Delete this recording?')) return;
      await deleteRecording(rec.id);
      el.remove();
      if (!list.children.length) document.getElementById('empty').hidden = false;
    } else if (act === 'download-audio') {
      download(rec.blob, `${base}.webm`);
    } else if (act === 'transcribe') {
      e.target.disabled = true;
      status.textContent = 'Transcribing... (this may take a moment)';
      try {
        const transcript = await transcribe(rec.blob, await loadSettings(), (p) => {
          status.textContent = progressText(p);
          if (p.partialText) {
            el.querySelector('.transcript').hidden = false;
            el.querySelector('.transcript > textarea').value = p.partialText;
          }
        });
        await updateRecording(rec.id, { transcript });
        rec.transcript = transcript;
        showTranscript(el, transcript);
        status.textContent = 'Done';
      } catch (err) {
        status.textContent = '';
        error.textContent = err.message;
      } finally {
        e.target.disabled = false;
      }
    } else if (act === 'copy') {
      await navigator.clipboard.writeText(rec.transcript.text);
      status.textContent = 'Copied';
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
    // New recordings sort to the top already — scroll there (not 'center', which in the
    // popup's short iframe tends to crop the card's own top instead of showing it in full).
    el.scrollIntoView({ block: 'start' });
  }
}

render();
