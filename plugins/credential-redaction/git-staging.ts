// Pure analysis of shell commands for git staging operations, used by the
// credential-protection plugin to block staging of sensitive files. Kept free
// of opencode runtime imports so it is unit-testable (same policy as
// ./index.ts).
//
// Robustness goals (each was a bypass in the previous inline implementation):
// - `git -C <dir> add .env` and other global-flag forms are detected.
// - `git stage .env` (built-in alias for `add`) is detected.
// - Chained commands (`git add . && git add .env`) are analyzed per segment;
//   a broad add in one segment does not short-circuit checks on the rest.

export interface GitStagingAnalysis {
  /** True when any segment stages broadly (`.`, `*`, `-A`, `--all`). */
  hasBroadAdd: boolean;
  /** Explicit path tokens staged across all segments, quotes stripped. */
  stagedPaths: string[];
}

// Shell chain/pipe operators that separate independently-executed commands.
const SEGMENT_SPLIT = /&&|\|\||;|\|/;

// `git`, optional global flags (`-C <path>`, `-c <cfg>`, `--git-dir=...`,
// `--no-pager`, ...), then the staging subcommand. Matching is deliberately
// permissive: over-matching fails closed (a warning or block), never open.
const GIT_STAGING_PATTERN =
  /\bgit\b(?:\s+(?:-[cC]\s+\S+|--?[A-Za-z0-9][\w-]*(?:=\S+)?))*\s+(add|stage)\b/;

const BROAD_PATH_TOKENS = new Set([".", "./", "*"]);
const BROAD_FLAG_TOKENS = new Set(["-A", "--all", "--no-ignore-removal"]);

function stripQuotes(token: string): string {
  return token.replace(/^["']|["']$/g, "");
}

/**
 * Analyze a shell command for git staging operations.
 *
 * Returns null when the command stages nothing. Otherwise returns the broad
 * staging signal plus every explicit path token, so the caller can apply its
 * own sensitive-file policy.
 */
export function analyzeGitStaging(command: string): GitStagingAnalysis | null {
  let found = false;
  let hasBroadAdd = false;
  const stagedPaths: string[] = [];

  for (const segment of command.split(SEGMENT_SPLIT)) {
    const match = GIT_STAGING_PATTERN.exec(segment);
    if (!match || match.index === undefined) continue;
    found = true;

    const rest = segment.slice(match.index + match[0].length).trim();
    if (!rest) continue;

    let pathsOnly = false;
    for (const rawToken of rest.split(/\s+/)) {
      const token = stripQuotes(rawToken);
      if (!token) continue;

      if (!pathsOnly && token === "--") {
        pathsOnly = true;
        continue;
      }
      if (!pathsOnly && token.startsWith("-")) {
        if (BROAD_FLAG_TOKENS.has(token)) hasBroadAdd = true;
        continue;
      }
      if (BROAD_PATH_TOKENS.has(token)) {
        hasBroadAdd = true;
        continue;
      }
      stagedPaths.push(token);
    }
  }

  return found ? { hasBroadAdd, stagedPaths } : null;
}
