/**
 * Credential Redaction Library
 *
 * Pure, runtime-free redaction logic extracted from the
 * `credential-protection` opencode plugin.
 *
 * This module has ZERO dependency on `@opencode-ai/plugin` or any opencode
 * runtime symbol so that it can be unit-tested in isolation and reused.
 * The plugin file (`credential-protection.ts`) imports from here; this
 * module never imports from there (Strict Layer Direction).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Output-side redaction pattern. */
export interface RedactionPattern {
  /** Stable identifier used in warning aggregation. */
  reason: string;
  /** Regex with the `g` flag (and `m`/`i`/`s` as needed). */
  pattern: RegExp;
  /** Build the inline replacement substring from the exec match. */
  buildReplacement: (m: RegExpExecArray) => string;
}

export interface RedactionHit {
  reason: string;
}

// ---------------------------------------------------------------------------
// Comment / placeholder filters (shared with input-side scanner)
// ---------------------------------------------------------------------------

/**
 * `--(?!-)` distinguishes a SQL line-comment (`-- foo`) from PEM block
 * delimiters (`-----BEGIN PRIVATE KEY-----`). Without the lookahead the
 * comment-skip filter would falsely treat every PEM line as a comment and
 * pass private-key blocks straight through both hooks.
 */
export const COMMENT_LINE_PATTERN: RegExp = /^\s*(#|\/\/|--(?!-)|\/\*|\*)/;

export const PLACEHOLDER_INDICATORS: string[] = [
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
  // The redactor's own sentinel marker. Listing it here makes redaction
  // idempotent: a string already containing `<REDACTED:` is skipped on
  // re-scan, so re-running the after-hook produces zero new hits.
  "<REDACTED:",
];

export function isCommentLine(line: string): boolean {
  return COMMENT_LINE_PATTERN.test(line);
}

export function containsPlaceholder(text: string): boolean {
  const lowerText = text.toLowerCase();
  return PLACEHOLDER_INDICATORS.some((indicator) =>
    lowerText.includes(indicator.toLowerCase()),
  );
}

export function extractLineContaining(
  content: string,
  matchIndex: number,
): string {
  const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
  const lineEnd = content.indexOf("\n", matchIndex);
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
}

// ---------------------------------------------------------------------------
// Output-side redaction pattern catalog
// ---------------------------------------------------------------------------

// Declaration order is load-bearing: it determines the order in which patterns
// run AND the order in which reasons appear in the prepended warning line.
//
// Patterns assume ASCII input and do not NFKC-normalize. An attacker emitting
// Cyrillic-A or similar homoglyphs can defeat the character classes. This is
// a universal regex-detector limitation and out of scope for this layer.
export const REDACTION_PATTERNS: RedactionPattern[] = [
  {
    reason: "env-assignment",
    // Leading delimiter class includes `+` to cover `bash -x` traces
    // (`+ KEY=value`). The class is consumed into m[0], so buildReplacement
    // re-emits it via m[0].slice(0, eqIdx). Trailing lookahead allows
    // whitespace, end-of-line, or shell separators after the value so the
    // pattern catches tab-tailed and indented bash output, not just
    // strict line-anchored shapes.
    pattern:
      /(?:^|[\s;|&(+])\s*(?:export\s+)?([A-Z][A-Z0-9_]*?(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE_KEY|API_KEY|ACCESS_KEY|AUTH))=(\S{8,})(?=\s|$|[;&|])/gim,
    buildReplacement: (m) => {
      const eqIdx = m[0].indexOf("=");
      const lhs = m[0].slice(0, eqIdx);
      return `${lhs}=<REDACTED:env-assignment:${m[1]}>`;
    },
  },
  {
    reason: "github-token",
    pattern: /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}\b/g,
    buildReplacement: () => "<REDACTED:github-token>",
  },
  {
    reason: "github-pat",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    buildReplacement: () => "<REDACTED:github-pat>",
  },
  {
    reason: "openai-anthropic-key",
    pattern: /\bsk-[A-Za-z0-9_\-]{20,}\b/g,
    buildReplacement: () => "<REDACTED:openai-anthropic-key>",
  },
  {
    reason: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    buildReplacement: () => "<REDACTED:slack-token>",
  },
  {
    reason: "gitlab-pat",
    pattern: /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,
    buildReplacement: () => "<REDACTED:gitlab-pat>",
  },
  {
    reason: "sonarqube-token",
    pattern: /\b(?:squ_|sqp_|sqa_)[A-Za-z0-9]{20,}\b/g,
    buildReplacement: () => "<REDACTED:sonarqube-token>",
  },
  {
    reason: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    buildReplacement: () => "<REDACTED:aws-access-key>",
  },
  {
    reason: "aws-session-key",
    pattern: /\bASIA[0-9A-Z]{16}\b/g,
    buildReplacement: () => "<REDACTED:aws-session-key>",
  },
  {
    reason: "stripe-key",
    pattern: /\b(?:sk_live_|rk_live_|sk_test_|rk_test_)[A-Za-z0-9]{20,}\b/g,
    buildReplacement: () => "<REDACTED:stripe-key>",
  },
  {
    reason: "jwt",
    pattern:
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    buildReplacement: () => "<REDACTED:jwt>",
  },
  {
    reason: "bearer-header",
    pattern: /\b(Authorization:\s*Bearer\s+)([A-Za-z0-9_\-.=]{10,})/gi,
    buildReplacement: (m) => `${m[1]}<REDACTED:bearer-header>`,
  },
  {
    reason: "basic-header",
    pattern: /\b(Authorization:\s*Basic\s+)([A-Za-z0-9+/=]{8,})/gi,
    buildReplacement: (m) => `${m[1]}<REDACTED:basic-header>`,
  },
  {
    reason: "url-userinfo",
    pattern: /\b([a-z][a-z0-9+\-.]*):\/\/([^\s:/?#@]+):([^\s@/?#]+)@/gi,
    buildReplacement: (m) => `${m[1]}://${m[2]}:<REDACTED:url-userinfo>@`,
  },
  {
    reason: "private-key-block",
    pattern:
      /-----BEGIN\s+(?:[A-Z ]+\s+)?PRIVATE\s+KEY(?:\s+BLOCK)?-----[\s\S]*?-----END\s+(?:[A-Z ]+\s+)?PRIVATE\s+KEY(?:\s+BLOCK)?-----/g,
    buildReplacement: () => "<REDACTED:private-key-block>",
  },
];

// ---------------------------------------------------------------------------
// Output-side pure functions
// ---------------------------------------------------------------------------

/**
 * Apply one pattern across `text`, mutating `hits` with one entry per
 * accepted replacement. Matches falling on comment lines or containing a
 * placeholder indicator are passed through unchanged.
 *
 * Uses `pattern.exec` in a loop (rather than `String.matchAll`) so the
 * fail-safe test can monkey-patch `.exec` and observe the hook's catch.
 */
export function applyPattern(
  text: string,
  p: RedactionPattern,
  hits: RedactionHit[],
): string {
  if (!p.pattern.global) {
    throw new Error(
      `[credential-protection] pattern ${p.reason} is missing /g flag`,
    );
  }
  p.pattern.lastIndex = 0;
  let result = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = p.pattern.exec(text)) !== null) {
    const matched = m[0];
    // Future-proofing: no current pattern produces a zero-width match, but
    // if one ever does, advancing lastIndex prevents an infinite loop. The
    // guard is cheap; do not remove it as dead code.
    if (matched.length === 0) {
      p.pattern.lastIndex++;
      continue;
    }
    const line = extractLineContaining(text, m.index);
    if (isCommentLine(line) || containsPlaceholder(matched)) {
      continue;
    }
    const replacement = p.buildReplacement(m);
    result += text.slice(cursor, m.index) + replacement;
    cursor = m.index + matched.length;
    hits.push({ reason: p.reason });
  }
  p.pattern.lastIndex = 0;
  return cursor === 0 ? text : result + text.slice(cursor);
}

/**
 * Scrub credential-shaped substrings from `s`, returning the rewritten text
 * and the hit list. Patterns are applied in declaration order.
 *
 * No size cap on input: the tool already paid the memory cost to produce
 * this string, and every pattern runs in linear time with no
 * catastrophic-backtracking shape. The redactor is a best-effort
 * post-processor, not a DoS surface.
 */
export function redactString(s: string): { text: string; hits: RedactionHit[] } {
  if (typeof s !== "string" || s.length === 0) {
    return { text: s, hits: [] };
  }
  const hits: RedactionHit[] = [];
  let current = s;
  for (const p of REDACTION_PATTERNS) {
    current = applyPattern(current, p, hits);
  }
  return { text: current, hits };
}

/**
 * Recursively rewrite every string leaf of `obj` in place, accumulating
 * hits. Non-string leaves are left untouched (Parse-Don't-Validate: we do
 * not coerce types we did not produce).
 */
export function deepRedactStrings(
  obj: unknown,
  hits: RedactionHit[],
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (!obj || typeof obj !== "object") return;
  if (seen.has(obj as object)) return;
  seen.add(obj as object);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (typeof v === "string") {
        const r = redactString(v);
        obj[i] = r.text;
        hits.push(...r.hits);
      } else if (v && typeof v === "object") {
        deepRedactStrings(v, hits, seen);
      }
    }
    return;
  }
  const record = obj as Record<string, unknown>;
  for (const k of Object.keys(record)) {
    const v = record[k];
    if (typeof v === "string") {
      const r = redactString(v);
      record[k] = r.text;
      hits.push(...r.hits);
    } else if (v && typeof v === "object") {
      deepRedactStrings(v, hits, seen);
    }
  }
}

