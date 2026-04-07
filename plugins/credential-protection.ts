import type { Plugin } from "@opencode-ai/plugin";

/**
 * General-Purpose Credential Protection Plugin
 *
 * Prevents accidental credential exposure across all tools by:
 * 1. Blocking file writes/edits containing hardcoded credentials
 * 2. Blocking bash commands that contain credentials or stage sensitive files
 * 3. Warning when reading sensitive files or using broad git add
 * 4. Filtering false positives (placeholders, comments, env references)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CredentialPattern {
  category: string;
  pattern: RegExp;
  description: string;
}

// ---------------------------------------------------------------------------
// Constants - Credential patterns (5 categories, all case-insensitive)
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
// Constants - False positive indicators
// ---------------------------------------------------------------------------

const PLACEHOLDER_INDICATORS: string[] = [
  "your-api-key",
  "your_api_key",
  "YOUR_API_KEY",
  "xxx",
  "XXX",
  "changeme",
  "CHANGEME",
  "TODO",
  "PLACEHOLDER",
  "EXAMPLE",
  "SAMPLE",
  "<TOKEN>",
  "<SECRET>",
  "<PASSWORD>",
  "<API_KEY>",
  "${",
  "process.env.",
  "os.environ",
  "System.getenv",
  "import.meta.env.",
];

const COMMENT_LINE_PATTERN: RegExp = /^\s*(#|\/\/|--|\/\*|\*)/;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

function isCommentLine(line: string): boolean {
  return COMMENT_LINE_PATTERN.test(line);
}

function containsPlaceholder(text: string): boolean {
  const lowerText = text.toLowerCase();
  return PLACEHOLDER_INDICATORS.some((indicator) =>
    lowerText.includes(indicator.toLowerCase()),
  );
}

function extractLineContaining(
  content: string,
  matchIndex: number,
): string {
  const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
  const lineEnd = content.indexOf("\n", matchIndex);
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
}

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

export const CredentialProtection: Plugin = async ({ client }) => {
  const log = (level: "info" | "warn" | "error", message: string) =>
    client.app.log({
      body: { service: "credential-protection", level, message },
    });

  async function blockCredential(
    operation: string,
    credential: { category: string; description: string },
  ): Promise<never> {
    const msg =
      `[credential-protection] BLOCKED: ${credential.category} detected in ${operation} operation.\n` +
      `Pattern matched: ${credential.description}\n` +
      `If this is a false positive, use a placeholder value like 'your-api-key-here' or reference an environment variable.`;
    await log("error", msg);
    throw new Error(msg);
  }

  await log("info", "Credential protection plugin loaded and active.");

  return {
    "tool.execute.before": async (input: {
      tool: string;
      args?: Record<string, unknown>;
    }) => {
      const toolName = input.tool;

      // --- write/edit tool: scan content for credentials ---
      if (toolName === "write" || toolName === "edit") {
        const text = String(
          input.args?.content || input.args?.newString || "",
        );
        if (!text) return;

        const credential = scanForCredentials(text);
        if (credential) await blockCredential(toolName, credential);
        return;
      }

      // --- bash tool: scan command + check git add ---
      if (toolName === "bash") {
        const command = String(input.args?.command || "");
        if (!command) return;

        // Action A: Scan command for embedded credentials
        const credential = scanForCredentials(command);
        if (credential) {
          await blockCredential("bash", credential);
        }

        // Only check git add patterns if command contains "git add"
        if (!/git\s+add/.test(command)) return;

        // Action C: Warn on broad git add (check before Action B to avoid false block)
        if (/git\s+add\s+(\.|(-A|--all))/.test(command)) {
          await log(
            "warn",
            "[credential-protection] WARNING: Broad 'git add' detected. Verify no sensitive files are being staged.",
          );
          return;
        }

        // Action B: Block staging of sensitive files
        const commandParts = command.split(/\s+/);
        const gitAddIndex = commandParts.indexOf("add");
        if (gitAddIndex === -1) return;

        const filesToStage = commandParts.slice(gitAddIndex + 1);
        for (const file of filesToStage) {
          const cleaned = file.replace(/^["']|["']$/g, "");
          if (cleaned !== "--" && cleaned.startsWith("-")) continue;
          if (isSensitiveFile(cleaned)) {
            const msg = `[credential-protection] BLOCKED: Attempting to stage sensitive file '${cleaned}'.\nPattern matched: Sensitive file pattern\nIf this is a false positive, use a placeholder value like 'your-api-key-here' or reference an environment variable.`;
            await log("error", msg);
            throw new Error(msg);
          }
        }
        return;
      }

      // --- read tool: warn on sensitive file access ---
      if (toolName === "read") {
        const filePath = String(input.args?.filePath || "");
        if (!filePath) return;
        if (!isSensitiveFile(filePath)) return;

        await log(
          "warn",
          `[credential-protection] WARNING: Reading sensitive file: ${filePath}. Ensure no credentials are extracted and written to code.`,
        );
      }
    },
  };
};

export default CredentialProtection;
