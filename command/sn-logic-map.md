---
description: Generate lifecycle logic map showing all automations on a ServiceNow table
agent: servicenow
---

# Logic Map: $ARGUMENTS

Generate a complete lifecycle logic map for the **$1** table.

## Instructions

### Step 1: Generate the Logic Map

Run `docs_logic_map(table="$1")` to get all automations grouped by lifecycle phase.

### Step 2: Enrich with Context

Run these in parallel for additional insight:

1. **`table_describe(table="$1")`** — Get the full field schema (types, references, choices)
2. **`meta_what_writes(table="$1")`** — Find what Business Rules write to this table

### Step 3: Present the Map

Organize the output by lifecycle phase:

1. **Before Insert** — BRs that fire before new record creation
2. **Before Update** — BRs that fire before record modification
3. **After Insert** — BRs that fire after record creation (cross-record effects)
4. **After Update** — BRs that fire after modification (cross-record effects)
5. **Async** — Background processing (notifications, integrations)
6. **Display** — Display BRs that populate g_scratchpad
7. **Client Scripts** — onChange, onLoad, onSubmit
8. **UI Policies** — Field attribute rules (mandatory, read-only, visible)
9. **UI Actions** — Buttons, links, context menus

For each automation, show: **Name**, **Active** status, **Order**, **Condition** (if any), and a brief description of what it does.

### Step 4: Flag Potential Issues

Highlight:
- Multiple automations writing to the same field (conflict risk)
- BRs with no conditions (fire on every operation)
- Inactive automations that might be accidentally disabled
- BRs with very high or very low order that could cause sequencing issues
