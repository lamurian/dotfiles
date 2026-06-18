/**
 * Tests for git helper operations.
 *
 * Uses real git in a temporary repo to verify amend and status logic.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

interface TempRepo {
  path: string;
  cleanup: () => void;
}

function createTempRepo(): TempRepo {
  const path = mkdtempSync("orchestrator-git-test-");
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: path, stdio: "pipe" });

  // Create initial commit so HEAD exists
  writeFileSync(join(path, "initial.txt"), "initial");
  execSync("git add -A", { cwd: path, stdio: "pipe" });
  execSync("git commit -m 'initial commit'", { cwd: path, stdio: "pipe" });

  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

// We test git commands via execSync since the orchestration module
// uses pi.exec internally. These tests verify the contract: what
// git commands the orchestrator calls and their expected behavior.

describe("git operations (real git)", () => {
  let repo: TempRepo;

  before(() => {
    repo = createTempRepo();
  });

  after(() => {
    repo.cleanup();
  });

  it("git status --short returns empty for clean repo", () => {
    const out = execSync("git status --short", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.equal(out, "");
  });

  it("git status --short shows uncommitted changes", () => {
    writeFileSync(join(repo.path, "new-file.txt"), "content");

    // First it's untracked
    const out1 = execSync("git status --short", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.ok(out1.includes("new-file.txt"), `expected new-file.txt in status: ${out1}`);

    // After git add, should show as staged
    execSync("git add -A", { cwd: repo.path, stdio: "pipe" });
    const out2 = execSync("git status --short", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.ok(out2.includes("new-file.txt"), `expected staged new-file.txt: ${out2}`);
  });

  it("git rev-parse --short HEAD returns a hash", () => {
    const hash = execSync("git rev-parse --short HEAD", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.ok(hash.length > 0, "HEAD should have a hash");
  });

  it("git commit --amend --no-edit amends without changing message", () => {
    writeFileSync(join(repo.path, "amend-test.txt"), "amend content");
    execSync("git add -A", { cwd: repo.path, stdio: "pipe" });

    // Get the current log message
    const beforeMsg = execSync("git log -1 --format=%s", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();

    // Amend
    execSync("git commit --amend --no-edit", {
      cwd: repo.path,
      stdio: "pipe",
    });

    // Message should be unchanged
    const afterMsg = execSync("git log -1 --format=%s", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();

    assert.equal(afterMsg, beforeMsg, "commit message should be unchanged after amend");

    // The amend-test.txt should now be part of the last commit
    // Use ls-tree (works for root commits) instead of diff-tree
    const files = execSync("git ls-tree -r HEAD --name-only", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.ok(files.includes("amend-test.txt"), `expected amend-test.txt in HEAD tree: ${files}`);
  });

  it("git log -1 --oneline shows latest commit", () => {
    const log = execSync("git log -1 --oneline", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();
    assert.ok(log.length > 0, "should have log output");
    // Format: <hash> <message>
    assert.ok(/^[a-f0-9]+\s/.test(log), `expected hash prefix: ${log}`);
  });

  it("HEAD changes after a new commit", () => {
    const before = execSync("git rev-parse HEAD", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();

    writeFileSync(join(repo.path, "another-file.txt"), "more content");
    execSync("git add -A", { cwd: repo.path, stdio: "pipe" });
    execSync("git commit -m 'another commit'", { cwd: repo.path, stdio: "pipe" });

    const after = execSync("git rev-parse HEAD", {
      cwd: repo.path,
      encoding: "utf-8",
    }).trim();

    assert.notEqual(after, before, "HEAD should change after a new commit");
  });
});
