---
name: servicenow-gliderecord
description: GlideRecord and GlideAggregate best practices for ServiceNow. Load when writing queries, data manipulation, or performance-sensitive server-side scripts. Covers query patterns, getValue/setValue rules, existence checks, aggregation, and common anti-patterns.
---

# GlideRecord & GlideAggregate Best Practices

## Core Rules

1. **Always** use `getValue('field')` and `setValue('field', value)` -- never dot-walk to set/get values directly
2. **Always** call `query()` before iterating with `next()`
3. **Never** use `gr.field = value` (dot notation for writing)
4. **Never** use `gr.field` for reading values -- use `getValue('field')`

```javascript
// CORRECT
var grInc = new GlideRecord('incident');
grInc.addQuery('active', true);
grInc.query();
while (grInc.next()) {
    var state = grInc.getValue('state');
    grInc.setValue('priority', '2');
    grInc.update();
}

// WRONG -- dot notation
var grInc = new GlideRecord('incident');
grInc.addQuery('active', true);
grInc.query();
while (grInc.next()) {
    var state = grInc.state;          // WRONG: use getValue
    grInc.priority = '2';             // WRONG: use setValue
    grInc.update();
}
```

## Query Patterns

### Basic Query

```javascript
var gr = new GlideRecord('incident');
gr.addQuery('state', '1');           // equals
gr.addNotNullQuery('assigned_to');   // field is not empty
gr.addActiveQuery();                 // active=true
gr.orderByDesc('sys_created_on');
gr.setLimit(10);
gr.query();
while (gr.next()) {
    // process
}
```

### Encoded Query (Complex Conditions)

```javascript
var gr = new GlideRecord('incident');
gr.addEncodedQuery('state=1^priority<=2^assignment_groupISNOTEMPTY');
gr.query();
while (gr.next()) {
    // process
}
```

Use `addEncodedQuery()` when:
- You have complex OR conditions
- You're building queries from user input
- The query comes from a filter or URL parameter

### Reference Field Queries

```javascript
// Get the sys_id of a reference field -- use getValue, NOT dot-walk
var assignedTo = gr.getValue('assigned_to');  // returns sys_id string

// WRONG -- dot-walking to sys_id
var assignedTo = gr.assigned_to.sys_id;  // unnecessary, getValue already returns sys_id

// Query by reference field
var grTask = new GlideRecord('task');
grTask.addQuery('assigned_to', userId);  // pass sys_id directly
grTask.query();
```

## Existence Checks

**Always** use `setLimit(1)` for existence checks. Never fetch all records to check if one exists.

```javascript
// CORRECT -- efficient existence check
function recordExists(table, field, value) {
    var gr = new GlideRecord(table);
    gr.addQuery(field, value);
    gr.setLimit(1);
    gr.query();
    return gr.hasNext();
}

// ALSO CORRECT -- get the record if it exists
var gr = new GlideRecord('sys_user');
if (gr.get('user_name', 'admin')) {
    // gr is now populated with the record
    var name = gr.getValue('name');
}

// WRONG -- fetches ALL matching records
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.query();
if (gr.next()) {  // loaded entire result set just to check existence
    // ...
}
```

## GlideAggregate (Counts, Sums, Averages)

**Always** use GlideAggregate for counting and math. Never loop-count with GlideRecord.

```javascript
// CORRECT -- count with GlideAggregate
var ga = new GlideAggregate('incident');
ga.addQuery('active', true);
ga.addAggregate('COUNT');
ga.query();
if (ga.next()) {
    var count = parseInt(ga.getAggregate('COUNT'));
}

// CORRECT -- count grouped by field
var ga = new GlideAggregate('incident');
ga.addQuery('active', true);
ga.addAggregate('COUNT');
ga.groupBy('priority');
ga.query();
while (ga.next()) {
    var priority = ga.getValue('priority');
    var count = parseInt(ga.getAggregate('COUNT'));
    gs.info('Priority {0}: {1} incidents', priority, count);
}

// CORRECT -- average
var ga = new GlideAggregate('incident');
ga.addAggregate('AVG', 'reassignment_count');
ga.query();
if (ga.next()) {
    var avgReassign = ga.getAggregate('AVG', 'reassignment_count');
}

// WRONG -- loop counting
var gr = new GlideRecord('incident');
gr.addQuery('active', true);
gr.query();
var count = 0;
while (gr.next()) {
    count++;  // WRONG: use GlideAggregate instead
}
```

## GlideRecord in Loops -- The #1 Anti-Pattern

**Never** put a GlideRecord query inside a loop. This is the most common performance killer.

```javascript
// WRONG -- GlideRecord inside loop (N+1 query problem)
var grInc = new GlideRecord('incident');
grInc.addQuery('active', true);
grInc.query();
while (grInc.next()) {
    var grUser = new GlideRecord('sys_user');  // QUERY IN LOOP!
    grUser.get(grInc.getValue('assigned_to'));
    // ...
}

// CORRECT -- batch query, then lookup
var userMap = {};
var grInc = new GlideRecord('incident');
grInc.addQuery('active', true);
grInc.query();

// Collect unique user sys_ids
var userIds = [];
while (grInc.next()) {
    var userId = grInc.getValue('assigned_to');
    if (userId && userIds.indexOf(userId) === -1) {
        userIds.push(userId);
    }
}

// Single batch query for all users
if (userIds.length > 0) {
    var grUser = new GlideRecord('sys_user');
    grUser.addQuery('sys_id', 'IN', userIds.join(','));
    grUser.query();
    while (grUser.next()) {
        userMap[grUser.getUniqueValue()] = grUser.getValue('name');
    }
}

// Now use the map for lookups (no queries)
grInc = new GlideRecord('incident');
grInc.addQuery('active', true);
grInc.query();
while (grInc.next()) {
    var userName = userMap[grInc.getValue('assigned_to')] || 'Unassigned';
}
```

## Factory Methods (Prefer Over Manual Conditions)

```javascript
gr.addActiveQuery();                    // instead of addQuery('active', true)
gr.addNotNullQuery('assigned_to');      // instead of addQuery('assigned_to', '!=', '')
gr.addNullQuery('closed_at');           // instead of encoded query ISempty
gr.addJoinQuery('sys_user_grmember', 'assigned_to', 'user');  // join queries
```

## Update/Insert/Delete Patterns

```javascript
// Update
var gr = new GlideRecord('incident');
if (gr.get(sysId)) {
    gr.setValue('state', '6');
    gr.update();
}

// Insert
var gr = new GlideRecord('incident');
gr.initialize();
gr.setValue('short_description', 'New incident');
gr.setValue('urgency', '2');
var newSysId = gr.insert();

// Delete single record
var gr = new GlideRecord('incident');
if (gr.get(sysId)) {
    gr.deleteRecord();
}

// Delete multiple (careful!)
var gr = new GlideRecord('temp_table');
gr.addQuery('active', false);
gr.deleteMultiple();  // no query() + next() needed
```

## Performance Tips

1. **Select only needed fields** with `setFields()` or `chooseWindowQuery()` for large datasets
2. **Use `setLimit()`** whenever you don't need all records
3. **Use `setWorkflow(false)`** to skip Business Rules during bulk updates (use with extreme caution)
4. **Use `autoSysFields(false)`** to prevent updating sys_updated_on/sys_updated_by during programmatic updates
5. **Use `addEncodedQuery()`** for complex conditions -- it's parsed by the database engine, not JavaScript
6. **Index your query fields** -- if you're querying a field frequently, ensure it has a database index
