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
- Web evaluation calls are persisted automatically to `logs/postpartum-history.jsonl`.
- Recent history endpoint: `GET /api/postpartum/audit/recent?limit=50`.
- Outcome update endpoint: `POST /api/postpartum/audit/outcome`.
- Workflow update endpoint: `POST /api/postpartum/audit/workflow`.
- Dashboard supports editing `care_sought`, `care_time`, `care_type`, `resolved`, and `notes`.
- Coordinator workflow fields: `status`, `owner`, `follow_up_due_at`, `last_contact_at`.
- Queue views: `Needs follow-up today`, `Overdue`, `Closed`.
- Weekly ops metrics added: `% overdue`, `median time to close`, `open high-risk cases`.
- This is triage support logic, not diagnosis or treatment advice.
