import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where everything lives.
//
// The repository is public and holds only the engine. Everything that belongs to
// a real account (its pack, the database, rendered media, recordings, keys)
// lives in OF_HOME, which defaults to ./private/ inside the repo and is
// gitignored entirely. Nothing here may fall back to writing real data anywhere
// else, so every path below is derived from ofHome().

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The private folder. Relative values are resolved against the repo root, not the cwd. */
export function ofHome(env = process.env) {
  const raw = String(env.OF_HOME || '').trim();
  return raw ? path.resolve(ROOT, raw) : path.join(ROOT, 'private');
}

export const packsDir = (env) => path.join(ofHome(env), 'packs');
export const dataDir = (env) => path.join(ofHome(env), 'data');
export const dbPath = (env) => path.join(dataDir(env), 'openfrequency.db');
export const mediaDir = (env) => path.join(dataDir(env), 'media');
export const outDir = (env) => path.join(dataDir(env), 'out');
export const backupsDir = (env) => path.join(dataDir(env), 'backups');

/** The one tracked pack: fictional, used by tests, the demo and the docs. */
export const examplesDir = path.join(ROOT, 'examples', 'packs');
export const assetsDir = path.join(ROOT, 'assets');

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A clear stop when the private folder has not been created yet. */
export function requireHome(env = process.env) {
  const home = ofHome(env);
  if (!existsSync(home)) {
    const err = new Error(
      `No private folder at ${home}.\n` +
        '  Run `npm run init-private` to create it (or set OF_HOME).\n' +
        '  To try the engine with the fictional demo pack only: `npm run demo`.'
    );
    err.code = 'no_home';
    throw err;
  }
  return home;
}
