// Export CSV de ma bibliothèque et import d'un export Goodreads
import { db } from '../db/index.js';
import { parseCsv, csvToObjects, toCsv } from './csv.js';
import { normalizeIsbn } from './isbn.js';
import {
  STATUS_LABELS, FORMAT_LABELS, languageLabel, countryLabel, sortTitle,
} from './labels.js';
import { createBook, findSimilarWorks, setReadingStatus, saveReview } from './books.js';

// ---------- Export ----------

const EXPORT_HEADERS = [
  'Titre', 'Auteurs', "Titre de l'édition", 'ISBN', 'Éditeur', 'Date de publication', 'Langue', 'Format', 'Pages',
  'Genre', 'Pays de première publication', 'Langue originale',
  'Statut', 'Commencé le', 'Terminé le', 'Note', 'Recommandé', 'Critique', 'Exemplaires', 'Prêté à',
];

// Tous les livres que j'ai dans ma bibliothèque, notés ou possédés
export function exportLibraryCsv(userId) {
  const rows = db.prepare(`
    SELECT w.title, w.authors, w.country_code, w.original_language, g.name AS genre,
      e.edition_title, e.isbn, e.publisher, e.published_date, e.language, e.format, e.page_count,
      r.status, r.started_on, r.finished_on, rv.rating, rv.recommends, rv.body,
      (SELECT COUNT(*) FROM copies c JOIN editions x ON x.id = c.edition_id
        WHERE c.owner_id = @userId AND x.work_id = w.id) AS copies,
      (SELECT group_concat(l.borrower_name, ', ') FROM loans l JOIN copies c ON c.id = l.copy_id
        JOIN editions x ON x.id = c.edition_id
        WHERE c.owner_id = @userId AND x.work_id = w.id AND l.returned_on IS NULL) AS lent_to
    FROM works w
    LEFT JOIN genres g ON g.id = w.genre_id
    LEFT JOIN readings r ON r.work_id = w.id AND r.user_id = @userId
    LEFT JOIN reviews rv ON rv.work_id = w.id AND rv.user_id = @userId
    LEFT JOIN editions e ON e.id = COALESCE(r.edition_id, (SELECT id FROM editions WHERE work_id = w.id ORDER BY id LIMIT 1))
    WHERE r.id IS NOT NULL OR rv.id IS NOT NULL
      OR EXISTS (SELECT 1 FROM copies c JOIN editions x ON x.id = c.edition_id WHERE c.owner_id = @userId AND x.work_id = w.id)
    ORDER BY w.sort_title
  `).all({ userId });

  return toCsv(EXPORT_HEADERS, rows.map((b) => [
    b.title, b.authors, b.edition_title, b.isbn, b.publisher, b.published_date, languageLabel(b.language),
    FORMAT_LABELS[b.format] || '', b.page_count, b.genre, countryLabel(b.country_code), languageLabel(b.original_language),
    STATUS_LABELS[b.status] || '', b.started_on, b.finished_on, b.rating,
    b.recommends === 1 ? 'Oui' : b.recommends === 0 ? 'Non' : '', b.body, b.copies || '', b.lent_to,
  ]));
}

// ---------- Import Goodreads ----------

// Étagère exclusive Goodreads → statut. Les étagères personnelles sont reconnues par leur nom.
function statusFromShelf(shelf) {
  const s = String(shelf || '').toLowerCase();
  if (s === 'read') return 'lu';
  if (s === 'currently-reading') return 'en_cours';
  if (s === 'to-read') return 'a_lire';
  if (/abandon|dnf|did-not-finish|not-finish/.test(s)) return 'abandonne';
  if (/pause|hold/.test(s)) return 'en_pause';
  return 'a_lire';
}

// Reliure Goodreads (anglais ou français) → format
function formatFromBinding(binding) {
  const b = String(binding || '').toLowerCase();
  if (/mass market|poche|pocket/.test(b)) return 'poche';
  if (/paperback|broché|broche|trade/.test(b)) return 'broche';
  if (/hardcover|relié|relie|hardback/.test(b)) return 'relie';
  if (/kindle|ebook|e-book|nook|epub|numérique|digital/.test(b)) return 'numerique';
  if (/audio|audible|cd/.test(b)) return 'audio';
  return null;
}

