---
name: jira-agile-reference
description: Jira MCP tool catalog and agile authoring reference for the TV2 tenant style. Load when using the atlassian MCP server to create, refine, or manage Jira work items. Covers the atlassian_jira_* tool catalog (issues, fields, comments, transitions, agile, links, worklog, attachments, users, watchers, metrics, development), project scheme pre-flight, INVEST checklist, flat declarative acceptance criteria, Danish/English Epic templates, story-splitting patterns, no personas, no Gherkin.
---

# Jira Agile Reference

Tool catalog and agile authoring guide for the `atlassian` MCP server's Jira tools. TV2 Jira tenant style: Danish-first body when the user writes Danish, plain-text section labels, flat declarative acceptance criteria, no persona narratives, no Gherkin, no markdown headings in issue bodies.

## Issue Hierarchy

Canonical structure (top to bottom):

- **Objective** -- top-level OKR container. Summary convention: `C<N>-<YEAR>: ...` (for example `C1-2026: ...`, `C3-2025: ...`). Holds Initiatives and/or Epics.
- **Initiative** -- groups Epics into a larger delivery theme. Optional layer.
- **Epic** -- contains Stories / Tasks / Spikes / Bugs.
- **Story / Task / Spike / Bug** -- contains Sub-tasks.
- **Sub-task** -- always has a parent; never freestanding.

Rules:

- Stories do not parent Stories. Only Epics parent stories (via Epic Link).
- A sub-task inherits its parent's Epic Link - do not set it directly on the sub-task.
- An Epic may roll up to an Initiative or directly to an Objective. Ask the user which when authoring a new Epic, but do not block if they say no.
- Bugs follow the same authoring rules as Stories (summary, AC) unless the project treats them as lightweight.

## Pre-Development Checklist

Before creating or modifying any Jira item, run these tools to build context:

1. `atlassian_jira_get_all_projects()` -- confirm the target project key exists and you can reach it.
2. `atlassian_jira_search_fields(keyword="epic link")` -- and similar for "sprint". Custom field IDs (like `customfield_10016`) vary per instance and must be resolved before writes. Acceptance criteria is not a custom field on this team - it lives in the issue description body, so do not resolve a field ID for it.
3. `atlassian_jira_search(jql="project=<KEY> AND created > -30d ORDER BY created DESC", limit=5)` -- sample recent issues to learn summary style and component usage.
4. `atlassian_jira_get_transitions(issue_key)` -- before any `atlassian_jira_transition_issue` call. Transition IDs are workflow-specific.
5. Detect OKR framing. If the parent issue's summary starts with `C<N>-<YEAR>` (Objective pattern), or the user's intent mentions Key Result / KR / OKR / objective, switch the authoring to English section headers even when the rest of the body is Danish. Non-OKR delivery work uses Danish headers when the user writes Danish.

Run applicable tools in parallel. Skip steps where the user supplied the info.

If a write later fails with "field not found" or "invalid field", re-run `atlassian_jira_search_fields(..., refresh=true)` before retrying. Cached field IDs can go stale if an admin renames or deletes a field mid-session.

## Write Rules

