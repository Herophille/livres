import {
  parseBookForm, createBook, updateBook, getBook, findWorkIdByIsbn, isIsbnTaken,
  changeReadingStatus, removeReading, deleteWork, listGenres, setReadingDates, setReadingEdition,
  saveReview, deleteReview, findSimilarWorks, otherReaders,
} from '../lib/books.js';
import { normalizeIsbn } from '../lib/isbn.js';
import { copiesContext } from '../lib/copies.js';
import { STATUSES, STATUS_LABELS, FORMATS, LANGUAGES, COUNTRIES } from '../lib/labels.js';
import { lookupIsbn } from '../services/metadata/index.js';
import { findCovers, isAllowedCoverUrl } from '../services/metadata/covers.js';
import { searchBooks } from '../services/metadata/search.js';
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

// Pour les requêtes htmx on renvoie un fragment, sinon on revient sur la page du livre
const isHtmx = (req) => Boolean(req.headers['hx-request']);

// Proposition de couverture à réafficher après une erreur de saisie
const coversFromBody = (body) => (body.cover_url ? [{ url: String(body.cover_url), source: '' }] : []);

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
    const covers = found?.covers || [];
    const values = found?.title
      ? {
        isbn, title: found.title, authors: found.authors, publisher: found.publisher,
        published_date: found.publishedDate, page_count: found.pageCount, language: found.language,
        original_language: found.language, cover_url: covers[0]?.url, status: 'a_lire',
      }
      : { isbn, cover_url: covers[0]?.url, status: 'a_lire' };

    return reply.viewAsync('form.njk', {
      title: 'Ajouter un livre', mode: 'create', values, covers, ...formOptions(),
      similar: findSimilarWorks(values),
      notice: found?.title
        ? `Informations trouvées via ${found.sources.join(', ')}. Vérifiez-les et complétez le genre et le pays.`
        : 'Aucune information trouvée pour cet ISBN. Complétez la fiche à la main.',
    });
  });

  // Recherche par titre (et auteur) dans les catalogues en ligne
  app.get('/ajouter/recherche', async (req, reply) => {
    const titre = String(req.query.titre || '').trim().slice(0, 150);
    const auteur = String(req.query.auteur || '').trim().slice(0, 100);
    const data = { title: 'Ajouter un livre', search: { titre, auteur } };
    if (!titre) {
      data.search.error = 'Indiquez au moins une partie du titre.';
    } else {
      const { results, failed } = await searchBooks(titre, auteur);
      // Un livre déjà au catalogue commun mène directement à sa page
      data.search.results = results.map((r) => ({
        ...r,
        workId: r.isbn ? findWorkIdByIsbn(r.isbn) : null,
        // Sans ISBN : fiche à remplir à la main, préremplie avec ce qu'on sait
        manualUrl: r.isbn ? null : `/ajouter/manuel?${new URLSearchParams(Object.entries({
          title: r.title, authors: r.authors, publisher: r.publisher, published_date: r.year,
          language: r.language, cover_url: r.coverUrl,
        }).filter(([, v]) => v))}`,
      }));
      data.search.failed = failed;
    }
    if (req.headers['hx-target'] === 'search-results') return reply.viewAsync('partials/search-results.njk', data);
    return reply.viewAsync('add.njk', data);
  });

  // Saisie à la main, éventuellement préremplie par un résultat de recherche sans ISBN
  app.get('/ajouter/manuel', async (req, reply) => {
    const q = req.query;
    const field = (name, max = 200) => String(q[name] || '').trim().slice(0, max) || undefined;
    const coverUrl = q.cover_url && isAllowedCoverUrl(String(q.cover_url)) ? String(q.cover_url) : undefined;
    const values = {
      status: 'a_lire', title: field('title'), authors: field('authors'), publisher: field('publisher'),
      published_date: field('published_date', 10), language: field('language', 3), cover_url: coverUrl,
    };
    return reply.viewAsync('form.njk', {
      title: 'Ajouter un livre', mode: 'create', values, ...formOptions(),
      covers: coverUrl ? [{ url: coverUrl, source: 'En ligne' }] : [],
      similar: values.title ? findSimilarWorks(values) : [],
    });
  });

  // Œuvres ressemblantes, rafraîchies quand on modifie le titre ou les auteurs
  app.get('/ajouter/correspondances', async (req, reply) => {
    const values = { title: String(req.query.title || ''), authors: String(req.query.authors || ''), work_id: req.query.work_id };
    return reply.viewAsync('partials/work-match.njk', { similar: findSimilarWorks(values), values });
  });

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
        covers: coversFromBody(body), similar: findSimilarWorks(values),
      });
    }

    const cover = await coverFromRequest(body);
    const status = STATUS_LABELS[body.status] ? body.status : null;
    const workId = createBook(data, cover.file, req.user.id, status);
    return reply.redirect(`/livres/${workId}?ajoute=1`);
  });

  app.get('/livres/:id', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    // Après un ajout (ou un livre déjà présent), on propose d'enchaîner sur le suivant
    let notice = null;
    if (req.query.ajoute) notice = 'Livre ajouté.';
    else if (req.query.existant) notice = 'Ce livre est déjà dans la bibliothèque commune.';
    return reply.viewAsync('book.njk', {
      title: book.work.title, ...book, statuses: STATUSES, notice, friends: otherReaders(book.work.id, req.user.id),
      ...copiesContext(req.user.id, book.work.id, book.edition?.id),
    });
  });

  app.post('/livres/:id/statut', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();

    const status = String(req.body?.status || '');
    if (status === 'retirer') removeReading(req.user.id, book.work.id);
    else if (STATUS_LABELS[status]) changeReadingStatus(req.user.id, book.work.id, status, book.edition?.id);
    else return reply.code(400).send('Statut inconnu');

    if (!isHtmx(req)) return reply.redirect(`/livres/${book.work.id}`);
    const updated = getBook(book.work.id, req.user.id);
    return reply.viewAsync('partials/status.njk', { work: updated.work, reading: updated.reading, statuses: STATUSES });
  });

  app.post('/livres/:id/dates', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book?.reading) return reply.callNotFound();
    const dateError = setReadingDates(req.user.id, book.work.id, req.body?.started_on, req.body?.finished_on);

    if (!isHtmx(req)) return reply.redirect(`/livres/${book.work.id}`);
    const updated = getBook(book.work.id, req.user.id);
    return reply.viewAsync('partials/status.njk', {
      work: updated.work, reading: updated.reading, statuses: STATUSES, dateError,
    });
  });

  app.post('/livres/:id/edition', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    setReadingEdition(req.user.id, book.work.id, parseId(req.body?.edition_id));
    return reply.redirect(`/livres/${book.work.id}`);
  });

  app.post('/livres/:id/avis', async (req, reply) => {
    const book = getBook(parseId(req.params.id), req.user.id);
    if (!book) return reply.callNotFound();
    if (req.body?.action === 'supprimer') deleteReview(req.user.id, book.work.id);
    else saveReview(req.user.id, book.work.id, req.body || {});

    if (!isHtmx(req)) return reply.redirect(`/livres/${book.work.id}`);
    const updated = getBook(book.work.id, req.user.id);
    return reply.viewAsync('partials/review.njk', { work: updated.work, review: updated.review, saved: true });
  });

  // Couvertures trouvées en ligne pour l'ISBN saisi (formulaire de modification)
  app.get('/livres/:id/couvertures', async (req, reply) => {
    const isbn = normalizeIsbn(String(req.query.isbn || ''));
    const covers = isbn ? await findCovers(isbn) : [];
    return reply.viewAsync('partials/cover-choices.njk', { covers, mode: 'edit', searched: true, hasIsbn: Boolean(isbn) });
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
        covers: coversFromBody(body),
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
