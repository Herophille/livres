import { XMLParser } from 'fast-xml-parser';
import { fetchWithTimeout, toIso6391 } from './http.js';
import { isbn13to10 } from '../../lib/isbn.js';

const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, textNodeName: '#text' });

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (typeof v === 'object' && v !== null ? v['#text'] : v);

// "Herbert, Frank (1920-1986). Auteur du texte" -> "Frank Herbert"
export function parseBnfCreator(raw) {
  const s = String(raw).replace(/\(.*?\)/g, '').split('.')[0].trim();
  const [last, first] = s.split(',').map((p) => p.trim());
  return first ? `${first} ${last}` : last;
}

// "Le petit prince / Antoine de Saint-Exupéry ; avec…" -> "Le petit prince"
// "Dune (Trad. revue et corrigée) Frank Herbert ; traduit…" -> "Dune"
export function cleanBnfTitle(raw, authors = []) {
  let title = raw.split(' / ')[0];
  for (const name of authors) {
    const idx = title.indexOf(name);
    // Sans " / ", la mention d'édition entre parenthèses précède le nom de l'auteur
    if (idx > 0) title = title.slice(0, idx).replace(/\s*\([^)]*\)\s*$/, '');
  }
  return title.split(' ; ')[0].trim() || raw.trim();
}

// Extrait les champs utiles d'une notice Dublin Core de la BnF
export function parseBnfRecord(dc) {
  // On ne garde que les auteurs du texte (pas traducteurs, illustrateurs…)
  const creators = asArray(dc.creator).map(text).filter(Boolean);
  const authors = creators.filter((c) => /auteur du texte/i.test(c));
  const chosen = (authors.length ? authors : creators).map(parseBnfCreator);

  const titleRaw = text(asArray(dc.title)[0]);
  const title = titleRaw ? cleanBnfTitle(String(titleRaw), chosen) : null;

  const formats = asArray(dc.format).map(text).join(' ');
  const pages = formats.match(/(\d+)\s*p\./);

  const languages = asArray(dc.language).map(text);
  const publisher = text(asArray(dc.publisher)[0]);

  return {
    source: 'BnF',
    title,
    authors: chosen.length ? chosen.join(', ') : null,
    publisher: publisher ? String(publisher).replace(/\s*\(.*\)$/, '').trim() : null,
    publishedDate: text(asArray(dc.date)[0]) ? String(text(asArray(dc.date)[0])) : null,
    pageCount: pages ? Number(pages[1]) : null,
    language: toIso6391(languages[0]),
    coverUrl: null,
  };
}

export async function lookupBnf(isbn) {
  // Les notices anciennes ne connaissent que l'ISBN-10 : on cherche les deux formes
  const isbn10 = isbn13to10(isbn);
  const query = encodeURIComponent(
    isbn10 ? `bib.isbn all "${isbn}" or bib.isbn all "${isbn10}"` : `bib.isbn all "${isbn}"`,
  );
  const url = `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=${query}&recordSchema=dublincore&maximumRecords=1`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const xml = await res.text();
  const doc = parser.parse(xml);
  const record = asArray(doc?.searchRetrieveResponse?.records?.record)[0];
  const dc = record?.recordData?.dc;
  return dc ? parseBnfRecord(dc) : null;
}
