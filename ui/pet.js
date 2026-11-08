// Hoot's window: the animated sprite and the speech bubble where you ask about your screen.
const api = window.hoot;
const $ = (id) => document.getElementById(id);

// ---------- sprite ----------
// Rows and frame timings follow the Codex pet sheet (Hoots' idle row has 7 frames, not 6).
// The sheet draws Hoot at a different size in each row (standing is ~23% taller than flying), so
// each row has a scale that brings Hoot to the flying size. Idle is matched to flying head-to-feet
// (181 vs 147 px of the 208 px cell); the other poses are matched to idle by overlaying them.
const FW = 120;
const FH = 130;
const ms = (n, each, last) => [...Array(n - 1).fill(each), last];
const ANIMS = {
  idle: { row: 0, scale: 0.81, durations: [280, 110, 110, 140, 140, 140, 320] },
  runRight: { row: 1, scale: 1, durations: ms(8, 120, 220) },
  runLeft: { row: 2, scale: 1, durations: ms(8, 120, 220) },
  wave: { row: 3, scale: 0.86, durations: ms(4, 140, 280) },
  jump: { row: 4, scale: 0.83, durations: ms(5, 140, 280) },
  sad: { row: 5, scale: 0.83, durations: ms(8, 140, 240) },
  waiting: { row: 6, scale: 0.87, durations: ms(6, 150, 260) },
  write: { row: 7, scale: 0.85, durations: ms(6, 120, 220) }, // notepad: writing the answer
  read: { row: 8, scale: 0.81, durations: ms(6, 150, 280) } // book: reading your screen
};
// the look rows (9-10) stand in for idle, so they share its scale
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sprite = $('sprite');
let anim = 'idle';
let frame = 0;
let timer = null;
let baseAnim = 'idle'; // what to return to after a short reaction
let revertTimer = null;
let look = -1; // look frame index (0-15) while the cursor moves, or -1

function draw() {
  sprite.style.transform = `scale(${ANIMS[anim].scale})`;
  if (anim === 'idle' && look >= 0 && !dragging) {
    sprite.style.backgroundPosition = `${-(look % 8) * FW}px ${-(9 + Math.floor(look / 8)) * FH}px`;
    return;
  }
  sprite.style.backgroundPosition = `${-frame * FW}px ${-ANIMS[anim].row * FH}px`;
}
function tick() {
  const a = ANIMS[anim];
  draw();
  if (reduceMotion) return;
  let wait = a.durations[frame];
  // a calm idle: one breath, then rest on the first frame for a few seconds
  if (anim === 'idle' && frame === a.durations.length - 1) wait += 2000 + Math.random() * 3000;
  timer = setTimeout(() => {
    frame = (frame + 1) % a.durations.length;
    tick();
  }, wait);
}
function play(name) {
  if (!ANIMS[name] || (name === anim && timer)) return;
  anim = name;
  frame = 0;
  clearTimeout(timer);
  tick();
}
// A reaction plays for `ms`, then Hoot goes back to its base animation. ms = 0 changes the base.
function react(name, ms) {
  clearTimeout(revertTimer);
  if (!ms) {
    baseAnim = name;
    play(name);
    return;
  }
  play(name);
  revertTimer = setTimeout(() => play(baseAnim), ms);
}
play('idle');

api.on('pet:look', (idx) => {
  look = idx;
  if (anim === 'idle') draw();
});

// ---------- window size ----------
const PET_ONLY = { w: 150, h: 150 };
let open = false;
async function setOpen(next) {
  open = next;
  api.bubble(next);
  if (next) {
    const space = await api.space();
    api.resize(Math.min(420, space.w), Math.min(620, space.h));
  } else api.resize(PET_ONLY.w, PET_ONLY.h);
}