// Goodreads entoure les ISBN de ="…" pour qu'Excel garde les zéros
const isbnOf = (raw) => normalizeIsbn(String(raw || '').replace(/[="\s]/g, ''));

// « Dune (Dune Chronicles, #1) » → « Dune »
const cleanTitle = (t) => String(t || '').replace(/\s*\([^()]*#\s*\d+(\.\d+)?\)\s*$/, '').trim();

// Les critiques Goodreads contiennent un peu de HTML
function reviewText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

// 2023/05/14 → 2023-05-14 (et rien si la date est incomplète ou invalide)
function dateOf(raw) {
  const m = String(raw || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

const intOf = (raw) => {
  const n = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Lit le fichier Goodreads. Renvoie { entries } ou { error }.
export function parseGoodreads(buffer) {
  const rows = csvToObjects(parseCsv(buffer.toString('utf8')));
  if (!rows.length || !('Title' in rows[0]) || !('Exclusive Shelf' in rows[0])) {
    return { error: "Ce fichier ne ressemble pas à un export Goodreads (colonnes « Title » et « Exclusive Shelf » introuvables)." };
  }
  return {
    entries: rows.map((r, i) => {
      const status = statusFromShelf(r['Exclusive Shelf']);
      const authors = [r.Author, ...String(r['Additional Authors'] || '').split(',')]
        .map((a) => a.trim()).filter(Boolean);
      return {
        line: i + 2, // numéro de ligne dans le fichier (en-têtes en ligne 1)
        title: cleanTitle(r.Title),
        authors: [...new Set(authors)].join(', '),
        isbn: isbnOf(r.ISBN13) || isbnOf(r.ISBN),
        publisher: r.Publisher?.trim() || null,
        published_date: r['Year Published']?.trim() || null,
        format: formatFromBinding(r.Binding),
        page_count: intOf(r['Number of Pages']),
        status,
        finished_on: status === 'lu' || status === 'abandonne' ? dateOf(r['Date Read']) : null,
        rating: Math.min(intOf(r['My Rating']) || 0, 5) || null,
        review: reviewText(r['My Review']) || null,
        owned: intOf(r['Owned Copies']) || 0,
      };
    }),
  };
}

// Requêtes préparées à l'appel (au chargement du module, les tables n'existent pas encore
// sur une base neuve : les migrations passent après les imports)
const findEditionByIsbn = (isbn) => db.prepare('SELECT id, work_id FROM editions WHERE isbn = ?').get(isbn);
const lastEdition = (workId) => db.prepare('SELECT id FROM editions WHERE work_id = ? ORDER BY id DESC LIMIT 1').pluck().get(workId);
const firstEdition = (workId) => db.prepare('SELECT id FROM editions WHERE work_id = ? ORDER BY id LIMIT 1').pluck().get(workId);
const hasReading = (userId, workId) => db.prepare('SELECT 1 FROM readings WHERE user_id = ? AND work_id = ?').get(userId, workId);
const hasReview = (userId, workId) => db.prepare('SELECT 1 FROM reviews WHERE user_id = ? AND work_id = ?').get(userId, workId);
const hasCopy = (userId, workId) => db.prepare(`SELECT 1 FROM copies c JOIN editions e ON e.id = c.edition_id
  WHERE c.owner_id = ? AND e.work_id = ?`).get(userId, workId);

// Retrouve le livre dans le catalogue commun (ISBN, sinon même titre et même auteur)
// ou le crée. Renvoie { workId, editionId, created, newEdition }.
function findOrCreate(entry, userId) {
  const data = {
    title: entry.title, authors: entry.authors, genre_id: null, country_code: null, original_language: null,
    isbn: entry.isbn, publisher: entry.publisher, published_date: entry.published_date,
    language: null, format: entry.format, page_count: entry.page_count, work_id: null,
  };
  if (entry.isbn) {
    const edition = findEditionByIsbn(entry.isbn);
    if (edition) return { workId: edition.work_id, editionId: edition.id, created: false };
  }
  const key = sortTitle(entry.title);
  const same = findSimilarWorks(entry).find((w) => w.score === 3 && w.sort_title === key);
  if (same) {
    // Même œuvre : nouvelle édition si l'ISBN est différent, sinon la première édition connue
    if (!entry.isbn) return { workId: same.id, editionId: firstEdition(same.id), created: false };
    createBook({ ...data, work_id: same.id }, null, userId, null);
    return { workId: same.id, editionId: lastEdition(same.id), created: false, newEdition: true };
  }
  const workId = createBook(data, null, userId, null);
  return { workId, editionId: lastEdition(workId), created: true, newEdition: true };
}

// Importe les livres dans le catalogue commun et dans la bibliothèque de l'utilisateur.
// Un livre déjà dans sa bibliothèque n'est pas modifié : on peut relancer l'import sans risque.
export const importGoodreads = db.transaction((userId, entries) => {
  const report = {
    total: entries.length, created: 0, linked: 0, added: 0, alreadyMine: 0,
    reviews: 0, copies: 0, skipped: [], newEditions: [],
  };
  for (const entry of entries) {
    if (!entry.title) {
      report.skipped.push(`Ligne ${entry.line} : titre manquant`);
      continue;
    }
    const { workId, editionId, created, newEdition } = findOrCreate(entry, userId);
    if (created) report.created++; else report.linked++;
    if (newEdition && entry.isbn) report.newEditions.push({ id: editionId, isbn: entry.isbn, title: entry.title });

    if (hasReading(userId, workId)) {
      report.alreadyMine++;
      continue;
    }
    setReadingStatus(userId, workId, entry.status, editionId);
    if (entry.finished_on) {
      db.prepare('UPDATE readings SET finished_on = ? WHERE user_id = ? AND work_id = ?').run(entry.finished_on, userId, workId);
    }
    report.added++;

    if ((entry.rating || entry.review) && !hasReview(userId, workId)) {
      saveReview(userId, workId, { rating: entry.rating, body: entry.review });
      report.reviews++;
    }
    if (entry.owned && !hasCopy(userId, workId)) {
      db.prepare('INSERT INTO copies (owner_id, edition_id) VALUES (?, ?)').run(userId, editionId);
      report.copies++;
    }
  }
  return report;
});
