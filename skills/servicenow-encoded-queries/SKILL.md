---
name: servicenow-encoded-queries
description: ServiceNow encoded query construction, translation, review, and debugging. Use whenever work involves filter breadcrumbs, addEncodedQuery(), sysparm_query, encoded query strings, ^OR or ^NQ logic, field operators, relative dates, dynamic filters, or translating between condition-builder filters and GlideRecord queries.
---

# ServiceNow Encoded Queries

Encoded queries are ServiceNow's compact filter language. Use them when a condition builder, URL, reference qualifier, API parameter, or complex GlideRecord filter needs one portable query string. Keep simple programmatic conditions in `addQuery()` calls because their field, operator, and value boundaries are easier to inspect and safer to populate dynamically.

## Build Queries Safely

1. Confirm the target table and use internal field names.
2. Confirm each field type and its stored value. Choice labels are not query values, and reference equality uses a sys_id.
3. Build complex logic in the condition builder when possible, then copy the query from the breadcrumb. This avoids punctuation and grouping mistakes.
4. Treat the complete encoded query as code, not as a place to interpolate untrusted text. Use `addQuery(field, operator, value)` for user-supplied values.
5. Test with a bounded read or count before using the query for updates, deletes, notifications, or automation conditions.
6. Inspect `getEncodedQuery()` when debugging the final GlideRecord query.

```javascript
var grIncident = new GlideRecord("incident");
grIncident.addEncodedQuery("active=true^priorityIN1,2^assignment_groupISNOTEMPTY");
grIncident.setLimit(100);
grIncident.query();
```

Do not concatenate request parameters, form values, catalog variables, email content, or other untrusted strings into `addEncodedQuery()` or `sysparm_query`. Caret separators and operators inside the value can alter the filter. Keep those values separate:

```javascript
var grIncident = new GlideRecord("incident");
grIncident.addQuery("active", true);
grIncident.addQuery("short_description", "CONTAINS", userSearchText);
grIncident.query();
```

## Compose Conditions

| Token | Meaning                                    | Example                                            |
| ----- | ------------------------------------------ | -------------------------------------------------- |
| `^`   | AND                                        | `active=true^caller_idISNOTEMPTY`                  |
| `^OR` | OR within a condition group                | `priority=1^ORpriority=2`                          |
| `^NQ` | Start an alternative top-level query group | `short_descriptionISEMPTY^NQdescriptionISNOTEMPTY` |

Read these examples as:

- `active=true^caller_idISNOTEMPTY`: active is true AND caller is populated.
- `active=true^priority=1^ORpriority=2`: active is true AND priority is 1 or 2.
- `short_descriptionISEMPTY^NQdescriptionISNOTEMPTY`: short description is empty OR description is populated.

Do not insert parentheses into an encoded query. They are not general Boolean-grouping syntax. For logic that is hard to express or review with `^OR` and `^NQ`, use chained `addQuery()` / `addOrCondition()` calls or split the operation into explicit queries.

```javascript
var grIncident = new GlideRecord("incident");
var priorityCondition = grIncident.addQuery("priority", "1");
priorityCondition.addOrCondition("priority", "2");
grIncident.addQuery("active", true);
grIncident.query();
```

Do not assume SQL or JavaScript operator precedence. Generate complex strings in the condition builder and test their result set.

## Common Operators

### All field types

| Label                   | Encoded operator | Example                       |
| ----------------------- | ---------------- | ----------------------------- |
| is                      | `=`              | `active=true`                 |
| is not                  | `!=`             | `state!=7`                    |
| is empty                | `ISEMPTY`        | `assigned_toISEMPTY`          |
| is not empty            | `ISNOTEMPTY`     | `assigned_toISNOTEMPTY`       |
| is anything             | `ANYTHING`       | `short_descriptionANYTHING`   |
| is same as field        | `SAMEAS`         | `caller_idSAMEASassigned_to`  |
| is different from field | `NSAMEAS`        | `caller_idNSAMEASassigned_to` |

`ANYTHING` includes populated, empty, and null values. Use it only when that broad meaning is intentional.

### String and string-choice fields

| Label            | Encoded operator | Example                           |
| ---------------- | ---------------- | --------------------------------- |
| starts with      | `STARTSWITH`     | `short_descriptionSTARTSWITHSAP`  |
| ends with        | `ENDSWITH`       | `short_descriptionENDSWITHoutage` |
| contains         | `LIKE`           | `short_descriptionLIKESAP`        |
| does not contain | `NOT LIKE`       | `short_descriptionNOT LIKESAP`    |
| is one of        | `IN`             | `subcategoryINemail,database`     |
| is not one of    | `NOT IN`         | `subcategoryNOT INemail,database` |
| between          | `BETWEEN`        | `short_descriptionBETWEENq@t`     |
| is empty string  | `EMPTYSTRING`    | `short_descriptionEMPTYSTRING`    |

Use stored choice values in `IN` and `NOT IN`, not their display labels.

### Numeric and integer-choice fields

