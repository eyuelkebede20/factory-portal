# Homicho Ammunition Engineering Industry Portal

A single internal web page that lists every company app (intranet, clinic, HR, etc.) as clickable links, so staff never need to remember IP addresses. The page opens automatically on each PC at login (once per day). An admin can log in with a password from `.env` and add, edit or delete apps; changes appear on every computer.

## Stack
- Node.js 20 + Express 4 (only dependency). No database: apps are stored in `/data/apps.json`.
- Frontend: one static file, `public/index.html` (plain HTML, CSS, JS). No build step, no CDN, no external fonts. It must work with **no internet access**.
- Docker + Docker Compose. Container listens on 3000, published on host port 80.

## Project layout
```
server.js                 API, auth, JSON storage, static hosting
public/index.html         The public UI (search, categories, launcher)
public/admin.html         The admin console (/admin) for secure login & app management
Dockerfile                node:20-alpine, runs as non-root user "node"
docker-compose.yml        restart: unless-stopped, port 3010:3000, named volume portal-data
.env.example              Template for .env (never commit .env)
startup/setup-startup.bat    1-click batch installer that configures auto-startup & opens browser
startup/open-portal.bat      Direct batch launcher that starts the browser pointed to portal
startup/open-portal.ps1      PowerShell startup runner that verifies connectivity & browser process
startup/install-startup.ps1  PowerShell installer for Windows startup shortcut
startup/browser-policy.reg   Sets Home page + Home button in Edge/Chrome
```

## Environment variables (`.env`)
| Name | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | yes | Password for the admin login. Server refuses to start without it. |
| `SESSION_SECRET` | yes | Long random string used to sign the admin cookie (`openssl rand -hex 32`). |
| `FACTORY_NAME` | no | Title shown at the top of the page. |

Changing `.env` needs `docker compose up -d` (recreate) to take effect.

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/apps` | public | List all apps |
| GET | `/api/session` | public | `{admin, factory}` |
| POST | `/api/login` | public | Body `{password}`; sets HttpOnly cookie (8 hours) |
| POST | `/api/logout` | public | Clears cookie |
| POST | `/api/apps` | admin | Add app `{name, url, category, description, icon, alt}` |
| PUT | `/api/apps/:id` | admin | Edit app |
| DELETE | `/api/apps/:id` | admin | Delete app |
| POST | `/api/confirm-startup` | public | Logs workstation startup confirmation `{host, user}` |
| GET | `/api/confirmations` | admin | List workstation startup confirmations |
| GET | `/api/settings` | public | Get startup redirection and download settings |
| PUT | `/api/settings` | admin | Update startup redirection and download settings |
| GET | `/api/download/setup-pc` | public | Download 1-click Windows workstation startup installer (.bat) |
| GET | `/setup.bat`, `/startup.bat`, `/install.bat` | public | Short aliases to download 1-click setup installer (.bat) |
| GET | `/open.bat`, `/api/download/open-portal` | public | Download direct batch launcher (.bat) pointing to portal |
| POST | `/api/system/update` | admin | Trigger git pull, docker rebuild and container restart |
| GET | `/api/system/update-status` | admin | Live terminal log output of running system update |
| GET | `/admin` | admin | Administrator dashboard UI |
| GET | `/healthz` | public | Health check |

App record: `{ id, name (<=60), url (http/https only, <=300), category (<=40, default "General"), description (<=120, optional), icon (optional), alt (<=30, optional display card alt/monogram) }`.

## Deploy (Docker server)
```bash
cp .env.example .env        # then edit ADMIN_PASSWORD, SESSION_SECRET, FACTORY_NAME
docker compose up -d --build
```

### Local development & testing (without Docker)
```bash
npm install
npm test                    # runs built-in test suite (node --test)
npm start                   # starts server at http://localhost:3000
```
- **Server auto-start after reboot:** the container has `restart: unless-stopped`, so it returns whenever Docker starts. Make sure Docker itself starts on boot:
  - Linux: `sudo systemctl enable docker`
  - Windows Docker Desktop: Settings > General > "Start Docker Desktop when you sign in", or use Docker Engine as a service.
- **Friendly name:** in the company DNS (or AD DNS) create an A record `portal` pointing to this server's IP, so `http://portal` works. Do the same for other apps (`clinic`, `hr`) and use those names in the portal.
- **Port 80 busy?** Change `"80:3000"` in `docker-compose.yml` (users then need `http://portal:PORT`).
- **Update:** `git pull` or copy new files, then `docker compose up -d --build`. The app list survives because it lives in the `portal-data` volume.
- **Backup:** `docker cp factory-portal:/data/apps.json ./apps-backup.json`
- **Restore:** `docker cp ./apps-backup.json factory-portal:/data/apps.json` then `docker restart factory-portal`
- **Logs:** `docker logs -f factory-portal`

