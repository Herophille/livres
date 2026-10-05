import { lookupGoogleBooks } from './googlebooks.js';
import { lookupOpenLibrary } from './openlibrary.js';
import { lookupBnf } from './bnf.js';
import { directCoverUrls, probeCovers } from './covers.js';

const FIELDS = ['title', 'authors', 'publisher', 'publishedDate', 'pageCount', 'language'];

// Interroge les trois sources en parallèle et fusionne champ par champ.
// Priorité : BnF pour les livres français, sinon Google Books, puis Open Library.
export async function lookupIsbn(isbn) {
  // Les couvertures « directes » (Decitre, Open Library, Amazon) sont cherchées en même temps
  const coversPromise = probeCovers(directCoverUrls(isbn));
  const settled = await Promise.allSettled([
    lookupGoogleBooks(isbn),
    lookupBnf(isbn),
    lookupOpenLibrary(isbn),
  ]);
  const [google, bnf, openlib] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  for (const r of settled) if (r.status === 'rejected') console.warn('Recherche ISBN :', r.reason?.message);

  // Vignettes renvoyées par les API de métadonnées, ajoutées en fin de liste si valides
  const extra = [openlib, google].filter((r) => r?.coverUrl).map((r) => ({ source: r.source, url: r.coverUrl }));
  const [direct, fromApis] = await Promise.all([coversPromise, probeCovers(extra)]);
  const covers = [...direct, ...fromApis.filter((c) => !direct.some((d) => d.source === c.source))];

  const isFrench = bnf?.language === 'fr' || google?.language === 'fr';
  const order = (isFrench ? [bnf, google, openlib] : [google, openlib, bnf]).filter(Boolean);
  if (order.length === 0) return covers.length ? { isbn, sources: [], covers } : null;

  const merged = { isbn, sources: order.map((r) => r.source), covers };
  for (const field of FIELDS) {
    merged[field] = order.find((r) => r[field])?.[field] ?? null;
  }
  return merged;
}
