// Génère les icônes PNG de l'écran d'accueil à partir du dessin de public/img/icon.svg.
// À relancer seulement si l'icône change : `npm run icones`, puis committer les PNG.
//
// - iOS arrondit lui-même les coins : l'icône doit remplir tout le carré,
//   sinon les coins transparents apparaissent en noir.
// - Android « maskable » découpe l'icône en cercle ou en carré arrondi :
//   le dessin doit tenir dans le cercle central (80 % de la largeur).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = (name) => path.join(root, 'public/img', name);

const BACKGROUND = '#1f5e4b';
const DRAWING = `
  <rect x="120" y="128" width="62" height="256" rx="10" fill="#f2efe6"/>
  <rect x="198" y="104" width="62" height="280" rx="10" fill="#c9dccf"/>
  <rect x="280" y="140" width="62" height="250" rx="10" fill="#f2efe6" transform="rotate(-14 311 265)"/>
  <rect x="120" y="384" width="272" height="18" rx="9" fill="#c9dccf"/>`;

// Carré plein ; scale < 1 resserre le dessin vers le centre
const svg = (scale) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BACKGROUND}"/>
  <g transform="translate(256 253) scale(${scale}) translate(-256 -253)">${DRAWING}</g>
</svg>`);

const icons = [
  { file: 'icon-180.png', size: 180, scale: 1 },
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78 },
];

for (const { file, size, scale } of icons) {
  await sharp(svg(scale), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out(file));
  console.log(`${file} (${size}×${size})`);
}
