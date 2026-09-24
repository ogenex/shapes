# Maths Practice
Self-contained NAPLAN style questions aimed at students studying independently, and at
parents or tutors who want a quick source of practice questions. Accounts
are optional: sign in to track progress across devices, or just start.

**Live site:** hosted on GitHub Pages directly from this repo.

## What it does

Pick a topic on the home page and work through its multiple-choice
questions one at a time. Every answer gets immediate feedback and a worked
explanation, right or wrong. At the end you get a score, a list of any
missed questions to review (with their explanations), and the option to
try again, print your results, or move on to another topic.

Students can **sign in** to keep their progress on any device and see it on
a personal **dashboard** (scores by topic, recent activity, the questions they
miss most). **Tutors and parents** get their own account type with a short
code; students who enter that code share their progress, and the tutor sees
an overview of all their students plus each student's full dashboard.

Signing in is optional — "Continue without an account" keeps the original
behaviour, with progress saved only in that browser. If accounts haven't been
configured (see below), the site runs entirely in that guest mode.

Currently covers 7 topics and 195 questions in total:

- Fractions, Decimals & Percentages
- Ratios & Rates
- Algebra & Number Patterns
- Measurement & Units
- Geometry & Shape
- Statistics & Probability
- Money & Financial Maths

## How the site is built

A static, no-build site: `index.html` lists topics; `quiz.html` runs
whichever topic is passed in `?topic=<id>`, loading its questions from
`data/topics/<id>.json`; `login.html` handles accounts; `dashboard.html`
shows progress. No framework and no build step — plain HTML/CSS/JS deployed
straight from this repo by GitHub Pages.

Accounts and progress are stored in [Supabase](https://supabase.com) (hosted
Postgres + auth, free tier), called directly from the browser. The
`supabase-js` library is loaded from the jsDelivr CDN only when accounts are
configured.

| File | Purpose |
|---|---|
| `assets/js/config.js` | Supabase URL + anon key (empty = guest-only site) |
| `assets/js/auth.js` | Current user, page guard, sign out |
| `assets/js/store.js` | Progress storage — Supabase for accounts, `localStorage` for guests |
| `assets/js/dashboard.js` | Student dashboard and tutor overview |
| `supabase/schema.sql` | Tables, row-level security and functions — run once in Supabase |

## Setting up accounts (one-off, ~10 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste the whole of
   `supabase/schema.sql`, and click **Run**. (Safe to re-run later.)
3. Open **Project Settings → API** and copy the **Project URL** and the
   **anon public** key into `assets/js/config.js`. The anon key is meant to
   be public; the row-level security rules decide what each user can read.
4. Open **Authentication → URL Configuration** and set **Site URL** to your
   GitHub Pages address (e.g. `https://<user>.github.io/shapes/`). Add
   `https://<user>.github.io/shapes/login.html` under **Redirect URLs** (plus
   `http://localhost:8000/login.html` for local testing). Confirmation and
   password-reset emails link back here.
5. Optional: under **Authentication → Providers → Email** you can turn off
   **Confirm email** so students can start straight after signing up (handy
   for younger students or school-managed addresses). Supabase's built-in
   email sender is rate-limited; for a class-sized group, set up custom SMTP
   under **Authentication → Emails**.
6. Commit and push. GitHub Pages redeploys and the site now asks people to
   sign in (or continue as a guest).

### Who can see what

- **Students** see only their own attempts.
- **Tutors/parents** see the display name and attempts of students who have
  entered their code — never their email. Either side can remove the link at
  any time, and a tutor can issue a new code (existing students stay linked).
- Anyone can choose "Tutor or parent" when signing up: it only lets them
  *receive* shared progress, so it grants no access to anyone else's data.
- Profiles can only change their display name; roles and links can't be
  edited directly (linking goes through the `link_to_tutor` function).

## For developers

### Local preview

The pages load question data with `fetch()`, which browsers block over
`file://`. Serve the folder over HTTP instead:

```
python3 -m http.server
```

then open `http://localhost:8000`.

### Adding a question

Open the relevant file in `data/topics/` and add an entry to its
`questions` array:

```json
{
  "question": "What is 3/4 + 1/8?",
  "options": ["4/12", "7/8", "4/8", "7/4"],
  "correct": 1,
  "explanation": "Convert to common denominator: 3/4 = 6/8, so 6/8 + 1/8 = 7/8"
}
```

- `correct` is the 0-based index into `options`.
- `visual` is optional: an inline SVG string (as used by several
  measurement/geometry/statistics questions) rendered above the options.
- Update `questionCount` for that topic in `data/manifest.json` to match.

### Adding a topic

1. Create `data/topics/<new-id>.json` with `{ "id", "title", "description", "questions": [] }`.
2. Add a matching entry to `data/manifest.json`.

No other code changes are needed — `index.html` and `quiz.html` are both
driven entirely by the manifest and topic files.

### How progress is stored

- **Signed in:** each completed attempt is a row in the `attempts` table
  (topic, score, total, the text of any missed questions, timestamp). If the
  save fails because the device is offline, the attempt waits in a local
  outbox (`naplanQuiz:outbox:<user id>`) and is sent on the next page load.
- **Guest:** attempts stay in the browser's `localStorage` under
  `naplanQuiz:v1` (the same key the site has always used, so existing
  history carries over). The last 50 attempts per topic are kept.
- **In-progress attempts** (so a reload doesn't lose your place) are always
  saved on the device, separately for each user.
- When someone signs in on a device that has guest history, their dashboard
  offers to add it to their account.
