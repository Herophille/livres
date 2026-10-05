import { fetchWithTimeout } from './http.js';

export async function lookupOpenLibrary(isbn) {
  const res = await fetchWithTimeout(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const book = data[`ISBN:${isbn}`];
  if (!book) return null;

  return {
    source: 'Open Library',
    title: [book.title, book.subtitle].filter(Boolean).join(' : ') || null,
    authors: book.authors?.map((a) => a.name).join(', ') || null,
    publisher: book.publishers?.[0]?.name || null,
    publishedDate: book.publish_date || null,
    pageCount: book.number_of_pages || null,
    language: null, // non fourni par cette API
    coverUrl: book.cover?.large || book.cover?.medium || null,
  };
}
