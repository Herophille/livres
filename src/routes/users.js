import {
  listUsers, getUserByUsername, createUser, deleteUser, resetPassword, changePassword, setDisplayName, MIN_PASSWORD,
} from '../lib/users.js';
import { friendsOverview, listLibrary, libraryCounts, SORTS } from '../lib/books.js';
import { STATUSES, STATUS_LABELS } from '../lib/labels.js';

function parseId(raw) {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

export default async function userRoutes(app) {
  // ---------- Profil ----------

  const profile = (req, reply, extra = {}, code = 200) => reply.code(code).viewAsync('profile.njk', {
    title: 'Profil', minPassword: MIN_PASSWORD, counts: libraryCounts(req.user.id), ...extra,
  });

  app.get('/profil', async (req, reply) => profile(req, reply, {
    notice: { nom: 'Nom affiché modifié.', motdepasse: 'Mot de passe modifié. Vos autres appareils ont été déconnectés.' }[req.query.ok],
  }));

  app.post('/profil/nom', async (req, reply) => {
    const error = setDisplayName(req.user.id, req.body?.display_name);
    if (error) return profile(req, reply, { nameError: error, nameValue: req.body?.display_name }, 422);
    return reply.redirect('/profil?ok=nom');
  });

  app.post('/profil/mot-de-passe', async (req, reply) => {
    const errors = await changePassword(req.user.id, req.sessionId, req.body || {});
    if (errors) return profile(req, reply, { pwErrors: errors }, 422);
    return reply.redirect('/profil?ok=motdepasse');
  });

  // ---------- Amis ----------

  app.get('/amis', async (req, reply) => reply.viewAsync('friends.njk', {
    title: 'Amis', friends: friendsOverview(req.user.id),
  }));

  app.get('/amis/:username', async (req, reply) => {
    const friend = getUserByUsername(req.params.username);
    if (!friend) return reply.callNotFound();
    if (friend.id === req.user.id) return reply.redirect('/');

    const status = STATUS_LABELS[req.query.statut] ? req.query.statut : null;
    const view = req.query.vue === 'liste' ? 'liste' : 'grille';
    const sort = SORTS.some((s) => s.value === req.query.tri) ? req.query.tri : 'recent';
    const data = {
      title: friend.display_name, friend, status, view, sort,
      books: listLibrary(friend.id, { status, sort }),
      counts: libraryCounts(friend.id), statuses: STATUSES,
      // « Ma note » devient « Sa note » sur la bibliothèque d'un ami
      sorts: SORTS.map((s) => (s.value === 'note' ? { ...s, label: 'Sa note' } : s)),
    };
    if (req.headers['hx-target'] === 'shelf') return reply.viewAsync('partials/shelf.njk', data);
    return reply.viewAsync('friend.njk', data);
  });

  // ---------- Administration des comptes ----------

  app.register(async (admin) => {
    admin.addHook('preHandler', async (req, reply) => {
      if (req.user.role !== 'admin') {
        // Dans un hook, viewAsync ne fait que produire le HTML : il faut l'envoyer
        // explicitement, sinon la requête continue jusqu'à la route
        const html = await reply.viewAsync('error.njk', { title: 'Accès réservé', message: 'Cette page est réservée aux administrateurs.' });
        return reply.code(403).type('text/html; charset=utf-8').send(html);
      }
    });

    const accounts = (req, reply, extra = {}, code = 200) => reply.code(code).viewAsync('admin.njk', {
      title: 'Comptes', users: listUsers(), minPassword: MIN_PASSWORD, ...extra,
    });

    admin.get('/admin/comptes', async (req, reply) => accounts(req, reply, {
      notice: { cree: 'Compte créé.', supprime: 'Compte supprimé.', motdepasse: 'Mot de passe remplacé. Communiquez-le à la personne.' }[req.query.ok],
    }));

    admin.post('/admin/comptes', async (req, reply) => {
      const { errors } = await createUser(req.body || {});
      if (Object.keys(errors).length) {
        return accounts(req, reply, { errors, values: { ...req.body, password: '' } }, 422);
      }
      return reply.redirect('/admin/comptes?ok=cree');
    });

    admin.post('/admin/comptes/:id/mot-de-passe', async (req, reply) => {
      const id = parseId(req.params.id);
      const error = await resetPassword(id, req.body?.password);
      if (error) return accounts(req, reply, { resetError: { id, message: error } }, 422);
      return reply.redirect('/admin/comptes?ok=motdepasse');
    });

    admin.post('/admin/comptes/:id/supprimer', async (req, reply) => {
      const error = deleteUser(parseId(req.params.id), req.user.id);
      if (error) return accounts(req, reply, { error }, 422);
      return reply.redirect('/admin/comptes?ok=supprime');
    });
  });
}
