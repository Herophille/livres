import countries from 'i18n-iso-countries';
import fr from 'i18n-iso-countries/langs/fr.json' with { type: 'json' };

countries.registerLocale(fr);

export const STATUSES = [
  { value: 'en_cours', label: 'En cours' },
  { value: 'a_lire', label: 'À lire' },
  { value: 'lu', label: 'Lu' },
  { value: 'en_pause', label: 'En pause' },
  { value: 'abandonne', label: 'Abandonné' },
];
export const STATUS_LABELS = Object.fromEntries(STATUSES.map((s) => [s.value, s.label]));

export const FORMATS = [
  { value: 'broche', label: 'Broché' },
  { value: 'poche', label: 'Poche' },
  { value: 'relie', label: 'Relié' },
  { value: 'numerique', label: 'Numérique' },
  { value: 'audio', label: 'Livre audio' },
];
export const FORMAT_LABELS = Object.fromEntries(FORMATS.map((f) => [f.value, f.label]));

// Langues proposées en premier, le reste via Intl
const COMMON_LANGS = ['fr', 'en', 'es', 'it', 'de', 'pt', 'ja', 'ru', 'zh', 'ar', 'nl', 'sv', 'no', 'da', 'pl', 'ko', 'la'];
const langNames = new Intl.DisplayNames(['fr'], { type: 'language' });
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const LANGUAGES = COMMON_LANGS
  .map((code) => ({ value: code, label: capitalize(langNames.of(code)) }))
  .sort((a, b) => (a.value === 'fr' ? -1 : b.value === 'fr' ? 1 : a.value === 'en' ? -1 : b.value === 'en' ? 1 : a.label.localeCompare(b.label, 'fr')));

export function languageLabel(code) {
  if (!code) return '';
  try { return capitalize(langNames.of(code)); } catch { return code; }
}

export const COUNTRIES = Object.entries(countries.getNames('fr', { select: 'official' }))
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

export function countryLabel(code) {
  return code ? countries.getName(code, 'fr') || code : '';
}

// Titre de tri : ignore les articles en début de titre
const ARTICLES = /^(le |la |les |l'|l’|un |une |des |du |the |a |an )/i;
export function sortTitle(title) {
  return title
    .trim()
    .replace(ARTICLES, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
