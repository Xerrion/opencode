import type { Plugin } from "@opencode-ai/plugin";

/**
 * ServiceNow Credential Protection Plugin
 *
 * Prevents accidental exposure of ServiceNow credentials by:
 * 1. Blocking file writes that contain hardcoded instance URLs with credentials
 * 2. Blocking git add of .env / .env.local files
 * 3. Warning on writes containing common credential patterns
 */

const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /servicenow_password\s*=\s*["'][^"']+["']/i,
    label: "ServiceNow password",
  },
  {
    pattern: /servicenow_username\s*=\s*["'][^"']+["']/i,
    label: "ServiceNow username",
  },
  {
    pattern: /SERVICENOW_PASSWORD\s*=\s*\S+/i,
    label: "ServiceNow password env var",
  },
  {
    pattern: /https?:\/\/[^:]+:[^@]+@[^.]+\.service-now\.com/i,
    label: "ServiceNow URL with embedded credentials",
  },
  {
    pattern: /sn_password\s*[:=]\s*["'][^"']+["']/i,
    label: "SN password assignment",
  },
  {
    pattern: /glide\.servlet\.uri.*password/i,
    label: "Glide servlet credential",
  },
];

const ENV_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\.production$/,
  /^\.env\.\w+$/,
  /\/\.env$/,
  /\/\.env\.local$/,
  /\/\.env\.\w+$/,
];

function containsCredentials(content: string): string[] {
  const found: string[] = [];
  for (const { pattern, label } of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) {
      found.push(label);
    }
  }
  return found;
}

function isEnvFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() || "";
  return ENV_FILE_PATTERNS.some((p) => p.test(basename) || p.test(normalized));
}

export const SnCredentialProtection: Plugin = async ({ client }) => {
  const log = (level: "info" | "warn" | "error", message: string) =>
    client.app.log({
      body: { service: "sn-credential-protection", level, message },
    });

  return {
    "tool.execute.before": async (input: {
      tool: string;
      args?: Record<string, unknown>;
    }) => {
      // --- Block file writes containing credentials ---
      if (input.tool === "write" || input.tool === "edit") {
        const content = String(
          input.args?.content || input.args?.newString || "",
        );
        const filePath = String(input.args?.filePath || "");

        if (content) {
          const found = containsCredentials(content);
          if (found.length > 0) {
            const msg = `BLOCKED: File write to ${filePath} contains hardcoded credentials: ${found.join(", ")}. Use environment variables instead.`;
            await log("error", msg);
            throw new Error(msg);
          }
        }

        // Warn if writing to an env file (don't block -- env files are WHERE credentials belong)
        if (filePath && isEnvFile(filePath)) {
          await log(
            "warn",
            `Writing to env file: ${filePath} -- ensure this file is in .gitignore`,
          );
        }
      }

      // --- Block git add of env files ---
      if (input.tool === "bash") {
        const cmd = String(input.args?.command || "");

        // Check for git add with env files
        if (/git\s+add/.test(cmd)) {
          for (const pattern of ENV_FILE_PATTERNS) {
            if (pattern.test(cmd)) {
              const msg = `BLOCKED: Attempting to stage env file via '${cmd}'. Never commit .env files.`;
              await log("error", msg);
              throw new Error(msg);
            }
          }

          // Also catch "git add ." or "git add -A" which would include env files
          if (/git\s+add\s+(-A|--all|\.)/.test(cmd)) {
            await log(
              "warn",
              "Using 'git add .' or 'git add -A' -- verify .gitignore excludes .env files before proceeding",
            );
          }
        }
      }
    },
  };
};

export default SnCredentialProtection;
