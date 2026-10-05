// fetch avec délai maximal, pour ne jamais bloquer l'ajout d'un livre
export async function fetchWithTimeout(url, { timeout = 6000, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { 'User-Agent': 'Livres-selfhosted/1.0', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Codes ISO 639-2 courants (BnF, Open Library) vers ISO 639-1
const ISO639_2 = {
  fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ita: 'it', ger: 'de', deu: 'de',
  por: 'pt', jpn: 'ja', rus: 'ru', chi: 'zh', zho: 'zh', ara: 'ar', dut: 'nl',
  nld: 'nl', swe: 'sv', nor: 'no', dan: 'da', pol: 'pl', kor: 'ko', lat: 'la',
};
export function toIso6391(code) {
  if (!code) return null;
  const c = String(code).toLowerCase().trim();
  if (c.length === 2) return c;
  return ISO639_2[c] || null;
}
