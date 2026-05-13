---
description: Full incident debug pipeline — traces record lifecycle, field mutations, flow executions, and email chains
agent: servicenow
---

# Debug ServiceNow Record

Debug this record: **$ARGUMENTS**

## Instructions

Run a full debug investigation on the specified record. The argument can be:
- An INC/CHG/PRB/REQ/RITM number (e.g., `INC0010042`)
- A `table sys_id` pair (e.g., `incident abc123def456`)

### Step 1: Identify the Record

If given a record number (INC/CHG/PRB/REQ prefix), use the appropriate ITSM get tool (`incident_get`, `change_get`, `problem_get`, `request_get`) to fetch the record and its sys_id.

If given a table + sys_id, use `table_get` directly.

### Step 2: Run Debug Tools (in parallel)

Run ALL of these simultaneously:

1. **`debug_trace`** — Merged timeline from sys_audit, syslog, and journal entries (use `minutes=120` for a wider window)
2. **`debug_field_mutation_story`** — For the field most likely involved in the issue (state, priority, assigned_to, or as specified by the user)
3. **`debug_email_trace`** — Reconstruct the email chain for this record
4. **`changes_last_touched`** — Who last modified this record and what they changed

### Step 3: Check for Flow Executions

If the trace reveals any Flow Designer executions (look for flow context IDs in the timeline), run `debug_flow_execution` on each.

### Step 4: Analyze and Present

Present findings chronologically:

1. **Record Summary** — Current state, key field values, age
2. **Timeline** — Chronological event sequence (field changes, comments, emails, flow executions)
3. **Key Findings** — Anomalies, unexpected state transitions, suspicious gaps
4. **Root Cause Indicators** — If the issue is apparent from the data, state it clearly

If the user mentioned a specific problem, focus the analysis on events related to that problem.
