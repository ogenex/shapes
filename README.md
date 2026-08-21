# Year 7 NAPLAN Maths Practice

A free, self-contained practice site for Year 7 students preparing for the
NAPLAN numeracy test. It's aimed at students studying independently, and at
parents or tutors who want a quick source of practice questions without
signing up for anything.

**Live site:** hosted on GitHub Pages directly from this repo.

## What it does

Pick a topic on the home page and work through its multiple-choice
questions one at a time. Every answer gets immediate feedback and a worked
explanation, right or wrong. At the end you get a score, a list of any
missed questions to review (with their explanations), and the option to
try again, print your results, or move on to another topic.

There's no login and no server — progress (scores and an in-progress
attempt, so a reload doesn't lose your place) is saved locally in your own
browser, per topic. Clearing your browser's site data resets it.

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
`data/topics/<id>.json`. No framework, no build step, no backend — plain
HTML/CSS/JS deployed straight from this repo.

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

All state lives in the browser's `localStorage` under the key
`naplanQuiz:v1` — there's no backend. It holds, per topic, the last 10
completed attempts (for the score history shown on the homepage and results
screen) and an in-progress attempt (so a reload doesn't lose progress).
Clearing site data/localStorage resets everything.
