# Women-Specific Cardiovascular Triage MVP Readiness Checklist

Use this checklist before writing feature code.  
Goal: ship a safe P0 MVP that supports triage escalation for acute cardiovascular symptoms in women/AFAB adults.

## 1) Product Intent and Scope

- [ ] Write a one-paragraph Intended Use statement.
- [ ] Confirm product claim: `triage support`, not diagnosis.
- [ ] Freeze P0 triage outputs:
  - [ ] `Emergency now`
  - [ ] `Urgent same-day care`
  - [ ] `Book within 72h`
- [ ] Define explicit out-of-scope use cases for MVP.
- [ ] Define inclusion/exclusion criteria (age, region, clinical boundaries).

## 2) Clinical Safety Design

- [ ] Define non-negotiable red-flag rules that always escalate to emergency.
- [ ] Define symptom inputs and female-specific risk-factor inputs for v1.
- [ ] Lock deterministic v1 rules (no ML in MVP).
- [ ] Attach rationale text for each triage rule for auditability.
- [ ] Complete clinician review of v1 ruleset (at least one cardio-informed reviewer).
- [ ] Add uncertainty policy: low-confidence outcomes escalate conservatively.

## 3) Regulatory and Medical Claims

- [ ] Decide regulatory posture per launch market (wellness/decision support/SaMD).
- [ ] Align copy, UX labels, and disclaimers to chosen posture.
- [ ] Define prohibited language (e.g., words implying diagnosis/certainty).
- [ ] Create an evidence file mapping each major claim to source evidence.

## 4) Emergency and Escalation Workflow

- [ ] Confirm emergency number behavior for target country/region.
- [ ] Implement one-tap emergency call path from all emergency states.
- [ ] Define trusted-contact alert behavior and edge cases.
- [ ] Build clinician handoff output (PDF + structured JSON).
- [ ] Ensure handoff includes timestamp, rule version, and symptom timeline.

## 5) Data Privacy and Security Baseline

- [ ] Define minimum necessary data fields (data minimization).
- [ ] Define retention/deletion policy and user controls.
- [ ] Encrypt data in transit and at rest.
- [ ] Add access controls and audit logging for sensitive data access.
- [ ] Draft consent and privacy notice for symptom/risk-factor processing.
- [ ] Confirm incident response process for privacy/security events.

## 6) Engineering Foundations

- [ ] Model the triage flow as a state machine before UI polish.
- [ ] Build versioned rules config (e.g., JSON with semantic version).
- [ ] Persist per-episode decision trace: rules fired + output + confidence bucket.
- [ ] Add remote config/kill-switch for rules rollback.
- [ ] Add analytics events for each critical step in the flow.
- [ ] Define backup/restore and operational monitoring basics.

## 7) Validation Before Pilot

- [ ] Create a test pack of 30-50 clinical vignettes with expected outputs.
- [ ] Add automated tests for all emergency red-flag branches.
- [ ] Verify no critical vignette is under-triaged in test pack.
- [ ] Run usability test for completion time and comprehension.
- [ ] Document known failure modes and mitigations.

## 8) Pilot Readiness

- [ ] Identify at least one clinical partner for pilot review.
- [ ] Define pilot inclusion criteria and safety oversight cadence.
- [ ] Define escalation follow-up workflow after app recommendation.
- [ ] Add in-app incident reporting and manual review queue.
- [ ] Train internal team on handling safety-critical user reports.

## 9) Launch Gates (Must Pass)

- [ ] Clinical sign-off on ruleset and emergency logic.
- [ ] Regulatory/legal sign-off on claims and disclaimer language.
- [ ] Security/privacy baseline completed and documented.
- [ ] Test pack passes with zero known high-risk under-triage cases.
- [ ] Kill-switch tested in staging.
- [ ] On-call incident owner assigned for launch window.

## 10) Day-1 Metrics

- [ ] Track triage distribution by level (`Emergency`, `Urgent`, `72h`).
- [ ] Track flow completion rate and drop-off points.
- [ ] Track emergency action click-through rate.
- [ ] Track handoff-card generation/share rate.
- [ ] Track user-reported recommendation usefulness.
- [ ] Track safety incidents and time-to-review.

## Definition of Ready to Build

Start coding core features only when sections 1-4 are fully checked and section 7 test-pack setup is complete.

## Section 1 Draft (Filled Example: US Launch)

Use this as the initial baseline and adjust after clinical/legal review.

### Intended Use (Draft)

This mobile application provides women-specific cardiovascular triage support for adults (18+) in the United States who are currently experiencing possible cardiac symptoms. It collects symptom and risk-factor information, applies conservative rule-based escalation logic, and recommends one of three urgency levels (`Emergency now`, `Urgent same-day care`, `Book within 72h`) with a clinician-ready episode summary. The app does not diagnose, rule out, or treat medical conditions.

### P0 Outputs (Frozen)

- `Emergency now`
- `Urgent same-day care`
- `Book within 72h`

### Explicit Out-of-Scope (MVP)

- Diagnostic conclusions (e.g., heart attack confirmation/exclusion)
- Medication prescribing or treatment advice
- Chronic cardiovascular management programs
- Pediatric use (<18 years)
- Background continuous monitoring without active symptom input
- Non-US emergency workflow localization

### Inclusion Criteria (MVP)

- Age 18+
- User is currently in the US
- User can self-report symptoms (or with caregiver help)
- User consents to processing health-related inputs for triage support

### Exclusion Criteria (MVP)

