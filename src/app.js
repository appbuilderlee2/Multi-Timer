import './styles.css';

const STORAGE_KEY = 'swimtimer-independent-v2';
const names = ['Anna', 'Ben', 'Chloe', 'David', 'Eva', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
const makeTimer = (name) => ({ id: crypto.randomUUID(), name, status: 'idle', elapsed: 0, startedAt: null, laps: [] });
const defaultState = { timers: names.map(makeTimer), view: 'grid', settings: { vibration: true, keepAwake: true } };

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.timers?.length ? saved : structuredClone(defaultState);
  } catch { return structuredClone(defaultState); }
}

let state = loadState();
let frame = 0;
let wakeLock = null;
const app = document.querySelector('#app');

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const currentElapsed = (timer, now = Date.now()) => timer.elapsed + (timer.status === 'running' ? now - timer.startedAt : 0);
const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function formatTime(milliseconds) {
  const centisecondsTotal = Math.max(0, Math.floor(milliseconds / 10));
  const centiseconds = centisecondsTotal % 100;
  const secondsTotal = Math.floor(centisecondsTotal / 100);
  const seconds = secondsTotal % 60;
  const minutes = Math.floor(secondsTotal / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

const settingsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.5 6A7 7 0 0 0 9 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A7 7 0 0 0 10.5 18l.3 2.6h4L15 18a7 7 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>`;

function render() {
  app.innerHTML = `<main class="app-shell">
    <header class="topbar">
      <div><h1>Swim<span>Timer</span></h1><p>Independent timers</p></div>
      <div class="header-actions">
        <div class="view-toggle" role="group" aria-label="Timer layout">
          <button data-view="grid" class="${state.view === 'grid' ? 'active' : ''}">Grid</button>
          <button data-view="list" class="${state.view === 'list' ? 'active' : ''}">List</button>
        </div>
        <button class="settings-button" id="settings" aria-label="Manage timers and settings">${settingsIcon}</button>
      </div>
    </header>
    <section class="timer-grid ${state.view}" aria-label="Independent swimmer timers">
      ${state.timers.map((timer, index) => timerCard(timer, index)).join('')}
    </section>
    <footer class="global-rail">
      <button class="all-start" id="all-start">ALL START</button>
      <button class="all-stop" id="all-stop">ALL STOP</button>
      <button class="all-reset" id="all-reset">ALL RESET</button>
    </footer>
    <dialog id="dialog"></dialog>
  </main>`;

  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view; save(); render();
  }));
  document.querySelectorAll('[data-name]').forEach((button) => button.addEventListener('click', () => editName(button.dataset.name)));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => timerAction(button.dataset.id, button.dataset.action)));
  document.querySelector('#all-start').addEventListener('click', startAll);
  document.querySelector('#all-stop').addEventListener('click', stopAll);
  document.querySelector('#all-reset').addEventListener('click', confirmResetAll);
  document.querySelector('#settings').addEventListener('click', showSettings);
  startClockLoop();
}

function timerCard(timer, index) {
  const latest = timer.laps.at(-1);
  const running = timer.status === 'running';
  const hasTime = currentElapsed(timer) > 0;
  return `<article class="timer-card ${running ? 'running' : ''}" data-card="${timer.id}">
    <div class="card-head"><span class="lane-number">${index + 1}</span><button class="timer-name" data-name="${timer.id}" aria-label="Edit ${esc(timer.name)}">${esc(timer.name)}</button><span class="status-dot" aria-label="${running ? 'Running' : timer.status === 'paused' ? 'Stopped' : 'Idle'}"></span></div>
    <div class="elapsed" data-clock="${timer.id}">${formatTime(currentElapsed(timer))}</div>
    <div class="timer-meta"><span><small>Latest</small><b>${latest ? formatTime(latest.split) : '00:00.00'}</b></span><span><small>Laps</small><b>${timer.laps.length}</b></span></div>
    <div class="card-actions">
      <button class="${running ? 'stop-button' : 'start-button'}" data-action="${running ? 'stop' : 'start'}" data-id="${timer.id}">${running ? 'STOP' : 'START'}</button>
      <button class="${running ? 'lap-button' : 'reset-button'}" data-action="${running ? 'lap' : 'reset'}" data-id="${timer.id}" ${!running && !hasTime ? 'disabled' : ''}>${running ? 'LAP' : 'RESET'}</button>
    </div>
  </article>`;
}

function startClockLoop() {
  cancelAnimationFrame(frame);
  const update = () => {
    const now = Date.now();
    let active = false;
    for (const timer of state.timers) {
      if (timer.status !== 'running') continue;
      active = true;
      const clock = document.querySelector(`[data-clock="${timer.id}"]`);
      if (clock) clock.textContent = formatTime(currentElapsed(timer, now));
    }
    if (active) frame = requestAnimationFrame(update);
  };
  update();
}

function timerAction(id, action) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer) return;
  if (action === 'start') {
    timer.startedAt = Date.now(); timer.status = 'running'; requestWakeLock();
  }
  if (action === 'stop' && timer.status === 'running') {
    timer.elapsed = currentElapsed(timer); timer.startedAt = null; timer.status = 'paused';
  }
  if (action === 'lap' && timer.status === 'running') {
    const at = currentElapsed(timer);
    timer.laps.push({ at, split: at - (timer.laps.at(-1)?.at || 0) });
    if (state.settings.vibration && navigator.vibrate) navigator.vibrate(35);
  }
  if (action === 'reset') {
    resetTimer(timer);
    if (!state.timers.some((item) => item.status === 'running')) releaseWakeLock();
    save(); render(); return;
  }
  if (!state.timers.some((item) => item.status === 'running')) releaseWakeLock();
  save(); render();
}

function startAll() {
  const now = Date.now();
  state.timers.forEach((timer) => { if (timer.status !== 'running') { timer.startedAt = now; timer.status = 'running'; } });
  requestWakeLock(); save(); render();
}

function stopAll() {
  const now = Date.now();
  state.timers.forEach((timer) => {
    if (timer.status === 'running') { timer.elapsed = currentElapsed(timer, now); timer.startedAt = null; timer.status = 'paused'; }
  });
  releaseWakeLock(); save(); render();
}

function resetTimer(timer) {
  Object.assign(timer, { status: 'idle', elapsed: 0, startedAt: null, laps: [] });
}

function confirmResetAll() {
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>Reset all timers?</h2><p>This removes every current time and all recorded laps.</p><div class="dialog-actions"><button class="dialog-secondary" data-close>Cancel</button><button class="dialog-danger" id="confirm-reset">Reset</button></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('#confirm-reset').addEventListener('click', () => {
    state.timers.forEach(resetTimer);
    if (!state.timers.some((item) => item.status === 'running')) releaseWakeLock();
    save(); dialog.close(); render();
  });
}

function editName(id) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<form><h2>Swimmer name</h2><label class="sr-only" for="name-input">Swimmer name</label><input id="name-input" class="text-input" maxlength="24" value="${esc(timer.name)}"><div class="dialog-actions"><button type="button" class="dialog-secondary" data-close>Cancel</button><button class="dialog-primary">Save</button></div></form>`;
  dialog.showModal();
  const input = dialog.querySelector('input'); input.select();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault(); const value = input.value.trim();
    if (value) { timer.name = value; save(); dialog.close(); render(); }
  });
}

