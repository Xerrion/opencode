---
name: servicenow-mcp-reference
description: ServiceNow MCP tool catalog, safety workflows, and artifact deployment reference. Load when using the servicenow MCP server from the servicenow or servicenow-dev agents. Covers supported artifact types, artifact_create/artifact_update rules, pre-development checks, write safety, query safety, and implementation lookup guidance.
---

# ServiceNow MCP Tool Reference

Canonical catalog of `servicenow` MCP tools and artifact deployment rules. Use this as the single source of truth for the `servicenow` and `servicenow-dev` agents.

The MCP implementation lives at `/Users/lasn/Projects/servicenow-platform-mcp`. When tool behavior is unclear, inspect that implementation before guessing. Prefer the implementation over memory, stale prompt text, or assumptions.

## Source of Truth and Safety Model

Use this priority order when deciding how to call the MCP:

1. The live tool schema exposed in the current session.
2. The implementation at `/Users/lasn/Projects/servicenow-platform-mcp`.
3. This skill.
4. Agent prompt summaries.

Never invent tool names, parameters, artifact types, table names, or field names. If the current tool surface differs from this skill, follow the live tool schema and treat this file as guidance only.

## Supported Artifact Types (17)

`artifact_create` and `artifact_update` support the following 17 artifact types, each mapped to its underlying ServiceNow table automatically (e.g., `business_rule` -> `sys_script`, `script_include` -> `sys_script_include`):

`business_rule`, `script_include`, `client_script`, `ui_policy`, `ui_action`, `fix_script`, `scheduled_job`, `scripted_rest_resource`, `ui_script`, `processor`, `widget`, `ui_page`, `ui_macro`, `script_action`, `mid_script_include`, `scripted_rest_api`, `notification_script`

## Artifact Write Tools

### `artifact_create`

Creates a new platform artifact. Accepts:

- `artifact_type` -- one of the 17 supported types
- `data` -- JSON string of field values (all values must be strings: `"true"` not `true`, `"1"` not `1`)
- `script_path` (optional) -- absolute path to a local file containing the script body; must be UTF-8, under `SCRIPT_ALLOWED_ROOT` if configured, max 1MB

Automatically maps the script field for the artifact type (e.g., `operation_script` for Scripted REST Resources, `client_script` for widgets). Returns the `sys_id` of the created record.

### `artifact_update`

Updates an existing artifact by `sys_id`. Accepts:

- `artifact_type` -- one of the 17 supported types
- `sys_id` -- target record
- `changes` -- JSON string of fields to update
- `script_path` (optional) -- same semantics as `artifact_create`

### Hard Rule

**Do NOT use `record_create`, `record_update`, `record_preview_create`, or `record_preview_update` on script artifact tables.** Always use `artifact_create` / `artifact_update` for any of the 17 types listed above. The artifact tools validate types, handle script field mapping, and enforce path security; the record tools do none of this.

`record_create` / `record_update` remain appropriate for data records (incidents, changes, CMDB CIs, custom tables) that are NOT script artifacts.

### JSON Escaping Rules

- All field values must be strings
- Always include the full script body, never truncate
- Escape newlines as `\\n` and single quotes inside scripts as `\\'` when embedding in the JSON `data` string
- **No em-dashes** in scripts - ServiceNow may corrupt them
- **Use `script_path`** when the script is available as a local file -- avoids JSON escaping issues and keeps scripts readable

## Pre-Development Checklist

Before creating or modifying any artifact on a table, run these tools to build context and avoid conflicts:

1. **`docs_logic_map(table="<target_table>")`** -- List ALL existing automations on the table (Business Rules, Client Scripts, UI Policies, etc. grouped by lifecycle phase). Prevents creating conflicting or redundant logic.
2. **`meta_business_rules_for_table(table="<target>", field="<field>")`** -- If the request targets a specific field, find what already writes to it. Skip when no specific field is in scope.
3. **`meta_find_references(target="<name>")`** -- If refactoring an existing Script Include or table, find what references it before changing behavior.
4. **`table_describe(table="<target>")`** / **`meta_list_artifacts(artifact_type="<type>")`** -- Understand the schema (field names, types, references, choices) or discover existing artifacts of a type. Use `meta_get_artifact` to fetch a specific artifact's full script body.

Run applicable read-only tools in parallel. Do not parallelize writes. Skip steps that don't apply.

## Safe Operating Workflows

### Query Safety

Always use `build_query` before `table_query` or `table_aggregate`. Pass the returned `query_token`; do not hand-write encoded query strings unless the live tool schema explicitly requires them.

For large or noisy tables such as `syslog`, `sys_audit`, email logs, import sets, and transaction tables, always include a time-bound condition first. If a query is blocked by large table protection, narrow the time range and retry once.

Default to small result sets. Ask before pulling broad lists when the user's goal can be answered with an aggregate, a targeted lookup, or a narrower query.

### Data Record Write Safety

For data records, preview before apply:

1. Use `record_preview_create`, `record_preview_update`, or `record_preview_delete`.
2. Show the user the important changes and risks.
3. Use `record_apply` only after explicit confirmation.

