# Livres

Self-hosted reading tracker (French interface): books read, in progress, to read, on hold, abandoned. Shared catalogue for a small group, admin-managed accounts, barcode scanning from a phone photo.

Stack: Node.js 22, Fastify, server-rendered Nunjucks templates + htmx, SQLite.

## Deploy with Docker Compose

1. Copy this folder to the server, for example `/opt/stacks/livres`.
2. Create the settings file and fill it in:

   ```sh
   cp .env.example .env
   openssl rand -hex 32   # paste the result into COOKIE_SECRET
   nano .env
   ```

3. Build and start:

   ```sh
   docker compose up -d --build
   docker compose logs -f livres   # should print "Compte admin créé" then "Livres écoute sur…"
   ```

4. Open `http://<server>:8090` (or the `HOST_PORT` you chose) and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

The admin account is only created on the very first start. Changing `ADMIN_PASSWORD` later has no effect; you can remove it from `.env` once the account exists.

### Using Portainer

Portainer can't build an image from a folder you paste into its web editor, so pick one of these:

- **Simplest:** run step 3 over SSH. The stack then appears in Portainer (marked as created outside Portainer) and you can still see logs, restart, and inspect it there.
- **Git:** push this folder to a Git repository (Gitea, GitHub, etc.), then in Portainer use *Stacks → Add stack → Repository*, and enter the environment variables from `.env.example` in the stack's environment section. Portainer builds the image from the repository.

## Access over the VPN

With Headscale's MagicDNS, the app is reachable from any device running the Tailscale client at `http://<server-machine-name>:8090`.

For a friendlier address, Headscale can serve extra DNS records. In Headscale's `config.yaml`:

```yaml
dns:
  extra_records:
    - name: "livres.<your base_domain>"
      type: "A"
      value: "<server tailnet IP, 100.x.y.z>"
```

Restart Headscale, then use `http://livres.<your base_domain>:8090`. Devices on the LAN without the Tailscale client won't resolve these names; they use `http://<server LAN IP>:8090`.

### Why there's no HTTPS (and what it changes)

Headscale doesn't issue certificates for MagicDNS names, so the app runs on plain HTTP. Consequences:

- Barcode scanning uses a photo taken with the phone's camera app instead of a live camera view (browsers only allow live camera access over HTTPS). The photo is decoded in the browser.
- No offline mode. "Add to home screen" still works and opens the app full screen.
- Over the VPN, traffic is encrypted by WireGuard. On the home LAN, it isn't.

## Data and backups

| Path on the server | Contents |
|---|---|
| `./data/livres.db` | the database |
| `./data/covers/` | cover images |
| `./backups/` | nightly database copies (`BACKUP_HOUR`, keeps `BACKUP_KEEP` days) |

The nightly backup only copies the database. Covers are plain files: include `./data/covers/` in whatever sync you set up. RAID protects against a dead disk, not against deletion or corruption, so copy `./backups/` and `./data/covers/` to another machine regularly.

To restore a backup:

```sh
docker compose stop livres
cp backups/livres-YYYY-MM-DD-HH-MM-SS.db data/livres.db
rm -f data/livres.db-wal data/livres.db-shm
docker compose start livres
```

## Updating

Replace the files (or `git pull`), then:

```sh
docker compose up -d --build
```

Database migrations in `src/db/migrations/` run automatically at startup. Your data is never in the image, only in the mounted folders.

## Book information sources

ISBN lookups query Google Books, the BnF catalogue and Open Library in parallel and merge the results (BnF first for French editions). The server needs outbound internet access for this. Genre and country of first publication aren't reliably provided by any source, so they're filled in by hand.

An optional `GOOGLE_BOOKS_API_KEY` raises Google's anonymous quota, which is unlikely to matter for about ten users.

## Local development

```sh
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=test1234 COOKIE_SECRET=$(openssl rand -hex 32) npm run dev
```

Data goes to `./data` and `./backups`.

## Project layout

```
src/
  server.js            app setup, auth hook, static files
  config.js            environment variables
  db/                  SQLite connection, migrations, first-run seed (genres, admin)
  lib/                 auth, ISBN validation, labels, book queries
  routes/              login, library, books
  services/            ISBN lookup (Google Books, BnF, Open Library), covers, backups
  views/               Nunjucks templates
public/                CSS, scan script, icons
```
