# Postpartum Triage Engine (Germany Scope)

This module pivots the project to postpartum silent morbidity screening for Germany-first workflows.

## Scope (v1)

- Population: postpartum adults (weeks 1-52)
- Region: Germany (`112` emergency escalation)
- Locale: English-only user-facing copy in v1
- Domains:
  - mental health safety and functional deterioration
  - pelvic floor / recovery complications
- Outputs:
  - `EMERGENCY_NOW`
  - `URGENT_SAME_DAY`
  - `ROUTINE_FOLLOW_UP`

## Commands

Install dependencies:

```bash
npm install
```

Run one case:

```bash
npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json
```

Run local web UI:

```bash
npm run postpartum:web
```

Then open:

```text
http://localhost:4173
```

Triage history dashboard:

```text
http://localhost:4173/audit.html
```

Run one case and write pilot audit event (JSONL):

```bash
npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json --audit-log logs/postpartum-audit.jsonl --source local-dev --run-id run-001
```

Run postpartum regression vignettes:

```bash
npm run postpartum:test
```

Run postpartum web integration tests (auth, validation, change trail):

```bash
npm run postpartum:web:test
```

Run postpartum sample:

```bash
npm run postpartum:example
```

## Key Files

- Rules: `src/config/rules.postpartum.de.v1.json`
- Evaluator: `src/postpartum/evaluator.ts`
- Types: `src/postpartum/types.ts`
- CLI: `src/postpartum/cli.ts`
- Web server: `src/postpartum/web/server.ts`
- Web UI: `src/postpartum/web/static/*`
- Vignette runner: `src/postpartum/run-vignettes.ts`
- English copy pack: `src/postpartum/copy/en.ts`
- Audit logging: `src/postpartum/audit.ts`
- Test cases: `test/postpartum-vignettes/*.json`

## Notes

- v1 is deterministic (rule-based), with conservative uncertainty escalation.
- every result now includes a structured `actionPlan` with Germany-specific routing.
- CLI supports JSONL pilot audit logs via `--audit-log` (with optional `--include-input`).
- Web evaluation history, immutable changes, and coordinator sessions are persisted in SQLite.
- Default SQLite path: `logs/postpartum.sqlite` (override with `POSTPARTUM_DB_PATH`).
- Legacy JSONL history/change logs auto-migrate into SQLite on first run when tables are empty.
- Recent history endpoint: `GET /api/postpartum/audit/recent?limit=50`.
- Change history endpoint: `GET /api/postpartum/audit/changes?limit=50` (auth required).
- Auth session endpoint: `GET /api/postpartum/auth/session`.
- Auth login endpoint: `POST /api/postpartum/auth/login` with `{ username, password }`.
- Auth logout endpoint: `POST /api/postpartum/auth/logout`.
- Admin users list endpoint: `GET /api/postpartum/admin/users` (admin only).
- Admin create user endpoint: `POST /api/postpartum/admin/users` with `{ username, password, role, display_name? }` (admin only).
- Outcome update endpoint: `POST /api/postpartum/audit/outcome` (auth required).
- Workflow update endpoint: `POST /api/postpartum/audit/workflow` (auth required).
- Bootstrap admin comes from env vars `COORDINATOR_ADMIN_USERNAME` / `COORDINATOR_ADMIN_PASSWORD`.
- Optional default coordinator env vars: `COORDINATOR_DEFAULT_USERNAME`, `COORDINATOR_DEFAULT_PASSWORD`, `COORDINATOR_DEFAULT_DISPLAY_NAME`.
- Login hardening env vars: `AUTH_MAX_FAILED_ATTEMPTS` and `AUTH_COOLDOWN_SECONDS`.
- Local default first login is `admin / qwazi-local` until overridden by env.
- Dashboard supports editing `care_sought`, `care_time`, `care_type`, `resolved`, and `notes`.
- Coordinator workflow fields: `status`, `owner`, `follow_up_due_at`, `last_contact_at`.
- Queue views: `Needs follow-up today`, `Overdue`, `Closed`.
- Weekly ops metrics added: `% overdue`, `median time to close`, `open high-risk cases`.
- Dashboard row quick actions: `Start` (IN_PROGRESS) and `Close` (CLOSED).
- Dashboard shows case `last updated by` and timestamp for coordinator handoffs.
- Dashboard includes a `Recent Change History` table backed by immutable SQLite change records.
- This is triage support logic, not diagnosis or treatment advice.
