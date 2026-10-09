import { exportLibraryCsv, parseGoodreads, importGoodreads } from '../lib/transfer.js';
import { fillCoversInBackground } from '../services/fill-covers.js';

export default async function transferRoutes(app) {
  app.get('/import-export', async (req, reply) => reply.viewAsync('transfer.njk', { title: 'Importer et exporter' }));

  app.get('/export/livres.csv', async (req, reply) => {
    const date = new Date().toISOString().slice(0, 10);
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="livres-${req.user.username}-${date}.csv"`);
    return exportLibraryCsv(req.user.id);
  });

  app.post('/import/goodreads', async (req, reply) => {
    const file = req.body?.file;
    if (!Buffer.isBuffer(file) || file.length === 0) {
      return reply.code(422).viewAsync('transfer.njk', { title: 'Importer et exporter', error: 'Choisissez le fichier CSV exporté depuis Goodreads.' });
    }
    const { entries, error } = parseGoodreads(file);
    if (error) return reply.code(422).viewAsync('transfer.njk', { title: 'Importer et exporter', error });

    const report = importGoodreads(req.user.id, entries);
    // Les couvertures des nouvelles éditions arrivent peu à peu, sans faire attendre la page
    fillCoversInBackground(report.newEditions);
    return reply.viewAsync('transfer.njk', { title: 'Import terminé', report });
  });
}
