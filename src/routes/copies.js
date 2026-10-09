import { getBook } from '../lib/books.js';
import {
  copiesContext, getOwnCopy, addCopy, deleteCopy, lendCopy, returnCopy, loansOverview,
} from '../lib/copies.js';

function parseId(raw) {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export default async function copyRoutes(app) {
  // Réponse après une action : la section « Mes exemplaires » pour htmx, sinon retour à la page
  // (la page « Mes prêts » envoie retour=/prets ; aucune autre adresse n'est acceptée)
  async function respond(req, reply, workId, extra = {}) {
    if (!req.headers['hx-request']) {
      return reply.redirect(req.body?.retour === '/prets' ? '/prets' : `/livres/${workId}`);
    }
    const book = getBook(workId, req.user.id);
    return reply.viewAsync('partials/copies.njk', {
      work: book.work, ...copiesContext(req.user.id, workId, book.edition?.id), ...extra,
    });
  }

  app.post('/livres/:id/exemplaires', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    const error = addCopy(req.user.id, book.work.id, parseId(req.body?.edition_id), req.body?.note);
    return respond(req, reply, book.work.id, { copyError: error });
  });

  // Les routes suivantes ne concernent que les exemplaires de l'utilisateur connecté
  const ownCopy = (req, reply) => {
    const copy = getOwnCopy(parseId(req.params.copyId), req.user.id);
    if (!copy) reply.callNotFound();
    return copy;
  };

  app.post('/exemplaires/:copyId/preter', async (req, reply) => {
    const copy = ownCopy(req, reply);
    if (!copy) return reply;
    const error = lendCopy(copy.id, req.body || {});
    if (error && !req.headers['hx-request']) {
      // Sans JavaScript, on revient à la page du livre ; l'erreur ne s'affiche qu'avec htmx
      return reply.redirect(`/livres/${copy.work_id}`);
    }
    return respond(req, reply, copy.work_id, error ? { lendError: { id: copy.id, message: error, values: req.body } } : {});
  });

  app.post('/exemplaires/:copyId/rendu', async (req, reply) => {
    const copy = ownCopy(req, reply);
    if (!copy) return reply;
    returnCopy(copy.id);
    return respond(req, reply, copy.work_id);
  });

  app.post('/exemplaires/:copyId/supprimer', async (req, reply) => {
    const copy = ownCopy(req, reply);
    if (!copy) return reply;
    deleteCopy(copy.id);
    return respond(req, reply, copy.work_id);
  });

  app.get('/prets', async (req, reply) => reply.viewAsync('loans.njk', {
    title: 'Mes prêts', ...loansOverview(req.user.id),
  }));
}
