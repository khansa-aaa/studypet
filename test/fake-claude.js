#!/usr/bin/env node
// Stands in for `claude -p --input-format stream-json ...` in tests. For each user message it
// echoes back what it received. "crash" makes it exit; "fail" returns an error result.
const readline = require('readline');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', apiKeySource: 'none', model: 'fake', args: process.argv.slice(2) });
let turns = 0;
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line).message;
  const text = msg.content.find((c) => c.type === 'text').text;
  const images = msg.content.filter((c) => c.type === 'image').length;
  turns++;
  if (text === 'crash') {
    process.stderr.write('boom: something broke\n');
    process.exit(3);
  }
  if (text === 'fail') return out({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' });
  const reply = `turn ${turns}: ${text} (${images} image)`;
  for (const piece of [reply.slice(0, 6), reply.slice(6)]) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } } });
  out({ type: 'assistant', message: {} });
  out({ type: 'result', is_error: false, result: reply, total_cost_usd: 0.01 });
});
