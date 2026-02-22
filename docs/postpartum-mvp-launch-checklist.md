# Postpartum MVP Launch Checklist (Germany-First, EN Locale)

Use this as the single go/no-go board for pilot launch.
Checked items mean "done and verified", not "planned".

Last updated: 2026-02-22

## 0) MVP Definition (Must Stay Frozen)

- [ ] Intended use statement approved (triage support only, not diagnosis)
- [ ] Target user frozen (postpartum adults, weeks 1-52, Germany)
- [ ] Output levels frozen (`EMERGENCY_NOW`, `URGENT_SAME_DAY`, `ROUTINE_FOLLOW_UP`)
- [ ] Out-of-scope list frozen and documented

## 1) Product and UX Readiness

- [ ] Result page copy reviewed for clarity and safety
- [ ] Emergency action language explicitly references `112`
- [ ] Dashboard workflows match real coordinator process (owner, follow-up, closure)
- [ ] "What happens next" message exists for each triage level
- [ ] Known UX confusion points from at least 5 user/coordinator sessions resolved

## 2) Clinical Safety and Governance

- [ ] Rule set (`rules.postpartum.de.v1.json`) reviewed by clinical advisor
- [ ] Red-flag escalation logic explicitly signed off
- [ ] Uncertainty escalation policy signed off
- [ ] Safety disclaimers approved and visible in user flow
- [ ] Clinical governance owner assigned for post-launch updates

## 3) Security, Access, and Privacy Baseline

- [x] Role-based access control implemented (`COORDINATOR` / `ADMIN`)
- [x] Password-based login (hashed credentials) implemented
- [x] Login throttling/cooldown implemented
- [x] Immutable change history implemented
- [ ] Production admin password policy defined and enforced
- [ ] Data retention/deletion policy documented
- [ ] Privacy notice + consent copy finalized for pilot context

## 4) Engineering and Release Readiness

- [x] SQLite persistence for cases/changes/sessions implemented
- [x] Restart persistence verified
- [x] Concurrency behavior tested for workflow updates
- [x] Node/runtime guardrails added (`.nvmrc`, version checks)
- [x] Regression tests green (`postpartum:test`, `postpartum:web:test`, `triage:test`)
- [ ] Production deployment target configured (hosting + managed backups)
- [ ] Secrets management defined for production env vars
- [ ] Error logging + monitoring + alert routing configured
- [ ] Backup/restore runbook tested

## 5) Pilot Operations Readiness

- [ ] Pilot coordinator roster created (named users, roles assigned)
- [ ] Incident triage SOP documented (who responds, in what SLA)
- [ ] Clinical escalation SOP documented for high-risk cases
- [ ] Weekly review cadence scheduled (safety + product outcomes)
- [ ] Pilot entry/exit criteria defined

## 6) Launch Gate (All Must Be True)

- [ ] Clinical sign-off complete
- [ ] Legal/regulatory copy sign-off complete
- [ ] Security/privacy baseline complete
- [ ] Operations SOP complete
- [ ] Production environment healthy and monitored
- [ ] Pilot metrics dashboard ready

## 7) Day-1 / Week-1 Metrics

- [ ] Triage distribution by level
- [ ] % urgent/emergency cases with documented follow-up
- [ ] Median time from triage to first care contact (where available)
- [ ] Open high-risk cases count
- [ ] Overdue open cases %
- [ ] Safety incidents count and time-to-review

## 8) Current Technical Baseline (Already Shipped)

- [x] Postpartum rule engine + CLI
- [x] Web triage UI + result rendering
- [x] Persistent history + workflow dashboard
- [x] Outcome/workflow editing
- [x] Auth-protected APIs
- [x] Admin user management APIs
- [x] Immutable audit change trail
- [x] Integration test harness for auth/validation/persistence/concurrency

## Usage Rule

Only call MVP "ready" when sections 0-6 are fully checked.
