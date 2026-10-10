// Recherche de livres par titre (et auteur facultatif) dans les catalogues en ligne.
// Comme la recherche par ISBN : sources interrogées en parallèle, 6 s au plus chacune,
// et jamais d'erreur levée (une source qui échoue est simplement absente des résultats).
import { XMLParser } from 'fast-xml-parser';
import { fetchWithTimeout, toIso6391 } from './http.js';
import { parseBnfRecord } from './bnf.js';
import { normalizeIsbn } from '../../lib/isbn.js';
import { config } from '../../config.js';

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, textNodeName: '#text' });
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (typeof v === 'object' && v !== null ? v['#text'] : v);
const year = (d) => String(d || '').match(/\d{4}/)?.[0] || null;

// Open Library : une édition par œuvre, en français de préférence (paramètre lang).
// Le meilleur classement des trois, et les couvertures.
async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams({
    title, limit: '8', lang: 'fr',
    // « key » est indispensable : sans lui, Open Library ne renvoie pas le détail des éditions
    fields: 'key,title,author_name,editions,editions.title,editions.isbn,editions.language,editions.publisher,editions.publish_date,editions.cover_i,editions.number_of_pages_median',
  });
  if (author) params.set('author', author);
  const res = await fetchWithTimeout(`https://openlibrary.org/search.json?${params}`);
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const data = await res.json();
  return (data.docs || []).map((d) => {
    const e = d.editions?.docs?.[0] || {};
    return {
      source: 'Open Library',
      title: e.title || d.title,
      authors: d.author_name?.join(', ') || null,
      publisher: e.publisher?.[0] || null,
      year: year(e.publish_date?.[0]),
      language: toIso6391(e.language?.[0]),
      isbn: (e.isbn || []).map(normalizeIsbn).find(Boolean) || null,
      coverUrl: e.cover_i ? `https://covers.openlibrary.org/b/id/${e.cover_i}-M.jpg` : null,
    };
  });
}

// BnF : très complète pour les éditions françaises, mais classement approximatif.
// On ne garde que les notices avec un ISBN (les autres sont surtout des articles ou des revues).
async function searchBnf(title, author) {
  // Les guillemets fermeraient la requête CQL
  const term = (s) => s.replace(/["\\]/g, ' ').trim();
  const query = [`bib.title all "${term(title)}"`];
  if (author) query.push(`bib.author all "${term(author)}"`);
  const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=${encodeURIComponent(query.join(' and '))}&recordSchema=dublincore&maximumRecords=20`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`BnF ${res.status}`);
  const doc = parser.parse(await res.text());
  return asArray(doc?.searchRetrieveResponse?.records?.record)
    .map((r) => r?.recordData?.dc)
    .filter(Boolean)
    .map((dc) => {
      const isbnRaw = asArray(dc.identifier).map(text).find((id) => /^ISBN\s/i.test(String(id)));
      const book = parseBnfRecord(dc);
      return {
        source: 'BnF',
        title: book.title,
        authors: book.authors,
        publisher: book.publisher,
        year: year(book.publishedDate),
        language: book.language,
        isbn: isbnRaw ? normalizeIsbn(String(isbnRaw).replace(/^ISBN\s*/i, '')) : null,
        coverUrl: null,
      };
    })
    .filter((b) => b.isbn && b.title)
    .slice(0, 8);
}

// Google Books : souvent indisponible sans clé d'API (quota anonyme partagé)
async function searchGoogleBooks(title, author) {
  const q = [`intitle:${title}`, author ? `inauthor:${author}` : null].filter(Boolean).join('+');
  const key = config.googleBooksKey ? `&key=${encodeURIComponent(config.googleBooksKey)}` : '';
  const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books${key}`);
  if (!res.ok) throw new Error(`Google Books ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(({ volumeInfo: v }) => {
    const ids = v.industryIdentifiers || [];
    const isbn = normalizeIsbn((ids.find((i) => i.type === 'ISBN_13') || ids.find((i) => i.type === 'ISBN_10'))?.identifier || '');
    const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
    return {
      source: 'Google Books',
      title: [v.title, v.subtitle].filter(Boolean).join(' : '),
      authors: v.authors?.join(', ') || null,
      publisher: v.publisher || null,
      year: year(v.publishedDate),
      language: toIso6391(v.language),
      isbn: isbn || null,
      coverUrl: thumb ? thumb.replace('http://', 'https://').replace('&edge=curl', '') : null,
    };
  });
}

// Résultats fusionnés : Open Library, puis BnF, puis Google Books, sans doublon d'ISBN.
// Renvoie { results, failed } où failed liste les sources qui n'ont pas répondu.
export async function searchBooks(title, author = '') {
  const sources = [
    ['Open Library', searchOpenLibrary],
    ['BnF', searchBnf],
    ['Google Books', searchGoogleBooks],
  ];
  const settled = await Promise.allSettled(sources.map(([, search]) => search(title, author)));
  const results = [];
  const seen = new Set();
  const failed = [];
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed.push(sources[i][0]);
      console.warn('Recherche par titre :', r.reason?.message);
      return;
    }
    for (const book of r.value) {
      if (book.isbn && seen.has(book.isbn)) continue;
      if (book.isbn) seen.add(book.isbn);
      results.push(book);
    }
  });
  return { results: results.slice(0, 20), failed };
}
