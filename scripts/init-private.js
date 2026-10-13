#!/usr/bin/env node
// npm run init-private [-- --pack <id>] [-- --git]
//
// Creates the private folder ($OF_HOME, ./private/ by default) with the layout
// the engine expects, and never overwrites anything already there:
//
//   packs/              one folder per real account
//   templates/pack/     a blank pack to copy (refreshed from examples/pack-template)
//   data/               the database, rendered media, dry-run output, backups
//   .env                keys (copied from .env.example, empty, mode 600)
//   .gitignore          for the private repo: data/ and .env stay out of it
//   .gitattributes      LF line endings, so Windows and the VPS see the same files
//   public-denylist.txt words check:public refuses in the public repo
//   README.md           what this folder is
//
// --pack <id>  also creates packs/<id> from the template
// --git        also runs `git init` in the folder (a private repo for backup and VPS sync)

import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, ensureDir, examplesDir, ofHome } from '../src/core/paths.js';

const args = process.argv.slice(2);
const packId = args.includes('--pack') ? args[args.indexOf('--pack') + 1] : null;
const home = ofHome();
const made = [];
const write = (rel, body, mode) => {
  const f = path.join(home, rel);
  if (existsSync(f)) return;
  ensureDir(path.dirname(f));
  writeFileSync(f, body);
  if (mode) chmodSync(f, mode);
  made.push(rel);
};

for (const d of ['packs', 'data', 'templates']) if (!existsSync(path.join(home, d))) (ensureDir(path.join(home, d)), made.push(`${d}/`));
cpSync(path.join(path.dirname(examplesDir), 'pack-template'), path.join(home, 'templates', 'pack'), { recursive: true });

if (!existsSync(path.join(home, '.env'))) {
  copyFileSync(path.join(ROOT, '.env.example'), path.join(home, '.env'));
  try {
    chmodSync(path.join(home, '.env'), 0o600);
  } catch {
    /* Windows: permissions are the folder's */
  }
  made.push('.env');
}
write('.gitignore', '# The private repo tracks packs and recordings. Never keys or state.\n.env\ndata/\n*.db\n*.db-*\n');
write('.gitattributes', '* text=auto eol=lf\n*.jpg binary\n*.png binary\n');
write(
  'public-denylist.txt',
  '# Words that must never appear in the public repository, one per line.\n# check:public already refuses every pack id, handle, display name and Zernio id\n# found in packs/. Add anything else private: a real source, a person, a project.\n'
);
write(
  'README.md',
  `# open-frequency: private folder

This is $OF_HOME. It holds everything that belongs to the real accounts and must
never reach the public engine repository:

- \`packs/<id>/\`: one folder per account (pack.json, voice.md, theme.json,
  sources.json, formats.json, rules.json, and recordings/ for offline runs)
- \`data/\`: the SQLite database, rendered media, dry-run output, backups
- \`.env\`: the keys

Keep this folder in its own **private** git repository so it is backed up and the
VPS can pull it. That repo tracks packs/ and this file; \`.gitignore\` keeps
\`data/\` and \`.env\` out of it. Back up \`data/\` with \`npm run backup\`.

Inside the engine checkout this folder is \`./private/\` and gitignored there.
\`git clean -fdx\` in the engine checkout deletes it, so push it first.
`
);

if (packId) {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(packId)) {
    console.error(`"${packId}" is not a valid pack id (lowercase letters, digits, dashes)`);
    process.exit(1);
  }
  const dest = path.join(home, 'packs', packId);
  if (existsSync(dest)) console.log(`packs/${packId} already exists, left alone`);
  else {
    cpSync(path.join(home, 'templates', 'pack'), dest, { recursive: true });
    const pj = path.join(dest, 'pack.json');
    writeFileSync(pj, readFileSync(pj, 'utf8').replace('"your-pack-id"', JSON.stringify(packId)));
    made.push(`packs/${packId}/`);
  }
}

if (args.includes('--git') && !existsSync(path.join(home, '.git'))) {
  execFileSync('git', ['init', '-q'], { cwd: home });
  made.push('.git (a separate, private repository)');
}

console.log(`private folder: ${home}`);
console.log(made.length ? `created: ${made.join(', ')}` : 'already set up; nothing changed');
console.log(`\nnext:\n  1. fill in ${path.join(home, '.env')}\n  2. npm run init-private -- --pack <id>   (or use the website's New account page)\n  3. npm run dry -- --pack <id> --count 5`);
