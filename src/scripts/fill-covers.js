// Cherche une couverture pour les éditions qui n'en ont pas (et qui ont un ISBN).
// Sur le serveur : docker compose exec livres npm run couvertures
import { migrate } from '../db/index.js';
import { editionsWithoutCover } from '../lib/books.js';
import { fillCovers } from '../services/fill-covers.js';

migrate();
const editions = editionsWithoutCover();
console.log(`${editions.length} édition(s) sans couverture.`);
const found = await fillCovers(editions, console.log);
console.log(`Terminé : ${found} couverture(s) ajoutée(s).`);
