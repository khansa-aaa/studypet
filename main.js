// Hoot: a desktop study pet. It sits on top of every window; when you ask it something (click it or
// press the shortcut) it takes a screenshot of the display you're working on and asks Claude, through
// your own Claude subscription, about what's on screen.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Session } = require('./src/claude');
const { capture, permission, displayUnderCursor } = require('./src/capture');
const { lookIndex } = require('./src/look');
const settings = require('./src/settings');

const COLLAPSED = { w: 150, h: 150 };
const HIDE_MS = 30 * 60 * 1000;
const LAUNCH_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.studypet.hoot.plist');
const MODELS = [
  { id: 'sonnet', label: 'Sonnet (recommended)' },
  { id: 'opus', label: 'Opus (smartest, slower)' },
  { id: 'haiku', label: 'Haiku (fastest)' }
];
const SHORTCUTS = ['Alt+Space', 'Control+Alt+Space', 'Alt+Shift+Space'];
const SHORTCUT_LABEL = { 'Alt+Space': '⌥Space', 'Control+Alt+Space': '⌃⌥Space', 'Alt+Shift+Space': '⌥⇧Space' };
const SNAPSHOT = process.env.STUDYPET_SNAPSHOT;

let pet = null;
let tray = null;
let anchor = null;
let dragStart = null;
let unhideTimer = null;
let session = null;
let shortcut = null; // the one actually registered
let targetDisplay = null; // the display Hoot looks at, picked when the bubble opens
let bubbleOpen = false;
let lastAnswer = null; // snapshot mode only

if (!app.requestSingleInstanceLock()) app.quit();

const dataDir = () => app.getPath('userData');
const conf = () => settings.read(dataDir());
const send = (channel, payload) => pet && !pet.isDestroyed() && pet.webContents.send(channel, payload);

function newSession() {
  if (session) session.stop();
  session = new Session({ model: conf().model, cwd: path.join(dataDir(), 'claude') });
}

// ---------- pet window ----------
function defaultAnchor() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { right: wa.x + wa.width - 24, bottom: wa.y + wa.height - 12 };
}
function validAnchor(a) {
  if (!a || !Number.isFinite(a.right) || !Number.isFinite(a.bottom)) return false;
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return a.right - 20 > w.x && a.right - 20 < w.x + w.width && a.bottom - 20 > w.y && a.bottom - 20 < w.y + w.height;
  });
}
// Hoot's bottom-right corner stays put; the bubble grows up and to the left.
function placePet(w, h) {
  if (!pet || !anchor) return;
  const wa = screen.getDisplayNearestPoint({ x: anchor.right - 20, y: anchor.bottom - 20 }).workArea;
  const x = Math.min(Math.max(anchor.right - w, wa.x), wa.x + wa.width - w);
  const y = Math.max(anchor.bottom - h, wa.y);
  pet.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
}

