// Normalise un ISBN-10 ou ISBN-13 en ISBN-13, ou renvoie null s'il est invalide.
export function normalizeIsbn(input) {
  if (!input) return null;
  const clean = String(input).toUpperCase().replace(/[^0-9X]/g, '');
  if (clean.length === 13 && /^\d{13}$/.test(clean)) {
    return isValidIsbn13(clean) ? clean : null;
  }
  if (clean.length === 10 && /^\d{9}[\dX]$/.test(clean)) {
    if (!isValidIsbn10(clean)) return null;
    const core = '978' + clean.slice(0, 9);
    return core + isbn13CheckDigit(core);
  }
  return null;
}

function isValidIsbn10(s) {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const v = s[i] === 'X' ? 10 : Number(s[i]);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isValidIsbn13(s) {
  return isbn13CheckDigit(s.slice(0, 12)) === s[12];
}