/**
 * Build the human-visible warning line. Reasons are de-duplicated and
 * emitted in pattern-declaration order (stable, audit-friendly).
 */
export function buildWarning(hits: RedactionHit[]): string {
  const present = new Set(hits.map((h) => h.reason));
  const ordered: string[] = [];
  for (const p of REDACTION_PATTERNS) {
    if (present.has(p.reason)) ordered.push(p.reason);
  }
  return `[credential-protection] ${hits.length} value(s) redacted from this output. Reasons: ${ordered.join(", ")}`;
}

/** Fixed sentinel used when the after-hook itself throws. */
export const REDACTION_ERROR_SENTINEL =
  "[credential-protection] ERROR during redaction; output suppressed as a precaution.";

// ---------------------------------------------------------------------------
// MCP-shape duck-typing (the TS type lies about the runtime payload)
// ---------------------------------------------------------------------------

interface McpContentPart {
  type?: string;
  text?: string;
}

export interface McpShapedOutput {
  content: McpContentPart[];
}

export function isMcpShape(output: unknown): output is McpShapedOutput {
  // MCP tools take a different runtime path and pass
  // `{ content: Array<{ type, text? }> }` as the second hook argument,
  // even though the TS type declares `{ title, output, metadata }`.
  // Single duck-type guard at the boundary, single cast.
  return (
    !!output &&
    typeof output === "object" &&
    Array.isArray((output as { content?: unknown }).content)
  );
}

