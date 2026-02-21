# Postpartum Triage Engine (Germany Scope)

This module pivots the project to postpartum silent morbidity screening for Germany-first workflows.

## Scope (v1)

- Population: postpartum adults (weeks 1-52)
- Region: Germany (`112` emergency escalation)
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
- Vignette runner: `src/postpartum/run-vignettes.ts`
- Test cases: `test/postpartum-vignettes/*.json`

## Notes

- v1 is deterministic (rule-based), with conservative uncertainty escalation.
- This is triage support logic, not diagnosis or treatment advice.
