---
name: implementation-philosophy
description: The act-of-implementing discipline (The 5 Laws of Intentional Implementation). Governs how an engineer carries out a change - verification, sweep, evidence, scope, and self-review - orthogonal to the code-shape laws in `code-philosophy`.
---

# Implementation Philosophy: The 5 Laws of Intentional Implementation

**Role:** Discipline for the **act of implementing** - the steps an engineer takes between receiving a delegation and reporting it done.

**Philosophy:** Good code is necessary but not sufficient. An implementation is only honest when every symbol used is verified, every renamed reference is swept, every reported result is evidenced, every changed line is justified, and the final diff has been re-read. `code-philosophy` governs what code looks like; this skill governs how implementation is carried out.

## The 5 Laws

### 1. Verify Before Invoke
Every function, method, type, attribute, or import you write must be one you have read in this session or confirmed against declared dependencies (lockfile, manifest, stdlib reference). Recognizing a name is not confirming it exists.

*Check:* Did I confirm every non-trivial symbol I introduced exists, by reading the defining file or the dependency manifest?

### 2. Sweep Before Rename
When you change a symbol's name, signature, location, or shape, search the entire project for usages and update or confirm-untouched every hit before claiming done. Do not rely on lint or tests to surface stragglers.

*Check:* Did I grep the project for the old name/signature and account for every match?

### 3. Evidence Before Done
Each PASS/FAIL line in the Verification report must be backed by the exact command run and a one-line evidence trace (exit code, output snippet, "no output", or test count). No claim without a citation.

*Check:* For every PASS in my report, can I produce the command and the output I observed in this session?

### 4. Smallest Sufficient Diff
Every changed line must trace to a specific requirement in the delegation or to a defect your change introduced. Nearby ugliness, opportunistic renames, and prophylactic abstractions belong in a separate task - even when the loaded philosophy would prefer them.

*Check:* Can I justify every changed hunk with a sentence pointing at the delegation or at a regression my edit caused?

### 5. Re-Read the Diff
Before writing the report, read the full diff end-to-end and confirm it is what you intended - no stale edits, leftover scaffolding, debug prints, half-finished refactors, or accidental deletions.

*Check:* Did I view the full diff after my last edit and read every hunk before composing the report?

---

## Adherence Checklist
Before reporting an implementation done, verify each with a hard yes/no:
- [ ] Is every non-trivial symbol I introduced one I read in-session or confirmed against the dependency manifest?
- [ ] For every rename, move, or signature change, did I sweep the whole project and account for every old reference?
- [ ] Does every PASS/FAIL line in the report cite the exact command and a one-line evidence trace?
- [ ] Can every changed hunk be tied to a specific delegation requirement or a defect my edit introduced?
- [ ] Did I read the full diff end-to-end after the last edit, with no leftover scaffolding, debug output, or half-applied refactors?
