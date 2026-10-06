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
    visit.html   # 찾아오는 길: map, address, campus weather, reservation CTA
    visit.css    # Styles for visit.html and reserve.html
    visit.js     # Leaflet map + Open-Meteo weather + address copy
    reserve.html # 방문 예약 form: calendar, time, applicant fields, confirm modal
    reserve.css  # Styles for reserve.html
    reserve.js   # Calendar, validation, submit gating, confirm modal, POST
    admin-reservations.html # 예약하기 관리 tab: the reservation table
    admin-reservations.css  # Styles for the reservation table
    admin-reservations.js   # Reservation list + 처리 상태 changes
  backend/
    server.js                  # HTTP server, public API, admin API
    auth/adminAuth.js          # Password hashing, sessions, lockout
    data/projectStore.js       # JSON file persistence + validation
    data/portfolioData.js      # Public API adapter (published only)
    data/projects.json         # Project records (committed)
    data/reservationStore.js   # Visit-reservation rules + validation
    data/reservationStorage.js # Reservation persistence (file or Blob)
    data/reservations.json     # Reservation records (gitignored: visitor PII)
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
- `GET /api/admin/reservations` returns every reservation, newest first
- `PATCH /api/admin/reservations/:id` with `{ "status": "confirmed" }` sets 처리 상태

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

## Reservation page (방문 예약)

Public at `/reserve`. `reserve.js` runs the form; `backend/data/reservationStore.js`
holds the real rules and re-checks every field the browser already checked.

Rules (both copies must agree):

- Selectable dates: weekdays only, no public holidays, from tomorrow to
  `BOOKING_WINDOW_DAYS` (90) ahead. Same-day booking is refused.
- The holiday table lives twice — `backend/data/reservationStore.js` and
  `frontend/reserve.js`. It came from date.nager.at's KR list, minus 제헌절
  (a commemorative day, not a day off), plus 근로자의 날. **Covers 2026–2027
  only; add the next year before it arrives, and change both copies together.**
- Time slots: 13:00–18:00 inclusive, every 30 minutes, generated from one loop
  rather than written out, so the range is changed in one place.
- Required: name, email, purpose, date, time, and the consent checkbox. The
  submit button stays `disabled` until all six pass. Server returns 400 with a
  per-field `errors` map if anything is missing.
- Email must match `/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/`. A bad value turns the
  input red and prints the reason under it.
- Red error text only appears for fields the visitor has already touched (or
  after a submit attempt), so the form does not greet them in red.

Flow: 예약하기 → confirm modal showing every value → 확인하고 예약하기 →
Formspree (the email that matters) → `POST /api/reservations` (a secondary copy).
The browser writes its own copy to `localStorage` *before* either request, so a
network failure never loses what the visitor typed; the done panel then offers
예약 내용 복사.

### Formspree (how the reservation reaches the inbox)

- Endpoint: `https://formspree.io/f/xqpeaapj`, id in `FORMSPREE_FORM_ID` at the
  top of `reserve.js`. Submitted with `fetch` as JSON plus
  `Accept: application/json`; without that header Formspree replies with an HTML
  page instead of JSON. Preflight from the Vercel domain is allowed.
- **The recipient address is not in this repo.** It is set in the Formspree
  dashboard. Do not hardcode it in `frontend/` — a public page with an address in
  it gets scraped. The `email` field is sent so Formspree sets Reply-To.
- Field names are sent in Korean (이름, 방문날짜, 희망시간, 방문목적 …) because
  they become the labels in the email that is received.
- `_gotcha` is a honeypot input, hidden off-screen rather than with
  `display: none` (some bots skip hidden inputs). It must arrive empty.
- Status handling: 422 is treated as a field problem, so the confirm modal stays
  open with the reason and the visitor can fix it. 429 and anything else close the
  modal and say plainly that it was not delivered, with the copy button offered.
- The done panel only says "접수되었어요" when Formspree returned ok. Reaching the
  success wording without a delivered email would be the one unacceptable outcome.
