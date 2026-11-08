// Hoot's brain: one long-running Claude Code process per conversation, signed in with your own
// Claude subscription. Each question goes in as a stream-json message with the screenshot attached,
// and the answer streams back token by token. Claude gets no tools and none of your Claude Code
// customizations (--safe-mode), so a page on screen can only ever produce text in the bubble.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ANSWER_TIMEOUT = 3 * 60 * 1000;
const SYSTEM = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf8');

// ---------- finding claude (same approach as Fireball) ----------
let shellPathPromise = null;
function shellPath() {
  if (!shellPathPromise) {
    shellPathPromise = new Promise((resolve) => {
      execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'echo "__PATH__$PATH"'], { timeout: 8000 }, (_e, out) => {
        const m = /__PATH__(.*)/.exec(out || '');
        resolve(m ? m[1].trim() : '');
      });
    });
  }
  return shellPathPromise;
}

async function childEnv() {
  const home = os.homedir();
  const extra = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  const PATH = [await shellPath(), process.env.PATH, ...extra].filter(Boolean).join(path.delimiter);
  const env = { ...process.env, PATH };
  delete env.ELECTRON_RUN_AS_NODE;
  // With an API key in the environment Claude Code would bill that key instead of the subscription.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function findBin(bin, env) {
  for (const dir of env.PATH.split(path.delimiter)) {
    const f = path.join(dir, bin);
    try {
      fs.accessSync(f, fs.constants.X_OK);
      return f;
    } catch (_) {
      // keep looking
    }
  }
  return null;
}

// ---------- the stream-json protocol ----------
function userMessage(text, jpegBase64) {
  const content = [];
  if (jpegBase64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } });
  content.push({ type: 'text', text });
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

// One stdout line -> { type: 'init' | 'delta' | 'done' } or null for lines Hoot doesn't need.
function parseLine(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch (_) {
    return null;
  }
  if (o.type === 'system' && o.subtype === 'init') return { type: 'init', apiKeySource: o.apiKeySource, model: o.model };
  if (o.type === 'stream_event' && o.event && o.event.type === 'content_block_delta' && o.event.delta && o.event.delta.type === 'text_delta') {
    return { type: 'delta', text: o.event.delta.text };
  }
  if (o.type === 'result') return { type: 'done', text: o.result || '', isError: !!o.is_error, cost: o.total_cost_usd || 0 };
  return null;
}

const lastLine = (t) => String(t || '').trim().split('\n').filter(Boolean).pop() || '';

function args(model) {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt', SYSTEM,
    '--tools', '',
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--model', model || 'sonnet'
  ];
}

// A conversation. The process starts on the first question and keeps the context for follow-ups;
// stop() ends the conversation.
class Session {
  constructor({ model, cwd, bin }) {
    this.model = model;
    this.cwd = cwd;
    this.bin = bin; // tests point this at a fake claude
    this.child = null;
    this.turn = null;
    this.auth = null;
  }

  async start() {
    const env = await childEnv();
    const bin = this.bin || findBin('claude', env);
    if (!bin) throw new Error('Claude Code is not installed or not on the PATH. Install it, then run `claude` once in Terminal to sign in.');
    fs.mkdirSync(this.cwd, { recursive: true });
    const child = spawn(bin, args(this.model), { env, cwd: this.cwd });
    this.child = child;
    let buf = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = parseLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (ev) this.onEvent(ev);
      }
    });
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
    child.stdin.on('error', () => {});
    child.on('error', (e) => this.onExit(child, e.message));
    child.on('close', () => this.onExit(child, lastLine(stderr)));
  }

  onEvent(ev) {
    if (ev.type === 'init') {
      this.auth = ev.apiKeySource;
      return;
    }
    const t = this.turn;
    if (!t) return;
    if (ev.type === 'delta') {
      t.text += ev.text;
      if (t.onDelta) t.onDelta(ev.text);
    } else if (ev.type === 'done') {
      this.turn = null;
      clearTimeout(t.timer);
      if (ev.isError) t.reject(new Error(ev.text || 'Claude reported an error.'));
      else t.resolve({ text: t.text || ev.text, cost: ev.cost });
    }
  }

  onExit(child, why) {
    if (this.child !== child) return;
    this.child = null;
    const t = this.turn;
    this.turn = null;
    if (!t) return;
    clearTimeout(t.timer);
    if (t.timedOut) t.reject(new Error('Claude took too long to answer.'));
    else if (t.stopped) t.reject(Object.assign(new Error('Stopped.'), { stopped: true }));
    else t.reject(new Error(why || 'Claude Code stopped unexpectedly.'));
  }

  ask({ text, image, onDelta }) {
    if (this.turn) return Promise.reject(new Error('Hoot is still answering the last question.'));
    return new Promise((resolve, reject) => {
      // claim the turn before starting claude, so a second question can't start a second process
      const t = { text: '', onDelta, resolve, reject, timedOut: false, stopped: false };
      this.turn = t;
      t.timer = setTimeout(() => {
        t.timedOut = true;
        this.kill();
      }, ANSWER_TIMEOUT);
      const ready = this.child ? Promise.resolve() : this.start();
      ready.then(
        () => {
          if (this.turn !== t) return;
          if (t.stopped) {
            // New chat was pressed while claude was starting
            this.turn = null;
            clearTimeout(t.timer);
            this.kill();
            reject(Object.assign(new Error('Stopped.'), { stopped: true }));
            return;
          }
          this.child.stdin.write(userMessage(text, image));
        },
        (e) => {
          if (this.turn !== t) return;
          this.turn = null;
          clearTimeout(t.timer);
          reject(e);
        }
      );
    });
  }

  kill() {
    if (this.child) this.child.kill();
  }

  stop() {
    if (this.turn) this.turn.stopped = true;
    this.kill();
  }
}

module.exports = { Session, parseLine, userMessage, args, childEnv, findBin };
