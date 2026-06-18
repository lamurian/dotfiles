/**
 * Tests for the orchestrator's git helper module.
 *
 * Uses real git in temporary repos to verify helper functions.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  getHeadHash,
  getHeadHashFull,
  getLastCommitMessage,
  isWorkingTreeClean,
  stageAll,
  stageFile,
  amendLastCommit,
} from "../git.ts";

interface TempRepo {
  path: string;
  cleanup: () => void;
}

function createRepo(): TempRepo {
  const path = mkdtempSync("orchestrator-git-helper-");
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "t@t.com"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "T"', { cwd: path, stdio: "pipe" });
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

function commitFile(repo: string, name: string, content: string, msg: string): void {
  writeFileSync(join(repo, name), content);
  execSync("git add -A", { cwd: repo, stdio: "pipe" });
  execSync('git commit -m "' + msg + '"', { cwd: repo, stdio: "pipe" });
}

describe("git helper", () => {
  let repo: TempRepo;

  before(() => {
    repo = createRepo();
    commitFile(repo.path, "init.txt", "init", "initial commit");
  });

  after(() => {
    repo.cleanup();
  });

  describe("getHeadHash", () => {
    it("returns a short hash", () => {
      const hash = getHeadHash(repo.path);
      assert.ok(/^[a-f0-9]{7,}$/.test(hash), `expected short hash, got: ${hash}`);
    });
  });

  describe("getHeadHashFull", () => {
    it("returns a full hash", () => {
      const hash = getHeadHashFull(repo.path);
      assert.ok(/^[a-f0-9]{40}$/.test(hash), `expected 40-char hash, got: ${hash}`);
    });
  });

  describe("getLastCommitMessage", () => {
    it("returns oneline commit message", () => {
      const msg = getLastCommitMessage(repo.path);
      assert.ok(msg.includes("initial commit"), `expected 'initial commit', got: ${msg}`);
      assert.ok(/^[a-f0-9]+\s/.test(msg), `expected hash prefix: ${msg}`);
    });
  });

  describe("isWorkingTreeClean", () => {
    it("returns true for clean repo", () => {
      assert.equal(isWorkingTreeClean(repo.path), true);
    });

    it("returns false when there are unstaged changes", () => {
      writeFileSync(join(repo.path, "dirty.txt"), "dirty");
      assert.equal(isWorkingTreeClean(repo.path), false);
      execSync("git checkout -- . 2>/dev/null || git restore .", {
        cwd: repo.path,
        stdio: "pipe",
      });
    });
  });

  describe("stageAll", () => {
    it("stages all changes", () => {
      writeFileSync(join(repo.path, "new-file.txt"), "new content");
      const staged = stageAll(repo.path);
      assert.equal(staged, true);

      // Verify it's staged
      const out = execSync("git diff --cached --name-only", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();
      assert.ok(out.includes("new-file.txt"), `expected new-file.txt staged: ${out}`);
    });
  });

  describe("stageFile", () => {
    it("stages a specific file", () => {
      writeFileSync(join(repo.path, "specific.txt"), "specific content");
      const staged = stageFile("specific.txt", repo.path);
      assert.equal(staged, true);

      const out = execSync("git diff --cached --name-only", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();
      assert.ok(out.includes("specific.txt"), `expected specific.txt staged: ${out}`);
    });
  });

  describe("amendLastCommit", () => {
    it("amends without changing message", () => {
      const beforeMsg = getLastCommitMessage(repo.path);

      // Create a new commit first
      commitFile(repo.path, "pre-amend.txt", "before amend", "pre-amend commit");
      const hashBefore = getHeadHash(repo.path);

      // Now add a file and amend
      writeFileSync(join(repo.path, "amend-me.txt"), "amended");
      stageFile("amend-me.txt", repo.path);
      const result = amendLastCommit(repo.path);

      assert.equal(result.success, true);

      // Message should stay "pre-amend commit"
      const afterMsg = getLastCommitMessage(repo.path);
      assert.equal(afterMsg.includes("pre-amend commit"), true);

      // amend-me.txt should be in the commit
      const files = execSync("git ls-tree -r HEAD --name-only", {
        cwd: repo.path,
        encoding: "utf-8",
      }).trim();
      assert.ok(files.includes("amend-me.txt"), `expected amend-me.txt in HEAD: ${files}`);

      // HEAD hash should have changed
      const hashAfter = getHeadHash(repo.path);
      assert.notEqual(hashAfter, hashBefore, "HEAD hash should change after amend");
    });
  });
});
