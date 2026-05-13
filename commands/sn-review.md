---
description: Code review pipeline for a ServiceNow platform artifact (Business Rule, Script Include, etc.)
agent: servicenow
---

# Review ServiceNow Artifact: $ARGUMENTS

Run a comprehensive code review on the specified artifact.

## Arguments

- `$1` — Artifact type: `business_rule`, `script_include`, `client_script`, `ui_policy`, `ui_action`, `scheduled_job`, `fix_script`
- `$2` — Artifact name or sys_id

## Instructions

### Step 1: Find the Artifact

If `$2` looks like a sys_id (32-char hex), use it directly.

Otherwise, search for the artifact by name:
- `meta_list_artifacts(artifact_type="$1")` and filter results by name matching `$2`

### Step 2: Fetch and Analyze (in parallel)

Once you have the sys_id, run ALL of these simultaneously:

1. **`meta_get_artifact(artifact_type="$1", sys_id="<id>")`** — Get the full script body and metadata
2. **`docs_review_notes(artifact_type="$1", sys_id="<id>")`** — Scan for anti-patterns (GlideRecord in loops, hardcoded sys_ids, unbounded queries)
3. **`docs_test_scenarios(artifact_type="$1", sys_id="<id>")`** — Generate test scenario suggestions
4. **`docs_artifact_summary(artifact_type="$1", sys_id="<id>")`** — Dependency analysis (what it references, what references it)

### Step 3: Manual Review

Review the script body for:

1. **Correctness** — Does the logic match its description? Are conditions comprehensive?
2. **Style** — Follows naming conventions? Proper error handling with `gs.error()`?
3. **Performance** — GlideRecord usage efficient? Queries bounded? Appropriate use of GlideAggregate?
4. **Safety** — No hardcoded sys_ids? No `eval()`? No `current.update()` in BRs?
5. **Testability** — Logic in Script Includes (not inline)? Clear inputs/outputs?

### Step 4: Present Review

Format as a code review report:

```
## Code Review: <artifact_name>
**Type:** <artifact_type> | **Table:** <table> | **Active:** <yes/no>

### Anti-Pattern Scan Results
<from docs_review_notes>

### Issues Found
1. [SEVERITY] Description — Location in script — Recommendation

### Dependencies
<from docs_artifact_summary>

### Suggested Test Scenarios
<from docs_test_scenarios>

### Recommendations
<prioritized action items>
```

Rate overall quality: **Good** (minor issues only), **Needs Improvement** (significant issues), **Critical** (blocking issues that should be fixed immediately).
