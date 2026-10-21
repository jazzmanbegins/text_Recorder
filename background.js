// Service worker: coordinates tab capture and the offscreen recorder document.

const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'บันทึกเสียงจากแท็บด้วย MediaRecorder',
  });
}

async function getState() {
  const { recState } = await chrome.storage.session.get('recState');
  return recState || { recording: false };
}

async function setState(state) {
  await chrome.storage.session.set({ recState: state });
  await chrome.action.setBadgeText({ text: state.recording ? 'REC' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

async function startRecording(tabId) {
  const state = await getState();
  if (state.recording) throw new Error('กำลังอัดเสียงอยู่แล้ว');

  const tab = await chrome.tabs.get(tabId);
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    if (/active stream/i.test(e.message)) {
      throw new Error('แท็บนี้กำลังถูกอัดหรือแชร์อยู่แล้ว (อาจเป็น extension อื่น) — ปิดตัวนั้นหรือรีโหลดแท็บแล้วลองใหม่');
    }
    if (/chrome pages|cannot be captured|webstore/i.test(e.message)) {
      throw new Error('อัดเสียงหน้านี้ไม่ได้ — ใช้ได้กับหน้าเว็บทั่วไปเท่านั้น (ไม่ใช่ chrome:// หรือ Chrome Web Store)');
    }
    throw e;
  }

  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId,
    meta: { title: tab.title || 'Untitled', url: tab.url || '' },
  });
  if (!res?.ok) throw new Error(res?.error || 'เริ่มอัดเสียงไม่สำเร็จ');

  await setState({ recording: true, tabId, startedAt: Date.now(), title: tab.title });
}

async function stopRecording() {
  const state = await getState();
  if (!state.recording) return null;
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
  await setState({ recording: false });
  if (!res?.ok) throw new Error(res?.error || 'หยุดอัดเสียงไม่สำเร็จ');
  return res.id;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'background') return;
  (async () => {
    try {
      if (msg.type === 'start') {
        await startRecording(msg.tabId);
        sendResponse({ ok: true });
      } else if (msg.type === 'stop') {
        const id = await stopRecording();
        sendResponse({ ok: true, id });
      } else if (msg.type === 'state') {
        sendResponse({ ok: true, state: await getState() });
      } else if (msg.type === 'recorder-ended') {
        // Tab closed or stream ended unexpectedly; recording was saved by offscreen.
        await setState({ recording: false });
        sendResponse({ ok: true });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// If the captured tab is closed, stop and save.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.recording && state.tabId === tabId) {
    try { await stopRecording(); } catch { await setState({ recording: false }); }
  }
});