## Client PC auto-startup (one-time per PC)
Goal: the portal opens by itself when a user signs in at each startup.
1. **Option A (Simplest - 1-Click .bat)**:
   - Download or copy `setup.bat` (from `http://portal:3010/setup.bat` or `startup\setup-startup.bat`).
   - Simply double-click the `.bat` file (or right-click "Run as administrator").
   - It automatically installs the startup shortcut and immediately opens the default browser pointed to the portal to verify.
2. **Option B (PowerShell)**:
   `powershell -ExecutionPolicy Bypass -File startup\install-startup.ps1 -Url http://portal:3010`
3. **Option C, all PCs (Active Directory)**: put the `startup` folder on a network share, then in Group Policy go to Computer Configuration > Policies > Windows Settings > Scripts > Startup > PowerShell Scripts and add `install-startup.ps1` with parameter `-Url http://portal:3010`.
4. **Option D, Intune**: deploy `install-startup.ps1` as a PowerShell script run as system.
5. **Optional Home button in the browser**: import `startup\browser-policy.reg` (or recreate the same values with Group Policy ADMX templates for Edge and Chrome).

How it works: `setup-startup.bat` / `install-startup.ps1` copies `open-portal.ps1` to `C:\ProgramData\FactoryPortal` (or `%LOCALAPPDATA%\FactoryPortal`) and adds a shortcut to the Windows Startup folder. At each startup/login the script verifies network/portal connectivity, opens the portal in the default browser, confirms the browser process launched, and records a verified launch log in `%LOCALAPPDATA%\FactoryPortal\startup-launch.log`.

## Security rules (do not weaken)
- Admin routes must always go through `requireAdmin`. Never trust the browser to hide buttons.
- Password and cookie checks use constant-time comparison. Login locks an IP for 5 minutes after 5 wrong tries.
- Cookie is `HttpOnly; SameSite=Strict`. If the portal is later served over HTTPS (reverse proxy), add `Secure` to the cookie and set `app.set('trust proxy', 1)` so lockouts use the real client IP.
- URLs are validated as `http(s)://` only. Never accept `javascript:` links.
- In the UI, render user data with `textContent` / `createElement`, never `innerHTML`.
- Never commit `.env`. Use a long, unique admin password. HTTP on a closed internal network is acceptable, but the password travels unencrypted, so keep the portal off the internet.

## Code conventions
- Keep it dependency-light: do not add a framework or database unless asked. Adding a package needs a clear reason.
- Keep the UI in one file with no external requests (offline-first).
- All writes to `apps.json` go through `save()` (temp file + rename, so a power cut cannot corrupt it).
- Wording in the UI: short, plain, sentence case ("Add app", "Save app", "Delete").

## Testing checklist (manual)
1. `docker compose up -d --build`, open `http://localhost`.
2. Page loads, search filters apps, links open in a new tab.
3. Wrong password shows an error; 5 wrong tries lock login for 5 minutes.
4. Correct password shows Add, Edit and Delete. Add an app, then open the page on another PC and confirm it appears within a minute.
5. `docker compose restart`, confirm apps are still there.
6. Reboot the server and confirm the portal comes back on its own.
7. On a test PC run `install-startup.ps1`, sign out and in, confirm the portal opens once, and does not reopen on a second login the same day.

## Troubleshooting
- Container exits at once: `.env` is missing or `ADMIN_PASSWORD` / `SESSION_SECRET` is empty (see `docker logs`).
- `http://portal` not found: DNS record missing, or the PC uses a different DNS server.
- Port 80 already in use: stop IIS/other service or change the published port.
- Apps vanished after a rebuild: the compose file must keep the `portal-data` volume. Do not run `docker compose down -v`.

## Ideas for later (not built yet)
Amharic/English toggle, app icons or logo upload, per-department categories, drag to reorder, optional online/offline status dots for each app.
