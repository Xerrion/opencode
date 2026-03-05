---
name: servicenow-scripting
description: ServiceNow server-side scripting standards. Load when writing or reviewing Script Includes, Business Rules, Scheduled Jobs, Fix Scripts, or any server-side ServiceNow code. Covers class patterns, naming conventions, error handling, JSDoc, and critical anti-patterns.
---

# ServiceNow Server-Side Scripting Standards

## Script Include Pattern

Always use the `Class.create()` / `prototype` / `type` pattern:

```javascript
var MyUtil = Class.create();
MyUtil.prototype = {
    initialize: function() {},

    doSomething: function(param) {
        // implementation
    },

    type: 'MyUtil'
};
```

For inheritance, use `Object.extendsObject`:

```javascript
var ChildUtil = Class.create();
ChildUtil.prototype = Object.extendsObject(AbstractAjaxProcessor, {
    doSomething: function(param) {
        // implementation
    },

    type: 'ChildUtil'
});
```

## IIFE Wrappers by Context

Use the correct wrapper per script context:

- **REST API (Scripted REST Resource):** `(function process(request, response) { ... })(request, response);`
- **Widget Server Script:** `(function() { ... })();`
- **Widget Client Script:** `function() { ... }`
- **Email Script:** `(function runMailScript(current, template, email, email_action, event) { ... })(current, template, email, email_action, event);`
- **Transform Script:** `(function transformEntry(source, map, log, target) { ... })(source, map, log, target);`

## Naming Conventions

- Variables and functions: `camelCase`
- GlideRecord variables: `gr` prefix (e.g., `grIncident`, `grUser`)
- GlideAggregate variables: `ga` prefix (e.g., `gaCount`)
- Constants: `UPPER_SNAKE_CASE`
- Script Include names: `PascalCase` matching the class name exactly

## Error Handling

Use consistent logging with class and method context:

```javascript
gs.error('[MyScriptInclude.methodName] Failed to process: {0}', err.message);
gs.warn('[MyScriptInclude.methodName] Unexpected state: {0}', state);
gs.info('[MyScriptInclude.methodName] Processing complete for: {0}', recordId);
```

Always include the class name and method name in brackets so errors can be traced back to source.

## JSDoc Conventions

Document Script Includes with JSDoc:

```javascript
/**
 * Utility for managing incident escalation logic.
 * @class IncidentEscalation
 */

/**
 * Escalates an incident based on priority and age.
 * @param {string} incidentSysId - sys_id of the incident to escalate
 * @param {number} priority - Target priority level (1-5)
 * @returns {boolean} True if escalation was successful
 */
```

## Critical Don'ts

These are hard rules -- never violate them:

- **No hardcoded sys_ids** -- use `getProperty()`, `GlideRecord` lookups, or Script Includes to resolve dynamically
- **No dot-walking to sys_id** -- use `getValue('reference_field')` which already returns the sys_id
- **No `gs.nowDateTime()`** in scoped apps -- use `new GlideDateTime().getDisplayValue()` instead
- **No em-dashes** (—) in scripts -- ServiceNow may corrupt them; use standard hyphens or double-hyphens
- **No `eval()`** -- ever
- **No `gr.field = value`** -- always use `gr.setValue('field', value)`
- **No `gr.field`** for reading -- always use `gr.getValue('field')`
- **No `current.update()`** inside Business Rules -- the system handles the update
- **No synchronous server calls from client scripts** -- use GlideAjax

## Script Structure Template

For any new Script Include:

```javascript
/**
 * <Description of what this utility does>.
 * @class <ClassName>
 */
var ClassName = Class.create();
ClassName.prototype = {
    initialize: function() {
        this.LOG_PREFIX = '[ClassName] ';
    },

    /**
     * <Method description>.
     * @param {string} param1 - <description>
     * @returns {boolean} <description>
     */
    methodName: function(param1) {
        try {
            // implementation
            return true;
        } catch (e) {
            gs.error(this.LOG_PREFIX + 'methodName failed: {0}', e.message);
            return false;
        }
    },

    type: 'ClassName'
};
```
