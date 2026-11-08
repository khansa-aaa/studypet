const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Session, parseLine, userMessage, args } = require('../src/claude');

const FAKE = path.join(__dirname, 'fake-claude.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studypet-'));

test('userMessage puts the screenshot before the question', () => {
  const m = JSON.parse(userMessage('what is this?', 'QUJD'));
  assert.deepStrictEqual(m.message.content.map((c) => c.type), ['image', 'text']);
  assert.strictEqual(m.message.content[0].source.media_type, 'image/jpeg');
  assert.strictEqual(m.message.content[1].text, 'what is this?');
  assert.deepStrictEqual(JSON.parse(userMessage('hi')).message.content.map((c) => c.type), ['text']);
});

test('parseLine picks out init, text deltas and the result', () => {
  assert.deepStrictEqual(parseLine('{"type":"system","subtype":"init","apiKeySource":"none","model":"m"}'), { type: 'init', apiKeySource: 'none', model: 'm' });
  assert.deepStrictEqual(parseLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}'), { type: 'delta', text: 'Hi' });
  assert.strictEqual(parseLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"x"}}}'), null);
  assert.deepStrictEqual(parseLine('{"type":"result","is_error":false,"result":"ok","total_cost_usd":0.2}'), { type: 'done', text: 'ok', isError: false, cost: 0.2 });
  assert.strictEqual(parseLine('not json'), null);
});

test('claude runs with no tools, no customizations and the subscription', () => {
  const a = args('opus');
  assert.strictEqual(a[a.indexOf('--tools') + 1], '');
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--include-partial-messages']) assert.ok(a.includes(flag), flag);
  assert.ok(!a.includes('--bare'), '--bare would skip the subscription login');
  assert.strictEqual(a[a.indexOf('--model') + 1], 'opus');
});

test('a session streams answers and keeps one process for follow-ups', async () => {
  const s = new Session({ model: 'sonnet', cwd: tmp(), bin: FAKE });
  const deltas = [];
  const r1 = await s.ask({ text: 'what is this?', image: 'QUJD', onDelta: (d) => deltas.push(d) });
  assert.strictEqual(r1.text, 'turn 1: what is this? (1 image)');
  assert.strictEqual(deltas.join(''), r1.text);
  assert.strictEqual(s.auth, 'none');
  const r2 = await s.ask({ text: 'and this?' });
  assert.strictEqual(r2.text, 'turn 2: and this? (0 image)');
  s.stop();
});

test('errors, crashes and stopping reject, and the next question starts a fresh process', async () => {
  const s = new Session({ model: 'sonnet', cwd: tmp(), bin: FAKE });
  await assert.rejects(s.ask({ text: 'fail' }), /Not logged in/);
  await assert.rejects(s.ask({ text: 'crash' }), /boom: something broke/);
  const r = await s.ask({ text: 'again' });
  assert.strictEqual(r.text, 'turn 1: again (0 image)');
  const p = s.ask({ text: 'crash' }).catch((e) => e);
  s.stop();
  const e = await p;
  assert.ok(e.stopped || /boom/.test(e.message));
});

test('only one question at a time', async () => {
  const s = new Session({ model: 'sonnet', cwd: tmp(), bin: FAKE });
  const first = s.ask({ text: 'one' });
  await assert.rejects(s.ask({ text: 'two' }), /still answering/);
  await first;
  s.stop();
});
