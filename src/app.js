import './styles.css';

const APP_VERSION = '2.9.1';
const STORAGE_KEY = 'swimtimer-independent-v2';
const names = ['Anna', 'Ben', 'Chloe', 'David', 'Eva', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'];
const makeTimer = (name) => {
  const id = crypto.randomUUID();
  return { id, studentId: id, name, status: 'idle', elapsed: 0, startedAt: null, laps: [], distance: 0, lastSavedSignature: '' };
};
const defaultState = { timers: names.map(makeTimer), view: 'grid', settings: { vibration: true, keepAwake: true, poolLength: 20 }, sessions: [] };
function normaliseName(value) { return String(value || 'Unnamed').trim().toLocaleLowerCase(); }

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved?.timers?.length) return structuredClone(defaultState);
    const loaded = {
      ...structuredClone(defaultState),
      ...saved,
      settings: { ...defaultState.settings, ...saved.settings },
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    };
    loaded.timers = loaded.timers.map((timer) => ({ ...makeTimer(timer.name || 'Swimmer'), ...timer, studentId: timer.studentId || timer.id || crypto.randomUUID(), lastSavedSignature: timer.lastSavedSignature || '' }));
    const profilesByName = new Map(loaded.timers.map((timer) => [normaliseName(timer.name), timer.studentId]));
    const legacyIds = new Map();
    loaded.sessions = loaded.sessions.map((session) => ({
      ...session,
      timers: (session.timers || []).map((timer) => {
        const nameKey = normaliseName(timer.name);
        if (!legacyIds.has(nameKey)) legacyIds.set(nameKey, `legacy-${nameKey || crypto.randomUUID()}`);
        return { ...timer, studentId: timer.studentId || profilesByName.get(nameKey) || legacyIds.get(nameKey), stroke: timer.stroke || '', test: timer.test || '', equipment: timer.equipment || '', notes: timer.notes || '' };
      }),
    }));
    return loaded;
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
const resultSignature = (timer) => `${Math.round(currentElapsed(timer))}|${timerDistance(timer)}|${timer.laps.length}`;
const isSaved = (timer) => Boolean(timer.lastSavedSignature && timer.lastSavedSignature === resultSignature(timer));

