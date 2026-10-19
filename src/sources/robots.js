import { getText } from '../core/net.js';

// A site's own word on being read: its robots.txt, obeyed before any feed or page of a source is fetched.
//
// Two readers are asked about, and both must be let in. The engine itself, as the site's rules for its own name
// ("open-frequency") or for every reader ("*"). And Claude, because everything a source says goes to Claude to be
// drafted from: a site that tells Anthropic's agents to stay out ("anthropic-ai", "ClaudeBot", "Claude-User"...)
// has said no to that, whatever it says to everyone else. The Athletic, the BBC, the Guardian, ESPN and TechCrunch
// all say it, and none of them is read.
//
// Rules follow RFC 9309: the group naming the agent (else "*"), the longest matching path wins, Allow wins a tie,
// "*" and "$" in a path. A robots.txt that is not there (4xx) allows everything; one that cannot be read (5xx, the
// network) allows nothing this time.

export const OUR_AGENT = 'open-frequency';
export const CLAUDE_AGENTS = ['anthropic-ai', 'claudebot', 'claude-web', 'claude-user', 'claude-searchbot', 'claude'];

const TTL_MS = 12 * 3600_000;
const cache = new Map();

/** robots.txt as groups: [{ agents: ['*'], rules: [['allow'|'disallow', '/path']] }]. Pure. */
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (field === 'allow' || field === 'disallow')) cur.rules.push([field, value]);
    }
  }
  return groups;
}

const pathRe = (p) => new RegExp(`^${p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$|\$$/, '$')}`);

/** Whether one agent may read a path, by the parsed rules. Pure. */
export function allowedFor(groups, agent, pathAndQuery) {
  const a = agent.toLowerCase();
  // The most specific group: one naming this agent (a token the user-agent line contains), else "*".
  const named = groups.filter((g) => g.agents.some((x) => x !== '*' && (x === a || a.startsWith(x))));
  const rules = (named.length ? named : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const [kind, p] of rules) {
    if (kind === 'disallow' && p === '') continue; // "Disallow:" with nothing allows everything
    if (!pathRe(p).test(pathAndQuery)) continue;
    const len = p.replace(/[*$]/g, '').length;
    if (!best || len > best.len || (len === best.len && kind === 'allow')) best = { kind, len, p };
  }
  return best?.kind !== 'disallow' ? { ok: true } : { ok: false, rule: best.p };
}

/**
 * Whether a source may be read at this URL: { ok, why }. `read` replaces the network for the tests, and returns
 * { status, body }.
 */
export async function robotsAllows(url, { read = null, t = Date.now() } = {}) {
  const u = new URL(url);
  let entry = cache.get(u.origin);
  if (!entry || t - entry.at > TTL_MS) {
    let r;
    try {
      r = read ? await read(`${u.origin}/robots.txt`) : await getText(`${u.origin}/robots.txt`, { timeoutMs: 15_000 }).then((x) => ({ status: 200, body: x.body }));
    } catch (e) {
      r = { status: e.status || 0, body: '' };
    }
    entry = { at: t, status: r.status, groups: r.status >= 200 && r.status < 300 ? parseRobots(r.body) : [] };
    cache.set(u.origin, entry);
  }
  if (entry.status >= 400 && entry.status < 500) return { ok: true, why: null };
  if (!(entry.status >= 200 && entry.status < 300)) return { ok: false, why: `${u.hostname}'s robots.txt could not be read, so nothing there is read now` };
  const at = `${u.pathname}${u.search}`;
  const ours = allowedFor(entry.groups, OUR_AGENT, at);
  if (!ours.ok) return { ok: false, why: `${u.hostname}'s robots.txt disallows ${ours.rule} for this reader` };
  for (const agent of CLAUDE_AGENTS) {
    const c = allowedFor(entry.groups.filter((g) => g.agents.some((x) => x !== '*')), agent, at);
    if (!c.ok) return { ok: false, why: `${u.hostname}'s robots.txt tells Claude's agents (${agent}) to stay out of ${c.rule}, and what a source says is drafted by Claude` };
  }
  return { ok: true, why: null };
}

/** Forget what was read (the tests; a source re-checked by hand). */
export const clearRobots = () => cache.clear();
