import { listLibrary, libraryCounts, listGenres, SORTS } from '../lib/books.js';
import { STATUSES, STATUS_LABELS } from '../lib/labels.js';

export default async function libraryRoutes(app) {
  app.get('/', async (req, reply) => {
    // "Mes livres" ou tout le catalogue commun
    const scope = req.query.portee === 'tous' ? 'tous' : 'moi';
    const status = STATUS_LABELS[req.query.statut] ? req.query.statut : null;
    const q = String(req.query.q || '').trim().slice(0, 100) || null;
    const view = req.query.vue === 'liste' ? 'liste' : 'grille';
    const sort = SORTS.some((s) => s.value === req.query.tri) ? req.query.tri : 'titre';
    const genres = listGenres();
    const genreId = genres.find((g) => String(g.id) === req.query.genre)?.id ?? null;

    const books = listLibrary(req.user.id, { scope, status, genreId, q, sort });
    const data = {
      title: scope === 'tous' ? 'Tous les livres' : 'Bibliothèque',
      books, scope, status, genreId, q, view, sort,
      statuses: STATUSES, sorts: SORTS, genres, counts: libraryCounts(req.user.id),
    };

    // Requête htmx ciblant la grille : on ne renvoie que la liste de livres
    if (req.headers['hx-target'] === 'shelf') {
      return reply.viewAsync('partials/shelf.njk', data);
    }
    return reply.viewAsync('library.njk', data);
  });
}
