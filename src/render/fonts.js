import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assetsDir } from '../core/paths.js';

// The Hebrew faces the engine can set a slide in. All SIL Open Font License,
// bundled in assets/fonts with their licence files, and inlined into every render
// as data URIs: a webfont that fails to load does not error, it silently falls
// back, and on a bare Linux box the fallback for Hebrew is tofu boxes.
//
// A pack names faces from this list in theme.json. Adding a face is a file here
// and in assets/fonts, never a change to a pack.

export const FONTS = {
  Heebo: [{ file: 'Heebo.ttf', weight: '100 900' }],
  Assistant: [{ file: 'Assistant.ttf', weight: '200 800' }],
  'Frank Ruhl Libre': [{ file: 'FrankRuhlLibre.ttf', weight: '300 900' }],
  Rubik: [{ file: 'Rubik.ttf', weight: '300 900' }],
  'Secular One': [{ file: 'SecularOne-Regular.ttf', weight: '400' }],
  Karantina: [
    { file: 'Karantina-Regular.ttf', weight: '400' },
    { file: 'Karantina-Bold.ttf', weight: '700' },
  ],
  'IBM Plex Sans Hebrew': [
    { file: 'IBMPlexSansHebrew-Regular.ttf', weight: '400' },
    { file: 'IBMPlexSansHebrew-SemiBold.ttf', weight: '600' },
    { file: 'IBMPlexSansHebrew-Bold.ttf', weight: '700' },
  ],
  'Suez One': [{ file: 'SuezOne-Regular.ttf', weight: '400' }],
  'Varela Round': [{ file: 'VarelaRound-Regular.ttf', weight: '400' }],
};

export const isFont = (name) => Object.prototype.hasOwnProperty.call(FONTS, name);

const cache = new Map();
function dataUri(file) {
  if (!cache.has(file)) {
    const buf = readFileSync(path.join(assetsDir, 'fonts', file));
    cache.set(file, `data:font/ttf;base64,${buf.toString('base64')}`);
  }
  return cache.get(file);
}

/** @font-face rules for the named families, inlined. */
export function fontFaces(families) {
  const seen = new Set();
  const out = [];
  for (const fam of families) {
    if (seen.has(fam) || !isFont(fam)) continue;
    seen.add(fam);
    for (const f of FONTS[fam]) {
      out.push(`@font-face{font-family:'${fam}';src:url(${dataUri(f.file)}) format('truetype');font-weight:${f.weight};font-style:normal;font-display:block;}`);
    }
  }
  return out.join('\n');
}
