# Year 7 NAPLAN Maths Practice

A static, no-build practice site hosted on GitHub Pages. `index.html` lists
topics; `quiz.html` runs whichever topic is passed in `?topic=<id>`, loading
its questions from `data/topics/<id>.json`.

## Local preview

The pages load question data with `fetch()`, which browsers block over
`file://`. Serve the folder over HTTP instead:

```
python3 -m http.server
```

then open `http://localhost:8000`.

## Adding a question

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

## Adding a topic

1. Create `data/topics/<new-id>.json` with `{ "id", "title", "description", "questions": [] }`.
2. Add a matching entry to `data/manifest.json`.

No other code changes are needed — `index.html` and `quiz.html` are both
driven entirely by the manifest and topic files.

## How progress is stored

All state lives in the browser's `localStorage` under the key
`naplanQuiz:v1` — there's no backend. It holds, per topic, the last 10
completed attempts (for the score history shown on the homepage and results
screen) and an in-progress attempt (so a reload doesn't lose progress).
Clearing site data/localStorage resets everything.
