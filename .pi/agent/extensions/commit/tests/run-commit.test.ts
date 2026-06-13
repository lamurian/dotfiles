/**
 * Tests for runCommit — runs git commit with a message.
 * Sets up a temporary git repo for each test.
 */
import { expect, test, mock, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

mock.module("@earendil-works/pi-coding-agent", () => ({
	createLocalBashOperations: () => ({
		exec: async () => ({ exitCode: 0 }),
	}),
}));

import { runCommit } from "../commit.ts";

interface TestRepo {
	dir: string;
	/** Mock pi object that delegates exec to real git */
	pi: {
		exec: (
			cmd: string,
			args: string[],
			opts?: { signal?: AbortSignal; timeout?: number },
		) => Promise<{ stdout: string; stderr: string; code: number; killed?: boolean }>;
	};
}

function createTestRepo(): TestRepo {
	const dir = realpathSync(mkdtempSync("/tmp/commit-test-"));
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name Test User", { cwd: dir, stdio: "pipe" });

	const pi = {
		exec: async (
			cmd: string,
			args: string[],
			opts?: { signal?: AbortSignal; timeout?: number },
		) => {
			try {
				const stdout = execSync(`${cmd} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
					cwd: dir,
					encoding: "utf-8",
					stdio: "pipe",
					timeout: opts?.timeout ?? 30_000,
					env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", HOME: "/nonexistent" },
					signal: opts?.signal,
				});
				return { stdout: stdout || "", stderr: "", code: 0, killed: false };
			} catch (err: any) {
				return {
					stdout: err.stdout || "",
					stderr: err.stderr || err.message || "",
					code: err.status ?? 1,
					killed: err.killed ?? false,
				};
			}
		},
	};

	return { dir, pi };
}

function destroyTestRepo(repo: TestRepo): void {
	rmSync(repo.dir, { recursive: true, force: true });
}

function stageFile(repo: TestRepo, name: string, content: string): void {
	writeFileSync(join(repo.dir, name), content, "utf-8");
	execSync(`git add ${name}`, { cwd: repo.dir, stdio: "pipe" });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("commits with a single-line message", async () => {
	const repo = createTestRepo();
	stageFile(repo, "test.txt", "hello");

	const result = await runCommit(repo.pi, "feat: add test file");

	expect(result.code).toBe(0);
	expect(result.output).toMatch(/1 file changed/);
	expect(result.output).toContain("feat: add test file");

	// Verify the commit was actually created
	const log = execSync("git log --oneline", { cwd: repo.dir, encoding: "utf-8" });
	expect(log).toContain("feat: add test file");

	destroyTestRepo(repo);
});

test("commits with message and body", async () => {
	const repo = createTestRepo();
	stageFile(repo, "test.txt", "world");

	const result = await runCommit(repo.pi, "feat: add test file", "This is the body explaining the change.");

	expect(result.code).toBe(0);
	expect(result.output).toMatch(/1 file changed/);

	// Verify body is in commit message
	const log = execSync("git log --format=%B -1", { cwd: repo.dir, encoding: "utf-8" });
	expect(log).toContain("feat: add test file");
	expect(log).toContain("This is the body explaining the change.");

	destroyTestRepo(repo);
});

test("returns non-zero code when nothing to commit", async () => {
	const repo = createTestRepo();
	// No staged changes

	const result = await runCommit(repo.pi, "feat: nothing");

	expect(result.code).not.toBe(0);
	expect(result.output).toMatch(/nothing to commit|nothing added/);

	destroyTestRepo(repo);
});

test("runCommit fails on pre-commit hook failure", async () => {
	const repo = createTestRepo();
	stageFile(repo, "test.txt", "hello");

	// Install a failing pre-commit hook that simulates real frameworks
	// (e.g., husky outputs "husky - pre-commit hook exited with code 1")
	const hookPath = join(repo.dir, ".git", "hooks", "pre-commit");
	writeFileSync(
		hookPath,
		"#!/bin/sh\necho 'pre-commit hook failure: eslint --fix found errors' >&2\nexit 1\n",
		"utf-8",
	);
	chmodSync(hookPath, 0o755);

	const result = await runCommit(repo.pi, "feat: add test");

	expect(result.code).not.toBe(0);
	// The hook's stderr output is captured in result.output
	expect(result.output).toContain("pre-commit");

	destroyTestRepo(repo);
});

test("runCommit does not set a hard timeout", async () => {
	const repo = createTestRepo();
	stageFile(repo, "test.txt", "hello");

	// Wrap exec to capture the timeout value
	let capturedTimeout: number | undefined = undefined;
	const originalExec = repo.pi.exec.bind(repo.pi);
	repo.pi.exec = async (cmd: string, args: string[], opts?: any) => {
		capturedTimeout = opts?.timeout;
		return originalExec(cmd, args, opts);
	};

	await runCommit(repo.pi, "feat: no hard timeout");

	// Timeout should be undefined (no hard timeout), allowing git hooks to
	// run as long as needed instead of being killed mid-hook.
	expect(capturedTimeout).toBeUndefined();

	destroyTestRepo(repo);
});

test("commits on branch with a slash", async () => {
	const repo = createTestRepo();

	// Create and switch to a branch with a slash
	execSync("git checkout -b feat/phase-based-modules", { cwd: repo.dir, stdio: "pipe" });
	stageFile(repo, "test.txt", "hello");

	const result = await runCommit(repo.pi, "feat: add test file");

	expect(result.code).toBe(0);
	expect(result.output).toMatch(/1 file changed/);
	expect(result.output).toContain("feat: add test file");

	// Verify the commit was actually created
	const log = execSync("git log --oneline", { cwd: repo.dir, encoding: "utf-8" });
	expect(log).toContain("feat: add test file");

	// Verify we're still on the branch with slash
	const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: repo.dir, encoding: "utf-8" }).trim();
	expect(branch).toBe("feat/phase-based-modules");

	destroyTestRepo(repo);
});

test("runCommit retry scenario — fix, re-stage, retry succeeds", async () => {
	const repo = createTestRepo();
	const filePath = join(repo.dir, "test.txt");

	// File containing "BAD" — simulates a formatting issue that the hook fixes
	writeFileSync(filePath, "BAD FILE\n", "utf-8");
	execSync("git add test.txt", { cwd: repo.dir, stdio: "pipe" });

	// Pre-commit hook: if file contains "BAD", rewrite to "GOOD" and fail
	const hookPath = join(repo.dir, ".git", "hooks", "pre-commit");
	writeFileSync(
		hookPath,
		"#!/bin/sh\nif grep -q 'BAD' test.txt; then\n\tsed -i 's/BAD/GOOD/' test.txt\n\techo 'pre-commit hook failure: found BAD content' >&2\n\texit 1\nfi\nexit 0\n",
		"utf-8",
	);
	chmodSync(hookPath, 0o755);

	// First commit fails due to pre-commit hook
	const first = await runCommit(repo.pi, "feat: add test");
	expect(first.code).not.toBe(0);
	expect(first.output).toContain("pre-commit");

	// Re-stage the fixed file (simulating AI step after running formatter)
	execSync("git add test.txt", { cwd: repo.dir, stdio: "pipe" });

	// Second commit passes because file is now clean
	const second = await runCommit(repo.pi, "feat: add test");
	expect(second.code).toBe(0);
	expect(second.output).toMatch(/1 file changed/);
	expect(second.output).toContain("feat: add test");

	// Verify the commit was actually created
	const log = execSync("git log --oneline", { cwd: repo.dir, encoding: "utf-8" });
	expect(log).toContain("feat: add test");

	destroyTestRepo(repo);
});
