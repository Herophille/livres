import {
  parseBookForm, createBook, updateBook, getBook, findWorkIdByIsbn, isIsbnTaken,
  setReadingStatus, removeReading, deleteWork, listGenres,
} from '../lib/books.js';
import { normalizeIsbn } from '../lib/isbn.js';
import { STATUSES, STATUS_LABELS, FORMATS, LANGUAGES, COUNTRIES } from '../lib/labels.js';
import { lookupIsbn } from '../services/metadata/index.js';
import { saveCover, saveCoverFromUrl, deleteCover } from '../services/covers.js';

// Listes nécessaires au formulaire livre
const formOptions = () => ({
  genres: listGenres(), formats: FORMATS, languages: LANGUAGES, countries: COUNTRIES, statuses: STATUSES,
});

// Couverture : fichier envoyé en priorité, sinon URL trouvée par la recherche ISBN
async function coverFromRequest(body) {
  if (Buffer.isBuffer(body.cover) && body.cover.length > 0) {
    return { file: await saveCover(body.cover), uploaded: true };
  }
  if (body.cover_url) return { file: await saveCoverFromUrl(String(body.cover_url)), uploaded: false };
  return { file: null, uploaded: false };
}

function parseId(raw) {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export default async function bookRoutes(app) {
  app.get('/ajouter', async (req, reply) => reply.viewAsync('add.njk', { title: 'Ajouter un livre' }));

  app.post('/ajouter/isbn', async (req, reply) => {
    const raw = String(req.body?.isbn || '');
    const isbn = normalizeIsbn(raw);
    if (!isbn) {
      return reply.code(422).viewAsync('add.njk', {
        title: 'Ajouter un livre', isbnValue: raw,
        error: "Cet ISBN n'est pas valide. Il doit comporter 10 ou 13 chiffres.",
      });
    }

    const existing = findWorkIdByIsbn(isbn);
    if (existing) return reply.redirect(`/livres/${existing}?existant=1`);

    const found = await lookupIsbn(isbn);
    const values = found
      ? {
        isbn, title: found.title, authors: found.authors, publisher: found.publisher,
        published_date: found.publishedDate, page_count: found.pageCount, language: found.language,
        original_language: found.language, cover_url: found.coverUrl, status: 'a_lire',
      }
      : { isbn, status: 'a_lire' };

    return reply.viewAsync('form.njk', {
      title: 'Ajouter un livre', mode: 'create', values, ...formOptions(),
      notice: found
        ? `Informations trouvées via ${found.sources.join(', ')}. Vérifiez-les et complétez le genre et le pays.`
        : 'Aucune information trouvée pour cet ISBN. Complétez la fiche à la main.',
    });
  });

  app.get('/ajouter/manuel', async (req, reply) => reply.viewAsync('form.njk', {
    title: 'Ajouter un livre', mode: 'create', values: { status: 'a_lire' }, ...formOptions(),
  }));

  app.post('/livres', async (req, reply) => {
    const body = req.body || {};
    const { data, errors } = parseBookForm(body);
    if (data.isbn && isIsbnTaken(data.isbn)) {
      errors.isbn = 'Un livre avec cet ISBN existe déjà dans la bibliothèque commune.';
    }
    const values = { ...body, cover: undefined };
    if (Object.keys(errors).length) {
      return reply.code(422).viewAsync('form.njk', {
        title: 'Ajouter un livre', mode: 'create', values, errors, ...formOptions(),
      });
    }

    const cover = await coverFromRequest(body);
    const status = STATUS_LABELS[body.status] ? body.status : null;
    const workId = createBook(data, cover.file, req.user.id, status);
    return reply.redirect(`/livres/${workId}`);
  });

  app.get('/livres/:id', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    return reply.viewAsync('book.njk', {
      title: book.work.title, ...book, statuses: STATUSES,
      notice: req.query.existant ? 'Ce livre est déjà dans la bibliothèque commune.' : null,
    });
  });

  app.post('/livres/:id/statut', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();

    const status = String(req.body?.status || '');
    if (status === 'retirer') removeReading(req.user.id, book.work.id);
    else if (STATUS_LABELS[status]) setReadingStatus(req.user.id, book.work.id, status, book.edition?.id);
    else return reply.code(400).send('Statut inconnu');

    const updated = getBook(book.work.id, req.user.id);
    return reply.viewAsync('partials/status.njk', { work: updated.work, reading: updated.reading, statuses: STATUSES });
  });

  app.get('/livres/:id/modifier', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    const { work, edition } = book;
    return reply.viewAsync('form.njk', {
      title: `Modifier « ${work.title} »`, mode: 'edit', workId: work.id,
      currentCover: edition?.cover_file,
      values: { ...work, ...edition, id: work.id },
      ...formOptions(),
    });
  });

  app.post('/livres/:id', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    const body = req.body || {};
    const { data, errors } = parseBookForm(body);
    if (data.isbn && isIsbnTaken(data.isbn, book.edition?.id)) {
      errors.isbn = 'Un autre livre utilise déjà cet ISBN.';
    }
    if (Object.keys(errors).length) {
      return reply.code(422).viewAsync('form.njk', {
        title: `Modifier « ${book.work.title} »`, mode: 'edit', workId: book.work.id,
        currentCover: book.edition?.cover_file, values: { ...body, cover: undefined }, errors, ...formOptions(),
      });
    }

    const cover = await coverFromRequest(body);
    updateBook(book.work.id, book.edition.id, data, cover.file);
    if (cover.file && book.edition.cover_file) await deleteCover(book.edition.cover_file);
    return reply.redirect(`/livres/${book.work.id}`);
  });

  app.post('/livres/:id/supprimer', async (req, reply) => {
    if (req.user.role !== 'admin') return reply.code(403).send('Réservé aux administrateurs');
    const workId = parseId(req.params.id);
    const covers = deleteWork(workId);
    await Promise.all(covers.map(deleteCover));
    return reply.redirect('/');
  });
}
