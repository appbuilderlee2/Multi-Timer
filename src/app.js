import './styles.css';

const APP_VERSION = '2.5.0';
const STORAGE_KEY = 'swimtimer-independent-v2';
const names = ['Anna', 'Ben', 'Chloe', 'David', 'Eva', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
const makeTimer = (name) => ({ id: crypto.randomUUID(), name, status: 'idle', elapsed: 0, startedAt: null, laps: [], distance: 0 });
const defaultState = { timers: names.map(makeTimer), view: 'grid', settings: { vibration: true, keepAwake: true, poolLength: 20 }, sessions: [] };

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.timers?.length) return structuredClone(defaultState);
    return {
      ...structuredClone(defaultState),
      ...saved,
      settings: { ...defaultState.settings, ...saved.settings },
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    };
  } catch { return structuredClone(defaultState); }
}

let state = loadState();
let frame = 0;
let wakeLock = null;
const app = document.querySelector('#app');

const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const currentElapsed = (timer, now = Date.now()) => timer.elapsed + (timer.status === 'running' ? now - timer.startedAt : 0);
const poolLength = () => Math.max(1, Number(state.settings.poolLength) || 20);
const timerDistance = (timer) => Math.max(0, Number(timer.distance) || timer.laps.length * poolLength());
const savedTimerDistance = (timer, session) => Math.max(0, Number(timer.distance) || timer.laps.length * session.poolLength);
const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatSavedAt = (timestamp) => new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);

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
  document.querySelectorAll('[data-laps]').forEach((button) => button.addEventListener('click', () => showLaps(button.dataset.laps)));
  document.querySelectorAll('[data-distance]').forEach((button) => button.addEventListener('click', () => showDistanceInput(button.dataset.distance)));
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
  const hasResult = hasTime || timer.laps.length > 0 || timerDistance(timer) > 0;
  return `<article class="timer-card ${running ? 'running' : ''}" data-card="${timer.id}">
    <div class="card-head"><span class="lane-number">${index + 1}</span><button class="timer-name" data-name="${timer.id}" aria-label="Edit ${esc(timer.name)}">${esc(timer.name)}</button><span class="status-dot" aria-label="${running ? 'Running' : timer.status === 'paused' ? 'Stopped' : 'Idle'}"></span></div>
    <div class="elapsed" data-clock="${timer.id}">${formatTime(currentElapsed(timer))}</div>
    <div class="timer-meta"><span class="meta-block"><small>Latest</small><b>${latest ? formatTime(latest.split) : '00:00.00'}</b></span><button class="meta-block lap-summary" data-laps="${timer.id}" aria-label="View ${esc(timer.name)} lap times" ${timer.laps.length ? '' : 'disabled'}><small>Laps</small><b>${timer.laps.length}</b></button><button class="meta-block distance-summary" data-distance="${timer.id}" aria-label="Set ${esc(timer.name)} distance"><small>Distance</small><b>${timerDistance(timer)}m</b></button></div>
    <div class="card-actions">
      <button class="${running ? 'stop-button' : 'start-button'}" data-action="${running ? 'stop' : 'start'}" data-id="${timer.id}">${running ? 'STOP' : 'START'}</button>
      <button class="${running ? 'lap-button' : 'reset-button'}" data-action="${running ? 'lap' : 'reset'}" data-id="${timer.id}" ${!running && !hasResult ? 'disabled' : ''}>${running ? 'LAP' : 'RESET'}</button>
      <button class="save-button" data-action="save" data-id="${timer.id}" ${running || !hasResult ? 'disabled' : ''}>SAVE</button>
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
  if (action === 'save') { saveIndividualResult(timer); return; }
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
  Object.assign(timer, { status: 'idle', elapsed: 0, startedAt: null, laps: [], distance: 0 });
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

function showLaps(id) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer?.laps.length) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${esc(timer.name)} — Lap times</h2>
    <p class="dialog-subtitle">${poolLength()}m per lap · ${timer.laps.length * poolLength()}m total</p>
    <div class="lap-list" role="list">
      ${timer.laps.map((lap, index) => `<div class="lap-row" role="listitem"><strong>Lap ${index + 1}<small>${(index + 1) * poolLength()}m</small></strong><span><small>Lap time</small><b>${formatTime(lap.split)}</b></span><span><small>Total</small><b>${formatTime(lap.at)}</b></span></div>`).join('')}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" data-close>Done</button></div>`;
  dialog.showModal();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

