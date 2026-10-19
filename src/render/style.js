import { createHash } from 'node:crypto';
import { getSetting, setSetting } from '../core/store.js';
import { nowIso } from '../core/clock.js';
import { isTemplate } from './templates/registry.js';

// An account's look, locked: the base style every post is drawn in, saved the first time the account renders.
//
// theme.json is the account's look, but it is a file anyone can change, and a change took effect on the next
// render: two posts of one day could come out in two looks, and a post edited after a theme change was drawn again
// in the new one, half its slides already out in the old. Now the look is saved (settings `style:<account>`) and
// every render draws from the saved one. A change to theme.json waits, and the Accounts page says so, until the
// owner applies it. Each post keeps the hash of the look it was drawn in, and drawing it again (an edit) uses that
// one, so a post never mixes two.
//
// HARD RULE 2 comes first: a saved look whose template and variant another account now uses in its theme.json is
// given up for this account's own current theme.json, so two accounts never draw the same look.

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

/** A look's hash: the same theme, in any key order, has the same one. */
export const styleHash = (theme) => createHash('sha256').update(JSON.stringify(canon(theme))).digest('hex').slice(0, 12);

const lookOf = (theme) => `${theme?.template}/${theme?.variant || 'a'}`;

function save(db, id, theme) {
  const lock = { hash: styleHash(theme), theme: canon(theme), at: nowIso() };
  setSetting(db, `style:${id}`, lock);
  // Every look a post was drawn in stays, by its hash, for drawing that post again.
  setSetting(db, `style:${id}:${lock.hash}`, lock.theme);
  return lock;
}

/**
 * The look an account draws in now: { theme, hash, at, pending }. `pending` is the hash of a theme.json that
 * differs from the saved look, waiting for the owner; null when they agree. `packs`: every account, for hard rule 2.
 */
export function lockedStyle(db, pack, packs = []) {
  const now = styleHash(pack.theme);
  let lock = getSetting(db, `style:${pack.id}`, null);
  const clash = lock && packs.some((o) => o.id !== pack.id && lookOf(o.theme) === lookOf(lock.theme));
  // No saved look yet, one the library no longer has, or one another account now uses: theme.json, saved.
  if (!lock || !isTemplate(lock.theme?.template, lock.theme?.variant || 'a') || clash) lock = save(db, pack.id, pack.theme);
  return { theme: lock.theme, hash: lock.hash, at: lock.at, pending: lock.hash !== now ? now : null };
}

/** The owner applies theme.json: it becomes the saved look. */
export const lockStyle = (db, pack) => save(db, pack.id, pack.theme);

/** The look one post was drawn in, by its hash, or null when it was drawn before looks were saved. */
export function styleByHash(db, pack, hash) {
  const theme = hash ? getSetting(db, `style:${pack.id}:${hash}`, null) : null;
  return theme && isTemplate(theme.template, theme.variant || 'a') ? { theme, hash } : null;
}