Data records include incidents, changes, problems, requests, knowledge articles, CMDB CIs, and custom table records that are not script artifacts.

Do not skip preview unless the user explicitly asks for a direct write and the operation is non-destructive.

### Script Artifact Write Safety

For script artifacts, never use the record preview or record CRUD tools. Use `artifact_create` and `artifact_update` only.

Before modifying an existing artifact:

1. Fetch the current artifact with `meta_get_artifact`.
2. Check references with `docs_artifact_summary` or `meta_find_references` when behavior changes could affect callers.
3. Deploy with `artifact_update`.
4. Run `docs_review_notes`.
5. Run `docs_test_scenarios`.
6. Report the `sys_id`, what changed, review findings, and suggested tests.

### Destructive and Risky Operations

Require explicit user confirmation naming the target before:

- Deleting records
- Running fix scripts
- Deactivating or reactivating automations
- Changing system properties
- Updating production data
- Updating ACLs, roles, groups, or access-related records
- Making broad updates that affect more than one record
- Changing integration endpoints, credentials, MID server behavior, or scheduled jobs

When in doubt, stop and ask for confirmation. Explain the likely blast radius in one or two sentences.

### Production Guardrails

Respect MCP write gating. If production writes are blocked, do not work around the guardrail. Provide the prepared change, validation steps, and ask the user to run it through the approved release path.

Never log, print, or copy masked secrets. Treat values returned as `***MASKED***` as intentionally unavailable.

## MCP Tool Catalog

### Introspection

- **`table_describe`** -- Field metadata for a table: types, references, choices, attributes. Run before writing any script that targets a table.
- **`table_query`** -- Query any table using an encoded query. Always call `build_query` first to produce the `query_token`.
- **`table_get`** -- Fetch a single record by sys_id from any table.
- **`table_aggregate`** -- Count, avg, min, max, sum with optional `group_by`. Requires `query_token` from `build_query`.

### Metadata (Platform Artifacts)

- **`meta_list_artifacts`** -- List artifacts by type: `business_rule`, `script_include`, `ui_policy`, `ui_action`, `client_script`, `scheduled_job`, `fix_script`, etc. Use to discover existing artifacts and avoid duplication.
- **`meta_get_artifact`** -- Fetch full artifact details including the script body. Use before modifying any existing artifact.

### Change Intelligence

- **`meta_business_rules_for_table`** -- Find Business Rules and other automations that write to a specific table/field. Essential before adding new logic that touches a field.
- **`meta_find_references`** -- Search all scripts on the instance for a target string (script include name, table name, property key). Use before refactoring or renaming.

### Documentation

- **`docs_logic_map`** -- Lifecycle map of ALL automations on a table (before/after insert/update, display, async). Grouped by lifecycle phase. Run before adding any new automation to a table.
- **`docs_artifact_summary`** -- Summary of an artifact with dependency analysis (what it touches, what touches it). Use before modifying an artifact to understand blast radius.
- **`docs_review_notes`** -- Anti-pattern scan for a specific artifact: GlideRecord in loops, hardcoded sys_ids, unbounded queries, and similar smells. Run after writing or modifying a script.
- **`docs_test_scenarios`** -- Suggested test scenarios derived from script analysis. Run after writing a script to present test coverage to the user.

### Query

- **`build_query`** -- Convert a JSON array of conditions into an encoded `query_token`. MUST be called before `table_query` or `table_aggregate`. Never pass raw encoded query strings directly.

  Each condition object has `operator`, `field`, and `value`. Operators include `equals`, `not_equals`, `contains`, `starts_with`, `greater_than`, `less_than`, `days_ago`, `is_empty`, `between`, `in_list`, `order_by`.

### Domain Tools

Use domain tools for common ITSM and CMDB reads because they are simpler and purpose-built. For domain writes, still follow the data record write safety rules unless the user explicitly requested a direct non-destructive write.

#### Incidents

- **`incident_list`** -- List incidents with filters such as state, priority, assignee, or assignment group.
- **`incident_get`** -- Fetch an incident by number, for example `INC0010042`.
- **`incident_create`** -- Create an incident. Requires a short description.
- **`incident_update`** -- Update an incident by number.
- **`incident_resolve`** -- Resolve an incident with close code and close notes.
- **`incident_add_comment`** -- Add a comment or work note to an incident.

#### Changes

- **`change_list`** -- List change requests with filters such as state, type, or risk.
- **`change_get`** -- Fetch a change request by number.
- **`change_create`** -- Create a change request.
- **`change_update`** -- Update a change request by number.
- **`change_tasks`** -- List tasks for a change request.
- **`change_add_comment`** -- Add a comment or work note to a change request.

#### Problems

- **`problem_list`** -- List problem records with filters.
- **`problem_get`** -- Fetch a problem by number.
- **`problem_create`** -- Create a problem record.
- **`problem_update`** -- Update a problem by number.
- **`problem_root_cause`** -- Document root cause analysis on a problem.

#### Requests

- **`request_list`** -- List request records with filters.
- **`request_get`** -- Fetch a request by number.
- **`request_items`** -- List RITMs for a request.
- **`request_item_get`** -- Fetch a RITM by number.
- **`request_item_update`** -- Update a RITM.

