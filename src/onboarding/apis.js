// A catalog of open, structured data sources, offered during onboarding when a
// niche's words match. A structured source is the best kind there is for this
// engine: a number from an API is quotable exactly, and nobody's prose is
// copied. Each entry says what it is and why it can be trusted; the owner still
// approves it. Adding an entry is a line here; no pack ever needs one.

export const API_CATALOG = [
  {
    match: /.*/,
    type: 'api', url: 'https://query.wikidata.org/sparql', name: 'Wikidata',
    why: 'Structured, sourced facts under CC0: dates, places, people, records. Every value carries its own reference.',
    api: { kind: 'wikidata-sparql', query: 'SELECT ?item ?itemLabel WHERE { ?item wdt:P31 wd:Q5 } LIMIT 1' }, terms: 'ok',
  },
  {
    match: /ממשל|זכויות|מדינה|ציבור|government|rights|public|מס|ביטוח|רווחה|תחבורה|בריאות|חינוך|data/i,
    type: 'api', url: 'https://data.gov.il/api/3/action/package_search', name: 'data.gov.il: מאגרי המידע הממשלתיים',
    why: "The Israeli government's open data portal (CKAN): official datasets from ministries and authorities.", terms: 'ok',
  },
  {
    match: /מחיר|מדד|יוקר|אינפלציה|שכר|אוכלוסי|price|inflation|cpi|wage|statistics|כסף|money/i,
    type: 'api', url: 'https://api.cbs.gov.il/index/data/price', name: 'הלשכה המרכזית לסטטיסטיקה: API מדדים',
    why: "Israel's Central Bureau of Statistics: the consumer price index and other official indices, as data.", terms: 'ok',
  },
  {
    match: /ריבית|בנק|מט"ח|שער|משכנתא|interest|bank|exchange|mortgage|כסף|money/i,
    type: 'api', url: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0', name: 'בנק ישראל: נתונים סטטיסטיים',
    why: 'The Bank of Israel publishes its interest rate and exchange rates as open SDMX data.', terms: 'ok',
  },
  {
    match: /כדורגל|ליגה|מונדיאל|football|soccer|league|world cup/i,
    type: 'api', url: 'https://raw.githubusercontent.com/openfootball/football.json/master/2024-25/en.1.json', name: 'openfootball: תוצאות ליגות (מאגר פתוח)',
    why: 'Public domain fixtures and results, maintained in the open on GitHub.', terms: 'ok', api: { kind: 'json', path: 'matches', fields: ['round', 'date', 'team1', 'team2', 'score.ft'] },
  },
  {
    match: /מזג|אקלים|גשם|weather|climate|rain|גינון|garden|חקלאות/i,
    type: 'api', url: 'https://archive-api.open-meteo.com/v1/archive', name: 'Open-Meteo: נתוני אקלים היסטוריים',
    why: 'Open historical weather from national weather services and ERA5 reanalysis, free for non-commercial and attributed use.', terms: 'check',
  },
  {
    match: /AI|בינה|טכנולוגי|קוד|תוכנה|tech|software|developer|github/i,
    type: 'rss', url: 'https://github.blog/changelog/feed/', name: 'GitHub Changelog',
    why: 'The official, dated record of every GitHub feature change.', terms: 'check',
  },
];

/** The catalog entries whose words match the seed. */
export function suggestApis(seed) {
  const text = [seed.niche, seed.nicheEn, seed.audience, ...(seed.topics || [])].filter(Boolean).join(' ');
  return API_CATALOG.filter((a) => a.match.test(text)).map(({ match, ...a }) => a);
}
