import { fetchWithTimeout, toIso6391 } from './http.js';
import { config } from '../../config.js';

export async function lookupGoogleBooks(isbn) {
  const key = config.googleBooksKey ? `&key=${encodeURIComponent(config.googleBooksKey)}` : '';
  const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key}`);
  if (!res.ok) return null;
  const data = await res.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info) return null;

  const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
  return {
    source: 'Google Books',
    title: [info.title, info.subtitle].filter(Boolean).join(' : ') || null,
    authors: info.authors?.join(', ') || null,
    publisher: info.publisher || null,
    publishedDate: info.publishedDate || null,
    pageCount: info.pageCount || null,
    language: toIso6391(info.language),
    coverUrl: thumb ? thumb.replace('http://', 'https://').replace('&edge=curl', '') : null,
  };
}
