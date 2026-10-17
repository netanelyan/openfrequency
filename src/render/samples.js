// One sample of every graphic type, with what breaks a right-to-left layout:
// Hebrew and Latin in one label, numbers with units, ranges, long names. Used by
// `npm run visuals` (for the eye) and by the render tests (for the fit pass).

const v = (type, items, extra = {}) => ({ type, title: '', a: '', b: '', style: '', ...extra, items: items.map(([label, value = '', value2 = '', sub = '']) => ({ label, value, value2, sub })) });

export const SAMPLE_VISUALS = {
  timeline: {
    slideTitle: 'מ-0:3 ל-3:3 בשש דקות',
    slideBody: 'במחצית הראשונה AC Milan הובילה, ובשש דקות של המחצית השנייה הכול התהפך.',
    visual: v('timeline', [["54'", 'Steven Gerrard מצמק בנגיחה'], ["56'", 'שמיצר מ-25 מטר'], ["60'", 'אלונסו משלים מהריבאונד'], ['2003–04', 'עונה של 38 משחקים']]),
  },
  bars: {
    slideTitle: 'מי כבש הכי הרבה',
    slideBody: 'שלושה שחקנים, שלוש עונות, פער אחד ענק.',
    visual: v('bars', [['Lionel Messi', '672 שערים'], ['כריסטיאנו רונאלדו', '450 שערים'], ['Raúl', '323 שערים']], { title: 'שערים בליגה, 2004–2021' }),
  },
  compare: {
    slideTitle: 'טייל אוף דה טייפ',
    slideBody: 'על הנייר, יתרון ברור לצד אחד.',
    visual: v('compare', [['ניצחונות', '27', '22'], ['גובה', '1.93 מ\'', '1.80 מ\''], ['טווח ידיים', '211 ס"מ', '188 ס"מ'], ['גיל', '35', '31']], { a: 'Jon Jones', b: 'סטיפה מיוצ\'יץ\'' }),
  },
  stat: {
    slideTitle: 'כמה מהם שילמו',
    slideBody: 'מתוך כל מי שנרשם בחודש הראשון.',
    visual: v('stat', [['מהנרשמים שילמו', '12%']]),
  },
  date: {
    slideTitle: 'הערב שבו הכול התחיל',
    slideBody: 'משחק אחד, קהל של 70,024 איש.',
    visual: v('date', [['25 במאי', '2005']]),
  },
  pitch: {
    slideTitle: 'ההרכב של הגמר',
    slideBody: 'בפיגור 3:0 במחצית, המאמן עבר לשלושה בלמים.',
    visual: v('pitch', [['Dudek', 'GK'], ['Carragher', 'CB'], ['Hyypiä', 'LCB'], ['Finnan', 'RCB'], ['Hamann', 'DM'], ['Alonso', 'LCM'], ['Gerrard', 'AM'], ['Riise', 'LWB'], ['Smicer', 'RWB'], ['Baroš', 'ST'], ['García', 'SS']], { title: 'ליברפול, המחצית השנייה' }),
  },
  kit: {
    slideTitle: 'הצבעים של הדרבי',
    slideBody: 'אדום מול צהוב, שכונה מול שכונה.',
    visual: v('kit', [['הפועל', '#C8102E #FFFFFF'], ['Maccabi', '#FFD100 #0033A0']]),
  },
  record: {
    slideTitle: 'רצף שלא נגמר',
    slideBody: 'הפסד אחד בכל הקריירה, וגם הוא בפסילה.',
    visual: v('record', [['Jon Jones', '27-1'], ['ח\'ביב נורמגומדוב', '29-0'], ['Alexander Volkanovski', '26-4-0']]),
  },
  ladder: {
    slideTitle: 'איפה הוא נלחם',
    slideBody: 'קטגוריה אחת מתחת למשקל בינוני.',
    visual: v('ladder', [['כבד', '120 ק"ג'], ['קל-כבד', '93 ק"ג'], ['בינוני', '84 ק"ג'], ['חצי-בינוני', '77 ק"ג', '', '*'], ['קל', '70 ק"ג']]),
  },
  stack: {
    slideTitle: 'הסטאק של MVP בשבוע',
    slideBody: 'ארבע שכבות, ושתיים מהן בחינם עד הלקוח הראשון.',
    visual: v('stack', [['ממשק', 'Next.js', '', 'חינם'], ['מודל', 'Claude Sonnet', '', '$3 למיליון טוקנים'], ['מסד נתונים', 'Supabase', '', '$25 לחודש'], ['תשלומים', 'Stripe', '', '2.9% + 30¢']]),
  },
  funnel: {
    slideTitle: 'מאיפה הגיעו 100 הראשונים',
    slideBody: 'רוב מי שביקר לא נשאר. מי שנשאר, שילם.',
    visual: v('funnel', [['ביקרו בדף', '12,400'], ['נרשמו', '1,130'], ['ניסו את המוצר', '420'], ['שילמו', '100']]),
  },
  pricing: {
    slideTitle: 'כמה זה עולה באמת',
    slideBody: 'שלוש תוכניות, והפער ביניהן הוא במגבלת השימוש.',
    visual: v('pricing', [['Hobby', 'חינם', '', '2,000 השלמות בחודש'], ['Pro', '$20 לחודש', '', 'שימוש מורחב'], ['Ultra', '$200 לחודש', '', 'פי 20 מ-Pro']]),
  },
  mock: {
    slideTitle: 'הפקודה הראשונה',
    slideBody: 'שלוש שורות, ויש לכם שרת שרץ.',
    visual: v('mock', [['npm create next-app my-mvp', 'Success! Created my-mvp'], ['cd my-mvp && npm run dev', 'Ready on http://localhost:3000']], { style: 'terminal' }),
  },
  dodont: {
    slideTitle: 'תראו בתוך השדה איך התשובה נראית',
    slideBody: 'כשרואים את הפורמט, ממלאים נכון כבר בפעם הראשונה.',
    visual: v('dodont', [['field', 'השם שלכם באינסטגרם...', '@noa.builds', 'Instagram ID'], ['field', 'מספר הכרטיס שלכם...', 'XXXX XXXX XXXX XXXX', 'מספר כרטיס אשראי'], ['button', '#2F6BFF המשך', '#2F6BFF המשך']], { style: 'app', title: 'טופס תשלום' }),
  },
};
