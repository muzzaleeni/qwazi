# Triage Engine: CLI and Vignettes

This repo includes a deterministic rules-based triage evaluator plus a vignette regression harness.

## Commands

- Install deps:

```bash
npm install
```

- Run one triage input:

```bash
npm run triage -- --input test/vignettes/04_urgent_high_score_no_red_flags.json
```

- Run all vignettes:

```bash
npm run triage:test
```

- Type-check:

```bash
npm run typecheck
```

## CLI Input Formats

`triage` accepts either:

1. Raw `TriageInput` JSON
2. Vignette JSON with an `input` object

## Vignette Format

Each vignette file in `test/vignettes/*.json`:

```json
{
  "id": "V001",
  "description": "Short description",
  "input": {},
  "expected": {
    "level": "EMERGENCY_NOW",
    "isEmergency": true,
    "requiredRedFlags": ["RF001"],
    "scoreTotalMin": 0,
    "scoreTotalMax": 100
  }
}
```

`expected` supports:

- `level` (required): `EMERGENCY_NOW | URGENT_SAME_DAY | BOOK_WITHIN_72H`
- `isEmergency` (optional)
- `requiredRedFlags` (optional, subset must fire)
- `scoreTotalMin` and `scoreTotalMax` (optional)

## Key Paths

- Rules config: `src/config/rules.v1.json`
- Evaluator: `src/triage/evaluator.ts`
- CLI: `src/triage/cli.ts`
- Vignette runner: `src/triage/run-vignettes.ts`
