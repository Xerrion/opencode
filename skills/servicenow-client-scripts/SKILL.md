---
name: servicenow-client-scripts
description: ServiceNow client-side scripting standards. Covers onChange guards, GlideAjax patterns, g_scratchpad, and when to use UI Policies vs Client Scripts.
---

# ServiceNow Client-Side Scripting Standards

## JavaScript Mode

The ECMAScript 2021 mode setting is a server-side engine setting. It governs the server halves of the patterns below -- the GlideAjax Script Include and the Display Business Rule -- which follow `servicenow-scripting`.

Client Scripts, Catalog Client Scripts, and UI Scripts execute in the browser, so that setting says nothing about them. Default to ES5 syntax on the client. Use modern syntax there only where the team has confirmed it against the instance's supported browsers and any client-side script processing, and keep the two halves of a GlideAjax pair evaluated separately: a server-side Script Include in ES2021 mode can be called from an ES5 client script without any change to the client code.

## Client Script Types

| Type           | Fires When              | Common Use                                                  |
| -------------- | ----------------------- | ----------------------------------------------------------- |
| **onChange**   | A field value changes   | Validate input, show/hide fields, populate dependent fields |
| **onLoad**     | Form loads              | Set defaults, show messages, initialize form state          |
| **onSubmit**   | User clicks Save/Update | Final validation before save                                |
| **onCellEdit** | List cell is edited     | Inline list editing validation                              |

## onChange Guard Pattern

**Always** guard onChange scripts to prevent execution on form load:

```javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
  if (isLoading || newValue === "") {
    return;
  }

  // Your logic here
}
```

Without this guard, the script fires when the form loads and populates fields, causing unintended side effects.

## GlideAjax Pattern

Use GlideAjax for async server communication. **Never** use synchronous `getXMLWait()`.

### Client-side (Client Script):

```javascript
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
  if (isLoading || newValue === "") {
    return;
  }

  var ga = new GlideAjax("MyAjaxUtil");
  ga.addParam("sysparm_name", "getDisplayInfo");
  ga.addParam("sysparm_user_id", newValue);
  ga.getXMLAnswer(function (answer) {
    var result = JSON.parse(answer);
    g_form.setValue("description", result.info);
  });
}
```

### Server-side (Script Include):

```javascript
var MyAjaxUtil = Class.create();
MyAjaxUtil.prototype = Object.extendsObject(AbstractAjaxProcessor, {
  getDisplayInfo: function () {
    var userId = this.getParameter("sysparm_user_id");
    var grUser = new GlideRecord("sys_user");
    if (grUser.get(userId)) {
      return JSON.stringify({
        info: grUser.getValue("name") + " - " + grUser.getValue("department"),
      });
    }
    return JSON.stringify({ info: "" });
  },

  type: "MyAjaxUtil",
});
```

**Key rules for GlideAjax Script Includes:**

- Must extend `AbstractAjaxProcessor`
- Must be marked **Client callable** on the form
- Use `this.getParameter('sysparm_name')` to get the method name
- Use `this.getParameter('sysparm_param')` for custom parameters
- Return strings only (use `JSON.stringify` for complex data)

## g_scratchpad Pattern

Pass server data to client scripts via Display Business Rules + `g_scratchpad`:

### Display Business Rule (server-side):

```javascript
// Business Rule: Populate Scratchpad for Incident Form
// When: display | Table: incident
(function executeRule(current, previous) {
  g_scratchpad.userHasEscalateRole = gs.hasRole("incident_escalator");
  g_scratchpad.maxPriority = gs.getProperty("incident.max_priority", "1");
  g_scratchpad.relatedCount = new GlideAggregate("incident").addQuery("parent", current.getUniqueValue()).getCount();
})(current, previous);
```

### Client Script (reading scratchpad):

```javascript
function onLoad() {
  if (g_scratchpad.userHasEscalateRole) {
    g_form.showFieldMsg("priority", "You have escalation permissions", "info");
  }
}
```

**Why g_scratchpad?** It avoids synchronous server calls and loads data in the same transaction as the form.

## UI Policies vs Client Scripts

**Use UI Policies for:**

- Making fields mandatory
- Making fields read-only
- Showing/hiding fields and sections
- Any field attribute change

**Use Client Scripts for:**

- Complex validation logic
- GlideAjax server calls
- Dynamic field population
- Conditional messages
- Anything that requires JavaScript logic beyond show/hide/mandatory/readonly

UI Policies are preferred because they:

- Don't require JavaScript
- Are easier to maintain and audit
- Can be set via the form builder
- Have clear on/off conditions

## g_form API (Common Methods)

```javascript
// Get/Set values
g_form.getValue("field_name");
g_form.setValue("field_name", "value");
g_form.getReference("reference_field", function (ref) {
  /* async */
});

// Field attributes
g_form.setMandatory("field_name", true);
g_form.setReadOnly("field_name", true);
g_form.setVisible("field_name", false);
g_form.setDisplay("field_name", false); // removes from DOM entirely

// Messages
g_form.showFieldMsg("field_name", "Message text", "info"); // info, error, warning
g_form.clearMessages();
g_form.addInfoMessage("Form-level info message");
g_form.addErrorMessage("Form-level error message");

// Choice lists
g_form.addOption("field_name", "value", "label");
g_form.removeOption("field_name", "value");
g_form.clearOptions("field_name");
```

## onSubmit Validation Pattern

```javascript
function onSubmit() {
  var description = g_form.getValue("description");
  if (description.length < 20) {
    g_form.showFieldMsg("description", "Description must be at least 20 characters", "error");
    return false; // prevents save
  }
  return true; // allows save
}
```

## Critical Don'ts

- **No synchronous GlideAjax** (`getXMLWait()`) -- blocks the browser thread
- **No unverified ES2021 syntax** -- the server-side ES2021 mode does not cover browser-executed scripts
- **No `window.location` redirects** -- use `GlideNavigation` or `g_navigation`
- **No direct DOM manipulation** -- use `g_form` API; DOM structure changes between versions
- **No `alert()` or `confirm()`** -- use `GlideModal` or `g_form` messages
- **No heavy loops or processing** -- client scripts run in the browser; keep them lightweight
- **Minimize client scripts** -- prefer server-side logic whenever possible