- `fields` and `additional_fields` on `atlassian_jira_create_issue` / `atlassian_jira_update_issue` must be **JSON strings**, not objects. Escape accordingly.
- Custom fields are referenced by ID (`customfield_10001`), never by display name.
- Descriptions, comments, and AC bodies accept Markdown, but this tenant's house style is plain text with label lines. Do NOT emit markdown headings (`#`, `##`) or bold (`**...**`) in issue bodies - use plain-text label lines like `Formål / baggrund` or `Acceptance Criteria`. Do NOT emit `[text](url)` markdown links in issue bodies - use bare URLs. Jira ADF renders bare URLs as smart inline cards.
- `atlassian_jira_batch_create_issues` is atomic per issue, not per batch. On any batch larger than 3 issues, run with `validate_only=true` first as a dry run. On partial failure, collect the successful keys, report them to the user, and retry only the failed entries - never re-submit the whole batch.
- Sub-tasks set their parent via the `parent` key inside `additional_fields`, not via `atlassian_jira_link_to_epic`.
- To link a Story to an Epic, prefer `atlassian_jira_link_to_epic` after creation - it handles both company-managed (Epic Link custom field) and team-managed (`parent`) projects. If you set it inline via `additional_fields` instead, detect the project style first: team-managed (next-gen) Cloud projects use `parent`, company-managed projects use the Epic Link custom field (resolve the ID via `atlassian_jira_search_fields(keyword="epic link")`). Setting the wrong one silently no-ops.
- `atlassian_jira_transition_issue` requires a `transition_id` from `atlassian_jira_get_transitions` - never hardcode IDs across projects.
- If a create call errors or times out, do not retry blindly. First run `atlassian_jira_search(jql='project=<KEY> AND summary ~ "<exact summary>" AND created > -5m', limit=5)` to check whether the write actually landed. Only retry if the search returns zero hits.
- Never guess an `accountId`, email, or username for assignee, reporter, or watcher fields. Resolve the identity first via `atlassian_jira_get_user_profile`. If the lookup returns zero or more than one match, ask the user to disambiguate before writing.
- On a 409 or version-conflict response from `atlassian_jira_update_issue` or `atlassian_jira_transition_issue`, re-fetch with `atlassian_jira_get_issue` and present the current state to the user before retrying. Never blind-retry an update.
- Reads (`atlassian_jira_get_*`, `atlassian_jira_search`) may run in parallel. Writes (tools tagged `[W]`) must be sequenced - do not parallelize creates, updates, transitions, or link operations, even across different issues.
- Default `limit=50` on `atlassian_jira_search` unless the user asks for more. Always add a time or status filter on large projects (`created > -90d`, `statusCategory != Done`). Never call `atlassian_jira_get_project_issues` without a `limit` on a project you have not sized.
- Preserve non-breaking hyphen U+2011 if the user writes one (for example `Entra ID‑grupper`, `On‑Premise`). Do not auto-insert it when the user used a regular hyphen.

## MCP Tool Catalog

### Issues

- **`atlassian_jira_get_issue`** -- Fetch one issue with fields, expand, comments. Required: `issue_key`. Optional: `fields`, `expand`, `comment_limit`, `properties`.
- **`atlassian_jira_search`** -- JQL search. Required: `jql`. Optional: `fields`, `limit`, `start_at`, `projects_filter`, `expand`, `page_token` (Cloud).
- **`atlassian_jira_get_project_issues`** -- All issues in a project. Required: `project_key`. Optional: `limit`, `start_at`.
- **`atlassian_jira_create_issue`** [W] -- Create one issue. Required: `project_key`, `summary`, `issue_type`. Optional: `assignee`, `description`, `components`, `additional_fields` (JSON string: priority, labels, parent, epic_link, fixVersions, `customfield_*`).
- **`atlassian_jira_update_issue`** [W] -- Update fields. Required: `issue_key`, `fields` (JSON string). Optional: `additional_fields`, `components`, `attachments`.
- **`atlassian_jira_delete_issue`** [W] -- Permanent delete. Required: `issue_key`. Use rarely.
- **`atlassian_jira_batch_create_issues`** [W] -- Bulk create. Required: `issues` (JSON array). Optional: `validate_only`.
- **`atlassian_jira_batch_get_changelogs`** -- Changelogs for many issues. Cloud only. Required: `issue_ids_or_keys`. Optional: `fields`, `limit`.

### Fields

- **`atlassian_jira_search_fields`** -- Fuzzy field search to resolve custom field IDs. Optional: `keyword`, `limit`, `refresh`.
- **`atlassian_jira_get_field_options`** -- Allowed options for a custom field. Required: `field_id`. Optional: `context_id` (Cloud), `project_key` + `issue_type` (Server/DC), `contains`, `return_limit`, `values_only`.

### Comments