function formatTime(milliseconds) {
  const centisecondsTotal = Math.max(0, Math.floor(milliseconds / 10));
  const centiseconds = centisecondsTotal % 100;
  const secondsTotal = Math.floor(centisecondsTotal / 100);
  const seconds = secondsTotal % 60;
  const minutes = Math.floor(secondsTotal / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function parseManualTime(value) {
  let input = String(value || '').trim().replace(',', '.');
  if (!input) return null;
  const phoneFormat = input.match(/^(\d+)\.(\d{1,2})\.(\d{1,3})$/);
  if (phoneFormat) input = `${phoneFormat[1]}:${phoneFormat[2]}.${phoneFormat[3]}`;
  const parts = input.split(':');
  if (parts.length > 3 || parts.some((part) => part === '' || !/^\d+(?:\.\d{1,3})?$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((number) => !Number.isFinite(number) || number < 0)) return null;
  if (parts.length > 1 && numbers.at(-1) >= 60) return null;
  if (parts.length === 3 && numbers[1] >= 60) return null;
  const seconds = parts.length === 1
    ? numbers[0]
    : parts.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  const milliseconds = Math.round(seconds * 1000);
  return milliseconds > 0 && milliseconds <= 24 * 60 * 60 * 1000 ? milliseconds : null;
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
  const alreadySaved = isSaved(timer);
  return `<article class="timer-card ${running ? 'running' : ''}" data-card="${timer.id}">
    <div class="card-head"><span class="lane-number">${index + 1}</span><button class="timer-name" data-name="${timer.id}" aria-label="Edit ${esc(timer.name)}">${esc(timer.name)}</button><span class="status-dot" aria-label="${running ? 'Running' : timer.status === 'paused' ? 'Stopped' : 'Idle'}"></span></div>
    <div class="elapsed" data-clock="${timer.id}">${formatTime(currentElapsed(timer))}</div>
    <div class="timer-meta"><span class="meta-block"><small>Latest</small><b>${latest ? formatTime(latest.split) : '00:00.00'}</b></span><button class="meta-block lap-summary" data-laps="${timer.id}" aria-label="View ${esc(timer.name)} lap times" ${timer.laps.length ? '' : 'disabled'}><small>Laps</small><b>${timer.laps.length}</b></button><button class="meta-block distance-summary" data-distance="${timer.id}" aria-label="Set ${esc(timer.name)} distance"><small>Distance</small><b>${timerDistance(timer)}m</b></button></div>
    <div class="card-actions">
      <button class="${running ? 'stop-button' : 'start-button'}" data-action="${running ? 'stop' : 'start'}" data-id="${timer.id}">${running ? 'STOP' : 'START'}</button>
      <button class="${running ? 'lap-button' : 'reset-button'}" data-action="${running ? 'lap' : 'reset'}" data-id="${timer.id}" ${!running && !hasResult ? 'disabled' : ''}>${running ? 'LAP' : 'RESET'}</button>
      <button class="save-button ${alreadySaved ? 'saved' : ''}" data-action="save" data-id="${timer.id}" ${running || !hasResult || alreadySaved ? 'disabled' : ''}>${alreadySaved ? 'SAVED' : 'SAVE'}</button>
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
    timer.startedAt = Date.now(); timer.status = 'running'; timer.lastSavedSignature = ''; requestWakeLock();
  }
  if (action === 'stop' && timer.status === 'running') {
    timer.elapsed = currentElapsed(timer); timer.startedAt = null; timer.status = 'paused';
  }
  if (action === 'lap' && timer.status === 'running') {
    const at = currentElapsed(timer);
    timer.laps.push({ at, split: at - (timer.laps.at(-1)?.at || 0) });
    timer.lastSavedSignature = '';
    if (state.settings.vibration && navigator.vibrate) navigator.vibrate(35);
  }
  if (action === 'reset') {
    resetTimer(timer);
    if (!state.timers.some((item) => item.status === 'running')) releaseWakeLock();
    save(); render(); return;
  }
  if (action === 'save') { showSaveResultForm(timer); return; }
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
  Object.assign(timer, { status: 'idle', elapsed: 0, startedAt: null, laps: [], distance: 0, lastSavedSignature: '' });
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
    if (value) {
      timer.name = value;
      state.sessions.forEach((session) => session.timers.forEach((savedTimer) => { if (savedTimer.studentId === timer.studentId) savedTimer.name = value; }));
      save(); dialog.close(); render();
    }
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
  const presets = [...new Set([poolLength(), poolLength() * 2, 50, 100, 200, 400, 800])].sort((a, b) => a - b);
  dialog.innerHTML = `<form><h2>${esc(timer.name)} — Distance</h2><p>Choose a common distance or enter a custom total. LAP is optional.</p><div class="distance-presets">${presets.map((distance) => `<button type="button" data-distance-preset="${distance}">${distance}m</button>`).join('')}</div><label class="distance-entry"><span>Custom distance</span><span><input id="distance-input" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${timerDistance(timer)}"><b>m</b></span></label><div class="dialog-actions"><button type="button" class="dialog-secondary" data-close>Cancel</button><button class="dialog-primary">Save distance</button></div></form>`;
  dialog.showModal();
  const input = dialog.querySelector('#distance-input'); input.select();
  dialog.querySelectorAll('[data-distance-preset]').forEach((button) => button.addEventListener('click', () => {
    input.value = button.dataset.distancePreset;
    dialog.querySelectorAll('[data-distance-preset]').forEach((item) => item.classList.toggle('active', item === button));
  }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    timer.distance = Math.min(100000, Math.max(0, Math.round(Number(input.value) || 0)));
    timer.lastSavedSignature = '';
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
    <div class="data-actions"><button id="export-backup">Backup JSON</button><button id="export-csv">Export CSV</button><button id="import-backup">Restore backup</button><input class="sr-only" id="backup-file" type="file" accept="application/json,.json"></div>
    <p class="settings-tip">Tap a swimmer name to rename their profile. Previous records remain connected.</p>
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
  dialog.querySelector('#export-backup').addEventListener('click', exportBackup);
  dialog.querySelector('#export-csv').addEventListener('click', exportCsv);
  dialog.querySelector('#import-backup').addEventListener('click', () => dialog.querySelector('#backup-file').click());
  dialog.querySelector('#backup-file').addEventListener('change', importBackup);
  dialog.querySelectorAll('[data-setting]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.setting; state.settings[key] = !state.settings[key]; save(); showSettings();
  }));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
}

function downloadFile(filename, content, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportBackup() {
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(`swimtimer-backup-${date}.json`, JSON.stringify({ app: 'SwimTimer', version: APP_VERSION, exportedAt: Date.now(), data: state }, null, 2), 'application/json');
}

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

function exportCsv() {
  const rows = [['Student', 'Distance (m)', 'Time', 'Milliseconds', 'Date', 'Stroke', 'Test / Set', 'Equipment', 'Notes', 'Laps']];
  for (const session of state.sessions) for (const timer of session.timers) rows.push([
    timer.name, savedTimerDistance(timer, session), formatTime(timer.elapsed), Math.round(timer.elapsed || 0), new Date(session.savedAt).toISOString(), timer.stroke || '', timer.test || '', timer.equipment || '', timer.notes || '', timer.laps.length,
  ]);
  downloadFile(`swimtimer-records-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`, 'text/csv;charset=utf-8');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const restored = parsed.data || parsed;
    if (!Array.isArray(restored.timers) || !Array.isArray(restored.sessions)) throw new Error('Invalid backup');
    if (!window.confirm('Replace current timers and records with this backup?')) { event.target.value = ''; return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
    state = loadState();
    render();
    showSettings();
  } catch {
    window.alert('This backup file could not be restored.');
    event.target.value = '';
  }
}

function saveSession() {
  const now = Date.now();
  const timers = state.timers
    .map((timer) => ({ studentId: timer.studentId, name: timer.name, elapsed: currentElapsed(timer, now), distance: timerDistance(timer), laps: timer.laps.map((lap) => ({ ...lap })), stroke: '', test: '', equipment: '', notes: '' }))
    .filter((timer) => timer.elapsed > 0 || timer.laps.length || timer.distance > 0);
  if (!timers.length) return;
  state.sessions.unshift({ id: crypto.randomUUID(), savedAt: now, poolLength: poolLength(), timers });
  state.sessions = state.sessions.slice(0, 100);
  save();
  showSavedSessions();
}

function previousResults(studentId, distance) {
  return state.sessions.flatMap((session) => session.timers.map((timer) => ({ session, timer })))
    .filter((result) => result.timer.studentId === studentId && savedTimerDistance(result.timer, result.session) === distance && result.timer.elapsed > 0)
    .sort((a, b) => b.session.savedAt - a.session.savedAt);
}

function showSaveResultForm(timer) {
  if (isSaved(timer)) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<form id="result-form"><h2>Save ${esc(timer.name)}</h2><div class="record-hero compact"><strong>${timerDistance(timer)}m</strong><b>${formatTime(currentElapsed(timer))}</b></div>
    <div class="record-fields"><label>Stroke<select id="result-stroke"><option value="">Not specified</option><option>Freestyle</option><option>Backstroke</option><option>Breaststroke</option><option>Butterfly</option><option>Individual medley</option></select></label><label>Test / set<input id="result-test" maxlength="40" placeholder="e.g. Time trial"></label><label>Equipment<input id="result-equipment" maxlength="40" placeholder="e.g. Fins, paddles"></label><label class="wide">Notes<textarea id="result-notes" maxlength="200" rows="3" placeholder="Optional coaching notes"></textarea></label></div>
    <div class="dialog-actions"><button type="button" class="dialog-secondary" data-close>Cancel</button><button class="dialog-primary">Save record</button></div></form>`;
  dialog.showModal();
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.querySelector('#result-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveIndividualResult(timer, {
      stroke: dialog.querySelector('#result-stroke').value,
      test: dialog.querySelector('#result-test').value.trim(),
      equipment: dialog.querySelector('#result-equipment').value.trim(),
      notes: dialog.querySelector('#result-notes').value.trim(),
    });
  });
}

function saveIndividualResult(timer, details = {}) {
  const now = Date.now();
  const signature = resultSignature(timer);
  if (timer.lastSavedSignature === signature) return;
  const distance = timerDistance(timer);
  const prior = previousResults(timer.studentId, distance);
  const previous = prior[0]?.timer.elapsed || 0;
  const previousBest = prior.reduce((best, item) => Math.min(best, item.timer.elapsed), Number.POSITIVE_INFINITY);
  const result = { studentId: timer.studentId, name: timer.name, elapsed: currentElapsed(timer, now), distance, laps: timer.laps.map((lap) => ({ ...lap })), ...details };
  if (result.elapsed <= 0 && result.distance <= 0 && !result.laps.length) return;
  state.sessions.unshift({ id: crypto.randomUUID(), savedAt: now, poolLength: poolLength(), individual: true, timers: [result] });
  state.sessions = state.sessions.slice(0, 100);
  timer.lastSavedSignature = signature;
  save();
  render();
  const dialog = document.querySelector('#dialog');
  const isPb = result.elapsed > 0 && result.elapsed < previousBest;
  const delta = previous > 0 ? result.elapsed - previous : 0;
  const comparison = !previous ? 'First result at this distance' : isPb ? `New PB · ${formatTime(Math.abs(previousBest - result.elapsed))} faster` : `${delta <= 0 ? '▲' : '▼'} ${formatTime(Math.abs(delta))} ${delta <= 0 ? 'faster' : 'slower'} than last`;
  dialog.innerHTML = `<h2>${esc(timer.name)} saved</h2><div class="record-hero"><strong>${result.distance}m</strong><b>${formatTime(result.elapsed)}</b></div><p class="performance-note ${isPb ? 'pb' : ''}">${comparison}</p><div class="dialog-actions"><button class="dialog-secondary" data-close>Done</button><button class="dialog-primary" id="view-saved-student">View record</button></div>`;
  dialog.showModal();
  dialog.querySelector('[data-close]').addEventListener('click', () => { dialog.close(); render(); });
  dialog.querySelector('#view-saved-student').addEventListener('click', () => showStudentHistory(timer.studentId));
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
  const profileNames = new Map(state.timers.map((timer) => [timer.studentId, timer.name]));
  for (const session of state.sessions) {
    session.timers.forEach((timer, timerIndex) => {
      const key = timer.studentId || `legacy-${normaliseName(timer.name)}`;
      if (!grouped.has(key)) grouped.set(key, { key, name: profileNames.get(key) || timer.name || 'Unnamed', results: [] });
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
    <button class="manual-record-button" id="add-manual-record">＋ Add manual time</button>
    <div class="student-list">
      ${students.length ? students.map((student) => {
        const metres = student.results.reduce((sum, result) => sum + savedTimerDistance(result.timer, result.session), 0);
        const pbCount = new Set(student.results.filter((result) => result.timer.elapsed > 0).map((result) => savedTimerDistance(result.timer, result.session))).size;
        return `<button class="student-card" data-student="${esc(student.key)}"><strong>${esc(student.name)}</strong><span>${student.results.length} record${student.results.length === 1 ? '' : 's'} · ${pbCount} distance${pbCount === 1 ? '' : 's'} · ${metres}m total</span></button>`;
      }).join('') : '<p class="empty-state">Save a session to create student records.</p>'}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="students-back">Back</button></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('#add-manual-record').addEventListener('click', () => showManualResultForm());
  dialog.querySelectorAll('[data-student]').forEach((button) => button.addEventListener('click', () => showStudentHistory(button.dataset.student)));
  dialog.querySelector('#students-back').addEventListener('click', showSettings);
}

function showStudentHistory(key) {
  const student = getStudentRecords().find((item) => item.key === key);
  if (!student) return;
  const grouped = new Map();
  for (const result of student.results) {
    const distance = savedTimerDistance(result.timer, result.session);
    if (!grouped.has(distance)) grouped.set(distance, []);
    grouped.get(distance).push(result);
  }
  const distanceGroups = [...grouped.entries()]
    .sort(([distanceA], [distanceB]) => distanceA - distanceB)
    .map(([distance, results]) => ({
      distance,
      results: results.sort((a, b) => (a.timer.elapsed || Number.MAX_SAFE_INTEGER) - (b.timer.elapsed || Number.MAX_SAFE_INTEGER) || b.session.savedAt - a.session.savedAt),
    }));
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${esc(student.name)}</h2><p class="dialog-subtitle">Sorted by distance · fastest time first</p>
    <div class="student-results">
      ${distanceGroups.map((group) => `<section class="distance-record-group"><h3><strong>${group.distance}m</strong><span>${group.results.length} record${group.results.length === 1 ? '' : 's'}</span></h3><div class="distance-results">${group.results.map((result, index) => `<div class="student-result-row"><button class="student-result" data-result-session="${result.session.id}" data-result-timer="${result.timerIndex}"><span class="result-title"><strong class="result-time">${formatTime(result.timer.elapsed)}</strong>${index === 0 && result.timer.elapsed > 0 ? '<em>PB</em>' : ''}</span><small>${formatSavedAt(result.session.savedAt)} · ${result.timer.stroke ? `${esc(result.timer.stroke)} · ` : ''}${result.timer.laps.length} laps</small></button><button class="delete-record" data-delete-session="${result.session.id}" data-delete-timer="${result.timerIndex}" aria-label="Delete ${esc(student.name)} record from ${esc(formatSavedAt(result.session.savedAt))}">×</button></div>`).join('')}</div></section>`).join('')}
    </div>
    <div class="dialog-actions"><button class="dialog-secondary" id="history-back">Back</button><button class="dialog-primary" id="history-add-manual">＋ Manual time</button></div>`;
  dialog.querySelectorAll('[data-result-session]').forEach((button) => button.addEventListener('click', () => showSavedSwimmer(button.dataset.resultSession, Number(button.dataset.resultTimer), key)));
  dialog.querySelectorAll('[data-delete-session]').forEach((button) => button.addEventListener('click', () => confirmDeleteRecord(button.dataset.deleteSession, Number(button.dataset.deleteTimer), key)));
  dialog.querySelector('#history-back').addEventListener('click', showStudentRecords);
  dialog.querySelector('#history-add-manual').addEventListener('click', () => showManualResultForm(key));
}

function showManualResultForm(selectedStudentId = '') {
  const dialog = document.querySelector('#dialog');
  const profiles = state.timers.map((timer) => ({ studentId: timer.studentId, name: timer.name }));
  const selected = profiles.some((profile) => profile.studentId === selectedStudentId) ? selectedStudentId : profiles[0]?.studentId;
  dialog.innerHTML = `<form id="manual-result-form"><h2>Add manual time</h2><p class="dialog-subtitle">Enter a completed result without using the timer.</p>
    <div class="record-fields manual-record-fields">
      <label class="wide">Student<select id="manual-student" required>${profiles.map((profile) => `<option value="${esc(profile.studentId)}" ${profile.studentId === selected ? 'selected' : ''}>${esc(profile.name)}</option>`).join('')}</select></label>
      <label>Distance (m)<input id="manual-distance" type="number" min="1" max="100000" step="1" inputmode="numeric" placeholder="e.g. 400" required></label>
      <label>Time<input id="manual-time" type="text" inputmode="decimal" autocomplete="off" placeholder="e.g. 2.52.3" required aria-describedby="manual-time-help manual-time-error"></label>
      <p class="manual-time-help wide" id="manual-time-help">On iPhone, enter <b>2.52.3</b> for 2:52.30. You can also use <b>2:52.3</b>.</p>
      <p class="field-error wide" id="manual-time-error" role="alert" hidden>Please enter a valid time, such as 2.52.3 or 2:52.3.</p>
      <label>Stroke<select id="manual-stroke"><option value="">Not specified</option><option>Freestyle</option><option>Backstroke</option><option>Breaststroke</option><option>Butterfly</option><option>Individual medley</option></select></label>
      <label>Test / set<input id="manual-test" maxlength="40" placeholder="e.g. Time trial"></label>
      <label class="wide">Notes<textarea id="manual-notes" maxlength="200" rows="3" placeholder="Optional coaching notes"></textarea></label>
    </div>
    <div class="dialog-actions"><button type="button" class="dialog-secondary" id="manual-back">Cancel</button><button class="dialog-primary">Save record</button></div></form>`;
  if (!dialog.open) dialog.showModal();
  const timeInput = dialog.querySelector('#manual-time');
  timeInput.focus();
  dialog.querySelector('#manual-back').addEventListener('click', () => selectedStudentId ? showStudentHistory(selectedStudentId) : showStudentRecords());
  dialog.querySelector('#manual-result-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const elapsed = parseManualTime(timeInput.value);
    const distance = Math.min(100000, Math.max(0, Math.round(Number(dialog.querySelector('#manual-distance').value) || 0)));
    const error = dialog.querySelector('#manual-time-error');
    timeInput.setAttribute('aria-invalid', String(!elapsed));
    error.hidden = Boolean(elapsed);
    if (!elapsed || distance <= 0) return;
    const studentId = dialog.querySelector('#manual-student').value;
    const profile = state.timers.find((timer) => timer.studentId === studentId);
    if (!profile) return;
    const result = {
      studentId,
      name: profile.name,
      elapsed,
      distance,
      laps: [],
      stroke: dialog.querySelector('#manual-stroke').value,
      test: dialog.querySelector('#manual-test').value.trim(),
      equipment: '',
      notes: dialog.querySelector('#manual-notes').value.trim(),
      manual: true,
    };
    state.sessions.unshift({ id: crypto.randomUUID(), savedAt: Date.now(), poolLength: poolLength(), individual: true, manual: true, timers: [result] });
    state.sessions = state.sessions.slice(0, 100);
    save();
    showManualResultSaved(studentId, result);
  });
}

function showManualResultSaved(studentId, result) {
  const prior = previousResults(studentId, result.distance).filter((item) => item.timer !== result);
  const previousBest = prior.reduce((best, item) => Math.min(best, item.timer.elapsed), Number.POSITIVE_INFINITY);
  const isPb = result.elapsed < previousBest;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>${esc(result.name)} saved</h2><div class="record-hero"><strong>${result.distance}m</strong><b>${formatTime(result.elapsed)}</b></div><p class="performance-note ${isPb ? 'pb' : ''}">${!prior.length ? 'First result at this distance' : isPb ? `New PB · ${formatTime(previousBest - result.elapsed)} faster` : 'Manual result saved'}</p><div class="dialog-actions"><button class="dialog-secondary" id="manual-done">Done</button><button class="dialog-primary" id="manual-view-record">View record</button></div>`;
  dialog.querySelector('#manual-done').addEventListener('click', () => { dialog.close(); render(); });
  dialog.querySelector('#manual-view-record').addEventListener('click', () => showStudentHistory(studentId));
}

function confirmDeleteRecord(sessionId, timerIndex, studentKey) {
  const session = state.sessions.find((item) => item.id === sessionId);
  const timer = session?.timers?.[timerIndex];
  if (!session || !timer) return;
  const dialog = document.querySelector('#dialog');
  dialog.innerHTML = `<h2>Delete ${esc(timer.name)} record?</h2><p>${formatSavedAt(session.savedAt)} · ${formatTime(timer.elapsed)} · ${savedTimerDistance(timer, session)}m</p><p class="delete-warning">This cannot be undone.</p><div class="dialog-actions"><button class="dialog-secondary" id="cancel-delete">Cancel</button><button class="dialog-danger" id="confirm-delete-record">Delete record</button></div>`;
  dialog.querySelector('#cancel-delete').addEventListener('click', () => showStudentHistory(studentKey));
  dialog.querySelector('#confirm-delete-record').addEventListener('click', () => {
    const sessionIndex = state.sessions.findIndex((item) => item.id === sessionId);
    if (sessionIndex < 0) return;
    state.sessions[sessionIndex].timers.splice(timerIndex, 1);
    if (!state.sessions[sessionIndex].timers.length) state.sessions.splice(sessionIndex, 1);
    save();
    if (getStudentRecords().some((student) => student.key === studentKey)) showStudentHistory(studentKey);
    else showStudentRecords();
  });
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
  const details = [timer.stroke, timer.test, timer.equipment].filter(Boolean);
  dialog.innerHTML = `<h2>${esc(timer.name)}</h2><div class="record-hero"><strong>${savedTimerDistance(timer, session)}m</strong><b>${formatTime(timer.elapsed)}</b></div><p class="dialog-subtitle">${formatSavedAt(session.savedAt)} · ${timer.laps.length} laps${details.length ? ` · ${details.map(esc).join(' · ')}` : ''}</p>${timer.notes ? `<p class="record-notes">${esc(timer.notes)}</p>` : ''}
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
