# Claude Code Project Guide

## Project

This is a Korean portfolio website for Choi Seung-ha, a Green Smart City student at Sangmyung University.

The frontend and backend are separated. Projects are managed through a password-protected admin page instead of by editing files.

## Current structure

```text
portfolio/
  frontend/
    index.html   # Public page markup
    style.css    # Public visual styles
    app.js       # Public interactions, API rendering, PDF generation
    admin.html   # Admin login + management screen
    admin.css    # Admin styles (separate from style.css)
    admin.js     # Admin login, list, save/edit/delete
  backend/
    server.js                  # HTTP server, public API, admin API
    auth/adminAuth.js          # Password hashing, sessions, lockout
    data/projectStore.js       # JSON file persistence + validation
    data/portfolioData.js      # Public API adapter (published only)
    data/projects.json         # Project records (committed)
    data/admin.local.json      # Password hash (gitignored, auto-created)
  scripts/setAdminPassword.js
  package.json
  CLAUDE.md
```

## Run locally

From the `portfolio` directory:

```powershell
npm.cmd start
```

- Public site: `http://localhost:3000`
- Admin page: `http://localhost:3000/admin`

On first start, a random admin password is generated and printed to the console.
Change it with `npm.cmd run set-password -- 새비밀번호`, or set the `ADMIN_PASSWORD`
environment variable (which takes priority over the stored hash).

Node.js is installed in this environment. Verified versions were Node.js `v24.19.0` and npm `11.17.0`. In PowerShell, use `npm.cmd` if the `npm.ps1` execution policy blocks `npm`.

## API endpoints

Public (GET only):

- `GET /api/health` returns `{ "status": "ok" }`
- `GET /api/portfolio` returns published projects only
- `GET /api/categories` returns the allowed category list

Admin (requires the `admin_session` cookie):

- `POST /api/admin/login` with `{ "password": "..." }`
- `POST /api/admin/logout`
- `GET /api/admin/session` returns `{ "authenticated": bool }`
- `GET /api/admin/projects` returns all projects, including drafts
- `POST /api/admin/projects` creates a project
- `PUT /api/admin/projects/:id` updates a project
- `DELETE /api/admin/projects/:id` deletes a project

## Project record shape

```js
{
  id, status,                          // status: 'draft' | 'published'
  title, role, description, date,      // date: 'YYYY-MM-DD'
  teamSize, notes,                     // teamSize: integer >= 1 or null
  category, result, linkUrl, linkLabel,
  createdAt, updatedAt
}
```

Validation rules:

- `draft` saves with any fields empty and never appears on the public site.
- `published` requires title, role, description, date, teamSize, and category.
  `notes` is always optional. `result`, `linkUrl`, and `linkLabel` stay optional.
- `date` must match `YYYY-MM-DD`. `category` must be one of 웹 / 데이터 / 디자인.
- `linkUrl` accepts only `http:` and `https:`; anything else is stored as an empty string.

The server re-validates every write. Browser-side checks are for feedback only.

## Architecture rules

- Keep browser-only code in `frontend/`.
- Keep HTTP, data access, validation, and future database integration in `backend/`.
- Do not access files in `backend/` directly from browser code.
- Keep the API response shape stable when replacing `projectStore.js` with a database.
- Do not add a database dependency until the database choice and schema are known.
- Preserve the existing visual design and Korean copy unless the task explicitly requests a UI change.
- Do not commit secrets, local credentials, or database connection strings.
- Never send the admin password or its hash to the browser. Only `{ authenticated: bool }`.
- Keep the session cookie free of `Max-Age` and `Expires` so it dies when the browser closes.

## Important implementation notes

- The project filter expects `.project-card`, `.filter-chip`, `.p-toggle-btn`, `.p-detail-box`.
- `app.js` renders cards from the API first, then collects them into the filter array.
  Anything that reads rendered cards must run after `renderProjects()`.
- The PDF builder in `app.js` reads project data from rendered DOM cards.
- Use `textContent` or DOM node creation for API values. Do not concatenate untrusted
  API values into `innerHTML` without escaping.
- Keep external project links with `target="_blank"` and `rel="noopener noreferrer"`.
- Existing global functions `copyPhone`, `copyAddress`, and `showCuteToast` are part of the current UI contract.
- `projects.json` is written atomically (temp file, then rename).
- Changing `projects.json` through the admin page takes effect immediately.
  Editing backend `.js` files requires a server restart.

## Known gaps

- The three original projects are published but have empty `date` and `teamSize`,
  because that information did not exist in the original HTML. The admin list marks
  them with an "입력 필요" badge. Re-saving them as 공개 requires filling those fields.
- Sessions are stored in memory, so a server restart logs the admin out.
- Closing or reloading the admin page sends a `sendBeacon` logout, so a refresh also
  asks for the password again. This is intentional, not a bug.

## Session policy

The admin session is deliberately short-lived:

- The cookie carries no `Max-Age`/`Expires`, so the browser drops it on close.
- `pagehide` fires a `navigator.sendBeacon('/api/admin/logout')` that destroys the
  server-side session immediately, even if the browser would have restored the cookie.
- Server sessions idle out after 30 minutes and slide forward on each authenticated request.
- The password input uses `autocomplete="off"` so browser password managers do not store it.
- `ADMIN_PASSWORD` is deleted from `process.env` right after the hash is derived.
- The cookie gains `Secure` when the request arrives over HTTPS (`x-forwarded-proto`).
- `admin.*` files are served with `Cache-Control: no-store`.
- Login verification uses async `crypto.scrypt`, never `scryptSync`. The sync version
  blocks the event loop for ~0.2s per attempt, which stalls the whole site when login
  attempts pile up. Keep `scryptSync` only for startup and the CLI password setter.

## Deployment

Two hosts, one address for the browser:

- **Vercel** serves `frontend/` statically and rewrites `/api/*` to Render.
  Because the browser only ever talks to the Vercel domain there is no CORS
  setup and the session cookie keeps `SameSite=Strict`.
- **Render** (`render.yaml`, free plan) runs `node backend/server.js` and answers the API.
  The service must stay named `resume-seungha-api`; `vercel.json` points at
  `https://resume-seungha-api.onrender.com`.

Live: https://resume-seungha.vercel.app

### Where projects are edited

Render free instances have no persistent disk, so anything written there is lost
when the instance restarts. Rather than lose work silently, `backend/runtime.js`
marks such hosts as ephemeral and `isWritable()` returns false, which closes the
admin page there with an explanation.

So the flow is:

1. `npm.cmd start` locally, edit at http://localhost:3000/admin
2. `npm.cmd run publish` — commits only `backend/data/projects.json` and pushes
3. Render redeploys and the public site shows the change

To make the deployed admin writable instead, set `BLOB_READ_WRITE_TOKEN` to a real
Vercel Blob token. `backend/data/storage.js` then stores projects in Blob and
`isWritable()` opens up again, with no other change needed.

### Storage behaviour

- Reads that fail fall back to the committed `projects.json`, so a storage outage
  never blanks the portfolio.
- Writes that fail return 503 with the reason; they are never swallowed.
- `GET /api/health` reports `storage: { mode, healthy, problem }` for diagnosing
  a deployed server without shell access.

## Validation commands

```powershell
node --check backend/server.js
node --check frontend/app.js
node --check frontend/admin.js
Invoke-WebRequest http://localhost:3000/api/health
Invoke-WebRequest http://localhost:3000/api/portfolio
```

The server must be running before making HTTP requests.