| Label                          | Encoded operator     | Example                                            |
| ------------------------------ | -------------------- | -------------------------------------------------- |
| less than                      | `<`                  | `reassignment_count<2`                             |
| greater than                   | `>`                  | `reassignment_count>2`                             |
| less than or equal             | `<=`                 | `reassignment_count<=2`                            |
| greater than or equal          | `>=`                 | `reassignment_count>=2`                            |
| between, inclusive             | `BETWEEN`            | `reassignment_countBETWEEN1@3`                     |
| greater than field             | `GT_FIELD`           | `reassignment_countGT_FIELDreopen_count`           |
| less than field                | `LT_FIELD`           | `reassignment_countLT_FIELDreopen_count`           |
| greater than or equal to field | `GT_OR_EQUALS_FIELD` | `reassignment_countGT_OR_EQUALS_FIELDreopen_count` |
| less than or equal to field    | `LT_OR_EQUALS_FIELD` | `reassignment_countLT_OR_EQUALS_FIELDreopen_count` |

Operator availability can differ between numeric fields and integer-backed choice fields. If the condition builder does not offer `<=` or `>=` for the selected field, use a supported scripted condition or a direct GlideRecord condition rather than forcing the encoded form.

### Reference fields

| Intent                           | Example                                      |
| -------------------------------- | -------------------------------------------- |
| equals a record                  | `caller_id=9ee1b13dc6112271007f9d0efdb69cd0` |
| is populated                     | `caller_idISNOTEMPTY`                        |
| display value starts with text   | `caller_idSTARTSWITHDon`                     |
| same record as another reference | `caller_idSAMEASassigned_to`                 |
| dynamic filter option            | `caller_idDYNAMIC<filter-option-sys-id>`     |

For equality, use the referenced record sys_id. Text operators act on the reference display value. Dynamic-filter identifiers are instance records, so copy the generated condition from the condition builder instead of hardcoding an identifier from another instance. Not every operator is available for every reference type.

### Boolean fields

Use `field=true`, `field=false`, `fieldISEMPTY`, or `fieldISNOTEMPTY`. Remember that `active!=true` can include false, empty, and null values; it is broader than `active=false`.

## Date and Time Operators

Prefer condition-builder-generated date queries. Date ranges use `@` to separate operands and often contain a trusted `javascript:` expression evaluated by ServiceNow.

| Intent                                    | Example                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| today                                     | `sla_dueONToday@javascript:gs.daysAgoStart(0)@javascript:gs.daysAgoEnd(0)` |
| before today                              | `sla_due<javascript:gs.daysAgoStart(0)`                                    |
| at or before today                        | `sla_due<=javascript:gs.daysAgoEnd(0)`                                     |
| after today                               | `sla_due>javascript:gs.daysAgoEnd(0)`                                      |
| yesterday through today                   | `sla_dueBETWEENjavascript:gs.daysAgoStart(1)@javascript:gs.daysAgoEnd(0)`  |
| more recent than one hour ago             | `sla_dueRELATIVEGT@hour@ago@1`                                             |
| older than one hour ago                   | `sla_dueRELATIVELT@hour@ago@1`                                             |
| same day as another field                 | `sla_dueSAMEASactivity_due@day`                                            |
| more than one day before another field    | `sla_dueMORETHANactivity_due@day@before@1`                                 |
| less than three days before another field | `sla_dueLESSTHANactivity_due@day@before@3`                                 |

Never place user input inside a `javascript:` expression. Date tokens and trend operators can vary with field type and platform support, so copy them from a tested condition builder when available.

## Change, Tag, and Special Operators

Change operators apply only in contexts that have current and previous values, such as notification conditions:

| Intent               | Example             |
| -------------------- | ------------------- |
| field changes        | `stateVALCHANGES`   |
| changes from value 4 | `stateCHANGESFROM4` |
| changes to value 4   | `stateCHANGESTO4`   |

Tag queries are generated structures that include the tag record sys_id:

- Has tag: `sys_tags.<tag-sys-id>=<tag-sys-id>`
- Does not have tag: `sys_tags.<tag-sys-id>DOESNOTHAVE<tag-sys-id>`
- Excludes tag: `sys_tags.<tag-sys-id>EXCLUDING<tag-sys-id>`

Generate tag queries in the condition builder. Do not copy tag sys_ids across instances without resolving the corresponding tag record.

## Translation Workflow

When translating plain language or condition-builder rows into an encoded query:

1. Write the intended Boolean expression in words.
2. Resolve labels to internal field names and stored values.
3. Select operators that the target field type supports.
4. Separate AND conditions with `^`.
5. Use `^OR` for alternatives in one group and `^NQ` for a new top-level alternative.
6. Generate or verify the result in the condition builder.
7. Return both the encoded query and a one-sentence reading of it.

Example request: "Active incidents where priority is High or Critical and assignment group is populated."

```text
active=true^priorityIN1,2^assignment_groupISNOTEMPTY
```

Meaning: active is true, priority is 1 or 2, and assignment group is populated.

## Review Checklist

- The table and every internal field name are confirmed.
- Choice conditions use stored values; reference equality uses sys_ids.
- `^OR` and `^NQ` match the intended grouping.
- No parentheses are used as grouping syntax.
- No untrusted value is concatenated into the encoded string.
- Every `javascript:` expression is trusted and necessary.
- Dynamic-filter and tag sys_ids belong to the target instance.
- Date boundaries and inclusive/exclusive comparisons are explicit.
- The query was tested with a bounded read or count before any consequential action.
