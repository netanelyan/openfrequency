#!/usr/bin/env node
// npm run web            the approval website, on 127.0.0.1:${PORT:-4700}
// npm start              the website and the runner (generation, publishing, metrics)
//
// Beside the website, the owner line's internal listener for openfrequency-toran
// (127.0.0.1:${TEDER_INTERNAL_PORT:-4701}, src/owner/api.js), and with the runner
// the sender of its events (src/owner/events.js).
//
// Reads packs and data from $OF_HOME. With no private folder, says how to make
// one, or to try `npm run demo`.

import { requireHome } from '../src/core/paths.js';
import { loadEnv } from '../src/core/env.js';

try {
  requireHome();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
loadEnv();
const { makeContext } = await import('../src/engine.js');
const { listen } = await import('../src/web/server.js');
const { startRunner } = await import('../src/autonomy/runner.js');
const { listenInternal } = await import('../src/owner/api.js');
const { startEvents } = await import('../src/owner/events.js');
const { assistantSecret } = await import('../src/owner/sign.js');

const ctx = makeContext({ log: (m) => console.log(`[${new Date().toISOString()}] ${m}`) });
const { port } = await listen(ctx);
console.log(`open-frequency: http://127.0.0.1:${port}  (${ctx.packs.length} accounts, mode ${ctx.mode})`);
// Sign-in is openfrequency-accounts' (src/web/accounts.js): without the shared token nobody gets in.
if (String(process.env.OF_INTERNAL_TOKEN || '').trim().length < 32) {
  console.log('OF_INTERNAL_TOKEN is not set (32+ characters, the same value as in openfrequency-accounts): nobody can sign in.');
}
const loose = ctx.db.all('SELECT id FROM accounts WHERE workspace_id IS NULL').map((r) => r.id);
if (loose.length) console.log(`In no workspace yet, seen only by the operator: ${loose.join(', ')}. npm run workspace:assign gives them one.`);
// The owner line: a port already taken stops the line, never the website.
try {
  const internal = await listenInternal(ctx);
  console.log(`owner line: http://127.0.0.1:${internal.port}/internal/assistant/${assistantSecret() ? '' : '  (OF_ASSISTANT_SECRET is not set, 32+ characters: every request is refused, and no event is sent)'}`);
} catch (e) {
  console.log(`owner line: not listening (${e.message})`);
}
if (process.argv.includes('--runner')) {
  startRunner(ctx);
  startEvents(ctx);
  console.log('runner: on (one tick a minute)');
}
