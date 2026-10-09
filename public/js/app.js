// Confirmation avant une action destructive : <form data-confirm="Message">.
// Écouteur en phase de capture, pour passer avant la barre de chargement ci-dessous.
document.addEventListener('submit', (event) => {
  const message = event.target.dataset?.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
}, true);

// Aperçu immédiat de la couverture choisie dans le formulaire livre
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.name !== 'cover' || !input.files?.[0]) return;
  const field = input.closest('.cover-field');
  if (!field) return;
  const img = document.createElement('img');
  img.className = 'cover cover--preview';
  img.alt = 'Nouvelle couverture';
  img.src = URL.createObjectURL(input.files[0]);
  const preview = field.querySelector('.cover--preview');
  if (preview) preview.replaceWith(img);
  else field.prepend(img);
  // La photo envoyée remplace les couvertures trouvées en ligne
  const choices = document.getElementById('cover-choices');
  if (choices) choices.hidden = true;
});

// Barre de chargement en haut de l'écran pendant le passage d'une page à l'autre.
// Une fois installée sur l'écran d'accueil, l'app n'a plus l'indicateur du navigateur.
(function () {
  let timer = null;
  const start = () => {
    clearTimeout(timer);
    // Petit délai : rien ne s'affiche pour les pages qui arrivent tout de suite
    timer = setTimeout(() => document.body.classList.add('is-navigating'), 150);
  };
  const stop = () => {
    clearTimeout(timer);
    document.body.classList.remove('is-navigating');
  };

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target || link.hasAttribute('download') || link.origin !== location.origin) return;
    if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
    start();
  });
  // Les formulaires htmx annulent l'envoi classique : defaultPrevented est alors vrai
  document.addEventListener('submit', (event) => {
    if (!event.defaultPrevented) start();
  });
  // Retour arrière : la page revient du cache avec la barre encore affichée
  window.addEventListener('pageshow', stop);
})();

// Formulaires longs à traiter (<form data-busy>) : le bouton affiche son état « occupé »
// et ne peut pas être touché deux fois
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (event.defaultPrevented || !form.hasAttribute?.('data-busy')) return;
  const button = event.submitter || form.querySelector('button[type=submit]');
  if (!button) return;
  button.classList.add('is-busy');
  setTimeout(() => { button.disabled = true; }, 0);
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  document.querySelectorAll('form[data-busy] .is-busy').forEach((b) => { b.classList.remove('is-busy'); b.disabled = false; });
});

// Lien « retour » : si l'on vient de cette page, on revient en arrière dans l'historique,
// ce qui conserve les filtres et la position de défilement de la bibliothèque
document.addEventListener('click', (event) => {
  const link = event.target.closest('a.back');
  if (!link || !document.referrer || history.length < 2) return;
  let from;
  try { from = new URL(document.referrer); } catch (e) { return; }
  if (from.origin !== location.origin || from.pathname !== link.pathname) return;
  event.preventDefault();
  history.back();
});

// Message « Livre ajouté » : on le retire de l'adresse pour qu'il ne revienne pas
// en rechargeant la page
if (/[?&](ajoute|existant)=/.test(location.search)) {
  history.replaceState(history.state, '', location.pathname);
}

// Conseil d'installation sur l'écran d'accueil (pas d'invite automatique sans HTTPS)
(function () {
  const hint = document.getElementById('install-hint');
  if (!hint) return;
  const KEY = 'livres:install-hint-masque';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const platform = ios ? 'ios' : /Android/.test(ua) ? 'android' : null;
  let dismissed = false;
  try { dismissed = localStorage.getItem(KEY) === '1'; } catch (e) { /* stockage indisponible */ }
  if (standalone || !platform || dismissed) return;

  hint.querySelectorAll('[data-platform]').forEach((p) => { p.hidden = p.dataset.platform !== platform; });
  hint.hidden = false;
  hint.querySelector('.install-hint__close').addEventListener('click', () => {
    hint.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* tant pis, il reviendra */ }
  });
})();