function createPet() {
  const saved = conf().anchor;
  anchor = validAnchor(saved) ? saved : defaultAnchor();
  pet = new BrowserWindow({
    x: Math.round(anchor.right - COLLAPSED.w),
    y: Math.round(anchor.bottom - COLLAPSED.h),
    width: COLLAPSED.w,
    height: COLLAPSED.h,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // keeps Hoot and its bubble out of the screenshots it sends
  pet.setContentProtection(true);
  pet.loadFile(path.join(__dirname, 'ui', 'pet.html'));
  pet.on('show', refreshTray);
  pet.on('hide', refreshTray);
  pet.on('closed', () => (pet = null));
}

// Open the bubble, or close it if it's already open and focused.
function toggleAsk(fromShortcut) {
  if (!pet) return;
  if (bubbleOpen && pet.isFocused()) {
    send('pet:close');
    return;
  }
  // From the shortcut, look at the display you're working on; from a click, the one Hoot is on.
  targetDisplay = fromShortcut ? displayUnderCursor().id : screen.getDisplayMatching(pet.getBounds()).id;
  if (!pet.isVisible()) pet.showInactive();
  app.focus({ steal: true });
  pet.focus();
  send('pet:open');
}

// Hoot glances at the cursor while it's moving, and goes back to idling once it stops.
function watchCursor() {
  let last = null;
  let movedAt = 0;
  let sent = -1;
  setInterval(() => {
    if (!pet || !pet.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (!last || p.x !== last.x || p.y !== last.y) movedAt = Date.now();
    last = p;
    const b = pet.getBounds();
    // the sprite is drawn 120x130 in the window's bottom-right corner (see pet.css)
    const center = { x: b.x + b.width - 10 - 60, y: b.y + b.height - 4 - 70 };
    const idx = Date.now() - movedAt < 2500 ? lookIndex(center, p) : -1;
    if (idx !== sent) {
      sent = idx;
      send('pet:look', idx);
    }
  }, 100);
}

// ---------- tray ----------
function launchAtLogin() {
  return fs.existsSync(LAUNCH_AGENT);
}
function setLaunchAtLogin(on) {
  if (!on) {
    fs.rmSync(LAUNCH_AGENT, { force: true });
    return;
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.studypet.hoot</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${app.getAppPath()}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`;
  fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT, plist);
}

function setModel(id) {
  settings.update(dataDir(), { model: id });
  newSession();
  send('chat:reset', `Switched to ${id[0].toUpperCase() + id.slice(1)}. New conversation started.`);
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const c = conf();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Ask Hoot${shortcut ? ` (${SHORTCUT_LABEL[shortcut]})` : ''}`, click: () => toggleAsk(false) },
    { label: 'New conversation', click: () => { newSession(); send('chat:reset'); } },
    { label: pet && pet.isVisible() ? 'Hide Hoot' : 'Show Hoot', click: () => (pet.isVisible() ? pet.hide() : pet.showInactive()) },
    { type: 'separator' },
    { label: 'Model', submenu: MODELS.map((m) => ({ label: m.label, type: 'radio', checked: c.model === m.id, click: () => setModel(m.id) })) },
    { label: 'Shortcut', submenu: SHORTCUTS.map((s) => ({ label: SHORTCUT_LABEL[s], type: 'radio', checked: shortcut === s, click: () => chooseShortcut(s) })) },
    { label: 'Reset position', click: resetPosition },
    { label: 'Start Hoot at login', type: 'checkbox', checked: launchAtLogin(), click: (i) => setLaunchAtLogin(i.checked) },
    { label: 'Screen Recording settings…', click: openScreenSettings },
    { type: 'separator' },
    { label: 'Quit Hoot', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🦉');
  tray.setToolTip('Hoot');
  refreshTray();
}

function resetPosition() {
  anchor = defaultAnchor();
  settings.update(dataDir(), { anchor });
  const bb = pet.getBounds();
  placePet(bb.width, bb.height);
}

function openScreenSettings() {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
}

// ---------- shortcut ----------
function register(accel) {
  try {
    return globalShortcut.register(accel, () => toggleAsk(true));
  } catch (_) {
    return false;
  }
}
// Use the saved shortcut, or the first free one if another app (such as ChatGPT) already has it.
function registerShortcut() {
  const want = conf().shortcut;
  for (const s of [want, ...SHORTCUTS.filter((x) => x !== want)]) {
    if (register(s)) {
      shortcut = s;
      return;
    }
  }
  shortcut = null;
}
function chooseShortcut(s) {
  if (shortcut) globalShortcut.unregister(shortcut);
  if (register(s)) {
    shortcut = s;
    settings.update(dataDir(), { shortcut: s });
  } else {
    if (shortcut) register(shortcut);
    dialog.showMessageBox({ message: `${SHORTCUT_LABEL[s]} is already used by another app.`, detail: 'Pick a different shortcut, or turn it off in that app first.' });
  }
  refreshTray();
}

// ---------- IPC ----------
ipcMain.handle('ask', async (_e, req) => {
  const text = String((req && req.text) || '').trim().slice(0, 4000);
  if (!text) return { error: 'Type a question first.' };
  if (!session) newSession();
  let shot = null;
  if (req.withScreen) {
    try {
      shot = await capture(targetDisplay);
    } catch (e) {
      return { error: e.code === 'permission' ? 'Hoot needs Screen Recording permission to see your screen.' : e.message, kind: e.code };
    }
    if (permission() !== 'granted') return { error: 'Hoot needs Screen Recording permission to see your screen.', kind: 'permission' };
    send('chat:shot', { thumb: shot.thumb, display: shot.display });
    if (SNAPSHOT) fs.writeFileSync(path.join(SNAPSHOT, 'sent.jpg'), shot.jpeg);
  }
  try {
    const r = await session.ask({ text, image: shot && shot.jpeg.toString('base64'), onDelta: (d) => send('chat:delta', d) });
    if (session.auth && session.auth !== 'none') console.warn(`Claude is using ${session.auth}, not your subscription login.`);
    lastAnswer = { ok: true, text: r.text, auth: session.auth };
    return { ok: true, text: r.text };
  } catch (e) {
    if (e.stopped) return { stopped: true };
    const login = /log ?in|auth|credential|401/i.test(e.message);
    lastAnswer = { error: e.message };
    return { error: login ? `${e.message} Open Terminal, run \`claude\` and sign in with your Claude account.` : e.message, kind: login ? 'login' : undefined };
  }
});
ipcMain.handle('chat:reset', () => newSession());
ipcMain.handle('open:screenSettings', () => openScreenSettings());
ipcMain.on('bubble', (_e, open) => (bubbleOpen = !!open));

// pet window plumbing
ipcMain.on('win:resize', (_e, s) => s && Number.isFinite(s.w) && Number.isFinite(s.h) && placePet(s.w, s.h));
ipcMain.handle('win:space', () => {
  const a = anchor || defaultAnchor();
  const wa = screen.getDisplayNearestPoint({ x: a.right - 20, y: a.bottom - 20 }).workArea;
  return { w: a.right - wa.x, h: a.bottom - wa.y };
});
ipcMain.on('drag:start', () => {
  if (!pet) return;
  const [x, y] = pet.getPosition();
  dragStart = { x, y };
});
ipcMain.on('drag:move', (_e, d) => pet && dragStart && pet.setPosition(Math.round(dragStart.x + d.dx), Math.round(dragStart.y + d.dy)));
ipcMain.on('drag:end', () => {
  if (!pet || !dragStart) return;
  const bb = pet.getBounds();
  anchor = { right: bb.x + bb.width, bottom: bb.y + bb.height };
  settings.update(dataDir(), { anchor });
  dragStart = null;
});
ipcMain.on('pet:click', () => toggleAsk(false));
ipcMain.on('pet:menu', () => {
  if (!pet) return;
  Menu.buildFromTemplate([
    { label: 'Ask Hoot', click: () => toggleAsk(false) },
    { label: 'New conversation', click: () => { newSession(); send('chat:reset'); } },
    {
      label: 'Hide for 30 minutes',
      click: () => {
        pet.hide();
        clearTimeout(unhideTimer);
        unhideTimer = setTimeout(() => pet && pet.showInactive(), HIDE_MS);
      }
    },
    { type: 'separator' },
    { label: 'Quit Hoot', click: () => app.quit() }
  ]).popup({ window: pet });
});

// ---------- lifecycle ----------
app.on('second-instance', () => toggleAsk(false));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createPet();
  createTray();
  registerShortcut();
  refreshTray();
  newSession();
  watchCursor();
  if (SNAPSHOT) snapshotWindows(SNAPSHOT);
});

// Development aid: STUDYPET_SNAPSHOT=/some/dir npm start saves pictures of the pet and its bubble,
// asks STUDYPET_ASK (if set) about the real screen, saves the screenshot it sent, and quits.
async function snapshotWindows(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shoot = async (name) => fs.writeFileSync(path.join(dir, name), (await pet.webContents.capturePage()).toPNG());
  fs.mkdirSync(dir, { recursive: true });
  await wait(2500);
  await shoot('pet.png');
  toggleAsk(true);
  await wait(1500);
  await shoot('bubble.png');
  if (process.env.STUDYPET_ASK) {
    send('test:ask', process.env.STUDYPET_ASK);
    for (let i = 0; i < 240 && !lastAnswer; i++) await wait(500);
    fs.writeFileSync(path.join(dir, 'answer.json'), JSON.stringify({ ...lastAnswer, permission: permission(), shortcut }, null, 2));
    await wait(800);
    await shoot('bubble-answer.png');
  }
  app.quit();
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (session) session.stop();
});
app.on('window-all-closed', (e) => e.preventDefault());
