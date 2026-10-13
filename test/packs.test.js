import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadAll, loadPack, readPack } from '../src/packs/load.js';
import { validateAll, validatePack } from '../src/packs/validate.js';
import { copyPack, DEMO, tempHome } from './helpers.js';
import { investmentAdvice } from '../src/rules/compliance.js';

test('the demo pack is valid', () => {
  assert.doesNotThrow(() => loadPack(DEMO));
});

test('two packs with the same theme fail validation (hard rule 2)', () => {
  const { home, cleanup } = tempHome({ packs: { demo: null, twin: null } });
  try {
    assert.throws(() => loadAll({ dir: path.join(home, 'packs') }), /share the same visual template/);
  } finally {
    cleanup();
  }
});

test('two packs on different templates but near-identical colours also fail', () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    copyPack(home, 'demo');
    copyPack(home, 'near', (f) => {
      f.theme.template = 'poster';
      f.theme.fonts.display = 'Secular One';
      f.theme.colors.bg = '#EDF0E3';
      f.theme.colors.accent = '#B5522B';
    });
    assert.throws(() => loadAll({ dir: path.join(home, 'packs') }), /palettes too close/);
  } finally {
    cleanup();
  }
});

test('packs may not share a handle, a name, a display face or a Zernio profile', () => {
  const a = readPack(DEMO);
  const b = structuredClone(a);
  b.meta.id = 'other';
  b.theme.template = 'poster';
  b.theme.colors = { ...b.theme.colors, bg: '#101820', accent: '#3FA7D6' };
  const problems = validateAll([a, b]).join('\n');
  assert.match(problems, /same handle/);
  assert.match(problems, /same display name/);
  assert.match(problems, /same display font/);
});

test('a pack about money must enable the investment-advice check', () => {
  const p = readPack(DEMO);
  p.meta.topics = ['חיסכון ופנסיה'];
  assert.match(validatePack(p).join(), /il-investment-advice/);
  p.meta.compliance = ['il-investment-advice'];
  assert.equal(validatePack(p).filter((x) => /il-investment-advice/.test(x)).length, 0);
});

test('a theme without enough contrast is refused', () => {
  const p = readPack(DEMO);
  p.theme.colors.ink = '#C9CFBF';
  assert.match(validatePack(p).join(), /ink on bg/);
});

test('a source without a reason to trust it is refused', () => {
  const p = readPack(DEMO);
  p.sources.sources[0].why = '';
  p.sources.sources[0].url = 'http://insecure.example.com';
  const all = validatePack(p).join('\n');
  assert.match(all, /why/);
  assert.match(all, /https/);
});

test('investment advice: recommending is refused, explaining is not', () => {
  for (const bad of [
    'כדאי להשקיע בקרן מחקה S&P 500 של מיטב',
    'הקרן הכי משתלמת היא של הראל',
    'תעבירו את קרן ההשתלמות למסלול מניות',
    'המניה הזו צפויה לזנק בחודש הבא',
    'תשואה מובטחת של 8% בשנה',
    'כדאי לקנות VOO ולשכוח מזה',
    'תעבירו את קרן ההשתלמות למגדל',
    'כדאי להשקיע עם מיטב דש',
  ]) assert.ok(investmentAdvice(bad).length, bad);
  for (const ok of [
    'קרן השתלמות פטורה ממס רווחי הון אחרי 6 שנים',
    'דמי ניהול בקרן פנסיה מקיפה מוגבלים בחוק',
    'בדקו בתלוש כמה מופרש לפנסיה',
    'מסלול מניות הוא מסלול שבו רוב הכסף מושקע במניות',
    'מדד המחירים לצרכן עלה ב-0.3% בספטמבר',
    // provider names that are also ordinary words
    'כדאי לבדוק את זה, כי בדרך כלל זה עובד',
    'מומלץ לבחור קופה, ככלל עם דמי ניהול נמוכים, כך אומרים גם המורים',
  ]) assert.deepEqual(investmentAdvice(ok), [], ok);
});
