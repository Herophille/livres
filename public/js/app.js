// Aperçu immédiat de la couverture choisie dans le formulaire livre
document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.name !== 'cover' || !input.files?.[0]) return;
  const field = input.closest('.cover-field');
  const preview = field?.querySelector('.cover--preview');
  if (!preview) return;
  const img = document.createElement('img');
  img.className = 'cover cover--preview';
  img.alt = 'Nouvelle couverture';
  img.src = URL.createObjectURL(input.files[0]);
  preview.replaceWith(img);
  field.querySelector('input[name=cover_url]')?.remove();
});
