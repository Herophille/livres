import sharp from 'sharp';
import { fetchWithTimeout } from './http.js';
import { isbn13to10 } from '../../lib/isbn.js';

// Seuls ces sites peuvent fournir une couverture : le serveur ne télécharge
// jamais une adresse arbitraire envoyée par le navigateur.
const ALLOWED_HOSTS = [
  'products-images.di-static.com',
  'covers.openlibrary.org',
  'archive.org',
  'images-na.ssl-images-amazon.com',
  'm.media-amazon.com',
  'books.google.com',
  'books.googleusercontent.com',
];

export function isAllowedCoverUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Adresses directes par ISBN, de la plus fiable à la moins fiable pour les livres français
export function directCoverUrls(isbn) {
  const urls = [
    { source: 'Decitre', url: `https://products-images.di-static.com/image/livre/${isbn}-475x500-1.jpg` },
    { source: 'Open Library', url: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` },
  ];
  const isbn10 = isbn13to10(isbn);
  if (isbn10) {
    urls.push({ source: 'Amazon', url: `https://images-na.ssl-images-amazon.com/images/P/${isbn10}.01.LZZZZZZZ.jpg` });
  }
  return urls;
}

// Vérifie qu'une adresse renvoie une vraie image (pas un pixel ou une image "indisponible")
async function probe(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const meta = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' }).metadata();
  if (!meta.width || meta.width < 100 || meta.height < 120) return null;
  return { width: meta.width, height: meta.height };
}

// Garde les candidates [{ source, url }] qui pointent vers une vraie couverture,
// la meilleure en premier. Ne lève jamais d'erreur.
export async function probeCovers(candidates) {
  const results = await Promise.allSettled(candidates.map((c) => probe(c.url)));
  const found = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) found.push({ ...candidates[i], ...r.value });
  });
  // Les vignettes Google Books sont petites : les images plus grandes passent devant
  return found
    .sort((a, b) => (b.width >= 250) - (a.width >= 250))
    .map(({ source, url }) => ({ source, url }));
}

// Toutes les couvertures trouvables pour un ISBN. `extra` : adresses déjà
// trouvées par la recherche de métadonnées (Google Books, Open Library).
export function findCovers(isbn, extra = []) {
  const direct = directCoverUrls(isbn);
  const known = new Set(direct.map((c) => c.url));
  return probeCovers([...direct, ...extra.filter((c) => c?.url && !known.has(c.url))]);
}