// ---------- chat ----------
const log = $('chatlog');
const input = $('ask-input');
let pending = false;
let current = null; // the Hoot message being streamed

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
// The little markdown Hoot is allowed: bullets, **bold**, `code`. Everything is escaped first.
function md(s) {
  return esc(s)
    .replace(/^#{1,6}\s+(.*)$/gm, '**$1**')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

function add(cls, text, html) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  if (html) div.innerHTML = md(text);
  else div.textContent = text;
  log.append(div);
  scrollDown();
  return div;
}
function scrollDown() {
  const wrap = $('log-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}
function hello() {
  log.replaceChildren();
  add('hoot', "Hoo! I'm Hoot. Ask me about anything on your screen: a quiz question, a PDF page, a slide. I'll take a look when you ask.");
}
hello();

async function ask(text) {
  if (!text || pending) return;
  pending = true;
  $('ask-send').disabled = true;
  $('perm').hidden = true;
  add('you', text);
  const withScreen = $('with-screen').checked;
  current = add('hoot thinking', withScreen ? 'Looking at your screen…' : 'Thinking…');
  current.dataset.text = '';
  react('read', 0);
  const r = await api.ask(text, withScreen);
  pending = false;
  $('ask-send').disabled = false;
  const msg = current;
  current = null;
  if (r && r.stopped) {
    msg.remove();
    react('idle', 0);
    return;
  }
  if (r && r.error) {
    msg.className = 'msg hoot error';
    msg.textContent = r.error;
    if (r.kind === 'permission') $('perm').hidden = false;
    react('idle', 0);
    react('sad', 3200);
    return;
  }
  msg.classList.remove('thinking');
  msg.innerHTML = md(r.text || msg.dataset.text || '(no answer)');
  scrollDown();
  react('idle', 0);
  react('jump', 1400);
}

api.on('chat:shot', ({ thumb, display }) => {
  if (!current) return;
  const fig = document.createElement('div');
  fig.className = 'shot';
  const img = document.createElement('img');
  img.src = thumb;
  img.alt = 'The screenshot Hoot looked at';
  fig.append(img);
  if (display) {
    const s = document.createElement('span');
    s.textContent = display;
    fig.append(s);
  }
  log.insertBefore(fig, current);
  current.textContent = 'Reading…';
  scrollDown();
});

api.on('chat:delta', (d) => {
  if (!current) return;
  if (!current.dataset.text) {
    current.classList.remove('thinking');
    react('write', 0);
  }
  current.dataset.text += d;
  current.innerHTML = md(current.dataset.text);
  scrollDown();
});

api.on('chat:reset', (note) => {
  hello();
  if (note) add('hoot', note);
});

$('ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || pending) return;
  input.value = '';
  ask(text);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('ask').requestSubmit();
  }
});
$('reset').addEventListener('click', async () => {
  if (pending) return;
  await api.reset();
  hello();
  input.focus();
});
$('perm-open').addEventListener('click', () => api.openScreenSettings());
api.on('test:ask', (text) => ask(text));

// ---------- bubble ----------
async function openBubble() {
  $('bubble').hidden = false;
  await setOpen(true);
  if (!pending) react('wave', 1100);
  setTimeout(() => input.focus(), 50);
}
async function closeBubble() {
  $('bubble').hidden = true;
  await setOpen(false);
}
$('close').addEventListener('click', closeBubble);
api.on('pet:open', openBubble);
api.on('pet:close', closeBubble);

// ---------- click vs drag ----------
const petEl = $('pet');
let down = null;
let dragging = false;
petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
});
window.addEventListener('mousemove', (e) => {
  if (!down) return;
  const dx = e.screenX - down.x;
  const dy = e.screenY - down.y;
  if (!dragging && Math.hypot(dx, dy) > 4) {
    dragging = true;
    api.dragStart();
  }
  if (dragging) {
    api.dragMove(dx, dy);
    const want = dx >= 0 ? 'runRight' : 'runLeft';
    if (anim !== want) play(want);
  }
});
window.addEventListener('mouseup', () => {
  if (!down) return;
  const wasDrag = dragging;
  down = null;
  dragging = false;
  if (wasDrag) {
    api.dragEnd();
    play(baseAnim);
    return;
  }
  if (open) closeBubble();
  else api.click();
});
petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.petMenu();
});
petEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open ? closeBubble() : api.click();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open) closeBubble();
});
