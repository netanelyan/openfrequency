import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { styleConfigProblems } from '../render/styles/tokens.js';

// The one setting of a pack the website writes: its slide style (pack.json "style"), when the owner picks one on
// the Accounts page or a style test settles. Everything else in a pack is the owner's to edit by hand. The file is
// read fresh, only "style" is replaced, and it is written whole (a temporary file renamed over it), so a hand edit
// made since the engine started is kept.

/** Set a pack's style (a patch of { name, accent, bg, panel, test }; null for a key removes it). Returns the new style. */
export function setPackStyle(pack, patch) {
  const file = path.join(pack.dir, 'pack.json');
  const raw = readFileSync(file, 'utf8');
  const meta = JSON.parse(raw);
  const next = { ...(meta.style || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  const problems = styleConfigProblems(next);
  if (problems.length) throw Object.assign(new Error(problems.join('; ')), { problems });
  meta.style = next;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(`${file}.tmp`, `${JSON.stringify(meta, null, 2).replace(/\n/g, eol)}${eol}`);
  renameSync(`${file}.tmp`, file);
  pack.meta.style = next;
  return next;
}
