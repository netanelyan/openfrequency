#!/usr/bin/env node
// npm run budget [-- status]     this month's Anthropic API spend, the cap, and the jobs that cost most
// npm run budget -- init         create the spend file once ($OF_HOME/data/anthropic-spend.json)
// npm run budget -- reconcile    raise this month in the spend file to what the database's ledger recorded (never lower)
//
// The spend file is what every API call is checked against (src/budget/anthropic.js).
// When it is missing or unreadable every API call is blocked, so a new server runs
// `init` once before the first live day. init never overwrites a file that exists,
// and it starts each month at what the ledger in the database already recorded.

import { existsSync } from 'node:fs';
import { loadEnv } from '../src/core/env.js';
import { openDb } from '../src/db/index.js';
import { initState, ledgerUsd, limits, reconcileState, spendStatus, statePath, utcMonth } from '../src/budget/anthropic.js';
import { PRICES_VERIFIED } from '../src/budget/pricing.js';

loadEnv();
const cmd = process.argv[2] || 'status';
const usd = (x, d = 2) => `$${Number(x || 0).toFixed(d)}`;
const month = utcMonth();
// The ledger's rows for this UTC month: real API calls only (the CLI's rows cost nothing, recorded ones are estimates).
const ledger = (db) => db.all("SELECT tag, COUNT(*) AS n, COALESCE(SUM(usd), 0) AS usd FROM spend WHERE api = 'claude' AND estimated = 0 AND substr(at, 1, 7) = ? GROUP BY tag ORDER BY usd DESC", month);

if (cmd === 'init') {
  const db = openDb();
  const seed = ledger(db).reduce((s, r) => s + r.usd, 0);
  const r = initState({ seedUsd: seed ? { [month]: seed } : {} });
  console.log(r.created ? `created ${r.file}, ${month} starting at ${usd(seed, 4)}` : `${r.file} already exists: left as it is`);
} else if (cmd === 'reconcile') {
  const r = reconcileState({ month, ledgerUsd: ledgerUsd(openDb(), month) });
  console.log(r ? `${month} raised from ${usd(r.from, 4)} to ${usd(r.to, 4)}, the database's ledger` : `${month} already at or above the database's ledger: left as it is`);
} else if (cmd === 'status') {
  const { cap, warn } = limits();
  let s;
  try {
    s = spendStatus();
  } catch (e) {
    console.error(`BLOCKED: ${e.message}`);
    console.error(`cap ${usd(cap)}, warning at ${usd(warn)}. ${existsSync(statePath()) ? 'Fix the file' : 'Run `npm run budget -- init`'} to allow API calls again.`);
    process.exit(1);
  }
  const left = Math.max(0, s.cap - s.usd);
  console.log(`Anthropic API, ${s.month} (UTC): ${usd(s.usd, 4)} of ${usd(s.cap)} in ${s.calls} call(s); ${usd(left, 4)} left.`);
  console.log(`Warning level ${usd(s.warn)}${s.usd >= s.warn ? ' (reached)' : ''}. Prices verified ${PRICES_VERIFIED} (src/budget/pricing.js).`);
  const jobs = ledger(openDb());
  if (jobs.length) {
    console.log('\nTop jobs this month:');
    for (const j of jobs.slice(0, 8)) console.log(`  ${String(j.tag || '(none)').padEnd(16)} ${usd(j.usd, 4).padStart(9)}  ${j.n} call(s)`);
  } else console.log('\nNo API calls recorded this month.');
} else {
  console.error('usage: npm run budget [-- status | init | reconcile]');
  process.exit(1);
}
