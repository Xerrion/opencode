import { Plugin } from "@opencode-ai/plugin";
import {
  containsPlaceholder,
  isCommentLine,
  extractLineContaining,
  redactToolOutput,
} from "./redaction";
import { analyzeGitStaging } from "./git-staging";

/**
 * General-Purpose Credential Protection Plugin
 *
 * Prevents accidental credential exposure across all tools by:
 * 1. Blocking file writes/edits containing hardcoded credentials
 * 2. Blocking bash commands that contain credentials or stage sensitive files
 * 3. Warning when reading sensitive files or using broad git add
 * 4. Filtering false positives (placeholders, comments, env references)
 * 5. Redacting credential-shaped strings from tool *output* before the LLM
 *    transcript captures them.
 *
 * Pure redaction logic lives in `./credential-redaction` so it can be
 * unit-tested without the opencode runtime. This file owns only the hook
 * wiring and the input-side scanner.
 */

// ---------------------------------------------------------------------------
// Types (input-side)
// ---------------------------------------------------------------------------

interface CredentialPattern {
  category: string;
  pattern: RegExp;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants - Credential patterns (input-side; preserved unchanged)
// ---------------------------------------------------------------------------

const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  // Category: Generic API Key/Token
  {
    category: "Generic API Key/Token",
    pattern:
      /(api[_-]?key|api[_-]?secret|secret[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/=_\-]{16,}["']/i,
    description: "API key or token assignment with value >= 16 characters",
  },
  {
    category: "Generic API Key/Token",
    pattern: /(password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i,
    description: "Password assignment with value >= 4 characters",
  },

  // Category: Cloud Provider Credential
  {
    category: "Cloud Provider Credential",
    pattern: /AKIA[0-9A-Z]{16}/,
    description: "AWS access key ID (AKIA prefix)",
  },
  {
    category: "Cloud Provider Credential",
    pattern:
      /(aws[_-]?secret[_-]?access[_-]?key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[A-Za-z0-9+/=]{30,}["']?/i,
    description: "AWS secret access key assignment",
  },
  {
    category: "Cloud Provider Credential",
    pattern:
      /(AZURE[_-]?CLIENT[_-]?SECRET|AZURE[_-]?TENANT[_-]?ID)\s*[:=]\s*["'][^"']+["']/i,
    description: "Azure client secret or tenant ID assignment",
  },
  {
    category: "Cloud Provider Credential",
    pattern:
      /(GCP[_-]?SERVICE[_-]?ACCOUNT[_-]?KEY|GCLOUD[_-]?SERVICE[_-]?KEY)\s*[:=]\s*["'][^"']+["']/i,
    description: "GCP service account key assignment",
  },

  // Category: Database Connection String
  {
    category: "Database Connection String",
    pattern:
      /(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp|mssql):\/\/[^:]+:[^@]+@/i,
    description: "Database URL with embedded credentials",
  },
  {
    category: "Database Connection String",
    pattern:
      /DATABASE[_-]?URL\s*[:=]\s*["']?(postgres|postgresql|mysql|mongodb|redis|amqp|mssql):\/\/[^:]+:[^@]+@/i,
    description: "DATABASE_URL assignment with embedded credentials",
  },

  // Category: Private Key
  {
    category: "Private Key",
    pattern: /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+|DSA\s+)?PRIVATE\s+KEY-----/,
    description: "SSH/TLS private key block",
  },
  {
    category: "Private Key",
    pattern: /-----BEGIN\s+PGP\s+PRIVATE\s+KEY\s+BLOCK-----/,
    description: "PGP private key block",
  },

  // Category: JWT/Bearer Token
  {
    category: "JWT/Bearer Token",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    description: "JWT token (base64-encoded header.payload)",
  },
  {
    category: "JWT/Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9_\-.]{20,}/i,
    description: "Bearer token value",
  },
];

// ---------------------------------------------------------------------------
// Constants - Sensitive file patterns
// ---------------------------------------------------------------------------

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.[a-zA-Z]+$/,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/,
  /(^|\/)credentials\.json$/,
  /(^|\/)service[_-]?account[^/]*\.json$/,
  /(^|\/)\.netrc$/,
  /(^|\/)\.pgpass$/,
  /(^|\/)\.my\.cnf$/,
  /(^|\/)tokens?\.json$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.pypirc$/,
];

// ---------------------------------------------------------------------------
// Input-side scanner
// ---------------------------------------------------------------------------
//
// Comment-line and placeholder filters are shared with the output redactor
// and live in `./credential-redaction` so both sides use the exact same
// rules (see the `--(?!-)` PEM/SQL-comment note on COMMENT_LINE_PATTERN).

function scanForCredentials(
  content: string,
): { category: string; description: string } | null {
  for (const { category, pattern, description } of CREDENTIAL_PATTERNS) {
    const match = pattern.exec(content);
    if (!match) continue;

    const fullLine = extractLineContaining(content, match.index);
    if (isCommentLine(fullLine)) continue;
    if (containsPlaceholder(match[0])) continue;

    return { category, description };
  }
  return null;
}

function isSensitiveFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const CredentialProtection = Plugin.define({
  id: "credential-protection",
  setup: async (context) => {
  function blockCredential(
    operation: string,
    credential: { category: string; description: string },
  ): never {
    const msg =
      `[credential-protection] BLOCKED: ${credential.category} detected in ${operation} operation.\n` +
      `Pattern matched: ${credential.description}\n` +
      `If this is a false positive, use a placeholder value like 'your-api-key-here' or reference an environment variable.`;
    console.error(msg);
    throw new Error(msg);
  }

  console.info("[credential-protection] plugin loaded and active");

  await context.tool.hook("execute.before", (event) => {
      const toolName = event.tool.toLowerCase();
      const args =
        event.input && typeof event.input === "object" && !Array.isArray(event.input)
          ? (event.input as Record<string, unknown>)
          : {};

      // --- write/edit/patch tools: scan new content for credentials ---
      // oldString is deliberately NOT scanned: edits that REMOVE a credential
      // must not be blocked.
      if (toolName === "write" || toolName === "edit" || toolName === "patch") {
        const text = [args.content, args.newString, args.diff, args.patchText]
          .filter((v): v is string => typeof v === "string")
          .join("\n");
        if (!text) return;

        const credential = scanForCredentials(text);
        if (credential) blockCredential(toolName, credential);
        return;
      }

      // --- bash tool: scan command + check git add ---
      if (toolName === "bash" || toolName === "shell") {
        const command = typeof args.command === "string" ? args.command : "";
        if (!command) return;

        // Action A: Scan command for embedded credentials
        const credential = scanForCredentials(command);
        if (credential) {
          blockCredential("shell", credential);
        }

        // Actions B & C: git staging policy. analyzeGitStaging handles
        // `git -C dir add`, the `git stage` alias, and chained commands, and
        // reports broad adds and explicit paths independently so a broad add
        // in one segment cannot mask a sensitive path staged in another.
        const staging = analyzeGitStaging(command);
        if (!staging) return;

        if (staging.hasBroadAdd) {
          console.warn(
            "[credential-protection] WARNING: Broad 'git add' detected. Verify no sensitive files are being staged.",
          );
        }

        for (const path of staging.stagedPaths) {
          if (isSensitiveFile(path)) {
            const msg = `[credential-protection] BLOCKED: Attempting to stage sensitive file '${path}'.\nPattern matched: Sensitive file pattern\nIf this file must be tracked, remove the credential content first and stage a sanitized version.`;
            console.error(msg);
            throw new Error(msg);
          }
        }
        return;
      }

      // --- read tool: warn on sensitive file access ---
      if (toolName === "read") {
        const filePath =
          typeof args.path === "string"
            ? args.path
            : typeof args.filePath === "string"
              ? args.filePath
              : "";
        if (!filePath) return;
        if (!isSensitiveFile(filePath)) return;

        console.warn(
          `[credential-protection] WARNING: Reading sensitive file: ${filePath}. Ensure no credentials are extracted and written to code.`,
        );
      }
    });

    await context.tool.hook("execute.after", (event) => {
      if (event.status === "error") return;

      const { hits, error } = redactToolOutput(event.result);

      if (error) {
        console.error("[credential-protection] redactor threw; payload suppressed");
        return;
      }

      if (hits.length === 0) return;

      const reasons = Array.from(new Set(hits.map((h) => h.reason)));
      console.warn(
        `[credential-protection] redacted ${hits.length} value(s) from ${event.tool}; reasons: ${reasons.join(", ")}`,
      );
    });
  },
});

export default CredentialProtection;
