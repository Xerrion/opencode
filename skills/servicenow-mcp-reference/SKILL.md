---
name: servicenow-mcp-reference
description: ServiceNow MCP tool catalog and artifact deployment reference. Load when using the servicenow MCP server from the servicenow or servicenow-dev agents. Covers the 17 supported artifact types, artifact_create/artifact_update rules, pre-development checklist, and full tool catalog.
---

# ServiceNow MCP Tool Reference

Canonical catalog of `servicenow` MCP tools and artifact deployment rules. Use this as the single source of truth for the `servicenow` and `servicenow-dev` agents.

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
- **No em-dashes** (—) in scripts -- ServiceNow may corrupt them
- **Use `script_path`** when the script is available as a local file -- avoids JSON escaping issues and keeps scripts readable

## Pre-Development Checklist

Before creating or modifying any artifact on a table, run these tools to build context and avoid conflicts:

1. **`docs_logic_map(table="<target_table>")`** -- List ALL existing automations on the table (Business Rules, Client Scripts, UI Policies, etc. grouped by lifecycle phase). Prevents creating conflicting or redundant logic.
2. **`meta_what_writes(table="<target>", field="<field>")`** -- If the request targets a specific field, find what already writes to it. Skip when no specific field is in scope.
3. **`meta_find_references(target="<name>")`** -- If refactoring an existing Script Include or table, find what references it before changing behavior.
4. **`table_describe(table="<target>")`** / **`meta_list_artifacts(artifact_type="<type>")`** -- Understand the schema (field names, types, references, choices) or discover existing artifacts of a type. Use `meta_get_artifact` to fetch a specific artifact's full script body.

Run applicable tools in parallel. Skip steps that don't apply.

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

- **`meta_what_writes`** -- Find Business Rules and other automations that write to a specific table/field. Essential before adding new logic that touches a field.
- **`meta_find_references`** -- Search all scripts on the instance for a target string (script include name, table name, property key). Use before refactoring or renaming.

### Documentation

- **`docs_logic_map`** -- Lifecycle map of ALL automations on a table (before/after insert/update, display, async). Grouped by lifecycle phase. Run before adding any new automation to a table.
- **`docs_artifact_summary`** -- Summary of an artifact with dependency analysis (what it touches, what touches it). Use before modifying an artifact to understand blast radius.
- **`docs_review_notes`** -- Anti-pattern scan for a specific artifact: GlideRecord in loops, hardcoded sys_ids, unbounded queries, and similar smells. Run after writing or modifying a script.
- **`docs_test_scenarios`** -- Suggested test scenarios derived from script analysis. Run after writing a script to present test coverage to the user.

### Query

- **`build_query`** -- Convert a JSON array of conditions into an encoded `query_token`. MUST be called before `table_query` or `table_aggregate`. Never pass raw encoded query strings directly.

  Each condition object has `operator`, `field`, and `value`. Operators include `equals`, `not_equals`, `contains`, `starts_with`, `greater_than`, `less_than`, `days_ago`, `is_empty`, `between`, `in_list`, `order_by`.

### Write

- **`artifact_create`** -- Create a new platform artifact (any of the 17 types). See "Artifact Write Tools" above for full semantics. Preferred over `record_create` for script artifacts.
- **`artifact_update`** -- Update an existing platform artifact by sys_id. See "Artifact Write Tools" above. Preferred over `record_update` for script artifacts.

Base directory for this skill: file:///Users/lasn/.config/opencode/skills/servicenow-mcp-reference
