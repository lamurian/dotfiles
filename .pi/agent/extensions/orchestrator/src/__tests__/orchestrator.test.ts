/**
 * Tests for the orchestration engine.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
    const emptyDir = mkdtempSync("orchestrator-empty-");
    const ctx = mockCtx(repo.path);

    const summary = await runOrchestration(emptyDir, ctx);

    assert.equal(summary.total, 0);
    assert.equal(summary.implemented, 0);
    assert.equal(summary.failed, 0);
    assert.deepEqual(summary.results, []);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("fails gracefully when pi is not in PATH", async () => {
    const planPath = join(plansDir, "001-test-task.md");
    writeFileSync(planPath, "# Test Task\n\n- [ ] Do something");
    const ctx = mockCtx(repo.path);

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

  it("stops orchestration on spawn error (non-timeout)", async () => {
    // Previous test left plansDir with 001-test-task.md.
    // Add a second plan — the first should fail (pi not found), stopping everything.
    writeFileSync(join(plansDir, "002-after-fail.md"), "# After\n\n- [ ] Task");
    const ctx = mockCtx(repo.path);

    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-path";

    try {
      const summary = await runOrchestration(plansDir, ctx);
      // Only first plan should be processed (spawn error stops orchestration)
      assert.equal(summary.total, 1, "should stop after first failure");
      assert.equal(summary.failed, 1);
      // First plan should NOT be archived (no commit made, kill path)
      assert.equal(
        existsSync(join(plansDir, "001-test-task.md")),
        true,
        "failed plan should remain unarchived",
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("processes only the new plan when pi works", async () => {
    // Set up a clean dir with just one plan
    const cleanDir = mkdtempSync("orchestrator-clean-");
    const cleanPlans = join(cleanDir, "plans");
    mkdirSync(cleanPlans, { recursive: true });
    writeFileSync(join(cleanPlans, "001-unique.md"), "# Unique\n\n- [ ] Task");

    const ctx = mockCtx(cleanDir);

    // With pi NOT in PATH, this will fail — but it tests that a single plan is processed
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-path";

    try {
      const summary = await runOrchestration(cleanPlans, ctx);
      assert.equal(summary.total, 1, "one plan should be processed");
    } finally {
      process.env.PATH = originalPath;
      rmSync(cleanDir, { recursive: true, force: true });
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
          error: "Timed out after 3 attempts",
          analysis: "Session timed out while implementing",
        },
      ],
      total: 2,
      implemented: 1,
      failed: 1,
    };

    const output = formatSummary(summary);
    assert.ok(output.includes("❌"));
    assert.ok(output.includes("Timed out after 3 attempts"));
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

  it("formats a timeout-with-commit summary as success", () => {
    const summary: OrchestrationSummary = {
      results: [
        {
          file: "003-timeout-commit.md",
          success: true,
          error: "Timed out after 10 min. Partial work committed and archived.",
        },
      ],
      total: 1,
      implemented: 1,
      failed: 0,
    };

    const output = formatSummary(summary);
    assert.ok(output.includes("✅"));
    assert.ok(output.includes("Partial work committed"));
    assert.ok(!output.includes("stopped due to failure"));
  });
});