#### Knowledge

- **`knowledge_search`** -- Search knowledge articles by text.
- **`knowledge_get`** -- Fetch a knowledge article by number or sys_id.
- **`knowledge_create`** -- Create a knowledge article.
- **`knowledge_update`** -- Update a knowledge article.
- **`knowledge_feedback`** -- Submit rating or feedback on an article.

#### CMDB

- **`cmdb_list`** -- List CIs with optional class and operational status filters.
- **`cmdb_get`** -- Fetch a CI by name or sys_id.
- **`cmdb_relationships`** -- Get parent and child relationships for a CI.
- **`cmdb_classes`** -- List known CI classes.
- **`cmdb_health`** -- Aggregate CMDB operational health.

### Record CRUD

Use record tools for data records only. Do not use them for script artifact tables.

- **`record_preview_create`** -- Preview a data record creation and return a preview token.
- **`record_preview_update`** -- Preview a data record update and return a preview token plus diff.
- **`record_preview_delete`** -- Preview a data record delete and return a preview token.
- **`record_apply`** -- Apply a previously previewed record operation after explicit user confirmation.
- **`record_create`** -- Directly create a data record. Use only when preview is not required or the user explicitly asked for a direct non-destructive write.
- **`record_update`** -- Directly update a data record. Use only when preview is not required or the user explicitly asked for a direct non-destructive write.
- **`record_delete`** -- Directly delete a data record. Requires explicit confirmation naming the table and record.

### Artifact Write

- **`artifact_create`** -- Create a new platform artifact (any of the 17 types). See "Artifact Write Tools" above for full semantics. Preferred over `record_create` for script artifacts.
- **`artifact_update`** -- Update an existing platform artifact by sys_id. See "Artifact Write Tools" above. Preferred over `record_update` for script artifacts.

### Relationships

- **`rel_references_to`** -- Find records that reference a target record.
- **`rel_references_from`** -- Find records referenced by a source record.

### Change Intelligence

- **`changes_updateset_inspect`** -- Inspect update set members grouped by type, with risk flags where available.
- **`changes_diff_artifact`** -- Produce a unified diff between recent versions of an artifact.
- **`changes_last_touched`** -- Show who last changed a record and what changed.
- **`changes_release_notes`** -- Generate release notes from an update set.

### Debug and Trace

- **`debug_trace`** -- Build a merged timeline from audit, journal, and log data for a record.
- **`debug_flow_execution`** -- Inspect Flow Designer execution details.
- **`debug_email_trace`** -- Reconstruct email activity for a record.
- **`debug_integration_health`** -- Inspect recent integration errors from queues or REST messages.
- **`debug_importset_run`** -- Inspect import set header, row results, and errors.
- **`debug_field_mutation_story`** -- Show chronological mutation history for a single field.

### Developer and Admin Utilities

These tools change runtime behavior. Treat them as write tools and require explicit confirmation when the target is security-sensitive, production-impacting, or automation-related.

- **`dev_toggle`** -- Toggle active state on supported platform artifacts.
- **`dev_set_property`** -- Set a system property and return the previous value.

### Investigations

Investigations are read-oriented analysis tools. Run the investigation first, then explain individual findings when needed.

- **`investigate_run`** -- Run an investigation such as `stale_automations`, `deprecated_apis`, `table_health`, `acl_conflicts`, `error_analysis`, `slow_transactions`, or `performance_bottlenecks`.
- **`investigate_explain`** -- Explain a specific finding from an investigation result.

### Utility

- **`list_tool_packages`** -- List available ServiceNow MCP tool packages.

## Implementation Reference

The local MCP source is available at `/Users/lasn/Projects/servicenow-platform-mcp`.

Use it to verify:

- Exact tool names and parameters
- Supported artifact type mappings
- Script field mapping by artifact type
- Deny-listed tables and protected fields
- Row limits and large table protections
- Production write gates
- Preview token and apply behavior
- Path restrictions for `script_path`
- Validation behavior for `artifact_create` and `artifact_update`

When hardening agents, keep operational behavior in the agent files and detailed MCP mechanics in this skill. This avoids drift between `servicenow`, `servicenow-dev`, and the shared reference.

## Verification Checklist for MCP Work

Before reporting ServiceNow MCP work as complete:

1. Required read-only context was gathered before writes.
2. Queries used `build_query` and bounded large tables by time.
3. Data record writes used preview and explicit apply confirmation.
4. Script artifact writes used `artifact_create` or `artifact_update`, not record CRUD.
5. Existing artifacts were fetched before modification.
6. Risky operations had explicit confirmation naming the target.
7. Created or updated records were fetched or reviewed after write when the MCP supports it.
8. Script artifacts were checked with `docs_review_notes` and `docs_test_scenarios`.
9. The resulting `sys_id`, record number, or URL was reported to the user.
10. Warnings, row limits, masked fields, and partial failures were surfaced.

Base directory for this skill: file:///Users/lasn/.config/opencode/skills/servicenow-mcp-reference
