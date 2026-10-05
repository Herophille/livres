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
