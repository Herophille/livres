import { db } from '../db/index.js';
import {
  verifyPassword, createSession, destroySession, cookieOptions, SESSION_COOKIE,
} from '../lib/auth.js';

// Limite simple contre les essais de mots de passe en rafale (par adresse IP)
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, list);
  return list.length >= MAX_ATTEMPTS;
}

export default async function authRoutes(app) {
  app.get('/connexion', async (req, reply) => {
    if (req.user) return reply.redirect('/');
    return reply.viewAsync('login.njk', { title: 'Connexion' });
  });

  app.post('/connexion', async (req, reply) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (tooManyAttempts(req.ip)) {
      return reply.code(429).viewAsync('login.njk', {
        title: 'Connexion', username,
        error: 'Trop de tentatives. Réessayez dans 15 minutes.',
      });
    }

    const user = db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username);
    const ok = user && password && (await verifyPassword(user.password_hash, password));
    if (!ok) {
      attempts.get(req.ip).push(Date.now());
      return reply.code(401).viewAsync('login.njk', {
        title: 'Connexion', username,
        error: "Nom d'utilisateur ou mot de passe incorrect.",
      });
    }

    attempts.delete(req.ip);
    const session = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions(session.expires));
    return reply.redirect('/');
  });

  app.post('/deconnexion', async (req, reply) => {
    if (req.sessionId) destroySession(req.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/connexion');
  });
}
