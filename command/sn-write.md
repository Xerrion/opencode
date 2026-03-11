---
description: Write a ServiceNow script by gathering full context and delegating to the dev agent
agent: servicenow
---

# Write ServiceNow Script: $ARGUMENTS

The user wants to create or modify a ServiceNow script. Follow the Development Handover Protocol.

## Instructions

### Step 1: Parse the Request

From the user's description (`$ARGUMENTS`), identify:
- **What** to write (Business Rule, Script Include, Client Script, etc.)
- **Target table** (incident, change_request, etc.)
- **Target field** (if the script modifies a specific field)
- **Behavior** (what the script should do)

### Step 2: Gather Context (run in parallel)

Run ALL applicable MCP tools simultaneously:

1. **`table_describe(table="<target>")`** — Always. Get the full schema.
2. **`docs_logic_map(table="<target>")`** — Always. See existing automations to avoid conflicts.
3. **`meta_what_writes(table="<target>", field="<field>")`** — If a specific field is targeted. Find what already writes to it.
4. **`meta_list_artifacts(artifact_type="<type>")`** + **`meta_get_artifact`** — If modifying an existing artifact. Get the current script body.

### Step 3: Delegate to servicenow-dev

Use `task(subagent_type="servicenow-dev", ...)` with the full context gathered above.

Include in the delegation prompt:

```
TASK: <What the user asked for>
ACTION: CREATE and DEPLOY this artifact to the instance using sn-scriptsync `create_artifact`. Do NOT just show the code -- actually create it.

TARGET TABLE: <table name>
SCOPE: <application scope -- use "global" unless user specifies a scoped app>
TABLE SCHEMA (relevant fields):
<key fields from table_describe>

EXISTING AUTOMATIONS ON THIS TABLE:
<docs_logic_map results>

FIELD WRITERS (if applicable):
<meta_what_writes results>

CURRENT SCRIPT (if modifying existing):
<full script body from meta_get_artifact>

CONSTRAINTS:
- <any user-specified constraints>
- Must not conflict with: <existing automation names>
```

Load relevant skills for the dev agent:
- Always: `servicenow-scripting`, `servicenow-scriptsync`
- For Business Rules: `servicenow-business-rules`
- For Client Scripts: `servicenow-client-scripts`
- For GlideRecord-heavy work: `servicenow-gliderecord`

### Step 4: Verify and Relay

After the dev agent returns:
1. Review the output for completeness
2. Check if `docs_review_notes` flagged any issues
3. Relay the script to the user with any warnings