- **`atlassian_jira_add_comment`** [W] -- Markdown comment. Required: `issue_key`, `body`. Optional: `visibility` (JSON string).
- **`atlassian_jira_edit_comment`** [W] -- Edit existing. Required: `issue_key`, `comment_id`, `body`. Optional: `visibility`.

The `visibility` parameter on comments is an opt-in restriction to a role or group. Do not set it unless the user explicitly asks for a restricted comment. On a Service Desk / JSM issue, the default comment is customer-visible - confirm with the user whether a comment should be internal before writing.

### Transitions

- **`atlassian_jira_get_transitions`** -- List available transitions for the issue's current status. Required: `issue_key`. Always run before a status change.
- **`atlassian_jira_transition_issue`** [W] -- Change status. Required: `issue_key`, `transition_id`. Optional: `fields` (JSON for resolution etc.), `comment`.

### Projects

- **`atlassian_jira_get_all_projects`** -- List projects. Optional: `include_archived`.
- **`atlassian_jira_get_project_versions`** -- Fix versions. Required: `project_key`.
- **`atlassian_jira_get_project_components`** -- Components. Required: `project_key`.
- **`atlassian_jira_create_version`** [W] -- New fix version. Required: `project_key`, `name`. Optional: `start_date`, `release_date`, `description`.
- **`atlassian_jira_batch_create_versions`** [W] -- Bulk versions. Required: `project_key`, `versions` (JSON array).

### Agile (Boards and Sprints)

- **`atlassian_jira_get_agile_boards`** -- Find boards by name/project/type. Optional: `board_name`, `project_key`, `board_type` (scrum/kanban), `start_at`, `limit`.
- **`atlassian_jira_get_board_issues`** -- Board issues by JQL. Required: `board_id`, `jql`. Optional: `fields`, `start_at`, `limit`, `expand`.
- **`atlassian_jira_get_sprints_from_board`** -- Sprints by state. Required: `board_id`. Optional: `state` (active/future/closed), `start_at`, `limit`.
- **`atlassian_jira_get_sprint_issues`** -- Sprint contents. Required: `sprint_id`. Optional: `fields`, `start_at`, `limit`.
- **`atlassian_jira_create_sprint`** [W] -- New sprint. Required: `board_id`, `name`, `start_date`, `end_date`. Optional: `goal`.
- **`atlassian_jira_update_sprint`** [W] -- Edit. Required: `sprint_id`. Optional: `name`, `state`, `start_date`, `end_date`, `goal`.
- **`atlassian_jira_add_issues_to_sprint`** [W] -- Move issues in. Required: `sprint_id`, `issue_keys` (CSV).

### Links

- **`atlassian_jira_get_link_types`** -- List link types. Optional: `name_filter`.
- **`atlassian_jira_create_issue_link`** [W] -- Link two issues (blocks, duplicates, relates). Required: `link_type`, `inward_issue_key`, `outward_issue_key`. Optional: `comment`, `comment_visibility`.
- **`atlassian_jira_remove_issue_link`** [W] -- Required: `link_id`.
- **`atlassian_jira_link_to_epic`** [W] -- Set Epic Link. Required: `issue_key`, `epic_key`.
- **`atlassian_jira_create_remote_issue_link`** [W] -- Web/Confluence link. Required: `issue_key`, `url`, `title`. Optional: `summary`, `relationship`, `icon_url`.

### Worklog

- **`atlassian_jira_get_worklog`** -- List worklogs. Required: `issue_key`.
- **`atlassian_jira_add_worklog`** [W] -- Log time. Required: `issue_key`, `time_spent` (e.g. "1h 30m"). Optional: `comment`, `started` (ISO), `original_estimate`, `remaining_estimate`.

### Attachments

- **`atlassian_jira_download_attachments`** -- All attachments (base64, <50MB each). Required: `issue_key`.
- **`atlassian_jira_get_issue_images`** -- Images as inline content for vision. Required: `issue_key`.

### Users and Watchers

