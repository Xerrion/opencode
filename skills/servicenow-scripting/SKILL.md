---
name: servicenow-scripting
description: ServiceNow server-side scripting standards. Covers JavaScript mode (ES5 vs ECMAScript 2021), class patterns, naming conventions, error handling, JSDoc, and critical anti-patterns.
---

# ServiceNow Server-Side Scripting Standards

## JavaScript Mode: ES5 or ES2021

Server-side scripts run in one of two engine modes, and the mode decides which syntax is legal. Confirm the mode for the artifact you are editing before you write. When you cannot confirm it, write ES5 -- ES5 runs in both modes, while ES2021 syntax is a hard failure in ES5 mode.

### How ES2021 gets turned on

| Level             | Where                                                                    | Notes                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Application       | Scoped application JavaScript mode: `ES5 (Helsinki)` or `ES2021 (Tokyo)` | Tokyo and later. Applies to every script in the scope.                                                                |
| Individual script | Toggle **Turn on ECMAScript 2021 (ES12) mode** above the script field    | Xanadu and later. Available on scripts in applications still using ES5 or Compatibility mode, including global scope. |

The per-script toggle is **not** stored on the script record. It lives in the `sys_es_latest_script` table, which holds the target table, the target record sys_id, and a boolean. Two consequences:

1. To read or report on the toggle, query `sys_es_latest_script`. Run `describe` on it first -- the value is not a field on the script record.
2. XML export does not carry the toggle. An exported script lands on the target instance with ES2021 off, so ES2021 syntax in it breaks there. Move such scripts in update sets and verify the toggle after promotion.

The ES2021 engine is also slightly stricter about legacy behaviour that ES5 mode tolerates (for example, `Array.prototype.sort` rejects a comparator that is neither a function nor `undefined`).

### Safe to use in ES2021 mode

- Declarations and functions: `let`, `const`, arrow functions, default and rest parameters, spread, destructuring (declarations, assignment, parameters), block-level function declarations
- Literals: template literals including tagged templates, object shorthand and computed keys, numeric separators, binary and octal literals
- Operators: `?.`, `??`, `||=`, `&&=`, `??=`, `**`
- Control flow: `for...of`, optional catch binding (`catch {}`), generators and `yield*`
- Async: `async`/`await` in function declarations, function expressions, arrow functions, and object-literal methods; `Promise.all/race/allSettled/any/finally`; `AggregateError`
- Collections and types: `Map`, `Set`, `WeakMap`, `WeakSet`, `Symbol` and well-known symbols, typed arrays, `BigInt`, `Proxy`, `globalThis`
- Built-in methods: `Object.assign/values/entries/fromEntries/is`, `Array.from/of/includes/find/findIndex/flat/flatMap/fill`, `String.padStart/padEnd/trimStart/trimEnd/replaceAll/matchAll/repeat/includes`
- RegExp: named capture groups, lookbehind assertions, `s`/`u`/`y` flags, Unicode property escapes
- `class` declarations and expressions, including `extends`, `super`, static members, and accessors

### Not available even in ES2021 mode

The engine is ES2021-shaped, not a complete ES2021 runtime. These fail:

- The entire `Reflect` namespace
- `async` methods inside a `class` body -- put the async work in an object-literal method or an arrow function, or have the class method return a Promise
- Async iterators, async generators, `for await...of`
- `new.target`
- Subclassing built-ins (`Array`, `Error`, `Map`, `Set`, `Promise`, `RegExp`, `Function`, `Number`, `String`, `Boolean`)
- `WeakRef`, `FinalizationRegistry`, `SharedArrayBuffer`, `Atomics`
- `generator.throw()` and `generator.return()`
- `new Function()` built with modern syntax (default parameters, destructuring, rest)
- Proper tail calls -- deep recursion still overflows

### Do not rely on these semantics

They parse, but they do not behave the way a standards-compliant engine would:

- Temporal dead zone: reading a `let`/`const` before its declaration does not reliably throw, so always declare before use
- Implicit strict mode inside `class` bodies: add `'use strict'` when you need it
- `Function.prototype.toString` returning original source text
- Own-property order for `Object.assign`, `JSON.stringify`, and `JSON.parse`
- `Array.prototype.includes` on array-likes -- it is not generic here
- `Number('0b1010')` and `Number('0o17')` -- the literals work, the string coercion does not
- Unicode escape sequences in identifiers and property keys
- Well-formed `JSON.stringify` -- lone surrogates are not escaped

### What the mode does not change

Every platform rule in this skill still applies in ES2021 mode: `getValue`/`setValue`, deliberate sys_id usage, no `eval()`, `Class.create()` for Script Includes, and the IIFE wrapper for each script context.

## Script Include Pattern

Always use the `Class.create()` / `prototype` / `type` pattern:

```javascript
var MyUtil = Class.create();
MyUtil.prototype = {
  initialize: function () {},

  doSomething: function (param) {
    // implementation
  },

  type: "MyUtil",
};
```

For inheritance, use `Object.extendsObject`:

```javascript
var ChildUtil = Class.create();
ChildUtil.prototype = Object.extendsObject(AbstractAjaxProcessor, {
  doSomething: function (param) {
    // implementation
  },

  type: "ChildUtil",
});
```

