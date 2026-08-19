---
name: code-review
description: Comprehensive code review methodology with severity classification and confidence thresholds
---

# Code Review Philosophy

## TL;DR

Systematic code review across 4 layers with severity classification. Severities and confidence floors follow the repo-wide tiers: BLOCKER (≥90% confidence), IMPORTANT (≥70%), NIT (no minimum) - below a tier's floor, drop one tier. Include file:line references for all issues.

## The 4 Review Layers

### Layer 1: Correctness

- Logic errors and edge cases
- Error handling completeness
- Type safety and null checks
- Algorithm correctness
- Off-by-one errors

### Layer 2: Security

- No hardcoded secrets or API keys
- Input validation and sanitization
- Injection vulnerability prevention (SQL, XSS, command)
- Authentication and authorization checks
- Sensitive data not logged
- OWASP Top 10 awareness

### Layer 3: Performance

- No N+1 query patterns
- Appropriate caching strategies
- No unnecessary re-renders or redraws (frontend/UI code)
- Lazy loading where appropriate
- Memory leak prevention
- Algorithmic complexity concerns

### Layer 4: Style & Maintainability

- Adherence to project conventions (check AGENTS.md)
- Code duplication (DRY violations)
- Complexity management (cyclomatic complexity)
- Documentation completeness
- Test coverage gaps

## Severity Classification

One severity system exists repo-wide; it is defined by `review-philosophy` and mirrored here. Closed criteria - a finding qualifies for a tier only by matching its list.

| Severity  | Criteria                                                                                                                                                                        | Action Required        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| BLOCKER   | Correctness defect; security vulnerability; data loss or corruption; broken public contract; regression in tested behavior                                                      | Must fix before merge  |
| IMPORTANT | Significant performance regression in a hot path; missing error handling on a high-risk path; clear violation of a named philosophy law; documented project convention violated | Should fix             |
| NIT       | Style, naming (unless deceptive), minor doc gaps, "improvable but correct" code, cosmetic concerns                                                                              | Optional; never blocks |

## Confidence Floors

Tier-specific floors (same as `review-philosophy` Law 2: Lower Tier When Uncertain):

- BLOCKER requires ≥90% confidence.
- IMPORTANT requires ≥70% confidence.
- NIT has no minimum.

If uncertain about an issue:

- Below a tier's floor, report it one tier down - doubt deflates, confidence inflates.
- State the uncertainty explicitly: "Potential issue (70% confidence): ..."
- Suggest investigation rather than assert a problem
- Prefer false negatives over false positives (reduce noise)

## Review Process

1. **Initial Scan** - Identify all files in scope, understand the change
2. **Deep Analysis** - Apply all 4 layers systematically to each file
3. **Context Evaluation** - Consider surrounding code, project patterns, existing conventions
4. **Philosophy Check** - Verify against code-philosophy (5 Laws) if applicable
5. **Synthesize Findings** - Group by severity, deduplicate, prioritize

## Output Format

Structure your review as:

1. **Files Reviewed** - List all files analyzed
2. **Overall Assessment** - APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION
3. **Summary** - 2-3 sentence overview
4. **BLOCKER Issues** - With file:line references
5. **IMPORTANT Issues** - With file:line references
6. **NIT Issues** - With file:line references
7. **Positive Observations** - What's done well (always include at least one)
8. **Philosophy Compliance** - Checklist results if applicable

## What NOT to Do

- Do NOT report low-confidence findings as definite issues
- Do NOT provide vague feedback without file:line references
- Do NOT skip any of the 4 layers
- Do NOT forget to note positive observations
- Do NOT modify any files during review
- Do NOT approve without completing the full review process

## Adherence Checklist

Before completing a review, verify:

- [ ] All 4 layers analyzed (Correctness, Security, Performance, Style)
- [ ] Severity assigned to each finding (BLOCKER/IMPORTANT/NIT)
- [ ] Every finding meets its tier's confidence floor (BLOCKER ≥90%, IMPORTANT ≥70%) or was dropped a tier
- [ ] File names and line numbers included for all findings
- [ ] Positive observations noted
- [ ] Output follows the standard format
