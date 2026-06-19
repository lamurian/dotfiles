/**
 * Tests for plan file operations (list, archive, move, git mv).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { listPlanFiles, moveToArchive, archiveDirPath } from "../plan.ts";

interface TempRepo {
  path: string;
  cleanup: () => void;
}

/**
 * Initialize a git repo with an initial commit.
 * Uses git plumbing commands (commit-tree + update-ref) to avoid
 * the commit extension intercepting `git commit` calls.
 */
function gitInit(path: string): void {
  execSync("git init", { cwd: path, stdio: "pipe" });
  execSync('git config user.email "t@t.com"', { cwd: path, stdio: "pipe" });
  execSync('git config user.name "T"', { cwd: path, stdio: "pipe" });
  writeFileSync(join(path, "README.md"), "# test");
  execSync("git add -A", { cwd: path, stdio: "pipe" });
  // Plumbing: create initial commit without `git commit`
  const treeHash = execSync("git write-tree", { cwd: path, encoding: "utf-8" }).trim();
  const commitHash = execSync(
    `echo "initial commit" | git commit-tree ${treeHash}`,
    { cwd: path, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" },
  ).trim();
  execSync(`git update-ref HEAD ${commitHash}`, { cwd: path, stdio: "pipe" });
}

/**
 * Stage and commit a file using git plumbing.
 * Uses relative paths from repoPath to avoid git path issues.
 */
function gitCommitFile(repoPath: string, filePath: string, msg: string): void {
  const relPath = filePath.replace(repoPath + "/", "");
  execSync(`git add "${relPath}"`, { cwd: repoPath, stdio: "pipe" });
  const treeHash = execSync("git write-tree", { cwd: repoPath, encoding: "utf-8" }).trim();
  const currentHead = execSync("git rev-parse HEAD", { cwd: repoPath, encoding: "utf-8" }).trim();
  const commitHash = execSync(
    `echo "${msg}" | git commit-tree ${treeHash} -p ${currentHead}`,
    { cwd: repoPath, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" },
  ).trim();
  execSync(`git update-ref HEAD ${commitHash}`, { cwd: repoPath, stdio: "pipe" });
}

function createRepo(): TempRepo {
  const path = mkdtempSync("orchestrator-plan-test-");
  gitInit(path);
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

/** Create a fresh temp dir for each test using a unique subdirectory. */
function testDir(parent: string, name: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// listPlanFiles
// ─────────────────────────────────────────────────────────────────────────────

describe("listPlanFiles", () => {
  let tmp: TempRepo;

  before(() => {
    tmp = createRepo();
  });

  after(() => {
    tmp.cleanup();
  });

  it("returns empty array for empty directory", async () => {
    const dir = testDir(tmp.path, "empty");
    const files = await listPlanFiles(dir);
    assert.deepEqual(files, []);
  });

  it("returns only .md files in sorted order, skipping non-.md", async () => {
    const dir = testDir(tmp.path, "sorted");
    writeFileSync(join(dir, "002-task.md"), "plan 2");
    writeFileSync(join(dir, "001-task.md"), "plan 1");
    writeFileSync(join(dir, "003-task.md"), "plan 3");
    writeFileSync(join(dir, "notes.txt"), "not a plan");

    const files = await listPlanFiles(dir);
    const rel = files.map((f) => f.replace(dir + "/", ""));

    assert.deepEqual(rel, ["001-task.md", "002-task.md", "003-task.md"]);
  });

  it("includes non-plan .md files like README.md", async () => {
    const dir = testDir(tmp.path, "includes-other-md");
    writeFileSync(join(dir, "001-task.md"), "plan");
    writeFileSync(join(dir, "README.md"), "readme");

    const files = await listPlanFiles(dir);
    const rel = files.map((f) => f.replace(dir + "/", ""));
    assert.deepEqual(rel, ["001-task.md", "README.md"]);
  });

  it("skips the .archive subdirectory", async () => {
    const dir = testDir(tmp.path, "skip-archive");
    mkdirSync(join(dir, ".archive"));
    writeFileSync(join(dir, "001-plan.md"), "plan");

    const files = await listPlanFiles(dir);
    const rel = files.map((f) => f.replace(dir + "/", ""));
    assert.deepEqual(rel, ["001-plan.md"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// archiveDirPath
// ─────────────────────────────────────────────────────────────────────────────

describe("archiveDirPath", () => {
  it("returns path with .archive suffix", () => {
    assert.equal(archiveDirPath("/some/plans"), "/some/plans/.archive");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// moveToArchive
// ─────────────────────────────────────────────────────────────────────────────

describe("moveToArchive", () => {
  let tmp: TempRepo;

  before(() => {
    tmp = createRepo();
  });

  after(() => {
    tmp.cleanup();
  });

  it("moves a file to .archive and returns new path", async () => {
    const dir = testDir(tmp.path, "move-test");
    const planPath = join(dir, "001-plan.md");
    writeFileSync(planPath, "plan content");

    const archived = await moveToArchive(planPath, dir);

    // Original file should be gone
    assert.equal(existsSync(planPath), false);

    // Archived file should exist
    assert.equal(existsSync(archived), true);
    assert.equal(archived, join(dir, ".archive", "001-plan.md"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// archive — moveToArchive (filesystem rename)
// ─────────────────────────────────────────────────────────────────────────────

describe("plan module exports", () => {
  it("exports moveToArchive but not gitMoveToArchive", async () => {
    // gitMoveToArchive was removed because git mv fails when the
    // archive destination is gitignored (dotfiles repo pattern).
    // moveToArchive uses filesystem rename which works regardless.
    const mod: Record<string, unknown> = await import("../plan.ts");
    assert.equal(typeof mod.moveToArchive, "function");
    assert.equal(
      mod.gitMoveToArchive,
      undefined,
      "gitMoveToArchive should be removed; use moveToArchive instead",
    );
  });
});

describe("archive with filesystem rename", () => {
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

  it("moves a tracked file to .archive using filesystem rename", async () => {
    const planPath = join(plansDir, "001-auth.md");
    writeFileSync(planPath, "# Auth plan\n\n- [ ] Implement login");
    gitCommitFile(repo.path, planPath, "add plan");

    // Move via filesystem rename (not git mv)
    const archived = await moveToArchive(planPath, plansDir);

    // Source file should be gone from disk (rename, not git mv)
    assert.equal(existsSync(planPath), false, "source should be gone from disk");

    // Archived file should exist at the expected path
    assert.equal(existsSync(archived), true, "archived file should exist");
    assert.equal(archived, join(plansDir, ".archive", "001-auth.md"));
  });

  it("works when .archive is gitignored (dotfiles-style repo)", async () => {
    const cleanDir = mkdtempSync("orchestrator-archive-gitignored-");
    try {
      execSync("git init", { cwd: cleanDir, stdio: "pipe" });
      execSync('git config user.email "t@t.com"', { cwd: cleanDir, stdio: "pipe" });
      execSync('git config user.name "T"', { cwd: cleanDir, stdio: "pipe" });

      // Root .gitignore with blacklist-all pattern (like dotfiles repo)
      writeFileSync(join(cleanDir, ".gitignore"), "*\n!*/\n");
      execSync("git add -f .gitignore", { cwd: cleanDir, stdio: "pipe" });

      // Initial commit
      const initTree = execSync("git write-tree", { cwd: cleanDir, encoding: "utf-8" }).trim();
      const initCommit = execSync(`echo "init" | git commit-tree ${initTree}`, {
        cwd: cleanDir, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8",
      }).trim();
      execSync(`git update-ref HEAD ${initCommit}`, { cwd: cleanDir, stdio: "pipe" });

      // Create a tracked plan file (force-add since it's gitignored)
      const plans = join(cleanDir, "docs", "plans");
      mkdirSync(plans, { recursive: true });
      const planPath = join(plans, "001-task.md");
      writeFileSync(planPath, "# Task\n\n- [ ] Do it");
      execSync(`git add -f "${planPath.replace(cleanDir + "/", "")}"`, { cwd: cleanDir, stdio: "pipe" });

      const tree = execSync("git write-tree", { cwd: cleanDir, encoding: "utf-8" }).trim();
      const head = execSync("git rev-parse HEAD", { cwd: cleanDir, encoding: "utf-8" }).trim();
      const commit = execSync(`echo "add plan" | git commit-tree ${tree} -p ${head}`, {
        cwd: cleanDir, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8",
      }).trim();
      execSync(`git update-ref HEAD ${commit}`, { cwd: cleanDir, stdio: "pipe" });

      // git mv to .archive would FAIL here because .archive/** is gitignored.
      // moveToArchive (filesystem rename) succeeds regardless.
      const archived = await moveToArchive(planPath, plans);

      assert.equal(existsSync(planPath), false, "source file should be removed");
      assert.equal(existsSync(archived), true, "archived file should exist");
      assert.equal(archived, join(plans, ".archive", "001-task.md"));

      // Archived file should NOT be tracked by git (it's gitignored)
      const tracked = execSync('git ls-files "docs/plans/.archive/001-task.md"', {
        cwd: cleanDir, encoding: "utf-8",
      }).trim();
      assert.equal(tracked, "", "archived file should not be tracked (gitignored)");
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("creates .archive directory if it does not exist", async () => {
    const cleanDir = mkdtempSync("orchestrator-archive-mkdir-");
    try {
      execSync("git init", { cwd: cleanDir, stdio: "pipe" });
      execSync('git config user.email "t@t.com"', { cwd: cleanDir, stdio: "pipe" });
      execSync('git config user.name "T"', { cwd: cleanDir, stdio: "pipe" });
      execSync("git commit --allow-empty -m init", {
        cwd: cleanDir, stdio: "pipe",
      });

      const plans = join(cleanDir, "plans");
      mkdirSync(plans, { recursive: true });
      const planPath = join(plans, "001-task.md");
      writeFileSync(planPath, "# Task");

      // .archive does not exist yet
      assert.equal(existsSync(join(plans, ".archive")), false);

      const archived = await moveToArchive(planPath, plans);

      assert.equal(existsSync(join(plans, ".archive", "001-task.md")), true);
      assert.equal(archived, join(plans, ".archive", "001-task.md"));
    } finally {
      rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("works with nested paths", async () => {
    const planPath = join(plansDir, "002-db.md");
    writeFileSync(planPath, "# DB plan");
    gitCommitFile(repo.path, planPath, "add db plan");

    const archived = await moveToArchive(planPath, plansDir);

    assert.equal(existsSync(planPath), false);
    assert.equal(existsSync(archived), true);
    assert.ok(archived.endsWith(".archive/002-db.md"));
  });
});
