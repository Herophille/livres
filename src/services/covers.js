import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import { fetchWithTimeout } from './metadata/http.js';

const MAX_BYTES = 15 * 1024 * 1024;

// Enregistre une couverture en deux tailles (page du livre + vignette de grille).
// Renvoie le nom de base du fichier, ou null si l'image est inutilisable.
export async function saveCover(buffer) {
  if (!buffer?.length || buffer.length > MAX_BYTES) return null;
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  if (!meta.width || meta.width < 60) return null; // images vides ou "pixel" de remplacement

  const base = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  await image.clone().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 82 })
    .toFile(path.join(config.coversDir, `${base}.webp`));
  await image.clone().resize({ width: 300, withoutEnlargement: true }).webp({ quality: 78 })
    .toFile(path.join(config.coversDir, `${base}_t.webp`));
  return base;
}

export async function saveCoverFromUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  try {
    const res = await fetchWithTimeout(url, { timeout: 10000 });
    if (!res.ok) return null;
    return await saveCover(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    console.warn('Téléchargement de couverture impossible :', err.message);
    return null;
  }
}

export async function deleteCover(base) {
  if (!base) return;
  await Promise.all([`${base}.webp`, `${base}_t.webp`].map((f) =>
    fs.rm(path.join(config.coversDir, f), { force: true })));
}
