/**
 * Tests for plan file operations (list, archive, move).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listPlanFiles, moveToArchive, archiveDirPath } from "../plan.ts";

interface TempDir {
  path: string;
  cleanup: () => void;
}

function createTempDir(): TempDir {
  const path = mkdtempSync("orchestrator-test-");
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
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
  let tmp: TempDir;

  before(() => {
    tmp = createTempDir();
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
  let tmp: TempDir;

  before(() => {
    tmp = createTempDir();
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
