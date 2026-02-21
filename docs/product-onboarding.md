# Product Onboarding (For You)

This doc is your operating manual to become the product owner of this project.
You do not need to be an expert before starting.
You only need a repeatable way to make better product decisions each week.

## 1) Where We Are Right Now

Current product direction:
- Germany-first postpartum silent morbidity triage
- Focus domains:
  - mental health risk in postpartum year
  - pelvic floor/recovery complications

Current implementation status:
- Rule-based postpartum evaluator exists
- CLI exists
- Vignette regression tests exist
- Germany emergency number is wired (`112`)

What this means:
- You are not starting from zero
- Your job now is to steer scope, user reality, and decision quality

## 2) What “Product Owner” Means Here

Your job is to answer these 5 questions repeatedly:
1. Who exactly are we serving first?
2. What painful moment are we solving first?
3. What outcome proves we solved it?
4. What are we not building now?
5. What evidence would make us change direction?

If you can answer these weekly, you are the product owner.

## 3) Your Weekly Operating Rhythm

### Daily (20 minutes)

Create one short entry in a product log with:
- User segment
- Pain moment
- Current workaround
- Why current workaround fails
- Success outcome if solved

### Weekly (60-90 minutes total)

1. Review latest insights (user notes, test behavior, feedback).
2. Make one explicit product decision.
3. Write one decision memo (max 1 page).
4. Update “Not Building Now” list.
5. Give me one prioritized build request for next week.

Rule: one clear decision per week beats ten vague ideas.

## 4) Product Decision Template (Use Every Time)

Copy/paste this and fill it:

```md
## Decision
<one sentence>

## Why now
<evidence, signal, or risk>

## Scope included
<3-5 bullets>

## Scope excluded
<3-5 bullets>

## Success signal
<what would prove this worked>

## Reversal trigger
<what evidence would make us undo this decision>
```

## 5) First User You Should Optimize For

Start with a single “primary user profile”:
- New mother in Germany, postpartum weeks 6-24
- Has persistent mood or pelvic floor symptoms
- Unsure whether symptoms are “normal”
- Not in immediate emergency at baseline, but at risk of delayed care

Why this profile:
- Strong unmet gap
- High practical relevance to current rules
- Clear escalation pathways to design around

## 6) Product North Star (v1)

North star outcome:
- Detect meaningful postpartum morbidity earlier and route to the right care level.

Operational v1 metrics to track:
1. `% users triaged as urgent/emergency who seek care within recommended window`
2. `% users with late-onset symptoms identified after week 6`
3. `time from symptom recognition to first clinical contact`
4. `false reassurance incidents` (must be near zero)

## 7) The “Not Building Now” List (Critical)

Keep this list updated every week.
Default items to exclude for now:
- Full diagnosis claims
- Insurance billing workflows
- Broad multi-country localization
- Complex AI models before rule-based reliability is proven
- Consumer wellness features unrelated to postpartum triage outcomes

This list protects focus and prevents random expansion.

## 8) What to Ask Real Users (15-20 min interviews)

Ask these in order:
1. “What symptoms did you notice first, and when?”
2. “What did you do next?”
3. “What made deciding hard?”
4. “What care did you get, and how long did it take?”
5. “What would have helped you act sooner?”

Do not pitch solution during the first 10 minutes.
Capture exact phrases; they are better than summaries.

## 9) How to Work With Me (Best Prompt Pattern)

Use this structure when asking for work:

```md
Goal:
Current scope:
Out of scope:
Definition of done:
Constraints:
```

Example:
- Goal: Add Germany action plan output for each triage level.
- Current scope: Postpartum module only.
- Out of scope: UI redesign.
- Done: JSON response includes actionable care routing text.
- Constraints: Keep deterministic rules only.

## 10) If You Feel Lost, Run This 10-Minute Reset

1. Write: “Who is this for this week?”
2. Write: “What painful moment are we solving this week?”
3. Write: “What one decision do I need to make today?”
4. Send me that decision and I implement around it.

That is enough to regain control quickly.

## 11) Next 2 Weeks (Recommended)

Week 1:
- Finalize Germany action plans per triage level
- Add action-plan assertions to postpartum vignettes
- Validate language for safety and clarity

Week 2:
- Build minimal interface (form in, triage out)
- Test flow with 3-5 real user conversations
- Tighten rules based on concrete confusion points

## 12) Reminder

You do not need to “know everything” to own product.
You need to make clear scope decisions, update them with evidence, and keep the team focused.
This doc is your loop for doing exactly that.
