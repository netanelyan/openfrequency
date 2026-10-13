import { layout, icon } from './ui.js';

// The new-account flow. Filled in with source discovery and sample posts in
// phase 4; for now the page says what it will do.

export function onboardingRoutes() {
  return [
    [
      'GET',
      /^\/new$/,
      (_u, _m, _q, pc) =>
        layout({ ...pc, title: 'חשבון חדש', active: 'new' }, `<div class="head"><h1>חשבון חדש</h1></div><div class="empty">${icon('plus')}<b>בקרוב</b>גילוי מקורות ופוסטים לדוגמה.</div>`),
    ],
  ];
}
