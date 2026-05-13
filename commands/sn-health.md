---
description: Run all 7 ServiceNow investigation modules and summarize findings
agent: servicenow
---

# ServiceNow Health Check

Run a comprehensive health check across all investigation modules.

## Instructions

### Step 1: Run All Investigations (in parallel)

Execute ALL 7 investigation modules simultaneously:

1. `investigate_run(investigation="stale_automations")` — Disabled/unused BRs, flows, scheduled jobs
2. `investigate_run(investigation="deprecated_apis")` — Scripts using deprecated ServiceNow APIs
3. `investigate_run(investigation="table_health")` — Table size, index coverage, schema issues
4. `investigate_run(investigation="acl_conflicts")` — Conflicting or redundant ACL rules
5. `investigate_run(investigation="error_analysis")` — Recent errors from syslog
6. `investigate_run(investigation="slow_transactions")` — Slow-running transactions
7. `investigate_run(investigation="performance_bottlenecks")` — Performance issues across flows, queries, scripts

### Step 2: Triage Findings

For each investigation that returns findings:

1. Count the findings per module
2. Classify severity: **Critical** (immediate action needed), **Warning** (should address soon), **Info** (awareness only)
3. Sort by severity

### Step 3: Deep Dive on Critical Findings

For any **Critical** findings, automatically run `investigate_explain` to get detailed context and remediation steps.

### Step 4: Present Health Report

Format as a health dashboard:

```
## Instance Health Report

### Summary
| Module | Findings | Critical | Warning | Info |
|--------|----------|----------|---------|------|
| ...    | ...      | ...      | ...     | ...  |

### Critical Issues (Immediate Action Required)
<detailed findings with remediation>

### Warnings
<summary of warnings>

### Informational
<brief list>
```

Include specific remediation recommendations for each critical and warning finding.