- **`atlassian_jira_get_user_profile`** -- Profile lookup. Required: `user_identifier` (email / username / `accountid:...` / Server key).
- **`atlassian_jira_get_issue_watchers`** -- List watchers. Required: `issue_key`.
- **`atlassian_jira_add_watcher`** [W] -- Required: `issue_key`, user identifier.
- **`atlassian_jira_remove_watcher`** [W] -- Required: `issue_key`, user identifier.

### Metrics

- **`atlassian_jira_get_issue_dates`** -- Key dates + transition history. Required: `issue_key`. Optional: `include_status_changes`, `include_status_summary`.
- **`atlassian_jira_get_issue_sla`** -- SLA metrics. Required: `issue_key`. Optional: `metrics` (CSV of cycle_time, lead_time, time_in_status, due_date_compliance, resolution_time, first_response_time), `working_hours_only`, `include_raw_dates`.

### Development

- **`atlassian_jira_get_issue_development_info`** -- PRs/commits/branches. Required: `issue_key`. Optional: `application_type`, `data_type`.
- **`atlassian_jira_get_issues_development_info`** -- Bulk. Required: `issue_keys` (CSV).

### Service Desk

- **`atlassian_jira_get_service_desk_for_project`** -- Required: `project_key`.
- **`atlassian_jira_get_service_desk_queues`** -- Required: `service_desk_id`. Optional: `start_at`, `limit`.
- **`atlassian_jira_get_queue_issues`** -- Required: `service_desk_id`, `queue_id`. Optional: `start_at`, `limit`.

### Forms (Cloud)

- **`atlassian_jira_get_issue_proforma_forms`** -- List forms. Required: `issue_key`.
- **`atlassian_jira_get_proforma_form_details`** -- Schema + answers. Required: `issue_key`, `form_id`.
- **`atlassian_jira_update_proforma_form_answers`** [W] -- Required: `issue_key`, `form_id`, `answers` (array of `{questionId, type, value}`).

## INVEST Checklist

- **I**ndependent - can ship without waiting on another story
- **N**egotiable - the "how" is open; the "what" is anchored by AC
- **V**aluable - delivers observable value to the end user or business
- **S**mall - fits comfortably in a sprint
- **T**estable - AC is flat declarative lines describing specific observable outcomes, each verifiable the moment this issue is done

Note: the E (Estimable) rung is not scored for this team - sizing in points is not used.

## Templates

Three templates. Pick one:

- Delivery Epic (Danish, Template A) - default for Epics when the user writes Danish and the Epic is not tied to an OKR/KR.
- OKR/KR Epic (English, Template B) - used when the parent is an Objective with summary prefix `C<N>-<YEAR>`, or when the user names KR / OKR / Key Result in the intent.
- Story / Task (minimal) - mirrors the user's language (Danish headers if the user writes Danish, English headers if the user writes English).

The entire block below each header is the issue description body. Plain-text section labels. No markdown headings, no bold, no Gherkin, no `[text](url)` links.

### Delivery Epic (Danish, Template A)

```
summary: ServiceNow – Auto-Close RITM-lukning af afhængige SC Tasks

Formål / baggrund
<hvad vil vi opnå, og hvorfor nu>

Omfang
<kort prosa-beskrivelse af afgrænsningen>

Med i scope
- <konkret leverance>
- <konkret leverance>

Ikke i scope
- <hvad dette epic bevidst ikke dækker>

Acceptkriterier
<observérbart udfald er opnået>
<observérbart udfald er opnået>
<observérbart udfald er opnået>

Afhængigheder
- <system / team / issue>
- <system / team / issue>

Forslag til nedbrydning (temaer)
- <tema 1>
- <tema 2>
- <tema 3>

Kilder
https://example.com/ritm-or-confluence-or-ticket
```

### OKR/KR Epic (English, Template B)

```
summary: KR1 – Tidsbesparelse fastlagt for alle bestillingstyper

Purpose
<the action goal this Epic drives toward the parent Objective / KR>

Measurement principles
- <how progress on this Epic is measured>
- <baseline, target, cadence>

Scope
<optional: short prose on what is and is not included>

Acceptance Criteria
<observable outcome is achieved>
<observable outcome is achieved>

Definition of Done (Epic)
- <rollup artefact is produced>
- <handover is complete>
- <measurement is reported back to the KR>

Sources
https://example.com/ritm-or-confluence-or-ticket
```

