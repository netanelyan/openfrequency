#!/usr/bin/env node
// npm run backup [-- --keep 14]
//
// A consistent copy of the database while the engine runs (SQLite's VACUUM INTO,
// which reads a snapshot), into $OF_HOME/data/backups/, keeping the newest
// --keep copies. Rendered media can always be rendered again; the database is
// the one thing that cannot. On the VPS, run it from a daily timer and copy the
// folder somewhere else.

import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupsDir, dbPath, ensureDir, requireHome } from '../src/core/paths.js';

requireHome();
const keep = Number(process.argv.includes('--keep') ? process.argv[process.argv.indexOf('--keep') + 1] : 14);
const dir = ensureDir(backupsDir());
const file = path.join(dir, `openfrequency-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new DatabaseSync(dbPath(), { readOnly: true });
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
const all = readdirSync(dir).filter((f) => f.startsWith('openfrequency-') && f.endsWith('.db')).sort();
for (const f of all.slice(0, Math.max(0, all.length - keep))) rmSync(path.join(dir, f));
console.log(`backup: ${file} (${Math.min(all.length, keep)} kept)`);
