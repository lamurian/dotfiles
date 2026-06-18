/**
 * Tests for the orchestration engine.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runOrchestration, formatSummary, type OrchestrationSummary } from "../orchestrator.ts";

interface TempRepo {
  path: string;
  cleanup: () => void;
}

function createRepo(): TempRepo {
  const path = mkdtempSync("orchestrator-orch-test-");
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "t@t.com"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "T"', { cwd: path, stdio: "pipe" });
  execSync("git commit --allow-empty -m 'initial commit'", {
    cwd: path,
    stdio: "pipe",
  });
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

function mockCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    ui: {
      notify: () => {},
      setStatus: () => {},
    },
  } as unknown as ExtensionContext;
}

describe("runOrchestration", () => {
  let repo: TempRepo;
  let plansDir: string;

  before(() => {
    repo = createRepo();
    plansDir = join(repo.path, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
  });

  after(() => {
    repo.cleanup();
  });

  it("returns empty summary when no plan files exist", async () => {
    // An empty directory (no plan files)
    const emptyDir = mkdtempSync("orchestrator-empty-");
    const ctx = mockCtx(repo.path);

    const summary = await runOrchestration(emptyDir, ctx);

    assert.equal(summary.total, 0);
    assert.equal(summary.implemented, 0);
    assert.equal(summary.failed, 0);
    assert.deepEqual(summary.results, []);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("fails gracefully for a simple plan file when pi is not in PATH", async () => {
    // Write a plan file
    const planPath = join(plansDir, "001-test-task.md");
    writeFileSync(planPath, "# Test Task\n\n- [ ] Do something");
    const ctx = mockCtx(repo.path);

    // Temporarily remove pi from PATH
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-path";

    try {
      const summary = await runOrchestration(plansDir, ctx);

      assert.equal(summary.total, 1);
      assert.equal(summary.failed, 1);
      assert.equal(summary.results[0].success, false);
      assert.ok(
        summary.results[0].error?.length ?? 0 > 0,
        "should have an error message",
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe("formatSummary", () => {
  it("formats a successful summary", () => {
    const summary: OrchestrationSummary = {
      results: [
        { file: "001-auth.md", success: true },
        { file: "002-db.md", success: true },
      ],
      total: 2,
      implemented: 2,
      failed: 0,
    };

    const output = formatSummary(summary);
    assert.ok(output.includes("001-auth.md"));
    assert.ok(output.includes("002-db.md"));
    assert.ok(output.includes("Implemented: 2"));
    assert.ok(output.includes("Failed: 0"));
    assert.ok(!output.includes("stopped due to failure"));
  });

  it("formats a summary with failures", () => {
    const summary: OrchestrationSummary = {
      results: [
        { file: "001-auth.md", success: true },
        {
          file: "002-db.md",
          success: false,
          error: "Pi session exited with code 1",
          analysis: "Missing database driver",
        },
      ],
      total: 2,
      implemented: 1,
      failed: 1,
    };

    const output = formatSummary(summary);
    assert.ok(output.includes("❌"));
    assert.ok(output.includes("Missing database driver"));
    assert.ok(output.includes("stopped due to failure"));
  });

  it("formats an empty summary", () => {
    const summary: OrchestrationSummary = {
      results: [],
      total: 0,
      implemented: 0,
      failed: 0,
    };

    const output = formatSummary(summary);
    assert.ok(output.includes("Total: 0"));
  });
});
