import { db } from '../db/index.js';
import { FORMAT_LABELS, languageLabel, countryLabel } from './labels.js';

// Nombre de lignes affichées par répartition avant de regrouper le reste dans « Autres »
const TOP = 7;
const monthName = (style) => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat('fr-FR', { month: style, timeZone: 'UTC' })
  .format(new Date(Date.UTC(2000, i, 1))));
const MONTHS = monthName('short');
const MONTHS_LONG = monthName('long');

// Livres lus d'un utilisateur, avec l'édition lue (sinon la première édition de l'œuvre)
function readBooks(userId) {
  return db.prepare(`
    SELECT r.finished_on, w.country_code, g.name AS genre, rv.rating,
      e.page_count, e.format, e.language
    FROM readings r
    JOIN works w ON w.id = r.work_id
    LEFT JOIN genres g ON g.id = w.genre_id
    LEFT JOIN reviews rv ON rv.work_id = r.work_id AND rv.user_id = r.user_id
    LEFT JOIN editions e ON e.id = COALESCE(r.edition_id, (SELECT id FROM editions WHERE work_id = w.id ORDER BY id LIMIT 1))
    WHERE r.user_id = ? AND r.status = 'lu'
  `).all(userId);
}

// Répartition par une propriété : les plus fréquents d'abord, le reste dans « Autres ».
// Les livres sans valeur sont comptés à part (« non renseigné »), pas dans les barres.
function breakdown(books, labelOf) {
  const counts = new Map();
  let unknown = 0;
  for (const b of books) {
    const label = labelOf(b);
    if (!label) { unknown++; continue; }
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const sorted = [...counts].map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'fr'));
  const rows = sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  if (rest.length) rows.push({ label: `Autres (${rest.length})`, n: rest.reduce((s, r) => s + r.n, 0), other: true });
  const max = Math.max(1, ...rows.map((r) => r.n));
  return { rows: rows.map((r) => ({ ...r, pct: Math.round((r.n / max) * 100) })), unknown };
}

// Colonnes (par année ou par mois) : livres et pages, hauteurs en % du maximum.
// Sur un écran de téléphone, toutes les étiquettes ne tiennent pas : `isTick(i, n)` choisit
// celles qu'on écrit. Au-delà de 12 colonnes, plus de valeurs au-dessus des barres.
function columns(buckets, isTick) {
  const maxBooks = Math.max(1, ...buckets.map((b) => b.books));
  const maxPages = Math.max(1, ...buckets.map((b) => b.pages));
  return buckets.map((b, i) => ({
    ...b,
    booksPct: Math.round((b.books / maxBooks) * 100),
    pagesPct: Math.round((b.pages / maxPages) * 100),
    tick: isTick(i, buckets.length),
    showValue: buckets.length <= 12,
  }));
}

function bucketBooks(label, books) {
  return { label, books: books.length, pages: books.reduce((s, b) => s + (b.page_count || 0), 0) };
}

// Statistiques d'un utilisateur, pour toutes les années ou une seule
export function readingStats(userId, year = null) {
  const all = readBooks(userId);
  const yearOf = (b) => (b.finished_on ? b.finished_on.slice(0, 4) : null);
  const years = [...new Set(all.map(yearOf).filter(Boolean))].sort().reverse();
  const selectedYear = years.includes(year) ? year : null;
  const books = selectedYear ? all.filter((b) => yearOf(b) === selectedYear) : all;

  // Par mois pour une année choisie, sinon par année (années vides comprises, pour une échelle de temps honnête)
  let timeline;
  if (selectedYear) {
    // Étiquettes : janv., avr., juil., oct. (les douze ne tiennent pas en largeur)
    timeline = columns(MONTHS.map((m, i) => ({
      ...bucketBooks(m, books.filter((b) => Number(b.finished_on.slice(5, 7)) === i + 1)), long: MONTHS_LONG[i],
    })), (i) => i % 3 === 0);
  } else if (years.length) {
    const first = Number(years[years.length - 1]);
    const last = Number(years[0]);
    timeline = columns(Array.from({ length: last - first + 1 }, (_, i) => String(first + i))
      .map((y) => bucketBooks(y, all.filter((b) => yearOf(b) === y))),
      // Six étiquettes au plus, en partant de la plus récente (toujours écrite)
      (i, n) => (n - 1 - i) % Math.ceil(n / 6) === 0);
  } else {
    timeline = [];
  }

  const rated = books.filter((b) => b.rating);
  return {
    years,
    year: selectedYear,
    total: books.length,
    pages: books.reduce((s, b) => s + (b.page_count || 0), 0),
    withoutPages: books.filter((b) => !b.page_count).length,
    average: rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null,
    ratedCount: rated.length,
    undated: selectedYear ? 0 : all.filter((b) => !b.finished_on).length,
    timeline,
    genres: breakdown(books, (b) => b.genre),
    languages: breakdown(books, (b) => languageLabel(b.language)),
    countries: breakdown(books, (b) => countryLabel(b.country_code)),
    formats: breakdown(books, (b) => FORMAT_LABELS[b.format]),
  };
}
