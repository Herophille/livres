import { listLibrary, libraryCounts } from '../lib/books.js';
import { STATUSES, STATUS_LABELS } from '../lib/labels.js';

export default async function libraryRoutes(app) {
  app.get('/', async (req, reply) => {
    const status = STATUS_LABELS[req.query.statut] ? req.query.statut : null;
    const q = String(req.query.q || '').trim().slice(0, 100) || null;
    const view = req.query.vue === 'liste' ? 'liste' : 'grille';

    const books = listLibrary(req.user.id, { status, q });
    const data = {
      title: 'Bibliothèque', books, status, q, view,
      statuses: STATUSES, counts: libraryCounts(req.user.id),
    };

    // Requête htmx ciblant la grille : on ne renvoie que la liste de livres
    if (req.headers['hx-target'] === 'shelf') {
      return reply.viewAsync('partials/shelf.njk', data);
    }
    return reply.viewAsync('library.njk', data);
  });
}