- Under age 18
- Users outside the US (until localization is implemented)
- Users seeking diagnosis, treatment plans, or prescription decisions
- Situations where the user cannot provide basic symptom timing/severity input

### Clinical Boundary Statements (User-Facing)

- "This tool supports urgency triage only. It is not a diagnosis."
- "If symptoms are severe, worsening, or feel life-threatening, call 911 now."
- "Do not delay emergency care while using this app."

### Emergency Behavior (US MVP)

- Primary emergency action: one-tap call to `911`
- Emergency CTA displayed persistently on all high-risk result screens
- Optional trusted-contact alert after user confirms emergency action

## Section 2 Draft (Filled Example: Clinical Safety Design v1)

Draft for implementation and internal testing only. Must be clinician-reviewed before pilot use.

### v1 Symptom Inputs

- Chest discomfort (pressure/tightness/pain/burning)
- Shortness of breath (at rest or on minimal exertion)
- Pain/discomfort in jaw, neck, back, shoulder, or arm
- Nausea or vomiting
- Cold sweat
- Lightheadedness, near-fainting, or fainting
- Palpitations or irregular heartbeat sensation
- Unusual severe fatigue or sudden weakness
- New confusion or trouble speaking
- Symptom onset timing and progression (sudden, intermittent, worsening)
- Duration of current episode (minutes/hours)

### v1 Risk-Factor Inputs

- Age band (`18-39`, `40-54`, `55-64`, `65+`)
- Prior cardiovascular disease (CAD, MI, stroke/TIA, heart failure)
- Hypertension
- Diabetes
- High cholesterol
- Smoking status (current/recent)
- First-degree family history of premature cardiovascular disease
- History of preeclampsia, gestational hypertension, or gestational diabetes
- Early menopause (natural or surgical before 45)
- Autoimmune disease (for example lupus/RA)
- Migraine with aura

### Non-Negotiable Emergency Red-Flag Rules (Always `Emergency now`)

- Current severe chest discomfort lasting `>= 10` minutes.
- Chest discomfort plus shortness of breath at rest.
- Chest discomfort plus fainting/near-fainting.
- Chest discomfort plus cold sweat plus nausea/vomiting.
- New neurologic signs (confusion, trouble speaking, one-sided weakness/facial droop).
- Symptoms rapidly worsening during app session.
- User reports symptoms feel life-threatening right now.

### Weighted Risk Scoring (Applied Only If No Red-Flag Rule Fired)

Assign points:

- Symptoms:
  - Chest discomfort (non-severe) = `+3`
  - Shortness of breath (non-severe) = `+2`
  - Jaw/neck/back/shoulder/arm discomfort = `+2`
  - Nausea/vomiting = `+1`
  - Cold sweat = `+2`
  - Lightheadedness/near-fainting = `+2`
  - Palpitations = `+1`
  - Unusual severe fatigue = `+2`
  - Worsening pattern over last 1-2 hours = `+2`
  - Episode duration `>= 20` minutes = `+2`
- Clinical history:
  - Prior cardiovascular disease = `+4`
  - Hypertension = `+1`
  - Diabetes = `+2`
  - High cholesterol = `+1`
  - Current/recent smoking = `+1`
  - Family history (premature CVD) = `+1`
- Women-specific multipliers:
  - Prior pregnancy hypertensive disorder or gestational diabetes = `+2`
  - Early menopause (<45) = `+1`
  - Autoimmune disease = `+1`
  - Migraine with aura = `+1`
- Age:
  - `40-54` = `+1`
  - `55-64` = `+2`
  - `65+` = `+3`

### v1 Triage Thresholds

- `>= 8` points -> `Urgent same-day care`
- `4-7` points -> `Book within 72h`
- `0-3` points -> `Book within 72h` with strict safety-net message

Note: In v1, non-red-flag paths do not produce a "no care needed" outcome.

### Uncertainty and Conservative Escalation Policy

Automatically escalate one level (for example `72h` -> `Urgent same-day`) when any of these are true:

- User cannot characterize symptom severity/duration.
- Symptom story is internally inconsistent across answers.
- Missing more than 2 critical inputs.
- App confidence bucket computed as `low`.

### Confidence Bucket Logic (v1)

- `High`: all critical inputs present and no contradictions.
- `Medium`: one critical input missing or minor contradiction.
- `Low`: two or more critical inputs missing, major contradiction, or user uncertainty on key items.

Critical inputs for confidence:

- Chest discomfort present/absent
- Shortness of breath present/absent
- Onset timing
- Progression (stable/worsening)
- Fainting/near-fainting present/absent

### Required User-Facing Safety Net Copy (All Non-Emergency Outcomes)

- "If symptoms worsen, become severe, or feel life-threatening, call 911 now."
- "If you develop chest pressure with shortness of breath, fainting, or neurologic symptoms, seek emergency care immediately."
- "This result is triage support, not a diagnosis."

### Decision Trace Requirements (Engineering)

For every triage episode, persist:

- Rule config version
- Red-flag rule IDs evaluated and fired/not-fired status
- Risk score subtotal by section (symptoms/history/women-specific/age)
- Final output level
- Confidence bucket
- Timestamped rationale string shown to user

### Clinician Review Checklist for This Ruleset

- Confirm red-flag definitions and minimum duration values
- Confirm score weights and thresholds for conservative safety
- Confirm women-specific risk factors included in v1 are appropriate
- Confirm user-facing copy does not imply diagnosis
- Confirm escalation policy for uncertainty is acceptable
