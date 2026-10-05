import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.resolve('data');

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir,
  dbPath: path.join(dataDir, 'livres.db'),
  coversDir: path.join(dataDir, 'covers'),
  backupDir: process.env.BACKUP_DIR || path.resolve('backups'),
  backupKeep: Number(process.env.BACKUP_KEEP || 14),
  backupHour: Number(process.env.BACKUP_HOUR || 3),
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  cookieSecret: process.env.COOKIE_SECRET,
  googleBooksKey: process.env.GOOGLE_BOOKS_API_KEY || '',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  isProd: process.env.NODE_ENV === 'production',
};