Keep `Class.create()` even in ES2021 mode. The Script Include loader, `Object.extendsObject`, and client-callable `AbstractAjaxProcessor` all depend on that shape. ES2021 buys you modern method bodies, not a different class container:

```javascript
var MyUtil = Class.create();
MyUtil.prototype = {
  initialize: function () {
    this.LOG_PREFIX = "[MyUtil] ";
  },

  summarize: function (userNames = []) {
    const labels = userNames.map((name) => name ?? "Unknown");
    return `${labels.length} user(s): ${labels.join(", ")}`;
  },

  type: "MyUtil",
};
```

Use an ES2021 `class` only for a helper type that is defined and consumed inside one script. Do not use it for a Script Include that other artifacts resolve by name.

## IIFE Wrappers by Context

Use the correct wrapper per script context:

- **REST API (Scripted REST Resource):** `(function process(request, response) { ... })(request, response);`
- **Widget Server Script:** `(function() { ... })();`
- **Widget Client Script:** `function() { ... }`
- **Email Script:** `(function runMailScript(current, template, email, email_action, event) { ... })(current, template, email, email_action, event);`
- **Transform Script:** `(function transformEntry(source, map, log, target) { ... })(source, map, log, target);`

## Naming Conventions

- Declarations: `var` in ES5 mode. In ES2021 mode use `const` by default and `let` only where the binding is reassigned
- Variables and functions: `camelCase`
- GlideRecord variables: `gr` prefix (e.g., `grIncident`, `grUser`)
- GlideAggregate variables: `ga` prefix (e.g., `gaCount`)
- Constants: `UPPER_SNAKE_CASE`
- Script Include names: `PascalCase` matching the class name exactly

## Error Handling

Use consistent logging with class and method context:

```javascript
gs.error("[MyScriptInclude.methodName] Failed to process: {0}", err.message);
gs.warn("[MyScriptInclude.methodName] Unexpected state: {0}", state);
gs.info("[MyScriptInclude.methodName] Processing complete for: {0}", recordId);
```

Always include the class name and method name in brackets so errors can be traced back to source. The `{0}` substitution works in both modes; in ES2021 mode a template literal is equally acceptable, but keep the bracketed prefix either way.

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

These are hard rules in every mode -- never violate them:

- **No dot-walking to sys_id** -- use `getValue('reference_field')` which already returns the sys_id
- **No `gs.nowDateTime()`** in scoped apps -- use `new GlideDateTime().getDisplayValue()` instead
- **No em-dashes** in scripts -- ServiceNow may corrupt them; use standard hyphens or double-hyphens
- **No `eval()`** -- ever
- **No `gr.field = value`** -- always use `gr.setValue('field', value)`
- **No `gr.field`** for reading -- always use `gr.getValue('field')`
- **No `current.update()`** inside Business Rules -- the system handles the update
- **No synchronous server calls from client scripts** -- use GlideAjax

## Hardcoded sys_ids

Hardcoded sys_ids are allowed. They are a common ServiceNow pattern, and a record keeps its sys_id when it moves through an update set. Use a hardcoded sys_id when the referenced record is delivered with the same application or update set, or when the identifier is otherwise stable across the target instances.

Prefer a named constant so the purpose is clear at each call site. Use a system property when administrators must configure the reference per instance. Use a lookup when the target is instance-specific data or is created independently on each instance and therefore does not share a stable sys_id.

These apply only until you have confirmed ES2021 mode is on for the artifact:

- **No `let`, `const`, arrow functions, template literals, classes, destructuring, spread, `?.`, `??`, or `async`/`await`** -- they are syntax errors in ES5 mode
- **No `Map`, `Set`, `Promise`, or `Symbol`** -- these are unavailable in ES5 mode
- **No `Object.assign`, `Array.prototype.includes`, or `String.prototype.padStart`** -- use `indexOf`, explicit copies, and manual padding in ES5 mode

## Script Structure Template

For any new Script Include:

```javascript
/**
 * <Description of what this utility does>.
 * @class <ClassName>
 */
var ClassName = Class.create();
ClassName.prototype = {
  initialize: function () {
    this.LOG_PREFIX = "[ClassName] ";
  },

  /**
   * <Method description>.
   * @param {string} param1 - <description>
   * @returns {boolean} <description>
   */
  methodName: function (param1) {
    try {
      // implementation
      return true;
    } catch (e) {
      gs.error(this.LOG_PREFIX + "methodName failed: {0}", e.message);
      return false;
    }
  },

  type: "ClassName",
};
```

Same Script Include in ES2021 mode -- identical structure, modern bodies:

```javascript
/**
 * <Description of what this utility does>.
 * @class <ClassName>
 */
var ClassName = Class.create();
ClassName.prototype = {
  initialize: function () {
    this.LOG_PREFIX = "[ClassName] ";
  },

  /**
   * <Method description>.
   * @param {string} param1 - <description>
   * @param {string} [fallback] - <description>
   * @returns {boolean} <description>
   */
  methodName: function (param1, fallback = "") {
    const value = param1 ?? fallback;
    try {
      // implementation
      return true;
    } catch (e) {
      gs.error(`${this.LOG_PREFIX}methodName failed for '${value}': ${e.message}`);
      return false;
    }
  },

  type: "ClassName",
};
```