### Story / Task (minimal)

Mirror the user's language. Danish labels shown; swap to `Purpose`, `Scope`, `Acceptance Criteria`, `Dependencies`, `Sources` when the user writes English.

```
summary: Software – Tidsbesparelse fastlagt

Formål
<hvad denne story/task opnår - handlingsmål, ikke persona>

Omfang
<valgfrit: kort afgrænsning>

Acceptkriterier
<observérbart udfald er opnået>
<observérbart udfald er opnået>

Afhængigheder
- <valgfrit>

Kilder
<valgfrit: bare URL'er til RITM / INC / Confluence>
```

## Acceptance Criteria Rules

- AC lives in the issue description, under a plain-text section header: `Acceptance Criteria` (English body) or `Acceptkriterier` (Danish body). Never in a custom field, never in labels, never in comments.
- One observable outcome per line, stated as done in passive tone: `X is Y` / `X er Y`. No Given/When/Then, no scenario blocks, no step-by-step.
- Bullet markers are optional. A `-` prefix is fine; unmarked newline-separated lines are also fine. Do not mix styles in the same block.
- Each line must be verifiable at the moment THIS issue is done. Aspirational lines about what future work will be able to do are not AC.
- Do not name the tool in AC. `"Time saved is recorded on all order types in ServiceNow"` couples the outcome to a solution. Move the tool name to Scope or Purpose; keep AC outcome-only: `"Time saved is recorded on all order types."`
- Documentation and process criteria ("source and assumptions are documented briefly", "runbook is updated") are Definition of Done concerns, not Acceptance Criteria. Move them under a `Definition of Done` section.
- No UI wording unless the rule is genuinely about UI behavior. No endpoints, table names, or framework references.
- Cover the core outcome plus at least one meaningful edge (empty, invalid, unauthorized, boundary) when applicable.

## Story Splitting Patterns

When a story feels too large to finish in a sprint, has "and"/"or" in its summary, or spans multiple workflows, split using one of these eight patterns. Pick the one that produces independently valuable slices:

1. **Workflow steps** - one story per step of a multi-step flow
2. **Business rule variations** - one story per rule (tax rule, discount rule, approval threshold)
3. **Happy path vs unhappy path** - ship the success case first, errors next
4. **Data variations** - one story per data type, region, currency, format
5. **Interface variations** - one per channel (web, mobile, API)
6. **Defer performance** - ship correct first, optimize in a follow-up
7. **CRUD splits** - read before write, create before update before delete
8. **Spike then build** - time-boxed research story, then the implementation story

## Definition of Ready (default)

- Parent epic linked (if applicable); Epic rolled up to Initiative or Objective where it exists
- Acceptance criteria present in the description body as flat declarative lines
- Team agrees the scope is understood and small enough to finish in a sprint
- Dependencies identified and either resolved or tracked as blockers
- Designs or data samples attached if the story needs them
- Product owner has accepted the wording

## Definition of Done (default)

- Code merged to the main branch
- Automated tests added and green
- Each AC line demonstrated
- Documentation updated where behavior changed
- Product owner has accepted the increment

## JQL Cookbook

Useful queries:

```sql
-- My open items
assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC

-- Stale stories
project = <KEY> AND issuetype = Story AND updated < -14d AND statusCategory != Done

-- Sprint candidates
project = <KEY> AND sprint is EMPTY AND statusCategory = "To Do"

-- Stories missing AC (AC lives in the description; scan for either header)
project = <KEY> AND issuetype = Story AND description !~ "Acceptkriterier" AND description !~ "Acceptance Criteria"

-- Stories slipping into Gherkin (should be zero on this tenant)
project = <KEY> AND issuetype in (Story, Task, Epic) AND description ~ "Scenario"

-- Blocked chain
project = <KEY> AND issueFunction in linkedIssuesOf("resolution = Unresolved", "is blocked by")

-- Recent exemplars
project = <KEY> AND issuetype = Story AND statusCategory = Done ORDER BY resolved DESC

-- Epic progress
"Epic Link" = <KEY>-123 ORDER BY rank
```

