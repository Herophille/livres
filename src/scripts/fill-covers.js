// Cherche une couverture pour les éditions qui n'en ont pas (et qui ont un ISBN).
// Sur le serveur : docker compose exec livres npm run couvertures
import { migrate } from '../db/index.js';
import { editionsWithoutCover, setEditionCover } from '../lib/books.js';
import { findCovers } from '../services/metadata/covers.js';
import { saveCoverFromUrl } from '../services/covers.js';

migrate();
const editions = editionsWithoutCover();
console.log(`${editions.length} édition(s) sans couverture.`);

let found = 0;
for (const edition of editions) {
  const [best] = await findCovers(edition.isbn);
  const file = best ? await saveCoverFromUrl(best.url) : null;
  if (file) {
    setEditionCover(edition.id, file);
    found++;
    console.log(`✓ ${edition.title} (${best.source})`);
  } else {
    console.log(`– ${edition.title} : rien trouvé`);
  }
}
console.log(`Terminé : ${found} couverture(s) ajoutée(s).`);
