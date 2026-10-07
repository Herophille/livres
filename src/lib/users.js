import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from './auth.js';

export const MIN_PASSWORD = 8;

const clean = (v) => String(v ?? '').trim();

export function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.created_at,
      (SELECT COUNT(*) FROM readings WHERE user_id = u.id) AS book_count
    FROM users u ORDER BY u.display_name COLLATE NOCASE
  `).all();
}

export function getUserByUsername(username) {
  return db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ?').get(String(username)) || null;
}

const countAdmins = () => db.prepare("SELECT COUNT(*) FROM users WHERE role = 'admin'").pluck().get();

// Vérifie un nouveau mot de passe (et sa confirmation). Renvoie un message d'erreur ou null.
function passwordError(password, confirm) {
  if (password.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  if (confirm !== undefined && password !== confirm) return 'Les deux mots de passe ne correspondent pas.';
  return null;
}

// Création d'un compte par l'admin. Renvoie { errors } (vide si tout va bien).
export async function createUser(body) {
  const username = clean(body.username).toLowerCase();
  const displayName = clean(body.display_name) || username;
  const password = String(body.password || '');
  const errors = {};
  if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
    errors.username = 'De 2 à 32 caractères : lettres sans accent, chiffres, point, tiret ou tiret bas.';
  } else if (getUserByUsername(username)) {
    errors.username = 'Ce nom d’utilisateur est déjà pris.';
  }
  if (displayName.length > 40) errors.display_name = 'Le nom affiché ne doit pas dépasser 40 caractères.';
  const pwError = passwordError(password);
  if (pwError) errors.password = pwError;
  if (Object.keys(errors).length) return { errors };

  const role = body.role === 'admin' ? 'admin' : 'user';
  db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, displayName, await hashPassword(password), role);
  return { errors: {} };
}

// Suppression d'un compte : ses lectures, avis et sessions partent avec lui (ON DELETE CASCADE),
// les livres qu'il a ajoutés restent dans le catalogue commun.
export function deleteUser(userId, currentUserId) {
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!user) return 'Ce compte n’existe plus.';
  if (user.id === currentUserId) return 'Vous ne pouvez pas supprimer votre propre compte.';
  if (user.role === 'admin' && countAdmins() <= 1) return 'Impossible de supprimer le dernier administrateur.';
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return null;
}

// L'admin remet un mot de passe à un utilisateur qui l'a oublié. Ses sessions sont fermées.
export async function resetPassword(userId, password) {
  const error = passwordError(String(password || ''));
  if (error) return error;
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  })();
  return null;
}

// Changement de son propre mot de passe. Les autres appareils sont déconnectés.
export async function changePassword(userId, sessionId, { current, password, confirm }) {
  const hashNow = db.prepare('SELECT password_hash FROM users WHERE id = ?').pluck().get(userId);
  if (!current || !(await verifyPassword(hashNow, String(current)))) return { current: 'Mot de passe actuel incorrect.' };
  const error = passwordError(String(password || ''), String(confirm || ''));
  if (error) return { password: error };
  const hash = await hashPassword(String(password));
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, sessionId);
  })();
  return null;
}

export function setDisplayName(userId, raw) {
  const name = clean(raw);
  if (!name) return 'Le nom affiché ne peut pas être vide.';
  if (name.length > 40) return 'Le nom affiché ne doit pas dépasser 40 caractères.';
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, userId);
  return null;
}
