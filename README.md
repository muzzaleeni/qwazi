# qwazi

Rule-based triage engines for women’s health workflows.

Current product focus:
- Germany-first postpartum silent morbidity triage (`mental health + pelvic floor/recovery`)

Also included:
- Cardiovascular triage module (earlier exploration, kept for reference)

## Quickstart

```bash
npm install
```

Type-check:

```bash
npm run typecheck
```

## Main Commands

Postpartum (Germany scope):

```bash
npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json
npm run postpartum:test
npm run postpartum:example
npm run postpartum:web
```

Postpartum with audit log:

```bash
npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json --audit-log logs/postpartum-audit.jsonl --source local-dev --run-id run-001
```

Web UI:
- Open `http://localhost:4173` after `npm run postpartum:web`
- Triage history dashboard: `http://localhost:4173/audit.html`
- Recent history API: `GET /api/postpartum/audit/recent?limit=50`
- Auth session API: `GET /api/postpartum/auth/session`
- Auth login API: `POST /api/postpartum/auth/login` with `{ actor?, passcode }`
- Auth logout API: `POST /api/postpartum/auth/logout`
- Outcome update API: `POST /api/postpartum/audit/outcome` with `{ eventId, outcome }` (auth required)
- Workflow update API: `POST /api/postpartum/audit/workflow` with `{ eventId, workflow }` (auth required)
- Coordinator passcode env var: `COORDINATOR_PASSCODE` (default: `qwazi-local`)
- Change trail file: `logs/postpartum-change-history.jsonl`

Cardiovascular module:

```bash
npm run triage -- --input test/vignettes/04_urgent_high_score_no_red_flags.json
npm run triage:test
```

## Output Levels

Postpartum module outputs:
- `EMERGENCY_NOW`
- `URGENT_SAME_DAY`
- `ROUTINE_FOLLOW_UP`

Cardiovascular module outputs:
- `EMERGENCY_NOW`
- `URGENT_SAME_DAY`
- `BOOK_WITHIN_72H`

## Project Structure

```text
src/
  config/
    rules.v1.json                         # cardiovascular rules
    rules.postpartum.de.v1.json           # postpartum DE rules
  triage/                                 # cardiovascular evaluator + CLI + harness
  postpartum/                             # postpartum evaluator + CLI + harness
test/
  vignettes/                              # cardiovascular cases
  postpartum-vignettes/                   # postpartum DE cases
docs/
  mvp-readiness-checklist.md
  triage-engine.md
  postpartum-germany-engine.md
```

## Safety Note

This repository contains triage-support logic for prototyping and validation workflows.
It is not a diagnosis system and does not replace emergency or clinician judgment.
