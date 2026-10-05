import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { db } from '../db/index.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'livres_session';

export const hashPassword = (password) => hash(password);
export const verifyPassword = (passwordHash, password) => verify(passwordHash, password);

export function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(id, userId, expires.toISOString());
  return { id, expires };
}

export function getSessionUser(sessionId) {
  if (!sessionId) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, new Date().toISOString()) || null;
}

export function destroySession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

// Lit le cookie de session signé et retrouve l'utilisateur
export function readSession(req) {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid) return null;
  return { id: unsigned.value, user: getSessionUser(unsigned.value) };
}

export function cookieOptions(expires) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    // Pas de HTTPS sur le réseau local : le cookie ne peut pas être "secure".
    // Le trafic VPN reste chiffré par WireGuard.
    secure: false,
    signed: true,
    expires,
  };
}
