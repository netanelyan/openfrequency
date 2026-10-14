import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { examplesDir, packsDir } from '../core/paths.js';
import { nowIso } from '../core/clock.js';
import { setSetting } from '../core/store.js';
import { validateAll, validatePack, voiceExamples } from './validate.js';
import { factsSource } from '../sources/facts.js';

// Packs are folders of configuration. The engine reads them from $OF_HOME/packs;
// the one tracked pack, examples/packs/demo, is read from the repo only when it
// is asked for by name (a dry run, the demo) and never mixed into a real install.

export class PackError extends Error {
  constructor(message, problems = []) {
    super(problems.length ? `${message}:\n  - ${problems.join('\n  - ')}` : message);
    this.name = 'PackError';
    this.problems = problems;
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new PackError(`${path.basename(path.dirname(file))}/${path.basename(file)}: ${e.code === 'ENOENT' ? 'missing' : `not valid JSON (${e.message})`}`);
  }
};

/** Read one pack folder. Does not validate. */
export function readPack(dir) {
  const meta = readJson(path.join(dir, 'pack.json'));
  const pack = {
    dir,
    dirName: path.basename(dir),
    meta,
    theme: readJson(path.join(dir, 'theme.json')),
    sources: readJson(path.join(dir, 'sources.json')),
    formats: readJson(path.join(dir, 'formats.json')),
    rules: readJson(path.join(dir, 'rules.json')),
    voice: existsSync(path.join(dir, 'voice.md')) ? readFileSync(path.join(dir, 'voice.md'), 'utf8') : '',
  };
  pack.id = meta.id;
  pack.examples = voiceExamples(pack.voice);
  pack.recordingsDir = path.join(dir, 'recordings');
  // The account's mark (brand/logo.png, or .svg): drawn small on the first and last slides when it is there.
  pack.brandLogo = ['logo.png', 'logo.svg'].map((f) => path.join(dir, 'brand', f)).find((f) => existsSync(f)) || null;
  // A facts/ folder: hand-checked facts, one more approved source (src/sources/facts.js).
  pack.facts = factsSource(path.join(dir, 'facts'));
  return pack;
}

/** Read and validate one pack folder, or throw a PackError listing every problem. */
export function loadPack(dir) {
  const pack = readPack(dir);
  const problems = validatePack(pack);
  if (problems.length) throw new PackError(`pack "${pack.dirName}" is not valid`, problems);
  return pack;
}

const isPackDir = (d) => existsSync(path.join(d, 'pack.json')) && statSync(d).isDirectory();

/** Every pack folder under $OF_HOME/packs (or `dir`), sorted. */
export function packDirs(dir = packsDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => path.join(dir, n))
    .filter((d) => statSync(d).isDirectory() && isPackDir(d))
    .sort();
}

/** All packs in the private folder, each valid and the set distinct. */
export function loadAll({ dir = packsDir(), extra = [] } = {}) {
  const packs = [...packDirs(dir).map(loadPack), ...extra];
  const problems = validateAll(packs);
  if (problems.length) throw new PackError('the packs are not distinct brands', problems);
  return packs;
}

/** A pack by id: the private folder first, then the tracked examples. */
export function resolvePackDir(id, { dir = packsDir() } = {}) {
  for (const base of [dir, examplesDir]) {
    const d = path.join(base, id);
    if (isPackDir(d)) return d;
  }
  return null;
}

/**
 * Make the database agree with the packs: one account row per pack, and the
 * pack's sources as approved sources (a source the owner removed on the website
 * stays removed; a source added there stays added).
 */
export function syncAccounts(db, packs) {
  const at = nowIso();
  db.tx(() => {
    for (const pk of packs) {
      const row = db.get('SELECT id FROM accounts WHERE id = ?', pk.id);
      if (!row) {
        db.insert('accounts', {
          id: pk.id,
          display_name: pk.meta.displayName,
          handle: pk.meta.handle,
          mode: pk.meta.autonomy?.mode || 'approve',
          status: 'active',
          created_at: at,
          updated_at: at,
        });
      } else {
        db.update('accounts', pk.id, { display_name: pk.meta.displayName, handle: pk.meta.handle, updated_at: at });
      }
      for (const s of [...(pk.sources.sources || []), ...factSources(pk)]) {
        const have = db.get('SELECT id, status, origin FROM sources WHERE account_id = ? AND key = ?', pk.id, s.id);
        const fields = {
          type: s.type,
          url: s.url,
          name: s.name,
          why: s.why,
          lang: s.lang || null,
          config_json: { api: s.api || null, hints: s.hints || null, recording: s.recording || null },
        };
        if (!have) {
          db.insert('sources', { account_id: pk.id, key: s.id, ...fields, status: 'approved', origin: 'pack', approved_at: s.approvedAt, created_at: at });
        } else if (have.origin === 'pack') {
          db.update('sources', have.id, fields);
        }
      }
    }
    // Each account's weight in the budget (pack.json budget.share, 1 by default).
    setSetting(db, 'budget:weights', Object.fromEntries(packs.map((pk) => [pk.id, Number(pk.meta.budget?.share) > 0 ? Number(pk.meta.budget.share) : 1])));
  });
}

/** A pack with a facts/ folder has one more approved source: its hand-checked facts. */
function factSources(pk) {
  if (!pk.facts) return [];
  return [{ id: 'facts', type: 'api', api: { kind: 'facts' }, url: pk.facts.url, name: pk.facts.name, why: pk.facts.why, approvedAt: pk.facts.approvedAt }];
}
