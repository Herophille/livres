import { db } from '../db/index.js';
import { sortTitle, STATUS_LABELS, FORMAT_LABELS } from './labels.js';
import { normalizeIsbn } from './isbn.js';

const clean = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Valide et normalise les champs du formulaire livre. Renvoie { data, errors }.
export function parseBookForm(body) {
  const errors = {};
  const data = {
    title: clean(body.title),
    authors: clean(body.authors) || '',
    genre_id: toInt(body.genre_id),
    country_code: clean(body.country_code),
    original_language: clean(body.original_language),
    isbn: null,
    publisher: clean(body.publisher),
    published_date: clean(body.published_date),
    language: clean(body.language),
    format: clean(body.format),
    page_count: toInt(body.page_count),
  };

  if (!data.title) errors.title = 'Le titre est obligatoire.';
  if (clean(body.isbn)) {
    data.isbn = normalizeIsbn(body.isbn);
    if (!data.isbn) errors.isbn = "Cet ISBN n'est pas valide. Vérifiez les chiffres ou laissez le champ vide.";
  }
  if (data.format && !FORMAT_LABELS[data.format]) data.format = null;
  return { data, errors };
}

export function findWorkIdByIsbn(isbn) {
  return db.prepare('SELECT work_id FROM editions WHERE isbn = ?').pluck().get(isbn) ?? null;
}

export function isIsbnTaken(isbn, exceptEditionId = null) {
  if (!isbn) return false;
  const id = db.prepare('SELECT id FROM editions WHERE isbn = ?').pluck().get(isbn);
  return id != null && id !== exceptEditionId;
}

export const createBook = db.transaction((data, coverFile, userId, status) => {
  const work = db.prepare(`
    INSERT INTO works (title, sort_title, authors, genre_id, country_code, original_language, created_by)
    VALUES (@title, @sort_title, @authors, @genre_id, @country_code, @original_language, @created_by)
  `).run({ ...data, sort_title: sortTitle(data.title), created_by: userId });
  const workId = Number(work.lastInsertRowid);

  const edition = db.prepare(`
    INSERT INTO editions (work_id, isbn, publisher, published_date, language, format, page_count, cover_file)
    VALUES (@work_id, @isbn, @publisher, @published_date, @language, @format, @page_count, @cover_file)
  `).run({ ...data, work_id: workId, cover_file: coverFile });

  if (status && STATUS_LABELS[status]) {
    setReadingStatus(userId, workId, status, Number(edition.lastInsertRowid));
  }
  return workId;
});

export const updateBook = db.transaction((workId, editionId, data, coverFile) => {
  db.prepare(`
    UPDATE works SET title = @title, sort_title = @sort_title, authors = @authors, genre_id = @genre_id,
      country_code = @country_code, original_language = @original_language, updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...data, sort_title: sortTitle(data.title), id: workId });

  db.prepare(`
    UPDATE editions SET isbn = @isbn, publisher = @publisher, published_date = @published_date,
      language = @language, format = @format, page_count = @page_count,
      cover_file = COALESCE(@cover_file, cover_file)
    WHERE id = @id
  `).run({ ...data, cover_file: coverFile, id: editionId });
});

// Œuvre + édition affichée (celle de la lecture de l'utilisateur, sinon la première)
export function getBook(workId, userId) {
  const work = db.prepare(`
    SELECT w.*, g.name AS genre_name
    FROM works w LEFT JOIN genres g ON g.id = w.genre_id
    WHERE w.id = ?
  `).get(workId);
  if (!work) return null;

  const reading = db.prepare('SELECT * FROM readings WHERE user_id = ? AND work_id = ?').get(userId, workId) || null;
  const editions = db.prepare('SELECT * FROM editions WHERE work_id = ? ORDER BY id').all(workId);
  const edition = editions.find((e) => e.id === reading?.edition_id) || editions[0] || null;
  return { work, edition, editions, reading };
}

export function setReadingStatus(userId, workId, status, editionId = null) {
  db.prepare(`
    INSERT INTO readings (user_id, work_id, edition_id, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, work_id) DO UPDATE SET
      status = excluded.status,
      edition_id = COALESCE(excluded.edition_id, readings.edition_id),
      updated_at = datetime('now')
  `).run(userId, workId, editionId, status);
}

export function removeReading(userId, workId) {
  db.prepare('DELETE FROM readings WHERE user_id = ? AND work_id = ?').run(userId, workId);
}

export function deleteWork(workId) {
  const covers = db.prepare('SELECT cover_file FROM editions WHERE work_id = ? AND cover_file IS NOT NULL').pluck().all(workId);
  db.prepare('DELETE FROM works WHERE id = ?').run(workId);
  return covers;
}

// Bibliothèque personnelle, filtrable par statut et par recherche texte
export function listLibrary(userId, { status = null, q = null } = {}) {
  const params = { userId };
  let where = 'r.user_id = @userId';
  if (status && STATUS_LABELS[status]) {
    where += ' AND r.status = @status';
    params.status = status;
  }
  if (q) {
    where += ' AND (w.title LIKE @q OR w.authors LIKE @q OR e.isbn LIKE @q)';
    params.q = `%${q}%`;
  }
  return db.prepare(`
    SELECT w.id, w.title, w.sort_title, w.authors, r.status, r.updated_at,
      COALESCE(e.cover_file, (SELECT cover_file FROM editions WHERE work_id = w.id AND cover_file IS NOT NULL LIMIT 1)) AS cover_file
    FROM readings r
    JOIN works w ON w.id = r.work_id
    LEFT JOIN editions e ON e.id = r.edition_id
    WHERE ${where}
    ORDER BY w.sort_title COLLATE NOCASE
  `).all(params);
}

export function libraryCounts(userId) {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM readings WHERE user_id = ? GROUP BY status').all(userId);
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  counts.all = rows.reduce((sum, r) => sum + r.n, 0);
  return counts;
}

export function listGenres() {
  return db.prepare('SELECT id, name FROM genres ORDER BY position, name').all();
}
