---
name: servicenow-mcp-reference
description: Use when ServiceNow MCP tool selection, payload construction, or error recovery is unclear. Covers the unified record, query, and discovery tools without adding a mandatory deployment checklist.
---

# ServiceNow MCP Reference

Use the live tool schema as the authority for parameters. Consult the implementation at `/Users/lasn/Projects/servicenow-platform-mcp` only if the schema and error response leave a specific question unresolved. Do not inspect source for routine calls.

## Tool selection

| Need | Tool |
| --- | --- |
| Read a known record | `query` with `sys_id` and explicit `fields` |
| Inspect an artifact and its script fields | `record_read` with `sys_id` or `name` |
| Find records or aggregate | `query` with an encoded query and bounded selection |
| Inspect unknown fields, tables, or script fields | `describe` |
| Resolve unknown choice values | `resolve_choice` |
| Create, update, or delete any permitted record, including artifacts | `record_write` |
| Commit a staged write | `record_apply` |
| Search implementation references | `code_search` |
| Inspect a flow definition | `flow` |
| Read request variables or journal history | `analysis` |
| Investigate audit configuration or history | `audit`, only when that evidence is needed |
| Investigate platform health | `investigate`, only for a relevant investigation |
| Read or write attachments | `attachment` or `attachment_write` |
| Catalog browsing and ordering | `service_catalog` |

These tools replace the former artifact, query-builder, metadata, and documentation tool families. Do not search for removed tools or reconstruct their entire workflows with generic queries.

## Record payloads

Pass field values in the JSON string `data`. Script content is an ordinary field value. Use the actual field name, such as `script`, `client_script`, `template`, or `script_true`. Multiple script fields can be changed in one payload.

- Include the complete body of each changed script field. Omit unchanged fields.
- Serialize valid JSON. Do not manually add escapes for single quotes.
- The MCP does not read script files. If drafting locally, send the file contents as field values, not a filesystem path.
- `record_read` returns discovered `script_fields`; reuse this information. Use `describe(action="list_script_fields")` only when the target fields are unknown.
- Follow the agent's deployment authorization, preview, and high-impact confirmation rules. Tool availability is not authorization.

## Sufficient evidence

Reuse context already established in the task. A supplied identity, reviewed predicate, or confirmed schema does not need a fresh discovery sequence merely because the user approved deployment.

Before create, establish that a targeted duplicate lookup is sufficient and current. Before update, obtain the current fields needed to compose the change safely. Resolve material uncertainty before preview, not after deployment.

Preview with `record_write` and apply with its single-use token. Read the exact artifact once after a successful deployment. Verify update-set capture when requested. Review and derive test scenarios from that retrieved content; neither task requires an extra tool by itself.

Do not query audit posture to verify a successful write. Do not add unrelated probes after verification passes. Persisted configuration is not proof that asynchronous behavior or an external integration has executed correctly.

## Failure recovery

- Local input rejection or preview failure: correct the input. No requested record write was committed, so a partial-write search is unnecessary.
- Timeout or ambiguous error during a committing call: inspect the exact target before retrying. A client timeout does not establish that the server rolled back.
- Expired preview token: prepare a fresh preview and reassess changes before applying. Do not reuse consumed tokens.
- Complete exact lookup with no matches: report no visible match in that scope. Search further only if identity, query scope, ACL visibility, or pagination leaves a relevant question unresolved.
- Truncated results or capped limits: surface the limit and continue only when missing rows are needed for the decision.
- Large-table rejection: add a relevant date bound and retry. Do not widen the search automatically.

Keep secrets masked. Preserve table access restrictions, production write gates, explicit destructive and sensitive-change confirmation, and the prohibition on running Fix Scripts or background scripts.
