# Repo Agent Notes

## Purpose
`qwazi` is a TypeScript rules-based triage codebase for women’s health workflows.
Current product focus is Germany-first postpartum triage (`mental health + pelvic floor/recovery`) with a retained cardiovascular module for reference/regression.

## Quickstart
- Install:
  - `nvm use`
  - `npm install`
- Run postpartum CLI:
  - `npm run postpartum -- --input test/postpartum-vignettes/04_urgent_mental_health_high_score.json`
- Run postpartum web:
  - `npm run postpartum:web` then open `http://localhost:4173`
- Test:
  - `npm run postpartum:test`
  - `npm run postpartum:web:test`
  - `npm run triage:test`
- Typecheck:
  - `npm run typecheck`
- Build:
  - No dedicated build step; run via `tsx` scripts.

## Entrypoints
- Main postpartum CLI: `src/postpartum/cli.ts`
- Main postpartum web server: `src/postpartum/web/server.ts`
- Postpartum evaluator: `src/postpartum/evaluator.ts`
- Postpartum rule config: `src/config/rules.postpartum.de.v1.json`
- Cardiovascular CLI (legacy/reference): `src/triage/cli.ts`
- Node guard script: `scripts/check-node-version.cjs`

## Environment
- Required runtime:
  - Node `20.x` (`.nvmrc`, enforced in `preinstall` and pre-web scripts)
- Optional env vars:
  - `POSTPARTUM_DB_PATH` (default `logs/postpartum.sqlite`)
  - `COORDINATOR_ADMIN_USERNAME` (default `admin`)
  - `COORDINATOR_ADMIN_PASSWORD` (default `qwazi-local`)
  - `COORDINATOR_DEFAULT_USERNAME`
  - `COORDINATOR_DEFAULT_PASSWORD`
  - `COORDINATOR_DEFAULT_DISPLAY_NAME`
  - `AUTH_MAX_FAILED_ATTEMPTS` (default `5`)
  - `AUTH_COOLDOWN_SECONDS` (default `600`)
- Secrets handling:
  - Never commit production credentials.
  - Default local admin credentials are only for local/dev bootstrapping.

## Project Structure
- Source:
  - `src/postpartum/*` postpartum engine, web APIs, UI, persistence
  - `src/triage/*` cardiovascular engine + harness
  - `src/config/*` rules files
- Tests:
  - `test/postpartum-vignettes/*`
  - `test/vignettes/*`
  - `src/postpartum/run-web-tests.ts` integration harness
- Scripts:
  - `scripts/check-node-version.cjs`
- Logs/artifacts:
  - `logs/` (sqlite, jsonl)
- Docs:
  - `docs/postpartum-germany-engine.md`
  - `docs/postpartum-mvp-launch-checklist.md`
  - `docs/product-onboarding.md`
  - `docs/triage-engine.md`

## Conventions
- Where to add new code:
  - Postpartum features go under `src/postpartum/`.
  - Postpartum rule changes go in `src/config/rules.postpartum.de.v1.json`.
  - Add regression vignettes in `test/postpartum-vignettes/` for behavior changes.
- API and UI behavior:
  - Keep triage outputs constrained to `EMERGENCY_NOW | URGENT_SAME_DAY | ROUTINE_FOLLOW_UP` for postpartum.
  - Keep Germany emergency routing (`112`) explicit in user-facing copy.
- Persistence and audit:
  - Preserve immutable change trail semantics.
  - Keep dashboard workflow fields consistent (`status`, `owner`, `follow_up_due_at`, `last_contact_at`).

## Definition of Done (repo-specific)
- Code compiles and typechecks:
  - `npm run typecheck`
- Relevant regressions pass:
  - Postpartum logic changes: `npm run postpartum:test`
  - Postpartum API/UI/persistence/auth changes: `npm run postpartum:web:test`
  - Cardiovascular module changes: `npm run triage:test`
- Manual verification for web/API changes:
  - Run `npm run postpartum:web` and verify triage flow + dashboard loads.
- Docs updated when behavior, APIs, or operational rules changed:
  - Update relevant files in `docs/` and this `AGENTS.md` when commands/conventions change.

## Gotchas
- Node version drift causes native sqlite issues (`better-sqlite3` module mismatch). Always `nvm use` first.
- `node:sqlite` is not available in this runtime; project intentionally uses `better-sqlite3`.
- Legacy JSONL history/change logs auto-import into sqlite when tables are empty; verify expected data source during first run.
- Local default admin credentials must be changed before any non-local usage.

## Dependencies Notes
- Runtime deps are intentionally minimal:
  - `better-sqlite3`
- Tooling deps:
  - `typescript`, `tsx`, `@types/node`, `@types/better-sqlite3`
- Prefer adding dependencies only when required by a concrete feature or reliability need.

## Docs
- Canonical docs: `docs/`
- Evolution notes: `docs/agents-evolution.md`
