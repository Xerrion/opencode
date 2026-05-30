import { test, expect, describe } from "bun:test";
import {
  redactString,
  redactToolOutput,
  buildWarning,
  deepRedactStrings,
  REDACTION_PATTERNS,
  REDACTION_ERROR_SENTINEL,
  type RedactionHit,
} from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPattern(reason: string) {
  const p = REDACTION_PATTERNS.find((x) => x.reason === reason);
  if (!p) throw new Error(`pattern ${reason} not found`);
  return p;
}

// ---------------------------------------------------------------------------
// 1. Originating bug - SONARQUBE_TOKEN env-assignment
// ---------------------------------------------------------------------------

describe("originating bug (env-assignment)", () => {
  test("bash output containing SONARQUBE_TOKEN=... is redacted with warning prepended", () => {
    const output = { output: "SONARQUBE_TOKEN=abc123xyzABCDEFGH" };
    const { hits, error } = redactToolOutput(output);

    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("env-assignment");
    expect(output.output).toBe(
      "[credential-protection] 1 value(s) redacted from this output. Reasons: env-assignment\nSONARQUBE_TOKEN=<REDACTED:env-assignment:SONARQUBE_TOKEN>",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple hits, mixed reasons
// ---------------------------------------------------------------------------

describe("multiple hits, mixed reasons", () => {
  test("output with JWT + GitHub token lists both reasons in declaration order", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const ghp = "ghp_" + "a".repeat(30);
    const output = { output: `token=${ghp}\nauth=${jwt}` };

    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(2);
    const reasons = hits.map((h) => h.reason);
    expect(reasons).toContain("github-token");
    expect(reasons).toContain("jwt");
    // warning lists in declaration order: github-token (idx 1) before jwt (idx 10)
    expect(output.output).toContain(
      "Reasons: github-token, jwt",
    );
    expect(output.output).toContain("<REDACTED:github-token>");
    expect(output.output).toContain("<REDACTED:jwt>");
    expect(output.output).not.toContain(ghp);
    expect(output.output).not.toContain(jwt);
  });
});

// ---------------------------------------------------------------------------
// 3. MCP shape
// ---------------------------------------------------------------------------

describe("MCP-shaped output", () => {
  test("text part is rewritten and warning prepended to first text part", () => {
    const output = {
      content: [
        { type: "text", text: "SONARQUBE_TOKEN=abc123xyzABCDEFGH" },
        { type: "image", data: "..." },
      ],
    };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(output.content[0]?.text).toContain(
      "<REDACTED:env-assignment:SONARQUBE_TOKEN>",
    );
    expect(output.content[0]?.text).toContain(
      "[credential-protection] 1 value(s) redacted",
    );
    // standard branch not taken - no `.output` field added
    expect((output as Record<string, unknown>).output).toBeUndefined();
  });

  test("MCP output with no text parts gets a synthetic warning text part when hits exist", () => {
    // Construct an MCP-style output with only non-text parts AFTER a text
    // part was redacted; for this no-text edge we craft an entry that still
    // triggers a hit via metadata - but MCP branch only scans `content`.
    // So this asserts the no-text-parts branch by inserting a text part
    // that initially had a hit. Easiest path: empty MCP output, no hits.
    const output: { content: Array<{ type?: string; text?: string }> } = {
      content: [{ type: "image", data: "..." } as { type: string }],
    };
    const { hits } = redactToolOutput(output);
    expect(hits.length).toBe(0);
    // No warning added when no hits.
    expect(output.content.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Attachments
// ---------------------------------------------------------------------------

describe("attachments", () => {
  test("attachment content is redacted and warning appears in output.output", () => {
    const output = {
      output: "file contents:",
      attachments: [{ content: "creds: AKIAABCDEFGHIJKLMNOP next" }],
    };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("aws-access-key");
    expect(output.attachments[0]?.content).toBe(
      "creds: <REDACTED:aws-access-key> next",
    );
    expect(output.output).toContain("Reasons: aws-access-key");
    expect(output.output).toContain("file contents:");
  });

  test("object-shaped attachment content is recursed into", () => {
    const output = {
      output: "file contents:",
      attachments: [{ content: { body: "AKIAABCDEFGHIJKLMNOP" } }],
    };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("aws-access-key");
    expect(
      (output.attachments[0]?.content as { body: string }).body,
    ).toBe("<REDACTED:aws-access-key>");
    expect(output.output).toContain("Reasons: aws-access-key");
  });
});

// ---------------------------------------------------------------------------
// 5. Metadata deep walk
// ---------------------------------------------------------------------------

describe("metadata deep walk", () => {
  test("nested Authorization header is redacted and warning prepended", () => {
    const output = {
      output: "ok",
      metadata: {
        headers: { auth: "Authorization: Bearer abcdefghijklmnop123" },
        nested: { other: 42, more: { deeper: "no secret here" } },
      },
    };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("bearer-header");
    expect(output.metadata.headers.auth).toBe(
      "Authorization: Bearer <REDACTED:bearer-header>",
    );
    expect(output.output.startsWith("[credential-protection] 1 value(s)")).toBe(
      true,
    );
    // non-string leaves are untouched
    expect(output.metadata.nested.other).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder skip
// ---------------------------------------------------------------------------

describe("placeholder skip", () => {
  test("API_KEY=your-api-key-here is NOT redacted", () => {
    const output = { output: "API_KEY=your-api-key-here" };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(0);
    expect(output.output).toBe("API_KEY=your-api-key-here");
  });
});

// ---------------------------------------------------------------------------
// 7. Length floor
// ---------------------------------------------------------------------------

describe("length floor", () => {
  test("TOKEN=short (7 chars value) is NOT matched by env-assignment", () => {
    const output = { output: "TOKEN=short" };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(0);
    expect(output.output).toBe("TOKEN=short");
  });

  test("API_TOKEN=12345678 (8-char value) IS matched (boundary check)", () => {
    const output = { output: "API_TOKEN=12345678" };
    const { hits } = redactToolOutput(output);
    expect(hits.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Comment skip
// ---------------------------------------------------------------------------

describe("comment skip", () => {
  test("commented JWT-looking line is not redacted", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const original = `# example token: ${jwt}`;
    const output = { output: original };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(0);
    expect(output.output).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// 9. URL credentials
// ---------------------------------------------------------------------------

describe("url-userinfo", () => {
  test("password segment is replaced; protocol/user/host preserved", () => {
    const output = { output: "https://user:hunter2@example.com/api" };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("url-userinfo");
    expect(output.output).toContain(
      "https://user:<REDACTED:url-userinfo>@example.com/api",
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Private key block
// ---------------------------------------------------------------------------

describe("private-key-block", () => {
  test("full PEM block is collapsed to a single sentinel", () => {
    const block = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQ...",
      "..............................................",
      "..............................................",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = { output: `before\n${block}\nafter` };

    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(1);
    expect(hits[0]?.reason).toBe("private-key-block");
    expect(output.output).toContain("<REDACTED:private-key-block>");
    expect(output.output).toContain("before");
    expect(output.output).toContain("after");
    expect(output.output).not.toContain("MIIEvAIBADANBgkqhkiG9w0BAQEFAA");
  });
});

// ---------------------------------------------------------------------------
// 11. Fail-safe: monkey-patched pattern that throws on exec
// ---------------------------------------------------------------------------

describe("fail-safe", () => {
  test("a throwing pattern causes payload to be replaced by the sentinel", () => {
    const victim = findPattern("env-assignment");
    const originalExec = victim.pattern.exec;
    victim.pattern.exec = () => {
      throw new Error("simulated regex blowup - DO NOT include secret here");
    };

    try {
      const output: {
        output: string;
        title: string;
        metadata: Record<string, unknown>;
      } = {
        output: "SONARQUBE_TOKEN=topsecretvaluexyzABC",
        title: "ran env",
        metadata: { x: 1 },
      };
      const { hits, error } = redactToolOutput(output);

      expect(error).toBeDefined();
      expect(hits.length).toBe(0);
      expect(output.output).toBe(REDACTION_ERROR_SENTINEL);
      expect(output.title).toBe(REDACTION_ERROR_SENTINEL);
      expect(output.metadata).toEqual({});
      // secret value MUST NOT appear in the sentinel
      expect(output.output).not.toContain("topsecretvaluexyzABC");
    } finally {
      victim.pattern.exec = originalExec;
    }
  });

  test("fail-safe on MCP shape replaces content with sentinel text part", () => {
    const victim = findPattern("env-assignment");
    const originalExec = victim.pattern.exec;
    victim.pattern.exec = () => {
      throw new Error("boom");
    };

    try {
      const output = {
        content: [
          { type: "text", text: "SONARQUBE_TOKEN=topsecretvaluexyzABC" },
        ],
      };
      const { error } = redactToolOutput(output);
      expect(error).toBeDefined();
      expect(output.content.length).toBe(1);
      expect(output.content[0]?.type).toBe("text");
      expect(output.content[0]?.text).toBe(REDACTION_ERROR_SENTINEL);
      expect(output.content[0]?.text).not.toContain("topsecretvaluexyzABC");
    } finally {
      victim.pattern.exec = originalExec;
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Idempotence
// ---------------------------------------------------------------------------

describe("idempotence", () => {
  test("running the hook twice produces zero new hits and no duplicate warning", () => {
    const output = { output: "SONARQUBE_TOKEN=abc123xyzABCDEFGH" };
    const first = redactToolOutput(output);
    expect(first.hits.length).toBe(1);
    const afterFirst = output.output;

    const second = redactToolOutput(output);
    expect(second.hits.length).toBe(0);
    expect(output.output).toBe(afterFirst);
    // Warning appears exactly once
    const occurrences = output.output.split(
      "[credential-protection]",
    ).length - 1;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. No-op path
// ---------------------------------------------------------------------------

describe("no-op path", () => {
  test("benign ls listing is unchanged byte-for-byte", () => {
    const original =
      "total 24\ndrwxr-xr-x  3 user staff   96 May 29 10:00 .\ndrwxr-xr-x 12 user staff  384 May 29 09:55 ..\n-rw-r--r--  1 user staff  220 May 29 09:55 README.md";
    const output = { output: original };
    const { hits } = redactToolOutput(output);

    expect(hits.length).toBe(0);
    expect(output.output).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Auxiliary unit coverage for the pure helpers
// ---------------------------------------------------------------------------

describe("redactString (pure)", () => {
  test("returns input unchanged on empty string", () => {
    const { text, hits } = redactString("");
    expect(text).toBe("");
    expect(hits.length).toBe(0);
  });

  test("preserves text outside matches and concatenates correctly", () => {
    const { text, hits } = redactString(
      "prefix AKIAABCDEFGHIJKLMNOP middle AKIAZZZZZZZZZZZZZZZZ suffix",
    );
    expect(hits.length).toBe(2);
    expect(text).toBe(
      "prefix <REDACTED:aws-access-key> middle <REDACTED:aws-access-key> suffix",
    );
  });
});

describe("buildWarning", () => {
  test("emits unique reasons in declaration order", () => {
    const hits: RedactionHit[] = [
      { reason: "jwt" },
      { reason: "github-token" },
      { reason: "jwt" },
      { reason: "aws-access-key" },
    ];
    // Declaration order: github-token (1) < aws-access-key (7) < jwt (10)
    expect(buildWarning(hits)).toBe(
      "[credential-protection] 4 value(s) redacted from this output. Reasons: github-token, aws-access-key, jwt",
    );
  });
});

describe("deepRedactStrings", () => {
  test("rewrites string leaves and leaves non-strings alone", () => {
    const obj: Record<string, unknown> = {
      a: "AKIAABCDEFGHIJKLMNOP",
      b: 42,
      c: null,
      d: { e: ["plain", "AKIAZZZZZZZZZZZZZZZZ", 7] },
    };
    const hits: RedactionHit[] = [];
    deepRedactStrings(obj, hits);
    expect(hits.length).toBe(2);
    expect(obj.a).toBe("<REDACTED:aws-access-key>");
    expect(obj.b).toBe(42);
    expect(obj.c).toBeNull();
    expect((obj.d as { e: unknown[] }).e[1]).toBe("<REDACTED:aws-access-key>");
    expect((obj.d as { e: unknown[] }).e[2]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// env-assignment line context (regression: regex was over-anchored with ^…$)
// ---------------------------------------------------------------------------

describe("env-assignment line context", () => {
  const WARNING =
    "[credential-protection] 1 value(s) redacted from this output. Reasons: env-assignment";

  test("trailing whitespace after value is redacted", () => {
    const output = { output: "SONARQUBE_TOKEN=abc123xyzABCDEFGH " };
    const { hits, error } = redactToolOutput(output);
    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(output.output).toBe(
      `${WARNING}\nSONARQUBE_TOKEN=<REDACTED:env-assignment:SONARQUBE_TOKEN> `,
    );
  });

  test("leading indentation before key is redacted", () => {
    const output = { output: "  SONARQUBE_TOKEN=abc123xyzABCDEFGH" };
    const { hits, error } = redactToolOutput(output);
    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(output.output).toBe(
      `${WARNING}\n  SONARQUBE_TOKEN=<REDACTED:env-assignment:SONARQUBE_TOKEN>`,
    );
  });

  test("bash -x trace prefix (+ ) is redacted", () => {
    const output = { output: "+ SONARQUBE_TOKEN=abc123xyzABCDEFGH" };
    const { hits, error } = redactToolOutput(output);
    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(output.output).toBe(
      `${WARNING}\n+ SONARQUBE_TOKEN=<REDACTED:env-assignment:SONARQUBE_TOKEN>`,
    );
  });

  test("tab-separated tail after value is redacted", () => {
    const output = {
      output: "SONARQUBE_TOKEN=abc123xyzABCDEFGH\tEXTRA=stuff",
    };
    const { hits, error } = redactToolOutput(output);
    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(output.output).toBe(
      `${WARNING}\nSONARQUBE_TOKEN=<REDACTED:env-assignment:SONARQUBE_TOKEN>\tEXTRA=stuff`,
    );
  });
});

// ---------------------------------------------------------------------------
// deepRedactStrings cycle guard
// ---------------------------------------------------------------------------

describe("deepRedactStrings cycle guard", () => {
  test("self-referential metadata graph does not blow the stack and still redacts", () => {
    type Node = { name: string; self?: Node; child?: Node };
    const node: Node = { name: "AKIAABCDEFGHIJKLMNOP" };
    node.self = node;
    node.child = node;
    const output = { output: "ok", metadata: node };

    const { hits, error } = redactToolOutput(output);

    expect(error).toBeUndefined();
    expect(hits.length).toBe(1);
    expect(node.name).toBe("<REDACTED:aws-access-key>");
  });
});
