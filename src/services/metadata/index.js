import { lookupGoogleBooks } from './googlebooks.js';
import { lookupOpenLibrary } from './openlibrary.js';
import { lookupBnf } from './bnf.js';

const FIELDS = ['title', 'authors', 'publisher', 'publishedDate', 'pageCount', 'language'];

// Interroge les trois sources en parallèle et fusionne champ par champ.
// Priorité : BnF pour les livres français, sinon Google Books, puis Open Library.
export async function lookupIsbn(isbn) {
  const settled = await Promise.allSettled([
    lookupGoogleBooks(isbn),
    lookupBnf(isbn),
    lookupOpenLibrary(isbn),
  ]);
  const [google, bnf, openlib] = settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  for (const r of settled) if (r.status === 'rejected') console.warn('Recherche ISBN :', r.reason?.message);

  const isFrench = bnf?.language === 'fr' || google?.language === 'fr';
  const order = (isFrench ? [bnf, google, openlib] : [google, openlib, bnf]).filter(Boolean);
  if (order.length === 0) return null;

  const merged = { isbn, sources: order.map((r) => r.source) };
  for (const field of FIELDS) {
    merged[field] = order.find((r) => r[field])?.[field] ?? null;
  }
  // Couvertures : Open Library en grand format d'abord, puis Google Books
  merged.coverUrl = openlib?.coverUrl || google?.coverUrl || null;
  return merged;
}
