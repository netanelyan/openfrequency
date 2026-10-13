import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ofHome } from './paths.js';

// Keys live in $OF_HOME/.env and nowhere else. A tiny parser rather than a
// dependency: KEY=value lines, # comments, optional quotes. Values already in the
// environment win, so a systemd unit or a test can override a file.

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

let loaded = false;

/** Load $OF_HOME/.env into process.env once. Returns the file's path, or null. */
export function loadEnv(env = process.env) {
  if (loaded) return null;
  loaded = true;
  const file = path.join(ofHome(env), '.env');
  if (!existsSync(file)) return null;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (env[k] === undefined) env[k] = v;
  }
  return file;
}

/** Is a key set (non-empty)? Never returns the value. */
export const isSet = (name, env = process.env) => Boolean(String(env[name] || '').trim());

/**
 * Every variable the engine reads, grouped, for the Settings page and the
 * check that .env.example lists them all. The values are never shown anywhere.
 */
export const KEYS = [
  { name: 'ANTHROPIC_API_KEY', group: 'drafting', what: 'Claude: drafting, review, scoring' },
  { name: 'ZERNIO_API_KEY', group: 'publishing', what: 'Zernio: publishing and analytics' },
  { name: 'BRAVE_API_KEY', group: 'discovery', what: 'Brave Search: finding sources for a new account' },
  { name: 'YOUTUBE_API_KEY', group: 'discovery', what: 'YouTube Data API: formats that work now' },
  { name: 'PEXELS_API_KEY', group: 'images', what: 'Pexels photographs' },
  { name: 'UNSPLASH_ACCESS_KEY', group: 'images', what: 'Unsplash photographs' },
  { name: 'SESSION_SECRET', group: 'website', what: 'signs the login cookie' },
  { name: 'OF_ADMIN_PASSWORD', group: 'website', what: 'the first user\'s password, used once to create it' },
];
