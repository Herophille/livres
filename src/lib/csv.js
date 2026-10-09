// Lecture et écriture CSV (RFC 4180), sans dépendance.

// Analyse un texte CSV en tableau de lignes (tableaux de chaînes).
// Gère les guillemets, les guillemets doublés et les retours à la ligne dans un champ.
export function parseCsv(text, separator = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

// Lignes → objets, avec la première ligne comme en-têtes
export function csvToObjects(rows) {
  const [headers = [], ...data] = rows;
  const keys = headers.map((h) => h.trim());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

// Un tableur exécute une cellule qui commence par = + - @ comme une formule :
// on la neutralise avec une apostrophe
function cell(value, separator) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["\r\n]/.test(s) || s.includes(separator) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Écrit un CSV pour Excel ou LibreOffice en français : point-virgule, BOM UTF-8, fins de ligne CRLF
export function toCsv(headers, rows, separator = ';') {
  const lines = [headers, ...rows].map((r) => r.map((v) => cell(v, separator)).join(separator));
  return `﻿${lines.join('\r\n')}\r\n`;
}
