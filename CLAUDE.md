# CLAUDE.md

Context for working on **Livres**, a self-hosted reading tracker. Read this before making changes.

## What it is

A web app for about 10 friends to track books: read, reading, want to read, on hold, abandoned. Hosted with Docker on a home Linux server (Dell, Docker Compose + Portainer), reachable only on the LAN and through a Headscale VPN. Never exposed publicly.

The owner writes little code: Claude writes most of it. Explain changes in plain terms, keep things simple to maintain, and avoid adding dependencies without a good reason.

## Hard constraints (decided, don't revisit without asking)

- **Interface entirely in French.** Code identifiers in English; comments in French (match existing files).
- **Node.js only** on the backend.
- **No HTTPS.** The owner uses Headscale MagicDNS and won't add a domain or certificates. Consequences:
  - No live camera access (`getUserMedia` needs a secure context). Barcode scanning uses `<input type="file" accept="image/*" capture="environment">` and decodes the photo client-side with ZXing (`public/js/scan.js`).
  - No service worker, so no offline PWA. The manifest and Apple meta tags still allow "Add to home screen".
  - Session cookies have `secure: false`. Don't use browser APIs that require a secure context (`crypto.subtle`, clipboard write, etc.).
- **Accounts are created by the admin only.** No self-registration. Simple username/password login.
- **Everything is visible to all users** (libraries, reviews). No social features beyond seeing what others read and their reviews: no feed, comments, or likes.
- **Phone first.** Design for ~390px wide, then scale up.
- **Design reference: Shelv (Navidrome client).** Clean Apple-style UI, covers as the main visual element, grid/list toggle, dark and light mode following the system.

## Stack

- Fastify 5, `@fastify/view` with Nunjucks, `@fastify/static`, `@fastify/formbody`, `@fastify/cookie`, `@fastify/multipart` (`attachFieldsToBody: 'keyValues'`, file fields arrive as Buffers)
- htmx 2 for interactivity, served from `node_modules` (no CDN: the app must work without internet on the client side)
- SQLite via `better-sqlite3` (WAL, foreign keys on)
- `@node-rs/argon2` for passwords, `sharp` for covers, `fast-xml-parser` for the BnF API, `i18n-iso-countries` for French country names
- ES modules (`"type": "module"`), Node 22

## Commands

```sh
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=test1234 COOKIE_SECRET=$(openssl rand -hex 32) npm run dev   # http://localhost:3000
docker compose up -d --build     # production-like run, needs .env (see .env.example)
```

Data goes to `./data` (database + covers) and `./backups`. Delete `./data` to start from scratch; the admin account is recreated from the env vars on first start only.

There is no test suite yet. Verify changes by running the app and exercising routes with curl or a browser, in both light and dark mode, at phone width.

## Layout

```
src/server.js            app setup, auth hook (onRequest), template filters, static routes
src/config.js            environment variables
src/db/index.js          connection + migration runner
src/db/migrations/*.sql  numbered migrations, applied in order at startup
src/db/seed.js           first-run seed: genre list, admin account
src/lib/auth.js          sessions (SQLite table, signed cookie), password hashing
src/lib/books.js         all book/reading queries and form parsing
src/lib/labels.js        statuses, formats, languages, countries (French labels), sortTitle()
src/lib/isbn.js          ISBN-10/13 validation, normalized to ISBN-13
src/routes/              auth.js, library.js, books.js
src/services/metadata/   ISBN lookup: googlebooks.js, bnf.js, openlibrary.js, merged in index.js; covers.js finds cover candidates
src/scripts/fill-covers.js  one-off: fetch covers for editions that have none (`npm run couvertures`)
src/scripts/make-icons.js   regenerates the home screen PNG icons (`npm run icones`), commit the output
src/services/covers.js   download/upload, resize to <name>.webp (800px) + <name>_t.webp (300px)
src/services/backup.js   nightly SQLite backup with retention
src/views/               Nunjucks templates, partials/ for htmx fragments
public/css/app.css       single stylesheet, CSS variables for light/dark
public/js/scan.js        barcode photo decoding, busy state during ISBN lookup
public/js/app.js         cover preview, page loading bar, back links, install hint
```

## Data model

- `works`: the book as a creation, shared by everyone (title, authors as a comma-separated string, genre, country of first publication as ISO 3166 alpha-2, original language as ISO 639-1)
- `editions`: a specific publication of a work (ISBN unique, language, format, pages, publisher, cover file)
- `readings`: one row per user and work (status, optional start/finish dates, which edition). Statuses: `a_lire`, `en_cours`, `lu`, `en_pause`, `abandonne`
- `reviews`: one per user and work (rating 1 to 5, whole stars only; text; recommends yes/no)
- `copies` and `loans`: physical books owned by a user, lent to a borrower given as **free text** (not necessarily an app user)
- `genres`: fixed French list, seeded on first run
- `users`, `sessions`

Reviews attach to the work, not the edition, so they're shared across editions and translations.

