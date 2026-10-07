import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import nunjucks from 'nunjucks';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';

import { config } from './config.js';
import { migrate } from './db/index.js';
import { seed } from './db/seed.js';
import { readSession, purgeExpiredSessions } from './lib/auth.js';
import { STATUS_LABELS, FORMAT_LABELS, languageLabel, countryLabel } from './lib/labels.js';
import { scheduleBackups } from './services/backup.js';
import authRoutes from './routes/auth.js';
import libraryRoutes from './routes/library.js';
import bookRoutes from './routes/books.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!config.cookieSecret || config.cookieSecret.length < 32) {
  console.error('COOKIE_SECRET doit contenir au moins 32 caractères (ex. : openssl rand -hex 32).');
  process.exit(1);
}

migrate();
await seed();
purgeExpiredSessions();

const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' }, trustProxy: true });

await app.register(fastifyCookie, { secret: config.cookieSecret });
await app.register(fastifyFormbody);
await app.register(fastifyMultipart, {
  attachFieldsToBody: 'keyValues',
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 30 },
});

await app.register(fastifyView, {
  engine: { nunjucks },
  templates: path.join(root, 'src/views'),
  production: config.isProd,
  options: {
    onConfigure(env) {
      env.addFilter('statusLabel', (v) => STATUS_LABELS[v] || '');
      env.addFilter('formatLabel', (v) => FORMAT_LABELS[v] || '');
      env.addFilter('languageLabel', languageLabel);
      env.addFilter('countryLabel', countryLabel);
      // Teinte stable dérivée du titre, pour les couvertures de remplacement
      env.addFilter('hue', (s) => {
        const h = crypto.createHash('md5').update(String(s || '')).digest();
        return h.readUInt16BE(0) % 360;
      });
    },
  },
});

await app.register(fastifyStatic, { root: path.join(root, 'public'), prefix: '/static/' });
await app.register(fastifyStatic, {
  root: config.coversDir,
  prefix: '/couvertures/',
  decorateReply: false,
  maxAge: '365d',
  immutable: true, // chaque nouvelle couverture a un nom de fichier unique
});
// Bibliothèques front servies depuis node_modules (aucun CDN : fonctionne hors ligne)
await app.register(fastifyStatic, {
  root: path.join(root, 'node_modules/htmx.org/dist'),
  prefix: '/vendor/htmx/',
  decorateReply: false,
});
await app.register(fastifyStatic, {
  root: path.join(root, 'node_modules/@zxing/library/umd'),
  prefix: '/vendor/zxing/',
  decorateReply: false,
});

const PUBLIC_PREFIXES = ['/connexion', '/static/', '/vendor/', '/health', '/manifest.webmanifest'];

app.addHook('onRequest', async (req, reply) => {
  const session = readSession(req);
  req.user = session?.user || null;
  req.sessionId = session?.user ? session.id : null;

  if (req.user || PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
  if (req.headers['hx-request']) {
    reply.header('HX-Redirect', '/connexion');
    return reply.code(401).send();
  }
  return reply.redirect('/connexion');
});

// Variables disponibles dans tous les gabarits
app.addHook('preHandler', async (req, reply) => {
  reply.locals = { currentUser: req.user, path: req.url.split('?')[0] };
});

app.get('/health', async () => ({ ok: true }));

// Sans HTTPS ni service worker, pas d'installation « PWA » complète :
// le manifeste sert à « Ajouter à l'écran d'accueil » (icône, nom, plein écran sur iOS)
app.get('/manifest.webmanifest', async (req, reply) => {
  reply.type('application/manifest+json').send({
    id: '/',
    name: 'Livres',
    short_name: 'Livres',
    description: 'Nos lectures, entre amis',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f2f2f5',
    theme_color: '#f2f2f5',
    icons: [
      { src: '/static/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/img/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/static/img/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/static/img/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    shortcuts: [
      { name: 'Ajouter un livre', url: '/ajouter', icons: [{ src: '/static/img/icon-192.png', sizes: '192x192' }] },
    ],
  });
});

await app.register(authRoutes);
await app.register(libraryRoutes);
await app.register(bookRoutes);

app.setNotFoundHandler((req, reply) => {
  reply.code(404).view('error.njk', { title: 'Page introuvable', message: "Cette page n'existe pas ou a été supprimée." });
});

scheduleBackups();
setInterval(purgeExpiredSessions, 6 * 3600_000).unref();

await app.listen({ port: config.port, host: config.host });
console.log(`Livres écoute sur http://${config.host}:${config.port}`);
