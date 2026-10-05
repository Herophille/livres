-- Utilisateurs et sessions
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Référentiel de genres (liste fixe, modifiable par l'admin)
CREATE TABLE genres (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  position  INTEGER NOT NULL DEFAULT 0
);

-- Œuvre : le livre en tant que création, partagée entre tous
CREATE TABLE works (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  sort_title        TEXT NOT NULL,
  authors           TEXT NOT NULL DEFAULT '',   -- "Auteur 1, Auteur 2"
  genre_id          INTEGER REFERENCES genres(id) ON DELETE SET NULL,
  country_code      TEXT,                       -- ISO 3166-1 alpha-2, pays de première publication
  original_language TEXT,                       -- ISO 639-1
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_works_sort ON works(sort_title);

-- Édition : une publication précise d'une œuvre (langue, format, ISBN…)
CREATE TABLE editions (
  id               INTEGER PRIMARY KEY,
  work_id          INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  isbn             TEXT UNIQUE,                 -- ISBN-13 normalisé
  edition_title    TEXT,                        -- titre de cette édition si différent (traduction)
  publisher        TEXT,
  published_date   TEXT,
  language         TEXT,                        -- ISO 639-1
  format           TEXT CHECK (format IN ('broche','poche','relie','numerique','audio')),
  page_count       INTEGER,
  cover_file       TEXT,                        -- nom de fichier dans /data/covers
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_editions_work ON editions(work_id);

-- Lecture : l'état d'une œuvre pour un utilisateur
CREATE TABLE readings (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  edition_id  INTEGER REFERENCES editions(id) ON DELETE SET NULL,
  status      TEXT NOT NULL CHECK (status IN ('a_lire','en_cours','lu','en_pause','abandonne')),
  started_on  TEXT,
  finished_on TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, work_id)
);
CREATE INDEX idx_readings_user ON readings(user_id, status);

-- Avis : note, critique, recommandation (phase 2)
CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  body        TEXT,
  recommends  INTEGER CHECK (recommends IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, work_id)
);

-- Exemplaires physiques et prêts (phase 6)
CREATE TABLE copies (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id  INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE loans (
  id            INTEGER PRIMARY KEY,
  copy_id       INTEGER NOT NULL REFERENCES copies(id) ON DELETE CASCADE,
  borrower_name TEXT NOT NULL,
  lent_on       TEXT NOT NULL,
  returned_on   TEXT
);
CREATE INDEX idx_loans_copy ON loans(copy_id);