Schema changes go in a **new** migration file (`002_….sql`); never edit `001_init.sql`, it has already run on the server.

## Conventions and gotchas

- In async route handlers, use `return reply.viewAsync(...)`, not `reply.view`.
- `reply.locals` (set in a preHandler) exposes `currentUser` and `path` to all templates.
- htmx fragments: the library route returns only `partials/shelf.njk` when the `HX-Target` header is `shelf`. The status picker posts to `/livres/:id/statut` and swaps `partials/status.njk`.
- Unauthenticated htmx requests get a 401 with an `HX-Redirect: /connexion` header instead of a 302.
- Global input styles use `:where()` to keep zero specificity, so components can override them. Keep it that way.
- Covers get a new unique filename on every change (served with a one-year immutable cache). Delete the old files when replacing.
- Books without a cover get a generated "cloth binding" placeholder (`partials/cover.njk`, hue derived from the title by the `hue` filter). It's the app's signature visual; keep it.
- Cover candidates come from direct ISBN URLs (Decitre, Open Library, Amazon via ISBN-10) plus the metadata APIs' thumbnails. Each is downloaded and checked with sharp server-side, then offered as radio choices in the form. `saveCoverFromUrl` only accepts hosts listed in `ALLOWED_HOSTS` (`src/services/metadata/covers.js`); add a host there when adding a source.
- BnF catalogues older books under their ISBN-10 only, so `bnf.js` queries both forms.
- Reading dates fill themselves only on live transitions (`changeReadingStatus`): `en_cours` sets the start, `en_cours`/`en_pause` → `lu` sets the end. Marking a book `lu` directly sets no date, so old reads don't get today's date.
- Adding a book can attach it to an existing work (`work_id`, proposed by `findSimilarWorks` on title or author surname). The typed title then becomes the `edition_title`.
- Google Books without `GOOGLE_BOOKS_API_KEY` shares a global anonymous quota and usually returns 429.
- Hidden radio inputs (`position: absolute`) need a positioned parent, or they widen the page on mobile.
- ISBN lookup queries all three sources in parallel with a 6s timeout each and must never block or crash the add flow. If everything fails, show the manual form. BnF has priority for French editions. Genre and country are always filled in by hand.
- The Dockerfile uses `npm ci --omit=dev --ignore-scripts`. The native modules (better-sqlite3, sharp, argon2) ship prebuilt binaries; without `--ignore-scripts`, npm tries to compile better-sqlite3 and fails in the slim image. If you add a native dependency, check that it ships prebuilt linux-x64 glibc binaries.
- `docker-entrypoint.sh` fixes ownership of the bind-mounted `/data` and `/backups`, then drops to the `node` user with `setpriv`.
- Login is rate-limited in memory (10 failures per IP per 15 minutes).
- Home screen icons: iOS needs a full-bleed square PNG (transparent corners turn black), Android a `maskable` one with the drawing inside the central 80 % circle. Both come from `make-icons.js`; the SVG is only the favicon.
- Without HTTPS there's no install prompt: the library page shows a dismissible hint (iOS or Android wording, hidden in standalone mode and on desktop, dismissal kept in `localStorage`). On Android over HTTP, the home screen shortcut opens in a normal Chrome tab; iOS opens it full screen.
- In standalone mode there's no browser loading indicator, so `app.js` shows a top progress bar on full page navigations (not htmx requests). `.back` links call `history.back()` when the referrer is the link's target, to keep library filters and scroll.
- Scan decoding runs on the main thread: yield (`setTimeout`) between attempts so the status message paints. Attempts cover the full photo and a zoomed centre crop, each straight and rotated 90°.
- After creating a book the redirect carries `?ajoute=1` (notice + "Ajouter un autre livre"); `app.js` strips it from the URL.

## Roadmap

- [x] **Phase 0/1:** login, admin bootstrap, add by photo scan / ISBN / manual entry, five statuses, library grid and list with filters and search, book page, edit form, admin delete, Docker, nightly backups
- [x] **Phase 2:** optional start/finish dates, ratings (1 to 5 stars), reviews, recommend yes/no, search and filters, linking editions and translations to an existing work (deduplication when adding)
- [x] **Phase 3:** mobile polish (scan flow, home screen install)
- [ ] **Phase 4:** admin page to create and delete accounts, password change, user profiles, other users' reviews on book pages, "what my friends read" view
- [ ] **Phase 5:** statistics (books and pages per year; breakdowns by genre, language, country, format)
- [ ] **Phase 6:** physical copies and loans (free-text borrower), "who has my book" view
- [ ] **Phase 7:** CSV export, Goodreads CSV import

## Open questions

- **Genre:** currently one genre per work. The owner hasn't confirmed whether a book should allow several. Ask before building statistics or changing the schema.
- **Live ISBN lookups are untested** against the real APIs (written from documented formats). If a source returns empty or badly parsed data, fix the parser in `src/services/metadata/` using the actual response.