- `@formspree/ajax` is deliberately **not** used. It binds to the form's submit
  event and owns the submit button and the error/success containers, which would
  fight the confirm-modal flow and the per-field validation already here.
- Free plan: 50 submissions a month. Past that, Formspree answers 429 and the page
  falls back to the copy-and-call message.

### Managing reservations (예약하기 관리)

`admin-reservations.html`, reached from the tab in the top-right of either admin
screen. Served at `/admin-reservations` — **not** `/admin/reservations`, because
one level deeper makes the page's relative `admin.css` resolve to
`/admin/admin.css` and every asset 404s. Keep admin pages at the same depth.

- The table columns are fixed: 예약번호 / 신청자 · 이메일 / 방문 희망 시간 /
  방문 목적 / 처리 상태 / 관리. The 관리 column is four buttons, one per status;
  the current status is the filled, disabled one.
- 처리 상태 is stored as `received | confirmed | change_requested | cancelled`
  and displayed as 접수 / 확정 / 변경 요청 / 취소. `STATUS_LABELS` in
  `reservationStore.js` is the source; `admin-reservations.js` keeps a matching
  copy for rendering, so change both together.
- `status: 'new'` from the first version of the feature normalizes to `received`
  on read, so old records need no migration.
- 예약번호 is `R-YYMMDD-HHMM-XXXX`: the visit date and time, then four hex chars
  hashed from email + name. Deriving it from the slot *and* the person is the
  point — the same person booking two different times must get two numbers, which
  a name/email-only key would not give. It is stored on create and backfilled on
  read for older records.
- A status change always re-renders from the record the server returned. Patching
  only the DOM would let the screen drift from what is stored.
- **Not yet built:** nothing stops two people booking the same slot. The table is
  where that will surface when it is added.

Navigating between the two admin pages would normally log you out — `pagehide`
fires a `sendBeacon` logout by design. Links carrying `data-admin-nav` set a flag
that suppresses that beacon, so the tab keeps the session while closing the tab
still drops it.

Server-side storage is the backup copy, not the delivery path. Why the response
still has a `saved` flag:

- Render's free plan has no persistent disk, so `isWritable()` is false there.
  Rather than claim success and lose the booking, the endpoint answers
  `200 { saved: false, reason }`, logs the full record to the server console,
  and the page tells the visitor plainly that it was not stored.
- Set `BLOB_READ_WRITE_TOKEN` and reservations persist in Vercel Blob with
  `access: 'private'` — unlike projects.json these must not be publicly fetchable.
- `reservations.json` is gitignored. It holds names and emails; never commit it.
- Read them back with `GET /api/admin/reservations` (admin session required).
- `GET /api/health` reports reservation storage separately from project storage.

`POST /api/reservations` is open to anyone, so it is rate limited to 5 requests
per 10 minutes per client IP (in-memory, resets on restart).

## Visit page (찾아오는 길)

- Public at `/visit` (Vercel `cleanUrls`) and `/visit.html`. `server.js` maps the
  extensionless `/visit` and `/reserve` paths to their `.html` files so local dev
  and the deployed site answer the same addresses.
- The visit address is 충청남도 천안시 동남구 상명대길 31, 상록관 306호.
- External services, all key-free, and all credited in small print on the page:
  - Map: Leaflet 1.9.4 (jsDelivr) over OpenStreetMap raster tiles.
  - Coordinates: looked up once through OSM Nominatim and stored as the
    `VISIT_PLACE` constant in `visit.js`. No geocoding request at page load.
  - Weather: `api.open-meteo.com/v1/forecast` with
    `current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code`.
- Both externals degrade instead of breaking: if the Leaflet CDN is blocked the map
  box is replaced with a note pointing at the 네이버/카카오 buttons, and a failed
  weather fetch leaves the metrics as `—` with a retry hint.
- `visit.js` carries its own toast and copy helpers, so `visit.html` does not load
  `app.js` (which exists to render project cards and build the PDF).
- `reserve.html` is intentionally only a shell. The reservation form is the next step.

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
