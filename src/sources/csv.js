// CSV, the way government datasets publish it: a header row, commas (or
// semicolons, or tabs), fields in double quotes when they hold the delimiter, a
// quote or a line break, and "" for a quote inside one. RFC 4180, plus the two
// things real files do: a byte-order mark at the start, and \r\n line endings.

/** The delimiter the header line uses most: comma, semicolon or tab. */
export function sniffDelimiter(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Parse CSV into rows of strings. */
export function parseRows(text, delimiter = null) {
  const s = String(text || '').replace(/^﻿/, '');
  const d = delimiter || sniffDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

/** Parse CSV with a header into objects keyed by the header's names. */
export function parseCsv(text, { delimiter = null } = {}) {
  const [head = [], ...rest] = parseRows(text, delimiter);
  const keys = head.map((h) => h.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