/**
 * Prepend the warning line to the first text part of an MCP-shaped output;
 * if no text part exists, insert one at the head.
 */
function prependWarningToMcp(
  output: McpShapedOutput,
  hits: RedactionHit[],
): void {
  const warning = buildWarning(hits);
  const firstText = output.content.find(
    (p) => p?.type === "text" && typeof p.text === "string",
  );
  if (firstText) {
    firstText.text = `${warning}\n${firstText.text ?? ""}`;
    return;
  }
  output.content.unshift({ type: "text", text: warning });
}

// ---------------------------------------------------------------------------
// Standard-shape redaction (output, title, attachments, metadata)
// ---------------------------------------------------------------------------

export interface StandardOutput {
  title?: string;
  output?: string;
  metadata?: unknown;
  // `attachments` is present at runtime on file-reading tools but is not
  // in the declared TS type. Same duck-typing posture as MCP.
  attachments?: Array<{ content?: unknown }>;
}

/**
 * Redact a single string-typed field on `obj` in place. No-op when the
 * field is missing or not a string; non-string shapes are handled by the
 * caller (see attachment branch below for the object-recursion case).
 */
function redactStringField<T extends Record<string, unknown>>(
  obj: T,
  key: keyof T & string,
  hits: RedactionHit[],
): void {
  const v = obj[key];
  if (typeof v !== "string") return;
  const r = redactString(v);
  (obj as Record<string, unknown>)[key] = r.text;
  hits.push(...r.hits);
}

