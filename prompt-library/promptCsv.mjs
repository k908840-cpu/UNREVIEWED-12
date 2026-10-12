// Minimal RFC 4180 CSV helpers for the Base44 `Prompt` entity export.
// The export quotes every field, uses LF line endings, and has no trailing
// newline; serializeCsv(parseCsv(x)) reproduces that exactly (see tests).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return { header, rows: body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))) };
}

export function serializeCsv({ header, rows }) {
  const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [header, ...rows.map((r) => header.map((h) => r[h]))]
    .map((cells) => cells.map(cell).join(','))
    .join('\n');
}

export const placeholderCount = (text) => (text.match(/\[NAME\]/g) || []).length;
