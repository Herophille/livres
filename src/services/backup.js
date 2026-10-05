import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';

// Date et heure locales (fuseau défini par TZ dans le conteneur)
function localStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

// Copie cohérente de la base SQLite, même pendant l'utilisation.
export async function runBackup() {
  await fs.mkdir(config.backupDir, { recursive: true });
  const stamp = localStamp();
  const target = path.join(config.backupDir, `livres-${stamp}.db`);
  await db.backup(target);

  const files = (await fs.readdir(config.backupDir))
    .filter((f) => /^livres-.*\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(config.backupKeep)) {
    await fs.rm(path.join(config.backupDir, old), { force: true });
  }
  console.log(`Sauvegarde créée : ${path.basename(target)}`);
  return target;
}

async function hasBackupForToday() {
  const today = localStamp().slice(0, 10);
  try {
    return (await fs.readdir(config.backupDir)).some((f) => f.startsWith(`livres-${today}`));
  } catch {
    return false;
  }
}

// Vérifie toutes les 30 minutes si la sauvegarde du jour a été faite
// (survit aux redémarrages du conteneur sans créer de doublons).
export function scheduleBackups() {
  const tick = async () => {
    if (new Date().getHours() < config.backupHour) return;
    if (await hasBackupForToday()) return;
    try { await runBackup(); } catch (err) { console.error('Échec de la sauvegarde :', err); }
  };
  setInterval(tick, 30 * 60 * 1000).unref();
  tick();
}
