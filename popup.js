const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ target: 'background', type, ...extra });

let timerHandle = null;

function fmt(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60);
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

function render(state) {
  clearInterval(timerHandle);
  const btn = $('toggle');
  if (state.recording) {
    btn.textContent = 'Stop & Save';
    btn.className = 'rec';
    $('tabTitle').textContent = `Recording: ${state.title || ''}`;
    const tick = () => ($('timer').textContent = fmt((Date.now() - state.startedAt) / 1000));
    tick();
    timerHandle = setInterval(tick, 500);
  } else {
    btn.textContent = 'Record';
    btn.className = 'primary';
    $('timer').textContent = '00:00';
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { state } = await send('state');
  if (!state.recording) $('tabTitle').textContent = tab?.title || '';
  render(state);
  $('recordingsFrame').src = 'recordings.html';

  $('toggle').onclick = async () => {
    const btn = $('toggle');
    btn.disabled = true;
    $('status').textContent = '';
    try {
      const { state } = await send('state');
      if (state.recording) {
        const res = await send('stop');
        if (!res.ok) throw new Error(res.error);
        $('status').textContent = 'Saved';
        render({ recording: false });
        $('recordingsFrame').src = `recordings.html#${res.id}`;
      } else {
        const res = await send('start', { tabId: tab.id });
        if (!res.ok) throw new Error(res.error);
        render((await send('state')).state);
        $('status').textContent = 'You can play the video now — closing the popup is fine, recording continues.';
      }
    } catch (e) {
      $('status').innerHTML = '';
      const err = document.createElement('div');
      err.className = 'error';
      err.textContent = e.message;
      $('status').append(err);
    } finally {
      btn.disabled = false;
    }
  };

  $('openOptions').onclick = (e) => {
    e.preventDefault();
    $('settingsFrame').src = 'options.html';
    $('settingsOverlay').hidden = false;
  };
  $('closeSettings').onclick = () => {
    $('settingsOverlay').hidden = true;
    $('settingsFrame').src = '';
  };
}

init();
