import { setEditionCover } from '../lib/books.js';
import { findCovers } from './metadata/covers.js';
import { saveCoverFromUrl } from './covers.js';

// Cherche une couverture pour chaque édition [{ id, isbn, title }], une à la fois
// pour ménager les sites interrogés. Ne lève jamais d'erreur.
export async function fillCovers(editions, log = () => {}) {
  let found = 0;
  for (const edition of editions) {
    try {
      const [best] = await findCovers(edition.isbn);
      const file = best ? await saveCoverFromUrl(best.url) : null;
      if (file) {
        setEditionCover(edition.id, file);
        found++;
        log(`✓ ${edition.title} (${best.source})`);
      } else {
        log(`– ${edition.title} : rien trouvé`);
      }
    } catch (err) {
      log(`– ${edition.title} : ${err.message}`);
    }
  }
  return found;
}

// Après un import : couvertures cherchées en arrière-plan, une seule tâche à la fois
let queue = Promise.resolve();
export function fillCoversInBackground(editions) {
  if (!editions.length) return;
  queue = queue.then(async () => {
    const found = await fillCovers(editions);
    console.log(`Import : ${found} couverture(s) trouvée(s) sur ${editions.length}.`);
  });
}
