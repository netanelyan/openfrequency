import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { examplesDir } from '../src/core/paths.js';

// Every test runs against a throwaway OF_HOME built from the fictional demo
// pack, never against ./private/ or any real pack. A test that wants a variant
// (a tiny budget, a second account) copies the demo and edits the copy.

process.env.OF_MODE = 'recorded';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ZERNIO_API_KEY;

export const DEMO = path.join(examplesDir, 'demo');

/** Databases opened by a test, closed before its folder is removed (Windows will not delete an open file). */
export const opened = [];

/** A fresh private folder with the demo pack in packs/demo. */
export function tempHome({ packs = { demo: null } } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'of-test-'));
  for (const [id, edit] of Object.entries(packs)) copyPack(home, id, edit);
  process.env.OF_HOME = home;
  return {
    home,
    cleanup: () => {
      while (opened.length) {
        try {
          opened.pop().close();
        } catch {
          /* already closed */
        }
      }
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* a leftover temp folder is harmless */
      }
    },
  };
}

const readJ = (f) => JSON.parse(readFileSync(f, 'utf8'));

/**
 * Copy the demo pack into <home>/packs/<id>. `edit(files)` may change any of
 * pack, theme, sources, formats, rules (objects) or voice (a string) before it
 * is written.
 */
export function copyPack(home, id, edit = null) {
  const dest = path.join(home, 'packs', id);
  cpSync(DEMO, dest, { recursive: true });
  const files = {
    pack: readJ(path.join(dest, 'pack.json')),
    theme: readJ(path.join(dest, 'theme.json')),
    sources: readJ(path.join(dest, 'sources.json')),
    formats: readJ(path.join(dest, 'formats.json')),
    rules: readJ(path.join(dest, 'rules.json')),
    voice: readFileSync(path.join(dest, 'voice.md'), 'utf8'),
  };
  files.pack.id = id;
  if (id !== 'demo') {
    files.pack.handle = `${id.replace(/-/g, '.')}.test`;
    files.pack.displayName = `חשבון ${id}`;
  }
  edit?.(files);
  for (const k of ['pack', 'theme', 'sources', 'formats', 'rules']) writeFileSync(path.join(dest, `${k}.json`), JSON.stringify(files[k], null, 2));
  writeFileSync(path.join(dest, 'voice.md'), files.voice);
  return dest;
}

/** Overwrite one recorded draft in a copied pack. */
export function setDraft(packDir, key, mutate) {
  const f = path.join(packDir, 'recordings', 'drafts', `${key}.json`);
  const d = readJ(f);
  mutate(d);
  writeFileSync(f, JSON.stringify(d, null, 2));
}

/** Keep only these recorded documents (and their drafts) in a copied pack. */
export function keepOnly(packDir, keys) {
  for (const sub of ['documents', 'drafts']) {
    const dir = path.join(packDir, 'recordings', sub);
    for (const f of readdir(dir)) if (!keys.includes(f.replace(/\.json$/, ''))) rmSync(path.join(dir, f));
  }
}

import { readdirSync } from 'node:fs';
const readdir = (d) => readdirSync(d);