function showDistanceInput(id) {
  const timer = state.timers.find((item) => item.id === id);
  if (!timer) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<form><h2>${esc(timer.name)} — Distance</h2><p>Enter the total distance completed. You do not need to press LAP during the swim.</p><label class="distance-entry"><span>Total distance</span><span><input id="distance-input" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${timerDistance(timer)}"><b>m</b></span></label><div class="dialog-actions"><button type="button" class="dialog-secondary" data-close>Cancel</button><button class="dialog-primary">Save distance</button></div></form>`;
  dialog.showModal();
  const input = dialog.querySelector('#distance-input'); input.select();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    timer.distance = Math.min(100000, Math.max(0, Math.round(Number(input.value) || 0)));
    save(); dialog.close(); render();
  });
}

function showSettings() {
  const dialog = document.querySelector('#dialog');
  const hasResults = state.timers.some((timer) => currentElapsed(timer) > 0 || timer.laps.length || timerDistance(timer) > 0);
  const students = getStudentRecords();
  dialog.innerHTML = `<h2>Manage timers</h2>
    <div class="manage-count"><button id="remove-timer" aria-label="Remove last timer">−</button><strong>${state.timers.length} swimmers</strong><button id="add-timer" aria-label="Add timer">＋</button></div>
    <div class="setting-row"><label for="pool-length">Pool length</label><span class="distance-input"><input id="pool-length" type="number" min="1" max="500" step="1" inputmode="numeric" value="${poolLength()}"><b>m</b></span></div>
    <div class="setting-row"><span>Vibrate on lap</span><button class="switch ${state.settings.vibration ? 'on' : ''}" data-setting="vibration" aria-label="Toggle vibration"></button></div>
    <div class="setting-row"><span>Keep screen awake</span><button class="switch ${state.settings.keepAwake ? 'on' : ''}" data-setting="keepAwake" aria-label="Toggle screen wake lock"></button></div>
    <div class="records-actions"><button class="save-records" id="save-session" ${hasResults ? '' : 'disabled'}>Save current session</button><button class="view-records" id="view-sessions">Saved sessions <b>${state.sessions.length}</b></button><button class="student-records" id="view-students">Student records <b>${students.length}</b></button></div>
    <p class="settings-tip">Tap any swimmer name on the main screen to edit it.</p>
    <p class="app-version">Version ${APP_VERSION}</p>
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
  dialog.querySelector('#pool-length').addEventListener('change', (event) => {
    state.settings.poolLength = Math.min(500, Math.max(1, Math.round(Number(event.target.value) || 20)));
    save(); render(); showSettings();
  });
  dialog.querySelector('#save-session').addEventListener('click', saveSession);
  dialog.querySelector('#view-sessions').addEventListener('click', showSavedSessions);
  dialog.querySelector('#view-students').addEventListener('click', showStudentRecords);
  dialog.querySelectorAll('[data-setting]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.setting; state.settings[key] = !state.settings[key]; save(); showSettings();
  }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

function saveSession() {
  const now = Date.now();
  const timers = state.timers
    .map((timer) => ({ name: timer.name, elapsed: currentElapsed(timer, now), distance: timerDistance(timer), laps: timer.laps.map((lap) => ({ ...lap })) }))
    .filter((timer) => timer.elapsed > 0 || timer.laps.length || timer.distance > 0);
  if (!timers.length) return;
  state.sessions.unshift({ id: crypto.randomUUID(), savedAt: now, poolLength: poolLength(), timers });
  state.sessions = state.sessions.slice(0, 100);
  save();
  showSavedSessions();
}

function saveIndividualResult(timer) {
  const now = Date.now();
  const result = { name: timer.name, elapsed: currentElapsed(timer, now), distance: timerDistance(timer), laps: timer.laps.map((lap) => ({ ...lap })) };
  if (result.elapsed <= 0 && result.distance <= 0 && !result.laps.length) return;
  state.sessions.unshift({ id: crypto.randomUUID(), savedAt: now, poolLength: poolLength(), individual: true, timers: [result] });
  state.sessions = state.sessions.slice(0, 100);
  save();
  const dialog = document.querySelector('#dialog');
  const studentKey = String(timer.name || 'Unnamed').trim().toLocaleLowerCase();
  dialog.innerHTML = `<h2>${esc(timer.name)} saved</h2><p>${formatTime(result.elapsed)} · ${result.distance}m · ${result.laps.length} laps</p><div class="dialog-actions"><button class="dialog-secondary" data-close>Done</button><button class="dialog-primary" id="view-saved-student">View record</button></div>`;
  dialog.showModal();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('#view-saved-student').addEventListener('click', () => showStudentHistory(studentKey));
}

function showSavedSessions() {
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>Saved sessions</h2>
    <div class="session-list">
      ${state.sessions.length ? state.sessions.map((session) => {
        const metres = session.timers.reduce((sum, timer) => sum + savedTimerDistance(timer, session), 0);
        return `<button class="session-card" data-session="${session.id}"><strong>${formatSavedAt(session.savedAt)}</strong><span>${session.timers.length} swimmers · ${metres}m recorded</span></button>`;
      }).join('') : '<p class="empty-state">No saved sessions yet.</p>'}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="records-back">Back</button></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-session]').forEach((button) => button.addEventListener('click', () => showSavedSession(button.dataset.session)));
  dialog.querySelector('#records-back').addEventListener('click', showSettings);
}

function getStudentRecords() {
  const grouped = new Map();
  for (const session of state.sessions) {
    session.timers.forEach((timer, timerIndex) => {
      const key = String(timer.name || 'Unnamed').trim().toLocaleLowerCase();
      if (!grouped.has(key)) grouped.set(key, { key, name: timer.name || 'Unnamed', results: [] });
      grouped.get(key).results.push({ session, timer, timerIndex });
    });
  }
  return [...grouped.values()]
    .map((student) => ({ ...student, results: student.results.sort((a, b) => b.session.savedAt - a.session.savedAt) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function showStudentRecords() {
  const students = getStudentRecords();
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>Student records</h2><p class="dialog-subtitle">All saved results grouped by student.</p>
    <div class="student-list">
      ${students.length ? students.map((student) => {
        const metres = student.results.reduce((sum, result) => sum + savedTimerDistance(result.timer, result.session), 0);
        return `<button class="student-card" data-student="${esc(student.key)}"><strong>${esc(student.name)}</strong><span>${student.results.length} record${student.results.length === 1 ? '' : 's'} · ${metres}m total</span></button>`;
      }).join('') : '<p class="empty-state">Save a session to create student records.</p>'}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="students-back">Back</button></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelectorAll('[data-student]').forEach((button) => button.addEventListener('click', () => showStudentHistory(button.dataset.student)));
  dialog.querySelector('#students-back').addEventListener('click', showSettings);
}

function showStudentHistory(key) {
  const student = getStudentRecords().find((item) => item.key === key);
  if (!student) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${esc(student.name)}</h2><p class="dialog-subtitle">${student.results.length} saved record${student.results.length === 1 ? '' : 's'}</p>
    <div class="student-results">
      ${student.results.map((result) => `<button class="student-result" data-result-session="${result.session.id}" data-result-timer="${result.timerIndex}"><strong>${formatSavedAt(result.session.savedAt)}</strong><span>${formatTime(result.timer.elapsed)}</span><small>${savedTimerDistance(result.timer, result.session)}m · ${result.timer.laps.length} laps</small></button>`).join('')}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="history-back">Back</button></div>`;
  dialog.querySelectorAll('[data-result-session]').forEach((button) => button.addEventListener('click', () => showSavedSwimmer(button.dataset.resultSession, Number(button.dataset.resultTimer), key)));
  dialog.querySelector('#history-back').addEventListener('click', showStudentRecords);
}

function showSavedSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${formatSavedAt(session.savedAt)}</h2><p class="dialog-subtitle">${session.poolLength}m pool</p>
    <div class="saved-swimmers">
      ${session.timers.map((timer, index) => `<button class="saved-swimmer" data-saved-swimmer="${index}"><strong>${esc(timer.name)}</strong><span>${formatTime(timer.elapsed)}</span><small>${timer.laps.length} laps · ${savedTimerDistance(timer, session)}m</small></button>`).join('')}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="session-back">Back</button></div>`;
  dialog.querySelectorAll('[data-saved-swimmer]').forEach((button) => button.addEventListener('click', () => showSavedSwimmer(id, Number(button.dataset.savedSwimmer))));
  dialog.querySelector('#session-back').addEventListener('click', showSavedSessions);
}

function showSavedSwimmer(sessionId, timerIndex, studentKey = null) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const timer = session?.timers?.[timerIndex];
  if (!session || !timer) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${esc(timer.name)}</h2><p class="dialog-subtitle">${formatSavedAt(session.savedAt)} · ${formatTime(timer.elapsed)} · ${savedTimerDistance(timer, session)}m</p>
    <div class="lap-list" role="list">
      ${timer.laps.length ? timer.laps.map((lap, index) => `<div class="lap-row" role="listitem"><strong>Lap ${index + 1}<small>${(index + 1) * session.poolLength}m</small></strong><span><small>Lap time</small><b>${formatTime(lap.split)}</b></span><span><small>Total</small><b>${formatTime(lap.at)}</b></span></div>`).join('') : '<p class="empty-state">No laps recorded.</p>'}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="swimmer-back">Back</button></div>`;
  dialog.querySelector('#swimmer-back').addEventListener('click', () => studentKey ? showStudentHistory(studentKey) : showSavedSession(sessionId));
}

async function requestWakeLock() {
  if (!state.settings.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* unavailable */ }
}
async function releaseWakeLock() { try { await wakeLock?.release(); } catch { /* already released */ } wakeLock = null; }

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.timers.some((timer) => timer.status === 'running')) requestWakeLock(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));

render();
