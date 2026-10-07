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
    work_id: toInt(body.work_id), // rattacher cette édition à une œuvre déjà au catalogue
  };

  if (!data.title) errors.title = 'Le titre est obligatoire.';
  if (clean(body.isbn)) {
    data.isbn = normalizeIsbn(body.isbn);
    if (!data.isbn) errors.isbn = "Cet ISBN n'est pas valide. Vérifiez les chiffres ou laissez le champ vide.";
  }
  if (data.format && !FORMAT_LABELS[data.format]) data.format = null;
  if (data.work_id && !db.prepare('SELECT 1 FROM works WHERE id = ?').get(data.work_id)) data.work_id = null;
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
  let workId = data.work_id;
  let editionTitle = null;
  if (workId) {
    // Nouvelle édition (ou traduction) d'une œuvre existante : on ne touche pas à l'œuvre,
    // sauf pour compléter les champs encore vides.
    const work = db.prepare('SELECT title FROM works WHERE id = ?').get(workId);
    if (data.title !== work.title) editionTitle = data.title;
    db.prepare(`
      UPDATE works SET genre_id = COALESCE(genre_id, @genre_id), country_code = COALESCE(country_code, @country_code),
        original_language = COALESCE(original_language, @original_language), updated_at = datetime('now')
      WHERE id = @id
    `).run({ ...data, id: workId });
  } else {
    const work = db.prepare(`
      INSERT INTO works (title, sort_title, authors, genre_id, country_code, original_language, created_by)
      VALUES (@title, @sort_title, @authors, @genre_id, @country_code, @original_language, @created_by)
    `).run({ ...data, sort_title: sortTitle(data.title), created_by: userId });
    workId = Number(work.lastInsertRowid);
  }

  const edition = db.prepare(`
    INSERT INTO editions (work_id, isbn, edition_title, publisher, published_date, language, format, page_count, cover_file)
    VALUES (@work_id, @isbn, @edition_title, @publisher, @published_date, @language, @format, @page_count, @cover_file)
  `).run({ ...data, work_id: workId, edition_title: editionTitle, cover_file: coverFile });

  if (status && STATUS_LABELS[status]) {
    changeReadingStatus(userId, workId, status, Number(edition.lastInsertRowid));
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
  const review = db.prepare('SELECT * FROM reviews WHERE user_id = ? AND work_id = ?').get(userId, workId) || null;
  const editions = db.prepare('SELECT * FROM editions WHERE work_id = ? ORDER BY published_date, id').all(workId);
  const edition = editions.find((e) => e.id === reading?.edition_id) || editions[0] || null;
  return { work, edition, editions, reading, review };
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

// Changement de statut depuis la page du livre. Les dates se remplissent toutes seules
// quand on suit sa lecture en direct (on commence, puis on finit), jamais quand on
// classe après coup un livre lu il y a longtemps.
export function changeReadingStatus(userId, workId, status, editionId = null) {
  const before = db.prepare('SELECT status FROM readings WHERE user_id = ? AND work_id = ?').pluck().get(userId, workId);
  setReadingStatus(userId, workId, status, editionId);
  if (status === 'en_cours') {
    db.prepare(`UPDATE readings SET started_on = COALESCE(started_on, date('now', 'localtime'))
      WHERE user_id = ? AND work_id = ?`).run(userId, workId);
  }
  if (status === 'lu' && (before === 'en_cours' || before === 'en_pause')) {
    db.prepare(`UPDATE readings SET finished_on = COALESCE(finished_on, date('now', 'localtime'))
      WHERE user_id = ? AND work_id = ?`).run(userId, workId);
  }
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// Dates facultatives de début et de fin. Renvoie un message d'erreur ou null.
export function setReadingDates(userId, workId, startedRaw, finishedRaw) {
  const started = clean(startedRaw);
  const finished = clean(finishedRaw);
  if ((started && !isDate(started)) || (finished && !isDate(finished))) return 'Date invalide.';
  if (started && finished && finished < started) return 'La date de fin est avant la date de début.';
  db.prepare(`UPDATE readings SET started_on = ?, finished_on = ?, updated_at = datetime('now')
    WHERE user_id = ? AND work_id = ?`).run(started, finished, userId, workId);
  return null;
}

// L'édition que l'utilisateur lit ou possède (sa couverture apparaît dans sa bibliothèque)
export function setReadingEdition(userId, workId, editionId) {
  db.prepare(`UPDATE readings SET edition_id = ? WHERE user_id = ? AND work_id = ?
    AND ? IN (SELECT id FROM editions WHERE work_id = ?)`).run(editionId, userId, workId, editionId, workId);
}

// Avis : note de 1 à 5 (entière), texte, recommandation. Tout est facultatif.
export function saveReview(userId, workId, body) {
  const rating = toInt(body.rating);
  const review = {
    rating: rating && rating <= 5 ? rating : null,
    body: clean(body.body)?.slice(0, 10000) ?? null,
    recommends: body.recommends === 'oui' ? 1 : body.recommends === 'non' ? 0 : null,
  };
  if (review.rating == null && review.body == null && review.recommends == null) {
    deleteReview(userId, workId);
    return;
  }
  db.prepare(`
    INSERT INTO reviews (user_id, work_id, rating, body, recommends)
    VALUES (@userId, @workId, @rating, @body, @recommends)
    ON CONFLICT (user_id, work_id) DO UPDATE SET
      rating = excluded.rating, body = excluded.body, recommends = excluded.recommends,
      updated_at = datetime('now')
  `).run({ ...review, userId, workId });
}

export function deleteReview(userId, workId) {
  db.prepare('DELETE FROM reviews WHERE user_id = ? AND work_id = ?').run(userId, workId);
}

// Œuvres du catalogue qui ressemblent au livre qu'on ajoute (même titre ou même auteur),
// pour proposer d'y rattacher une nouvelle édition ou une traduction.
const normalize = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const surnames = (authors) => String(authors || '').split(',')
  .map((a) => normalize(a).trim().split(/\s+/).pop())
  .filter((n) => n && n.length >= 3);

export function findSimilarWorks({ title, authors }, limit = 5) {
  const key = title ? sortTitle(title) : null;
  const names = surnames(authors);
  if (!key && names.length === 0) return [];

  const works = db.prepare(`
    SELECT w.id, w.title, w.sort_title, w.authors,
      (SELECT cover_file FROM editions WHERE work_id = w.id AND cover_file IS NOT NULL LIMIT 1) AS cover_file,
      (SELECT COUNT(*) FROM editions WHERE work_id = w.id) AS edition_count
    FROM works w
  `).all();
  return works
    .map((w) => {
      const sameTitle = key && (w.sort_title === key || w.sort_title.startsWith(key) || key.startsWith(w.sort_title));
      const sameAuthor = names.length && surnames(w.authors).some((n) => names.includes(n));
      return { ...w, score: (sameTitle ? 2 : 0) + (sameAuthor ? 1 : 0) };
    })
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score || a.sort_title.localeCompare(b.sort_title))
    .slice(0, limit);
}

export function removeReading(userId, workId) {
  db.prepare('DELETE FROM readings WHERE user_id = ? AND work_id = ?').run(userId, workId);
}

export function deleteWork(workId) {
  const covers = db.prepare('SELECT cover_file FROM editions WHERE work_id = ? AND cover_file IS NOT NULL').pluck().all(workId);
  db.prepare('DELETE FROM works WHERE id = ?').run(workId);
  return covers;
}

export const SORTS = [
  { value: 'titre', label: 'Titre' },
  { value: 'recent', label: 'Ajout récent' },
  { value: 'note', label: 'Ma note' },
  { value: 'fin', label: 'Date de lecture' },
];
const ORDER_BY = {
  titre: 'w.sort_title COLLATE NOCASE',
  recent: 'COALESCE(r.updated_at, w.created_at) DESC',
  note: 'rv.rating IS NULL, rv.rating DESC, w.sort_title COLLATE NOCASE',
  fin: 'r.finished_on IS NULL, r.finished_on DESC, w.sort_title COLLATE NOCASE',
};

// Bibliothèque personnelle (ou tout le catalogue commun avec scope = 'tous'),
// filtrable par statut, genre et recherche texte
export function listLibrary(userId, { scope = 'moi', status = null, genreId = null, q = null, sort = 'titre' } = {}) {
  const params = { userId };
  const where = [scope === 'tous' ? '1' : 'r.id IS NOT NULL'];
  if (status && STATUS_LABELS[status]) {
    where.push('r.status = @status');
    params.status = status;
  }
  if (genreId) {
    where.push('w.genre_id = @genreId');
    params.genreId = genreId;
  }
  if (q) {
    where.push(`(w.title LIKE @q OR w.authors LIKE @q
      OR EXISTS (SELECT 1 FROM editions x WHERE x.work_id = w.id AND (x.isbn LIKE @q OR x.edition_title LIKE @q)))`);
    params.q = `%${q}%`;
  }
  return db.prepare(`
    SELECT w.id, w.title, w.sort_title, w.authors, r.status, r.finished_on, rv.rating,
      COALESCE(e.cover_file, (SELECT cover_file FROM editions WHERE work_id = w.id AND cover_file IS NOT NULL LIMIT 1)) AS cover_file
    FROM works w
    LEFT JOIN readings r ON r.work_id = w.id AND r.user_id = @userId
    LEFT JOIN reviews rv ON rv.work_id = w.id AND rv.user_id = @userId
    LEFT JOIN editions e ON e.id = r.edition_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${ORDER_BY[sort] || ORDER_BY.titre}
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

// Pour le script de récupération des couvertures manquantes
export function editionsWithoutCover() {
  return db.prepare(`
    SELECT e.id, e.isbn, w.title FROM editions e JOIN works w ON w.id = e.work_id
    WHERE e.cover_file IS NULL AND e.isbn IS NOT NULL ORDER BY e.id
  `).all();
}

export function setEditionCover(editionId, coverFile) {
  db.prepare('UPDATE editions SET cover_file = ? WHERE id = ?').run(coverFile, editionId);
}

// ---------- Amis ----------

// Livres d'un utilisateur pour un statut donné, les plus récents d'abord
function readingsByStatus(userId, status, limit) {
  return db.prepare(`
    SELECT w.id, w.title, w.authors, r.finished_on,
      COALESCE(e.cover_file, (SELECT cover_file FROM editions WHERE work_id = w.id AND cover_file IS NOT NULL LIMIT 1)) AS cover_file
    FROM readings r JOIN works w ON w.id = r.work_id
    LEFT JOIN editions e ON e.id = r.edition_id
    WHERE r.user_id = ? AND r.status = ?
    ORDER BY COALESCE(r.finished_on, r.started_on, r.updated_at) DESC, r.updated_at DESC
    LIMIT ?
  `).all(userId, status, limit);
}

// Vue « Ce que lisent mes amis » : pour chaque autre utilisateur, ses lectures en cours
// et ses derniers livres terminés. Regroupé par personne, ce n'est pas un fil d'actualité.
export function friendsOverview(currentUserId) {
  const users = db.prepare(`
    SELECT id, username, display_name FROM users WHERE id != ? ORDER BY display_name COLLATE NOCASE
  `).all(currentUserId);
  return users.map((u) => ({
    ...u,
    counts: libraryCounts(u.id),
    reading: readingsByStatus(u.id, 'en_cours', 12),
    finished: readingsByStatus(u.id, 'lu', 6),
  }));
}

// Ce que les autres utilisateurs ont fait de ce livre : statut, note, avis
export function otherReaders(workId, currentUserId) {
  return db.prepare(`
    SELECT u.id AS user_id, u.username, u.display_name, r.status, r.finished_on,
      rv.rating, rv.body, rv.recommends, rv.updated_at AS reviewed_at
    FROM users u
    LEFT JOIN readings r ON r.user_id = u.id AND r.work_id = @workId
    LEFT JOIN reviews rv ON rv.user_id = u.id AND rv.work_id = @workId
    WHERE u.id != @currentUserId AND (r.id IS NOT NULL OR rv.id IS NOT NULL)
    ORDER BY rv.body IS NULL, rv.rating IS NULL, COALESCE(rv.updated_at, r.updated_at) DESC
  `).all({ workId, currentUserId });
}
