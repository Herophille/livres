import { db } from './index.js';
import { hashPassword } from '../lib/auth.js';
import { config } from '../config.js';

export const DEFAULT_GENRES = [
  'Roman', 'Roman policier', 'Thriller', 'Roman historique', 'Science-fiction',
  'Fantasy', 'Fantastique et horreur', 'Romance', 'Aventure', 'Classique',
  'Nouvelles', 'Poésie', 'Théâtre', 'Bande dessinée', 'Manga', 'Comics',
  'Jeunesse', 'Young adult', 'Biographie et mémoires', 'Récit et témoignage',
  'Essai', 'Histoire', 'Philosophie', 'Sciences', 'Nature et environnement',
  'Société et politique', 'Économie', 'Développement personnel', 'Voyage',
  'Art', 'Cuisine', 'Religion et spiritualité', 'Humour', 'Pratique',
];

export async function seed() {
  const genreCount = db.prepare('SELECT COUNT(*) FROM genres').pluck().get();
  if (genreCount === 0) {
    const insert = db.prepare('INSERT INTO genres (name, position) VALUES (?, ?)');
    db.transaction(() => DEFAULT_GENRES.forEach((g, i) => insert.run(g, i)))();
  }

  const userCount = db.prepare('SELECT COUNT(*) FROM users').pluck().get();
  if (userCount === 0) {
    if (!config.adminUsername || !config.adminPassword) {
      throw new Error('Aucun utilisateur : définissez ADMIN_USERNAME et ADMIN_PASSWORD pour créer le premier compte admin.');
    }
    const hash = await hashPassword(config.adminPassword);
    db.prepare(`INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'admin')`)
      .run(config.adminUsername, config.adminUsername, hash);
    console.log(`Compte admin créé : ${config.adminUsername}`);
  }
}
