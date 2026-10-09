import { db } from '../db/index.js';
import { FORMAT_LABELS, languageLabel } from './labels.js';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const today = () => db.prepare("SELECT date('now', 'localtime')").pluck().get();

// Description courte d'une édition : « Poche · Français · Gallimard »
export function editionLabel(e) {
  return [e.edition_title, FORMAT_LABELS[e.format], languageLabel(e.language), e.publisher]
    .filter(Boolean).join(' · ') || 'Édition sans détail';
}

// Prêt en cours d'un exemplaire (au plus un), avec sa durée en jours
const ACTIVE_LOAN = `
  SELECT l.id, l.borrower_name, l.lent_on,
    CAST(julianday(date('now', 'localtime')) - julianday(l.lent_on) AS INTEGER) AS days
  FROM loans l WHERE l.copy_id = ? AND l.returned_on IS NULL`;

// Mes exemplaires d'une œuvre, avec leur prêt en cours
export function myCopiesOfWork(userId, workId) {
  const copies = db.prepare(`
    SELECT c.id, c.note, e.id AS edition_id, e.edition_title, e.format, e.language, e.publisher
    FROM copies c JOIN editions e ON e.id = c.edition_id
    WHERE c.owner_id = ? AND e.work_id = ? ORDER BY c.created_at, c.id
  `).all(userId, workId);
  const loan = db.prepare(ACTIVE_LOAN);
  return copies.map((c) => ({ ...c, label: editionLabel(c), loan: loan.get(c.id) || null }));
}

// Exemplaire qui m'appartient (null sinon) : seul le propriétaire gère ses exemplaires et ses prêts
export function getOwnCopy(copyId, userId) {
  return db.prepare(`
    SELECT c.id, c.owner_id, e.work_id FROM copies c JOIN editions e ON e.id = c.edition_id
    WHERE c.id = ? AND c.owner_id = ?
  `).get(copyId, userId) || null;
}

export function addCopy(userId, workId, editionId, note) {
  const ok = db.prepare('SELECT 1 FROM editions WHERE id = ? AND work_id = ?').get(editionId, workId);
  if (!ok) return 'Choisissez une édition de ce livre.';
  db.prepare('INSERT INTO copies (owner_id, edition_id, note) VALUES (?, ?, ?)')
    .run(userId, editionId, clean(note)?.slice(0, 200) ?? null);
  return null;
}

export function deleteCopy(copyId) {
  db.prepare('DELETE FROM copies WHERE id = ?').run(copyId);
}

// Prêt : nom libre (pas forcément un utilisateur de l'app), date du jour par défaut
export function lendCopy(copyId, body) {
  const borrower = clean(body.borrower_name);
  const lentOn = clean(body.lent_on) || today();
  if (!borrower) return 'Indiquez à qui vous prêtez ce livre.';
  if (borrower.length > 80) return 'Le nom ne doit pas dépasser 80 caractères.';
  if (!isDate(lentOn)) return 'Date invalide.';
  if (lentOn > today()) return 'La date de prêt ne peut pas être dans le futur.';
  if (db.prepare(ACTIVE_LOAN).get(copyId)) return 'Cet exemplaire est déjà prêté.';
  db.prepare('INSERT INTO loans (copy_id, borrower_name, lent_on) VALUES (?, ?, ?)').run(copyId, borrower, lentOn);
  return null;
}

// Retour : aujourd'hui, mais jamais avant la date du prêt
export function returnCopy(copyId) {
  db.prepare(`UPDATE loans SET returned_on = MAX(lent_on, date('now', 'localtime'))
    WHERE copy_id = ? AND returned_on IS NULL`).run(copyId);
}

// Noms proposés pour un prêt : les autres utilisateurs et les emprunteurs déjà saisis
export function borrowerSuggestions(userId) {
  return db.prepare(`
    SELECT display_name AS name FROM users WHERE id != @userId
    UNION
    SELECT l.borrower_name FROM loans l JOIN copies c ON c.id = l.copy_id WHERE c.owner_id = @userId
    ORDER BY 1 COLLATE NOCASE
  `).pluck().all({ userId });
}

// Page « Mes prêts » : livres prêtés en ce moment (les plus anciens d'abord),
// exemplaires à la maison, historique des prêts rendus
export function loansOverview(userId) {
  const base = `
    SELECT w.id AS work_id, w.title, w.authors, e.edition_title, e.format, e.language, e.publisher, e.cover_file,
      c.id AS copy_id, c.note`;
  const active = db.prepare(`${base}, l.borrower_name, l.lent_on,
      CAST(julianday(date('now', 'localtime')) - julianday(l.lent_on) AS INTEGER) AS days
    FROM loans l JOIN copies c ON c.id = l.copy_id JOIN editions e ON e.id = c.edition_id JOIN works w ON w.id = e.work_id
    WHERE c.owner_id = ? AND l.returned_on IS NULL ORDER BY l.lent_on, w.sort_title`).all(userId);
  const home = db.prepare(`${base}
    FROM copies c JOIN editions e ON e.id = c.edition_id JOIN works w ON w.id = e.work_id
    WHERE c.owner_id = ? AND NOT EXISTS (SELECT 1 FROM loans WHERE copy_id = c.id AND returned_on IS NULL)
    ORDER BY w.sort_title`).all(userId);
  const history = db.prepare(`${base}, l.borrower_name, l.lent_on, l.returned_on
    FROM loans l JOIN copies c ON c.id = l.copy_id JOIN editions e ON e.id = c.edition_id JOIN works w ON w.id = e.work_id
    WHERE c.owner_id = ? AND l.returned_on IS NOT NULL ORDER BY l.returned_on DESC, l.id DESC LIMIT 50`).all(userId);
  const withLabel = (rows) => rows.map((r) => ({ ...r, label: editionLabel(r) }));
  return { active: withLabel(active), home: withLabel(home), history: withLabel(history) };
}

// Nombre d'exemplaires prêtés en ce moment (pour le profil)
export function activeLoanCount(userId) {
  return db.prepare(`SELECT COUNT(*) FROM loans l JOIN copies c ON c.id = l.copy_id
    WHERE c.owner_id = ? AND l.returned_on IS NULL`).pluck().get(userId);
}

// Tout ce qu'il faut pour la section « Mes exemplaires » de la page livre
export function copiesContext(userId, workId, defaultEditionId) {
  const editions = db.prepare('SELECT * FROM editions WHERE work_id = ? ORDER BY published_date, id').all(workId);
  return {
    copies: myCopiesOfWork(userId, workId),
    copyEditions: editions.map((e) => ({ id: e.id, label: editionLabel(e) })),
    defaultEdition: defaultEditionId,
    borrowers: borrowerSuggestions(userId),
    today: today(),
  };
}
