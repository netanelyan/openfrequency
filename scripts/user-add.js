#!/usr/bin/env node
// npm run user:add -- <name> [--role owner|editor|viewer]
// Asks for the password on the terminal (never on the command line, where it
// would land in the shell's history).

import { createInterface } from 'node:readline';
import { requireHome } from '../src/core/paths.js';
import { loadEnv } from '../src/core/env.js';

requireHome();
loadEnv();
const { openDb } = await import('../src/db/index.js');
const { addUser } = await import('../src/web/auth.js');

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const role = args.includes('--role') ? args[args.indexOf('--role') + 1] : 'owner';
if (!name) {
  console.error('usage: npm run user:add -- <name> [--role owner|editor|viewer]');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl.stdoutMuted = true;
rl._writeToOutput = (s) => rl.output.write(rl.stdoutMuted && !/^password/.test(s) ? '' : s);
const password = await new Promise((r) => rl.question('password (12+ characters): ', r));
rl.close();
process.stdout.write('\n');
try {
  addUser(openDb(), name, password, role);
  console.log(`user "${name}" (${role}) added`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