function showSettings() {
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>Manage timers</h2>
    <div class="manage-count"><button id="remove-timer" aria-label="Remove last timer">−</button><strong>${state.timers.length} swimmers</strong><button id="add-timer" aria-label="Add timer">＋</button></div>
    <div class="setting-row"><span>Vibrate on lap</span><button class="switch ${state.settings.vibration ? 'on' : ''}" data-setting="vibration" aria-label="Toggle vibration"></button></div>
    <div class="setting-row"><span>Keep screen awake</span><button class="switch ${state.settings.keepAwake ? 'on' : ''}" data-setting="keepAwake" aria-label="Toggle screen wake lock"></button></div>
    <p class="settings-tip">Tap any swimmer name on the main screen to edit it.</p>
    <div class="dialog-actions"><button class="dialog-secondary" data-close>Done</button></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('#add-timer').addEventListener('click', () => {
    if (state.timers.length >= 30) return;
    state.timers.push(makeTimer(`Swimmer ${state.timers.length + 1}`)); save(); showSettings();
  });
  dialog.querySelector('#remove-timer').addEventListener('click', () => {
    if (state.timers.length <= 1) return;
    state.timers.pop();
    if (!state.timers.some((timer) => timer.status === 'running')) releaseWakeLock();
    save(); showSettings();
  });
  dialog.querySelectorAll('[data-setting]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.setting; state.settings[key] = !state.settings[key]; save(); showSettings();
  }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

async function requestWakeLock() {
  if (!state.settings.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* unavailable */ }
}
async function releaseWakeLock() { try { await wakeLock?.release(); } catch { /* already released */ } wakeLock = null; }

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.timers.some((timer) => timer.status === 'running')) requestWakeLock(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));

render();
