import { readingStats } from '../lib/stats.js';
import { getUserByUsername } from '../lib/users.js';

export default async function statsRoutes(app) {
  const page = (reply, user, friend, query) => {
    const year = /^\d{4}$/.test(query.annee || '') ? query.annee : null;
    const stats = readingStats(user.id, year);
    const base = friend ? `/amis/${friend.username}/statistiques` : '/statistiques';
    return reply.viewAsync('stats.njk', {
      title: friend ? `Statistiques de ${friend.display_name}` : 'Statistiques', stats, friend, base,
    });
  };

  app.get('/statistiques', async (req, reply) => page(reply, req.user, null, req.query));

  app.get('/amis/:username/statistiques', async (req, reply) => {
    const friend = getUserByUsername(req.params.username);
    if (!friend) return reply.callNotFound();
    if (friend.id === req.user.id) return reply.redirect('/statistiques');
    return page(reply, friend, friend, req.query);
  });
}