## Common Anti-Patterns

- **Gherkin AC** - Given/When/Then and `Scenario:` blocks are not the TV2 style. Use flat declarative lines under `Acceptance Criteria` / `Acceptkriterier` instead.
- **Persona narratives** - `As a <role> / I want / So that` and the Danish `Som en <rolle> / vil jeg / så` are not the TV2 style. Lead with `Purpose` / `Formål` stating the action goal, not a persona template.
- **Markdown headings in issue bodies** - `##` and `**bold**` are not the TV2 style. Plain-text label lines only.
- **Markdown links in issue bodies** - `[text](url)` is not the TV2 style. Bare URLs only; Jira renders them as smart inline cards.
- **Aspirational AC** - `"Efterfølgende EPICs kan anvende den etablerede kapabilitet"` / `"Subsequent Epics can use the established capability"` is not verifiable when THIS issue is done. Reject or rewrite.
- **Solution-coupled AC** - `"Tidsbesparelse er registreret på alle bestillingstyper i ServiceNow"` names the tool, not the outcome. Move the tool name to Scope; keep AC outcome-only.
- **DoD-as-AC** - `"Kilde og antagelser er dokumenteret kort"` is a DoD concern, not an AC. Move to the `Definition of Done` section.
- **Thin Epics** - an Epic that does not fill Template A's required sections (`Formål / baggrund`, `Omfang`, `Acceptkriterier`, `Forslag til nedbrydning`) should be split into Stories or converted to a Story itself. Do not ship thin Epics.
- **Justification clauses in summaries** - `så...` / `so-that` tails belong in `Purpose` / `Formål`, not the summary. Keep summaries verb-first imperative and under 80 chars.
- **Tech-task stories** - `"Refactor the X service"` is a Task or a Story depending on whether end-user-observable behavior changes. Enablement without a user-observable outcome is a Task. Behavior change is a Story.
- **Wrong issue type** - Story vs Task: Stories change end-user-observable behavior or state. Tasks are ceremony or enablement without direct user-observable outcome. Spike is time-boxed investigation with a written finding as its deliverable. Bug includes reproduce steps in the description.
- **AC as UI checklists** - `"Button is blue, label says Submit"` is not AC. That is a design spec.
- **Epics masquerading as stories** - if it cannot be shipped in a sprint, it is probably an epic.
- **`and`/`or` in summaries** - splits hiding in plain sight. Break them apart.
- **Horizontal slicing** - one story for the API layer, one for the UI layer. Each should slice vertically through all layers.
- **Sub-tasks without parents** - orphaned sub-tasks are workflow rot. Attach or delete.
- **Using labels** - this team does not use Jira labels. Do not set the `labels` field on create or update. Do not suggest labels as a categorization mechanism.
- **Story points** - this team does not size in points. Do not set a story points custom field. Do not ask the user "how many points?"

## Danish Template Glossary

Mapping between Danish and English section labels so the agent reads both fluently:

- Formål / baggrund = Purpose / Background
- Omfang = Scope
- Med i scope = In scope
- Ikke i scope = Out of scope
- Acceptkriterier = Acceptance Criteria
- Afhængigheder = Dependencies
- Forslag til nedbrydning (temaer) = Breakdown suggestions (themes)
- Interessenter = Stakeholders
- Baggrund = Background
- Effektmål = Impact goals
- Succeskriterier = Success criteria
- Kilder / Referencer = Sources / References
- Definition of Done = (no Danish equivalent in the corpus - English used verbatim)
- Measurement principles = (English; used on OKR/KR Epics)

Base directory for this skill: file:///Users/lasn/.config/opencode/skills/jira-agile-reference
