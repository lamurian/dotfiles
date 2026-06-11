/**
 * Tests for runCommit — runs git commit with a message.
 * Sets up a temporary git repo for each test.
 */
import { expect, test, mock, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
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
