import { contrast, deltaE, isHex, bestInk } from '../render/color.js';
import { isFont } from '../render/fonts.js';
import { isTemplate, TEMPLATES } from '../render/templates/registry.js';
import { COMPLIANCE, FINANCIAL, isCompliance } from '../rules/compliance.js';

// What a pack must be, checked in code. Every problem is one line of English the
// website and the CLI can print. An empty list means the pack is valid.
//
// Two levels:
//   validatePack(pack)   one pack on its own: shape, colours, contrast, compliance
//   validateAll(packs)   the set: HARD RULE 2, each account a distinct brand

export const MODES = ['approve', 'digest', 'auto'];
export const PLATFORMS = ['tiktok', 'instagram'];
export const PUBLISHERS = ['dry', 'zernio'];
export const SOURCE_TYPES = ['rss', 'web', 'api'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HANDLE = /^[a-z0-9][a-z0-9._]{1,29}$/;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

export function validatePack(pack) {
  const p = [];
  const { meta = {}, theme = {}, sources = {}, formats = {}, rules = {}, voice = '' } = pack || {};

  // ---- pack.json
  if (!ID.test(meta.id || '')) p.push(`pack.json: id "${meta.id}" must be lowercase letters, digits and dashes`);
  if (pack?.dirName && meta.id !== pack.dirName) p.push(`pack.json: id "${meta.id}" must match its folder "${pack.dirName}"`);
  if (!String(meta.displayName || '').trim()) p.push('pack.json: displayName is required');
  if (!HANDLE.test(meta.handle || '')) p.push(`pack.json: handle "${meta.handle}" must be 2-30 of a-z 0-9 . _ (no @)`);
  if (meta.language !== 'he') p.push('pack.json: language must be "he" (the engine writes Hebrew, right to left)');
  if (!Array.isArray(meta.platforms) || !meta.platforms.length || meta.platforms.some((x) => !PLATFORMS.includes(x))) {
    p.push(`pack.json: platforms must be a non-empty list of ${PLATFORMS.join(', ')}`);
  }
  if (!PUBLISHERS.includes(meta.publisher || 'dry')) p.push(`pack.json: publisher must be one of ${PUBLISHERS.join(', ')}`);
  if (meta.publisher === 'zernio' && !String(meta.zernio?.profileId || '').trim()) p.push('pack.json: publisher "zernio" needs zernio.profileId');
  const s = meta.schedule || {};
  if (!Array.isArray(s.slots) || !s.slots.length || s.slots.some((x) => !HHMM.test(x))) p.push('pack.json: schedule.slots must be a list of "HH:MM"');
  if (s.windows && (!Array.isArray(s.windows) || s.windows.some((w) => !Array.isArray(w) || w.length !== 2 || !(w[0] < w[1])))) p.push('pack.json: schedule.windows must be [[from, to], ...] hours');
  for (const [d, list] of Object.entries(s.slotsByDay || {})) {
    if (!/^[0-6]$/.test(d) || !Array.isArray(list) || list.some((x) => !HHMM.test(x))) p.push(`pack.json: schedule.slotsByDay.${d} must be a list of "HH:MM"`);
  }
  if (!MODES.includes(meta.autonomy?.mode || 'approve')) p.push(`pack.json: autonomy.mode must be one of ${MODES.join(', ')}`);
  const budget = Number(meta.budget?.monthlyUsd);
  if (!(budget > 0 && budget <= 2000)) p.push('pack.json: budget.monthlyUsd must be a number between 0 and 2000');
  for (const c of meta.compliance || []) if (!isCompliance(c)) p.push(`pack.json: unknown compliance check "${c}" (have: ${Object.keys(COMPLIANCE).join(', ')})`);
  const about = [meta.displayName, meta.audience, meta.description, ...(meta.topics || [])].join(' ');
  if (FINANCIAL.test(about) && !(meta.compliance || []).includes('il-investment-advice')) {
    p.push('pack.json: this pack is about money, so compliance must include "il-investment-advice" (hard rule 6)');
  }
  if (!Array.isArray(meta.topics) || !meta.topics.length) p.push('pack.json: topics must list what the account is about');

  // ---- theme.json
  if (!isTemplate(theme.template, theme.variant || 'a')) {
    p.push(`theme.json: template "${theme.template}" variant "${theme.variant || 'a'}" is not in the library (have: ${Object.entries(TEMPLATES).map(([k, v]) => `${k}/${v.variants.join('|')}`).join(', ')})`);
  }
  const c = theme.colors || {};
  for (const k of ['bg', 'surface', 'ink', 'muted', 'accent', 'accent2']) if (!isHex(c[k])) p.push(`theme.json: colors.${k} must be a hex colour`);
  if (['bg', 'surface', 'ink', 'muted', 'accent'].every((k) => isHex(c[k]))) {
    // Legibility is a property of the palette before it is a property of a slide.
    const pairs = [
      ['ink', 'bg', 7],
      ['ink', 'surface', 7],
      ['muted', 'bg', 4.5],
    ];
    for (const [a, b, min] of pairs) {
      const r = contrast(c[a], c[b]);
      if (r < min) p.push(`theme.json: ${a} on ${b} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
    const onAccent = c.onAccent && isHex(c.onAccent) ? c.onAccent : bestInk(c.accent, c.ink, c.bg);
    if (contrast(onAccent, c.accent) < 4.5) p.push(`theme.json: text on accent is ${contrast(onAccent, c.accent).toFixed(2)}:1, needs 4.5:1 (set colors.onAccent)`);
  }
  for (const k of ['display', 'text']) if (!isFont(theme.fonts?.[k])) p.push(`theme.json: fonts.${k} "${theme.fonts?.[k]}" is not a bundled font`);

  // ---- sources.json
  const list = sources.sources || [];
  if (!list.length) p.push('sources.json: at least one approved source');
  const keys = new Set();
  for (const src of list) {
    const where = `sources.json: "${src.id}"`;
    if (!src.id || keys.has(src.id)) p.push(`${where}: id missing or repeated`);
    keys.add(src.id);
    if (!SOURCE_TYPES.includes(src.type)) p.push(`${where}: type must be ${SOURCE_TYPES.join(', ')}`);
    if (!/^https:\/\//.test(src.url || '')) p.push(`${where}: url must be https`);
    if (!String(src.name || '').trim()) p.push(`${where}: name is required`);
    if (String(src.why || '').trim().length < 10) p.push(`${where}: "why" must say why it is trusted`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(src.approvedAt || '')) p.push(`${where}: approvedAt must be a date`);
  }

  // ---- formats.json
  const fl = formats.formats || [];
  if (!fl.length) p.push('formats.json: at least one format');
  const fids = new Set();
  for (const f of fl) {
    const where = `formats.json: "${f.id}"`;
    if (!f.id || fids.has(f.id)) p.push(`${where}: id missing or repeated`);
    fids.add(f.id);
    if (!String(f.name || '').trim()) p.push(`${where}: name is required`);
    if (!Array.isArray(f.hooks) || !f.hooks.length) p.push(`${where}: hooks must list at least one pattern`);
    const [lo, hi] = f.items || [];
    if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 2 && hi <= 10 && lo <= hi)) p.push(`${where}: items must be [min, max] between 2 and 10`);
    if (!Array.isArray(f.closers) || !f.closers.length || f.closers.some((x) => !String(x?.title || '').trim())) p.push(`${where}: closers must list at least one { title, body }`);
  }
  if (!Array.isArray(formats.caption?.questions) || !formats.caption.questions.length) p.push('formats.json: caption.questions must list at least one question');
  const tags = [...(formats.hashtags?.broad || []), ...(formats.hashtags?.niche || [])];
  if (tags.length < 3 || tags.some((t) => !/^#[\p{L}\p{N}_]+$/u.test(t))) p.push('formats.json: hashtags.broad + hashtags.niche need at least 3 tags like #מילה');

  // ---- rules.json
  if (!isObj(rules)) p.push('rules.json: must be an object');
  const mq = Number(rules.maxQuoteWords ?? 40);
  if (!(mq >= 8 && mq <= 60)) p.push('rules.json: maxQuoteWords must be between 8 and 60 (short facts only)');
  for (const r of rules.patterns || []) {
    try {
      new RegExp(r.regex, 'u');
    } catch {
      p.push(`rules.json: pattern "${r.id}" is not a valid regular expression`);
    }
    if (!String(r.message || '').trim()) p.push(`rules.json: pattern "${r.id}" needs a message`);
  }

  // ---- voice.md
  const v = String(voice || '');
  if (v.trim().length < 200) p.push('voice.md: describe who is talking, to whom, and how (at least a few paragraphs)');
  const { good, bad } = voiceExamples(v);
  if (good.length < 3) p.push('voice.md: at least 3 good example lines under a "## שורות טובות" heading');
  if (bad.length < 3) p.push('voice.md: at least 3 bad example lines under a "## שורות רעות" heading');

  return p;
}

/** The example lines in voice.md, by heading. */
export function voiceExamples(md) {
  const out = { good: [], bad: [] };
  let into = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^#{2,3}\s*(.+)$/.exec(line);
    if (h) {
      into = /טוב|good/i.test(h[1]) ? 'good' : /רע|bad/i.test(h[1]) ? 'bad' : null;
      continue;
    }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (into && b) out[into].push(b[1].replace(/^["“]|["”]$/g, '').trim());
  }
  return out;
}

/**
 * HARD RULE 2 across the set: each account is a distinct brand. Refuses shared
 * ids, handles, display names, Zernio profiles and accounts, a shared visual
 * template, a display face used by two packs, and palettes too close to tell apart.
 */
export function validateAll(packs) {
  const p = [];
  const seen = (field, get) => {
    const map = new Map();
    for (const pk of packs) {
      const v = String(get(pk) || '').trim().toLowerCase();
      if (!v) continue;
      if (map.has(v)) p.push(`${pk.meta.id} and ${map.get(v)} share the same ${field}`);
      else map.set(v, pk.meta.id);
    }
  };
  seen('id', (x) => x.meta.id);
  seen('handle', (x) => x.meta.handle);
  seen('display name', (x) => x.meta.displayName);
  seen('Zernio profile', (x) => x.meta.zernio?.profileId);
  for (const plat of PLATFORMS) seen(`Zernio ${plat} account`, (x) => x.meta.zernio?.accounts?.[plat]);
  seen('visual template', (x) => `${x.theme.template}/${x.theme.variant || 'a'}`);
  seen('display font', (x) => x.theme.fonts?.display);

  for (let i = 0; i < packs.length; i++) {
    for (let k = i + 1; k < packs.length; k++) {
      const a = packs[i].theme.colors || {};
      const b = packs[k].theme.colors || {};
      if (![a.bg, b.bg, a.accent, b.accent].every(isHex)) continue;
      const dBg = deltaE(a.bg, b.bg);
      const dAccent = deltaE(a.accent, b.accent);
      if (dBg < 12 && dAccent < 20) {
        p.push(`${packs[i].meta.id} and ${packs[k].meta.id} have palettes too close to tell apart (background ΔE ${dBg.toFixed(1)}, accent ΔE ${dAccent.toFixed(1)})`);
      }
    }
  }
  return p;
}
