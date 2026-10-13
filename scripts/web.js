#!/usr/bin/env node
// npm run web            the approval website, on 127.0.0.1:${PORT:-4700}
// npm start              the website and the runner (generation, publishing, metrics)
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

const ctx = makeContext({ log: (m) => console.log(`[${new Date().toISOString()}] ${m}`) });
const { port } = await listen(ctx);
console.log(`open-frequency: http://127.0.0.1:${port}  (${ctx.packs.length} accounts, mode ${ctx.mode})`);
if (!ctx.db.get('SELECT COUNT(*) AS n FROM users').n) {
  console.log('No user yet: set OF_ADMIN_USER and OF_ADMIN_PASSWORD (12+ characters) in $OF_HOME/.env and restart, or run `npm run user:add -- <name>`.');
}
if (process.argv.includes('--runner')) {
  startRunner(ctx);
  console.log('runner: on (one tick a minute)');
}
