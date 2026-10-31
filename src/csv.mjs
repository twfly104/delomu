// Minimal RFC 4180 CSV: quoted fields, escaped quotes, CRLF, leading BOM.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ''));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map(h => h.trim().toLowerCase());
  return nonEmpty.slice(1).map(r => Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])));
}

export function toCsvLine(values) {
  return values.map(v => {
    const t = String(v ?? '');
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(',');
}
