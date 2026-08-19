import { test, expect, describe } from "bun:test";
import { analyzeGitStaging } from "./git-staging";

describe("analyzeGitStaging", () => {
  test("returns null for commands that stage nothing", () => {
    expect(analyzeGitStaging("git status")).toBeNull();
    expect(analyzeGitStaging("echo add && ls")).toBeNull();
    expect(analyzeGitStaging("git log --grep add")).toBeNull();
  });

  test("plain git add with explicit path", () => {
    const result = analyzeGitStaging("git add src/main.ts");
    expect(result).toEqual({ hasBroadAdd: false, stagedPaths: ["src/main.ts"] });
  });

  test("bypass fix: git -C <dir> add is detected", () => {
    const result = analyzeGitStaging("git -C /repo add .env");
    expect(result?.stagedPaths).toEqual([".env"]);
  });

  test("bypass fix: git stage alias is detected", () => {
    const result = analyzeGitStaging("git stage .env");
    expect(result?.stagedPaths).toEqual([".env"]);
  });

  test("bypass fix: broad add in one segment does not mask paths in another", () => {
    const result = analyzeGitStaging("git add . && git add .env");
    expect(result?.hasBroadAdd).toBe(true);
    expect(result?.stagedPaths).toEqual([".env"]);
  });

  test("global flags with values are skipped, not treated as paths", () => {
    const result = analyzeGitStaging("git --no-pager -c user.name=x add creds.json");
    expect(result?.stagedPaths).toEqual(["creds.json"]);
  });

  test("broad add via -A and --all flags", () => {
    expect(analyzeGitStaging("git add -A")?.hasBroadAdd).toBe(true);
    expect(analyzeGitStaging("git add --all")?.hasBroadAdd).toBe(true);
    expect(analyzeGitStaging("git add .")?.hasBroadAdd).toBe(true);
  });

  test("paths after -- separator are collected even when dash-prefixed", () => {
    const result = analyzeGitStaging("git add -- -weird-file .env");
    expect(result?.stagedPaths).toEqual(["-weird-file", ".env"]);
  });

  test("quoted paths are unwrapped", () => {
    const result = analyzeGitStaging(`git add ".env"`);
    expect(result?.stagedPaths).toEqual([".env"]);
  });

  test("prior echo containing 'add' does not confuse token scanning", () => {
    const result = analyzeGitStaging("echo add && git add secrets/id_rsa");
    expect(result?.stagedPaths).toEqual(["secrets/id_rsa"]);
  });
});
