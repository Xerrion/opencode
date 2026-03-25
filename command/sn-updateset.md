---
description: Inspect a ServiceNow update set and generate release notes
agent: servicenow
---

# Update Set: $ARGUMENTS

Inspect and document the specified update set.

## Arguments

- `$1` — Update set sys_id or name

## Instructions

### Step 1: Find the Update Set

If `$1` looks like a sys_id (32-char hex), use it directly.

Otherwise, search for it by name:
- `build_query(conditions=[{"operator": "contains", "field": "name", "value": "$1"}])` → `table_query(table="sys_update_set", query_token="<token>", fields="sys_id,name,state,description,installed_from")`

### Step 2: Inspect and Generate Notes (in parallel)

Run both simultaneously:

1. **`changes_updateset_inspect(update_set_id="<id>")`** — List members grouped by type, flag risks, show summary
2. **`changes_release_notes(update_set_id="<id>")`** — Generate Markdown release notes

### Step 3: Deep Dive on Risky Changes

For any members flagged as risky by the inspection:
- Run `docs_review_notes` on script artifacts to check for anti-patterns
- Run `changes_diff_artifact` to see what changed in the latest version

### Step 4: Present Report

Format as a combined inspection + release notes document:

```
## Update Set: <name>
**State:** <state> | **Members:** <count> | **Risk Level:** <low/medium/high>

### Member Summary
| Type | Count | Risky |
|------|-------|-------|
| ...  | ...   | ...   |

### Risk Flags
<detailed risk findings with remediation>

### Release Notes
<from changes_release_notes>

### Recommendations
- Pre-deployment: <checks to run>
- Post-deployment: <validation steps>
```
