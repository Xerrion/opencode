import type { Plugin } from "@opencode-ai/plugin";

/**
 * ServiceNow Production Warning Plugin
 *
 * Blocks write operations against production ServiceNow instances.
 * Detects production environment via:
 * 1. SERVICENOW_ENV environment variable set to "production" or "prod"
 * 2. Instance URL patterns (no "-dev", "-test", "-sandbox", "-uat" suffix)
 *
 * Write operations that are blocked:
 * - record_create, record_update, record_delete, record_apply
 * - artifact_create, artifact_update
 * - incident_create, incident_update, incident_resolve
 * - change_create, change_update
 * - problem_create, problem_update, problem_root_cause
 * - request_item_update
 * - knowledge_create, knowledge_update
 * - dev_toggle, dev_set_property
 *
 * Preview operations (record_preview_*) are ALLOWED -- they're read-only.
 */

const WRITE_TOOLS = new Set([
  // Generic record CRUD
  "record_create",
  "record_update",
  "record_delete",
  "record_apply",
  // Artifact write
  "artifact_create",
  "artifact_update",
  // Incidents
  "incident_create",
  "incident_update",
  "incident_resolve",
  "incident_add_comment",
  // Changes
  "change_create",
  "change_update",
  "change_add_comment",
  // Problems
  "problem_create",
  "problem_update",
  "problem_root_cause",
  // Requests
  "request_item_update",
  // Knowledge
  "knowledge_create",
  "knowledge_update",
  "knowledge_feedback",
  // Developer utilities
  "dev_toggle",
  "dev_set_property",
]);

/** Subdomains that indicate non-production environments */
const NON_PROD_SUFFIXES = [
  "-dev",
  "-test",
  "-sandbox",
  "-uat",
  "-staging",
  "-qa",
  "-demo",
  "-training",
  "-lab",
];

function isProductionInstance(): { isProd: boolean; reason: string } {
  // Check explicit env var first
  const envFlag = (process.env.SERVICENOW_ENV || "").toLowerCase().trim();
  if (envFlag === "production" || envFlag === "prod") {
    return { isProd: true, reason: `SERVICENOW_ENV=${envFlag}` };
  }
  if (envFlag && envFlag !== "production" && envFlag !== "prod") {
    return {
      isProd: false,
      reason: `SERVICENOW_ENV=${envFlag} (non-production)`,
    };
  }

  // Infer from instance URL
  const instanceUrl = (
    process.env.SERVICENOW_INSTANCE_URL ||
    process.env.servicenow_instance_url ||
    ""
  ).toLowerCase();
  if (!instanceUrl) {
    // No URL available -- can't determine, default to safe (block)
    return { isProd: false, reason: "No instance URL detected" };
  }

  // Extract subdomain: https://mycompany.service-now.com -> mycompany
  const match = instanceUrl.match(/https?:\/\/([^.]+)\.service-now\.com/);
  if (!match) {
    return { isProd: false, reason: `Non-standard URL: ${instanceUrl}` };
  }

  const subdomain = match[1];
  const isNonProd = NON_PROD_SUFFIXES.some((suffix) =>
    subdomain.endsWith(suffix),
  );

  if (isNonProd) {
    return {
      isProd: false,
      reason: `Instance subdomain '${subdomain}' contains non-prod suffix`,
    };
  }

  return {
    isProd: true,
    reason: `Instance '${subdomain}' has no non-prod suffix (-dev, -test, -sandbox, etc.)`,
  };
}

export const SnProductionWarning: Plugin = async ({ client }) => {
  const log = (level: "info" | "warn" | "error", message: string) =>
    client.app.log({
      body: { service: "sn-production-warning", level, message },
    });

  // Check environment on plugin load
  const { isProd, reason } = isProductionInstance();
  if (isProd) {
    await log(
      "warn",
      `Production environment detected (${reason}). Write operations will be BLOCKED.`,
    );
  } else {
    await log(
      "info",
      `Non-production environment (${reason}). Write operations allowed.`,
    );
  }

  return {
    "tool.execute.before": async (input: {
      tool: string;
      args?: Record<string, unknown>;
    }) => {
      // Only intercept ServiceNow write tools
      if (!WRITE_TOOLS.has(input.tool)) return;

      // Re-check on each call (env might change between sessions)
      const check = isProductionInstance();
      if (!check.isProd) return;

      const msg = [
        `BLOCKED: Write operation '${input.tool}' on production instance.`,
        `Detection: ${check.reason}.`,
        `To proceed: Set SERVICENOW_ENV to your sub-prod environment name,`,
        `or use a non-production instance URL (e.g., mycompany-dev.service-now.com).`,
      ].join(" ");

      await log("error", msg);
      throw new Error(msg);
    },
  };
};

export default SnProductionWarning;
