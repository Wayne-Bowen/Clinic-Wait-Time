# Clinic Wait Time App

Plain HTML/CSS/JS frontend + Supabase backend. No build step, no framework —
open the files or host them as static files anywhere free (GitHub Pages,
Netlify, Vercel, Cloudflare Pages).

## Live Demo

- **App:** https://clientwaittime.netlify.app/
- **Patient view:** https://clientwaittime.netlify.app/patient — no login needed, works with any active ticket code
- **Receptionist view:** https://clientwaittime.netlify.app/receptionist — staff-only, requires sign-in

**Demo login (for reviewers only — not a real clinic account):**
```
Email:    demo.reception@clinicqueue.app
Password: 1111
```
This is a throwaway account created solely so recruiters/reviewers can see
the receptionist dashboard. It is not a personal account and has no real
patient data behind it — feel free to check patients in and mark them done,
it's a sandbox.

## 1. Set up Supabase (free tier)

1. Create a project at supabase.com (free tier is enough for a single clinic).
2. Open the **SQL Editor**, paste in the full contents of `sql/schema.sql`,
   and run it. This creates the tables, locks them down with Row Level
   Security, and creates the three functions the app calls.
3. Go to **Database → Replication** and turn on replication for the
   `tickets` table — this is what makes the receptionist's queue update
   live without her refreshing anything.
4. Go to **Authentication → Users** and manually add one user: the
   receptionist's email + a password. This is the only login in the
   whole app.
5. Go to **Project Settings → API** and copy the **Project URL** and
   **anon public key**.

## 2. Configure the frontend

Open `js/config.js` and fill in:

```js
const SUPABASE_URL = "https://xxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
const PATIENT_PAGE_URL = "https://your-deployed-site.example/patient.html";
```

`PATIENT_PAGE_URL` should be the real, live URL of `patient.html` once you've
hosted the files — it's used to build the QR code shown at check-in.

## 3. Host it

Drag the whole `clinic-wait-app` folder into Netlify, or push it to a GitHub
repo and enable GitHub Pages. Either is free and needs no server to
maintain.

## 4. Daily use

- On the front-desk computer/tablet, open `receptionist.html` once and sign
  in. The session is saved in the browser, so this isn't repeated per
  patient — only if the browser's storage is cleared or a new device is
  used.
- For each new patient: type their name/initials, hit **Check in**. A code
  and QR appear — hand it to the patient or let them scan it.
- Patients without a smartphone can just be told the 4-character code and
  type it into any browser at `patient.html`.

## Architecture & security notes

- **No sign-up flow, by design.** This is a single-tenant app — one clinic,
  one receptionist login — not a multi-tenant SaaS product. There's
  intentionally no public registration.
- **Row Level Security is on** for the `tickets` table, and there is no
  policy granting the patient role (`anon`) any direct access to it. Even
  someone who opened the browser dev tools and tried to query Supabase
  directly would get nothing back.
- Patients only ever reach their own row through `get_ticket_status()`, a
  `security definer` function that takes one ticket code and returns only
  that one ticket's status — never the rest of the queue.
- The receptionist's full-queue access comes from being signed in
  (`authenticated` role), which is the only role the "staff full access"
  policy trusts.
- Wait time estimates use a weighted rolling average
  (`avg = old_avg * 0.8 + last_consult_duration * 0.2`), stored in a
  single-row `clinic_settings` table, so estimates improve over time as
  real consult data comes in.

## How this maps to constraints

**Budget** — Supabase free tier (Postgres + Auth + Realtime) and free static
hosting cover everything. The QR codes are generated through a free,
keyless endpoint (`api.qrserver.com`), so there's no paid API anywhere in
the stack.

**Staff skill / no training** — the receptionist's entire daily workflow is
two actions: type a name and click a button, or click "Call"/"Complete" on
a row. There are no settings, no menus, no jargon.

**Privacy** — enforced at the database level, not just hidden in the UI.
See "Architecture & security notes" above.

## How this maps to acceptance tests

1. **Receptionist needs no training** — the whole interface is a check-in
   box and a table with Call/Complete buttons.
2. **Patient sees wait time in under 10 seconds** — no login, no forms; a
   QR scan lands directly on `patient.html?code=...`, which fires a single
   RPC call and renders one big number.
3. **A patient can't see another patient's data** — enforced by RLS and the
   scoped RPC function described above, not just hidden in the UI.
4. **Receptionist sees the full ordered queue; patient sees only their own
   number** — two separate pages backed by two separate access paths
   (table access vs. single-row function).
5. **Patient can leave and come back** — the ticket code is saved in
   `localStorage`, and the page re-fetches the latest status the moment it
   becomes visible again, plus every 15 seconds while open.
6. **Patient understands wait time at a glance** — one large number, one
   plain-language line ("You're next!", "2 patients ahead of you"), no
   explanation of the underlying formula anywhere on that screen.

## What's deliberately left out of this MVP

- SMS notifications when a patient is nearly up.
- Manual queue reordering / priority flag for urgent walk-ins (the schema
  already has a `priority` column and the queue ordering already respects
  it — just no UI control yet to set it above the default).
- Analytics/reporting on wait times over time.

These are natural next phases once the core loop is running in the clinic.
