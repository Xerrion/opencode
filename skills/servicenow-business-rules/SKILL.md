---
name: servicenow-business-rules
description: ServiceNow Business Rule development patterns. Load when writing, reviewing, or debugging Business Rules. Covers timing selection (before/after/async/display), filter conditions, anti-patterns, and delegation to Script Includes.
---

# ServiceNow Business Rule Standards

## Timing Selection

Choose the correct **When** timing based on what the rule does:

| Timing | Use When | Example |
|--------|----------|---------|
| **before** | Manipulating fields on the current record before it saves | Set priority from impact + urgency |
| **after** | Creating/updating OTHER records based on this record's save | Create a child task when parent is created |
| **async** | Heavy processing that shouldn't block the user transaction | Sending notifications, external integrations, bulk updates |
| **display** | Populating `g_scratchpad` data for client-side use | Pass server data to an onChange Client Script |

**Default to `before`** for field manipulation. Only use `after` when you need the record's sys_id (insert) or need to affect other records. Use `async` for anything that doesn't need to block.

## Filter Conditions vs. Script Conditions

**Always** set Filter Conditions on the Business Rule form rather than scripting `if` checks:

```
// BAD -- condition logic in script
(function executeRule(current, previous) {
    if (current.getValue('state') == '6' && current.getValue('priority') == '1') {
        // do work
    }
})(current, previous);

// GOOD -- condition set on BR form, script only contains the action
// Form filter: state=6^priority=1
(function executeRule(current, previous) {
    // do work -- condition already filtered
})(current, previous);
```

Benefits: Form conditions are indexed and skip script evaluation entirely when not met.

## Operations

Set the correct operation checkboxes (Insert, Update, Delete, Query) on the form:

- **Insert only**: New record creation logic (e.g., auto-populate defaults)
- **Update only**: Change detection logic (e.g., escalation on priority change)
- **Insert + Update**: Logic that applies to both (e.g., field validation)
- **Delete**: Cleanup logic (e.g., cascade deletes, audit logging)
- **Query**: Query filter injection (rare, use carefully -- affects ALL queries on the table)

## Change Detection

Use `previous` object for update operations to detect field changes:

```javascript
// Check if a specific field changed
if (current.getValue('state') != previous.getValue('state')) {
    // state changed
}

// Check if priority was escalated (went to a lower number = higher priority)
if (parseInt(current.getValue('priority')) < parseInt(previous.getValue('priority'))) {
    // priority escalated
}
```

`previous` is only available in **before** and **after** rules on **update** operations.

## Hard Rules

1. **Never call `current.update()`** inside a before or after Business Rule. The system handles the update. Calling it causes recursive execution.
2. **Prefer Script Includes** over inline logic. Business Rules should be thin wrappers that call Script Include methods. This keeps logic testable and reusable.
3. **Set `order` explicitly** when multiple BRs fire on the same table/operation/timing. Default order is 100. Lower numbers run first.
4. **Use `setAbortAction(true)`** to prevent record save (before rules only). Always provide a user-facing message with `gs.addErrorMessage()`.
5. **Never use `gs.sleep()`** in synchronous rules. If you need delays, use async or Scheduled Jobs.

## Abort Pattern

To prevent a save with a user-facing error (before insert/update only):

```javascript
(function executeRule(current, previous) {
    if (!isValid(current)) {
        gs.addErrorMessage('Cannot save: <reason>');
        current.setAbortAction(true);
    }
})(current, previous);
```

## Async Best Practices

For async Business Rules:

- They run in a separate transaction -- `current` is a snapshot, not live
- You cannot abort the original transaction from async
- Access to `previous` works normally
- Ideal for: notifications, external API calls, heavy GlideRecord operations, event generation
- Use `gs.eventQueue()` for even more decoupled processing

## Template: Thin BR with Script Include

```javascript
// Business Rule: Set Incident Priority
// Table: incident | When: before | Insert: yes | Update: yes
// Condition: (on form) impact changes OR urgency changes
(function executeRule(current, previous) {
    new IncidentUtils().calculatePriority(current);
})(current, previous);
```

```javascript
// Script Include: IncidentUtils
var IncidentUtils = Class.create();
IncidentUtils.prototype = {
    initialize: function() {},

    /**
     * Calculate and set priority based on impact and urgency matrix.
     * @param {GlideRecord} grIncident - The incident record
     */
    calculatePriority: function(grIncident) {
        var impact = parseInt(grIncident.getValue('impact'));
        var urgency = parseInt(grIncident.getValue('urgency'));
        var priority = this._getPriorityFromMatrix(impact, urgency);
        grIncident.setValue('priority', priority);
    },

    _getPriorityFromMatrix: function(impact, urgency) {
        // Priority matrix: lower = more critical
        var matrix = {
            '1-1': '1', '1-2': '2', '1-3': '3',
            '2-1': '2', '2-2': '3', '2-3': '4',
            '3-1': '3', '3-2': '4', '3-3': '5'
        };
        return matrix[impact + '-' + urgency] || '4';
    },

    type: 'IncidentUtils'
};
```