function redactStandardOutput(
  output: StandardOutput,
  hits: RedactionHit[],
): void {
  redactStringField(output as Record<string, unknown>, "output", hits);
  redactStringField(output as Record<string, unknown>, "title", hits);
  if (Array.isArray(output.attachments)) {
    for (const att of output.attachments) {
      if (!att) continue;
      if (typeof att.content === "string") {
        redactStringField(att as Record<string, unknown>, "content", hits);
      } else if (att.content && typeof att.content === "object") {
        // Attachment content may be a structured payload (e.g. parsed JSON,
        // arrays of parts). Recurse so secrets nested in object/array
        // attachments do not leak past the walker.
        deepRedactStrings(att.content, hits);
      }
    }
  }
  if (output.metadata && typeof output.metadata === "object") {
    deepRedactStrings(output.metadata, hits);
  }
}

/**
 * Orchestrate the after-hook redaction. Mutates `output` in place. Never
 * throws: on any internal exception, the user-visible payload is replaced
 * with `REDACTION_ERROR_SENTINEL`: throwing could echo the secret in an
 * error message.
 *
 * Returns the recorded hits so callers (the live hook and tests) can log
 * or assert. The caller is responsible for any side-effectful logging.
 */
export function redactToolOutput(output: unknown): {
  hits: RedactionHit[];
  error?: Error;
} {
  try {
    const hits: RedactionHit[] = [];

    if (isMcpShape(output)) {
      for (const part of output.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          const r = redactString(part.text);
          part.text = r.text;
          hits.push(...r.hits);
        }
      }
      if (hits.length > 0) prependWarningToMcp(output, hits);
      return { hits };
    }

    if (!output || typeof output !== "object") return { hits };

    // Standard tool shape with duck-typed attachments slot.
    const std = output as StandardOutput;
    redactStandardOutput(std, hits);
    if (hits.length > 0) {
      const warning = buildWarning(hits);
      const existing = typeof std.output === "string" ? std.output : "";
      // Synthesise output.output so the warning surfaces even when the tool
      // only emitted metadata/attachments. opencode treats output.output as
      // the canonical display string; missing it would silently swallow the warning.
      std.output = `${warning}\n${existing}`;
    }
    return { hits };
  } catch (err) {
    // Fail-safe: suppress payload, never propagate.
    const error = err instanceof Error ? err : new Error(String(err));
    if (isMcpShape(output)) {
      output.content.length = 0;
      output.content.push({ type: "text", text: REDACTION_ERROR_SENTINEL });
    } else if (output && typeof output === "object") {
      const std = output as StandardOutput;
      std.output = REDACTION_ERROR_SENTINEL;
      if (typeof std.title === "string") std.title = REDACTION_ERROR_SENTINEL;
      std.metadata = {};
    }
    return { hits: [], error };
  }
}
