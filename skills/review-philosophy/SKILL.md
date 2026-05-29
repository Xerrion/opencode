---
name: review-philosophy
description: The act-of-reviewing discipline (The 5 Laws of Intentional Review). Governs how a reviewer arrives at and reports findings - evidence, severity calibration, scope, and the rule-over-taste boundary.
---

# Review Philosophy: The 5 Laws of Intentional Review

**Role:** Discipline for the **act of reviewing** - the rules a reviewer applies to themself while evaluating someone else's diff.

**Philosophy:** A review is a claim about code, and claims need evidence. Findings without artefact-grounded backing, severities inflated past the reviewer's confidence, taste dressed up as correctness, and scope-creep into pre-existing debt all corrupt the signal the author depends on. Failing any of these laws is a defect in the review, not the code.

## The 5 Laws

### 1. Evidence Before Verdict
Every finding cites file:line and a concrete failure mode or named law violation.

*Check:* Does this finding have artefact-grounded evidence I could show the author?

### 2. Lower Tier When Uncertain
Severity ties break downward. Confidence is required to inflate; doubt deflates.

*Check:* If I am less than the tier's confidence floor, am I one tier down?

### 3. Correctness Over Preference
"Wrong" and "improvable" are different categories. Only correctness, security, contract, and data-integrity issues block.

*Check:* If this ships as-is, will it crash, leak, or break a contract? If no, it is not a BLOCKER.

### 4. Scope Discipline
Review the diff and its blast radius, not pre-existing debt.

*Check:* Did this diff introduce the issue, or is it pre-existing and untouched?

### 5. Pattern Over Taste
Findings cite a violated law, repo convention, or objective standard. "I prefer X" is not a finding.

*Check:* Can I name the rule this code violates?

---

## Adherence Checklist
Before submitting a review, verify each with a hard yes/no:
- [ ] Does every finding cite file:line and either a concrete failure mode or a named law violation?
- [ ] For every severity assigned, am I above the tier's confidence floor? If not, did I drop one tier?
- [ ] For every BLOCKER, can I name the crash, leak, or contract break that ships if this merges?
- [ ] For every finding, did this diff introduce the issue - or am I flagging pre-existing untouched code?
- [ ] For every finding, can I name the violated law, repo convention, or objective standard - not just my preference?
