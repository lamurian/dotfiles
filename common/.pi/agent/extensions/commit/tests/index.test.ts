/**
 * Tests for the commit extension entry point.
 * Verifies command and tool registration.
 */
import { expect, test, mock, beforeAll, describe } from "bun:test";
import { EventEmitter } from "node:events";

// ─── Mock helpers ───────────────────────────────────────────────────────────

interface MockSpawnConfig {
	stdout?: string;
	stderr?: string;
	code?: number;
	delay?: number; // delay in ms before emitting data
}

/**
 * Create a spawn mock that returns a process-like EventEmitter.
 * The process emits stdout/stderr data, then closes with the given code.
 */
function createMockSpawn(config: MockSpawnConfig = {}) {
	const { stdout = "", stderr = "", code = 0, delay = 0 } = config;
	return (_cmd: string, _args: string[], _opts?: any) => {
		const proc = new EventEmitter() as any;
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();

		// Schedule output delivery after a microtask to let the caller set up listeners
		process.nextTick(() => {
			setTimeout(() => {
				if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
				if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
				proc.emit("close", code, null);
			}, delay);
		});

		return proc;
	};
}

// Default spawn mock: empty output, code 0, synchronous
const defaultSpawn = createMockSpawn();

// Dynamic spawn factory — tests can override this via setSpawnConfig
let spawnFactory: (cmd: string, args: string[], opts?: any) => any = defaultSpawn;

mock.module("node:child_process", () => ({
	spawn: (cmd: string, args: string[], opts?: any) => spawnFactory(cmd, args, opts),
}));

mock.module("@earendil-works/pi-coding-agent", () => ({
	createLocalBashOperations: () => ({
		exec: async () => ({ exitCode: 0 }),
	}),
}));

// We'll import after setting up mocks
let commitExtension: Function;
let registeredCommand: { name: string; handler: Function; description: string } | null = null;
let registeredTool: { name: string; execute: Function; description: string } | null = null;

const mockPi = {
	registerCommand: (name: string, def: { description: string; handler: Function }) => {
		registeredCommand = { name, ...def };
	},
	registerTool: (def: { name: string; execute: Function; description: string }) => {
		registeredTool = { name: def.name, execute: def.execute, description: def.description };
	},
	exec: async (cmd: string, args: string[], opts?: any) => {
		return { stdout: "", stderr: "", code: 0 };
	},
	sendUserMessage: (content: string, opts?: any) => {
		// no-op in test
	},
	on: () => {}, // no-op in default mock
};

beforeAll(async () => {
	// Dynamic import after mocks are set up
	const mod = await import("../index.ts");
	commitExtension = mod.default;
	commitExtension(mockPi);
});

// ─── Registration tests ───────────────────────────────────────────────────────

test("registers /commit command", () => {
	expect(registeredCommand).not.toBeNull();
	expect(registeredCommand!.name).toBe("commit");
	expect(registeredCommand!.description).toContain("Stage");
});

test("registers commit_changes tool", () => {
	expect(registeredTool).not.toBeNull();
	expect(registeredTool!.name).toBe("commit_changes");
	expect(registeredTool!.description).toContain("commit");
});

// ─── /commit command tests ────────────────────────────────────────────────────

test("commit command handler calls git add --all when no args", async () => {
	const gitCommands: string[][] = [];
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") gitCommands.push(args);
			return { stdout: " M test.txt\n", stderr: "", code: 0 };
		},
		sendUserMessage: (content: string, opts?: any) => {
			// Should include --stat but not full diff
			expect(content).toContain("Staged changes:");
			expect(content).not.toContain("Diff (first");
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	const mockCtx = {
		cwd: "/tmp",
		ui: { notify: () => {}, setWidget: () => {} },
	};

	if (registeredCommand) {
		await registeredCommand.handler("", mockCtx);
	}

	// Should have run git add --all
	const addCmd = gitCommands.find(cmd => cmd[0] === "add" && cmd[1] === "--all");
	expect(addCmd).toBeDefined();
});

test("commit command handler commits directly with explicit message", async () => {
	const gitCommands: string[][] = [];
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") {
				gitCommands.push(args);
				// Return status showing changes
				if (args[0] === "status" && args[1] === "--short") {
					return { stdout: " M test.txt\n", stderr: "", code: 0 };
				}
				if (args[0] === "diff" && args.includes("--stat")) {
					return { stdout: " test.txt | 1 +\n", stderr: "", code: 0 };
				}
				if (args[0] === "commit") {
					return { stdout: "[main abc1234] feat: add login\n 1 file changed, 1 insertion(+)", stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	const mockCtx = {
		cwd: "/tmp",
		ui: { notify: () => {} },
	};

	if (registeredCommand) {
		await registeredCommand.handler("feat: add login", mockCtx);
	}

	// Should have run git commit with the message
	const commitCmd = gitCommands.find(cmd =>
		cmd[0] === "commit" && cmd[1] === "-m" && cmd[2] === "feat: add login"
	);
	expect(commitCmd).toBeDefined();
});

// ─── commit_changes tool tests ────────────────────────────────────────────────

test("commit_changes tool runs git commit and returns result", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main def5678] feat: add test\n 1 file changed",
		code: 0,
	});

	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				revParseCount++;
				if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
				return { stdout: "def5678\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const result = await registeredTool!.execute(
		"call-1",
		{ message: "feat: add test" },
		undefined,
		undefined,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");
});

test("commit_changes tool throws on pre-commit hook failure", async () => {
	spawnFactory = createMockSpawn({
		stderr: "pre-commit hooks failed:\n  eslint --fix found errors",
		code: 1,
	});

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		registeredTool!.execute(
			"call-2",
			{ message: "feat: add test" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/pre-commit hook/i);
});

test("commit_changes tool throws on genuine git errors", async () => {
	spawnFactory = createMockSpawn({
		stderr: "fatal: not a git repository",
		code: 128,
	});

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		registeredTool!.execute(
			"call-3",
			{ message: "feat: add test" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/commit failed/i);
});

test("commit_changes tool handles initial commit (no prior HEAD)", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main (root-commit) abc1234] initial commit\n 1 file changed",
		code: 0,
	});

	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				revParseCount++;
				// First call (before commit) — no HEAD yet (empty repo)
				if (revParseCount === 1) {
					return { stdout: "", stderr: "fatal: ambiguous argument 'HEAD'", code: 128 };
				}
				// Second call (after commit) — HEAD is now set
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const result = await registeredTool!.execute(
		"call-1",
		{ message: "feat: initial commit" },
		undefined,
		undefined,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("abc1234");
});

test("commit_changes tool detects pre-commit hook interference when code is 0", async () => {
	spawnFactory = createMockSpawn({
		stderr: "==> Running pre-commit checks...\\npixi run prettify\\nAll done!",
		code: 0,
	});

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				// Same hash before and after — commit didn't land
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		registeredTool!.execute(
			"call-1",
			{ message: "feat: add test" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/pre-commit hook/i);
});

test("commit_changes tool throws when HEAD did not change despite full vs short hash formats", async () => {
	spawnFactory = createMockSpawn({
		stdout: "nothing to commit",
		code: 0,
	});

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				const isShort = args.includes("--short");
				const hash = isShort ? "9c9f975" : "9c9f9753e4038d2d26a8b0e6b3aa761c22e50fd8";
				return { stdout: hash + "\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		registeredTool!.execute(
			"call-1",
			{ message: "feat: nothing" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/HEAD did not change/i);
});

test("commit_changes tool throws when HEAD did not change despite exit code 0", async () => {
	spawnFactory = createMockSpawn({
		stdout: "nothing to commit",
		code: 0,
	});

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		registeredTool!.execute(
			"call-1",
			{ message: "feat: nothing" },
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/HEAD did not change/i);
});

test("commit_changes tool extracts hash from rev-parse HEAD", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[feat/phase-based-modules def5678] feat: add test\n 1 file changed",
		code: 0,
	});

	let callCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			callCount++;
			// First exec call: git add --all (always runs)
			// Second exec call: rev-parse before commit
			if (args[0] === "rev-parse" && callCount === 2) {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			// Third exec call: rev-parse after commit
			if (args[0] === "rev-parse" && callCount === 3) {
				return { stdout: "def5678\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const result = await registeredTool!.execute(
		"call-1",
		{ message: "feat: add test" },
		undefined,
		undefined,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");
});

// ─── Bash guardrail tests ───────────────────────────────────────────────────

test("blocks git commit command in bash tool call", async () => {
	const toolCallHandlers: ((event: any, ctx: any) => Promise<any>)[] = [];
	const localMockPi = {
		...mockPi,
		on: (event: string, handler: Function) => {
			if (event === "tool_call") toolCallHandlers.push(handler as any);
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(toolCallHandlers.length).toBe(1);

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };

	// Should block git commit
	const event1 = {
		toolName: "bash",
		toolCallId: "call-1",
		input: { command: "git commit -m 'test'" },
	};
	const result1 = await toolCallHandlers[0](event1, ctx);
	expect(result1).toEqual({ block: true, reason: expect.stringContaining("commit_changes") });

	// Should also block git commit --no-verify
	const event2 = {
		toolName: "bash",
		toolCallId: "call-2",
		input: { command: "git commit --no-verify -m 'bypass'" },
	};
	const result2 = await toolCallHandlers[0](event2, ctx);
	expect(result2).toEqual({ block: true, reason: expect.stringContaining("commit_changes") });
});

test("allows other git commands in bash", async () => {
	const toolCallHandlers: ((event: any, ctx: any) => Promise<any>)[] = [];
	const localMockPi = {
		...mockPi,
		on: (event: string, handler: Function) => {
			if (event === "tool_call") toolCallHandlers.push(handler as any);
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(toolCallHandlers.length).toBe(1);

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };

	const safeCommands = [
		"git status",
		"git log --oneline -3",
		"git diff --cached",
		"git add -A",
		"git push origin main",
		"echo hello",
	];

	for (const cmd of safeCommands) {
		const event = {
			toolName: "bash",
			toolCallId: "call-safe",
			input: { command: cmd },
		};
		const result = await toolCallHandlers[0](event, ctx);
		expect(result).toBeUndefined();
	}
});

test("blocks git commit bypass with -c core.hooksPath", async () => {
	const toolCallHandlers: ((event: any, ctx: any) => Promise<any>)[] = [];
	const localMockPi = {
		...mockPi,
		on: (event: string, handler: Function) => {
			if (event === "tool_call") toolCallHandlers.push(handler as any);
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(toolCallHandlers.length).toBe(1);

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };

	const bypassCommands = [
		"git -c core.hooksPath=/dev/null commit -m 'test'",
		"git -c core.hooksPath= commit -m 'test'",
		"git -C /some/repo commit -m 'test'",
		"git --git-dir=/other commit -m 'test'",
	];

	for (const cmd of bypassCommands) {
		const event = {
			toolName: "bash",
			toolCallId: "call-bypass",
			input: { command: cmd },
		};
		const result = await toolCallHandlers[0](event, ctx);
		expect(result).toBeDefined();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("commit_changes");
	}
});

test("allows git log with 'commit' in the output", async () => {
	const toolCallHandlers: ((event: any, ctx: any) => Promise<any>)[] = [];
	const localMockPi = {
		...mockPi,
		on: (event: string, handler: Function) => {
			if (event === "tool_call") toolCallHandlers.push(handler as any);
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(toolCallHandlers.length).toBe(1);

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };

	const safeCommandsWithCommit = [
		"git log --oneline | grep 'fix:'",
		"git log --grep=commit",
		"git log commit",
	];

	for (const cmd of safeCommandsWithCommit) {
		const event = {
			toolName: "bash",
			toolCallId: "call-safe",
			input: { command: cmd },
		};
		const result = await toolCallHandlers[0](event, ctx);
		expect(result).toBeUndefined();
	}
});

// ─── Auto-staging tests ────────────────────────────────────────────────────

test("commit_changes always stages all changes", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main def5678] feat: add test\n 1 file changed",
		code: 0,
	});

	const gitCommands: string[][] = [];
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") {
				gitCommands.push(args);
				if (args[0] === "rev-parse") {
					revParseCount++;
					if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
					return { stdout: "def5678\n", stderr: "", code: 0 };
				}
				if (args[0] === "add" && args[1] === "--all") {
					return { stdout: "", stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	const result = await registeredTool!.execute(
		"call-1",
		{ message: "feat: add test" },
		undefined,
		undefined,
		ctx,
	);

	// Should have called git add --all before committing
	const addCmd = gitCommands.find(cmd => cmd[0] === "add" && cmd[1] === "--all");
	expect(addCmd).toBeDefined();
	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");

	// add should come before rev-parse call #2 (the HEAD verification after commit)
	const addIndex = gitCommands.findIndex(cmd => cmd[0] === "add" && cmd[1] === "--all");
	const revParse2Index = gitCommands.findIndex((cmd, i) =>
		cmd[0] === "rev-parse" && i > 0
	);
	expect(addIndex).toBeLessThan(revParse2Index);
});

test("commit_changes always stages even when already staged", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main bcdef9] feat: staged only\n 1 file changed",
		code: 0,
	});

	const gitCommands: string[][] = [];
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") {
				gitCommands.push(args);
				if (args[0] === "rev-parse") {
					revParseCount++;
					if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
					return { stdout: "bcdef9\n", stderr: "", code: 0 };
				}
				if (args[0] === "add" && args[1] === "--all") {
					return { stdout: "", stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	const result = await registeredTool!.execute(
		"call-2",
		{ message: "feat: staged only" },
		undefined,
		undefined,
		ctx,
	);

	// Should have called git add --all (always-stage behavior)
	const addCmd = gitCommands.find(cmd => cmd[0] === "add" && cmd[1] === "--all");
	expect(addCmd).toBeDefined();
	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("bcdef9");
});

test("commit_changes auto-stages on retry after hook failure", async () => {
	// Simulate retry: first call had hook failure, files were fixed, retry now
	spawnFactory = createMockSpawn({
		stdout: "[main def5678] feat: fix after retry\n 1 file changed",
		code: 0,
	});

	const gitCommands: string[][] = [];
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") {
				gitCommands.push(args);
				if (args[0] === "rev-parse") {
					revParseCount++;
					if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
					return { stdout: "def5678\n", stderr: "", code: 0 };
				}
				if (args[0] === "add" && args[1] === "--all") {
					return { stdout: "", stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	const result = await registeredTool!.execute(
		"call-3",
		{ message: "feat: fix after retry" },
		undefined,
		undefined,
		ctx,
	);

	// Should always call git add --all, even on retry
	const addCalls = gitCommands.filter(cmd => cmd[0] === "add" && cmd[1] === "--all");
	expect(addCalls.length).toBe(1);
	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");
});

test("commit_changes updates progress when staging", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main feed00] feat: progress\n 1 file changed",
		code: 0,
	});

	const gitCommands: string[][] = [];
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") {
				gitCommands.push(args);
				if (args[0] === "rev-parse") {
					revParseCount++;
					if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
					return { stdout: "feed00\n", stderr: "", code: 0 };
				}
				if (args[0] === "add" && args[1] === "--all") {
					return { stdout: "", stderr: "", code: 0 };
				}
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const onUpdateCalls: unknown[] = [];
	const onUpdate = (update: unknown) => {
		onUpdateCalls.push(update);
	};

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await registeredTool!.execute(
		"call-3",
		{ message: "feat: progress" },
		undefined,
		onUpdate,
		ctx,
	);

	// Should have at least 2 updates: one for staging, one for commit output
	expect(onUpdateCalls.length).toBeGreaterThanOrEqual(2);
	// First update should mention staging
	const firstUpdate = onUpdateCalls[0] as { content: { text: string }[] };
	expect(firstUpdate.content[0].text).toContain("Staging");
	// Last update should mention the commit message
	const lastUpdate = onUpdateCalls[onUpdateCalls.length - 1] as { content: { text: string }[] };
	expect(lastUpdate.content[0].text).toContain("feat: progress");
});

// ─── onUpdate streaming tests ───────────────────────────────────────────────

test("commit_changes tool streams progress via onUpdate", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main abc123] feat: add test\n 1 file changed",
		code: 0,
	});

	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				revParseCount++;
				if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
				return { stdout: "def5678\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const onUpdateCalls: unknown[] = [];
	const onUpdate = (update: unknown) => {
		onUpdateCalls.push(update);
	};

	await registeredTool!.execute(
		"call-4",
		{ message: "feat: add test" },
		undefined,
		onUpdate,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	// onUpdate must be called with an object containing a content array
	expect(onUpdateCalls.length).toBeGreaterThanOrEqual(1);
	const lastUpdate = onUpdateCalls[onUpdateCalls.length - 1];
	expect(Array.isArray(lastUpdate)).toBe(false);
	expect(lastUpdate).toHaveProperty("content");
	expect(Array.isArray((lastUpdate as { content: unknown[] }).content)).toBe(true);
	expect((lastUpdate as { content: { type: string }[] }).content[0]).toHaveProperty("type", "text");
	// The final update should contain the commit output
	expect((lastUpdate as { content: { text: string }[] }).content[0].text).toContain("feat: add test");
});

test("commit_changes tool streams intermediate progress then final success", async () => {
	spawnFactory = createMockSpawn({
		stdout: "[main def5678] feat: streaming test\n 1 file changed",
		code: 0,
	});

	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				revParseCount++;
				if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
				return { stdout: "def5678\n", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const onUpdateCalls: unknown[] = [];
	const onUpdate = (update: unknown) => {
		onUpdateCalls.push(update);
	};

	const result = await registeredTool!.execute(
		"call-5",
		{ message: "feat: streaming test" },
		undefined,
		onUpdate,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	// Should have multiple onUpdate calls (initial + streaming + final)
	expect(onUpdateCalls.length).toBeGreaterThanOrEqual(1);
	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");
});

// ─── commit_amend tool tests ────────────────────────────────────────────

test("commit_amend is registered as a tool", () => {
	let capturedTool: any = null;
	const localMockPi = {
		...mockPi,
		registerTool: (def: any) => {
			if (def.name === "commit_amend") capturedTool = def;
		},
	};
	commitExtension(localMockPi);
	expect(capturedTool).not.toBeNull();
	expect(capturedTool!.name).toBe("commit_amend");
	expect(capturedTool!.description).toContain("amend");
	expect(typeof capturedTool!.execute).toBe("function");
});

test("commit_amend runs git add --all and pre-commit hooks before amend", async () => {
	const gitCommands: string[][] = [];
	let commitAmendTool: any = null;

	const localMockPi = {
		...mockPi,
		registerTool: (def: any) => {
			if (def.name === "commit_amend") commitAmendTool = def;
		},
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") gitCommands.push(args);
			// Return hooks dir path for hook detection
			if (args[0] === "rev-parse" && args[1] === "--git-path" && args[2] === "hooks") {
				return { stdout: "/tmp/.git/hooks\n", stderr: "", code: 0 };
			}
			if (args[0] === "rev-parse" && args[1] === "--short" && args[2] === "HEAD") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			// Simulate successful amend
			if (args[0] === "commit" && args[1] === "--amend") {
				return { stdout: "[main abc1234] feat: test", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	commitExtension(localMockPi);
	expect(commitAmendTool).not.toBeNull();

	const result = await commitAmendTool.execute(
		"call-amend-1",
		{},
		undefined,
		undefined,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	// Should have called git add --all before git commit --amend --no-edit
	const addIndex = gitCommands.findIndex(
		cmd => cmd[0] === "add" && cmd[1] === "--all",
	);
	const amendIndex = gitCommands.findIndex(
		cmd =>
			cmd[0] === "commit" &&
			cmd[1] === "--amend" &&
			cmd[2] === "--no-edit",
	);
	// Should have called rev-parse with --git-path hooks (for hook detection)
	const hooksDirIndex = gitCommands.findIndex(
		cmd => cmd[0] === "rev-parse" && cmd[1] === "--git-path" && cmd[2] === "hooks",
	);

	expect(hooksDirIndex).toBeGreaterThanOrEqual(0);
	expect(addIndex).toBeGreaterThanOrEqual(0);
	expect(amendIndex).toBeGreaterThanOrEqual(0);
	expect(addIndex).toBeLessThan(amendIndex);
	expect(result.details.success).toBe(true);
});

test("commit_amend throws on pre-commit hook failure", async () => {
	let commitAmendTool: any = null;

	const localMockPi = {
		...mockPi,
		registerTool: (def: any) => {
			if (def.name === "commit_amend") commitAmendTool = def;
		},
		exec: async (cmd: string, args: string[]) => {
			// Return hooks dir path
			if (args[0] === "rev-parse" && args[1] === "--git-path" && args[2] === "hooks") {
				return { stdout: "/tmp/.git/hooks\n", stderr: "", code: 0 };
			}
			// Simulate hook check — hook exists
			if (cmd === "sh" && args[0] === "-c" && args[1]?.includes("test -x")) {
				return { stdout: "", stderr: "", code: 0 };
			}
			// Simulate hook execution — hook FAILS
			if (cmd === "sh" && args[0] === "-c" && args[1]?.includes("/pre-commit")) {
				return {
					stdout: "",
					stderr: "eslint --fix found errors",
					code: 1,
				};
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	commitExtension(localMockPi);
	expect(commitAmendTool).not.toBeNull();

	const ctx = { cwd: "/tmp", ui: { notify: () => {} } };
	await expect(
		commitAmendTool.execute(
			"call-amend-2",
			{},
			undefined,
			undefined,
			ctx,
		),
	).rejects.toThrow(/pre-commit hook/i);
});

test("commit_amend reports failure when amend fails", async () => {
	let commitAmendTool: any = null;

	const localMockPi = {
		...mockPi,
		registerTool: (def: any) => {
			if (def.name === "commit_amend") commitAmendTool = def;
		},
		exec: async (cmd: string, args: string[]) => {
			// Return hooks dir path
			if (args[0] === "rev-parse" && args[1] === "--git-path" && args[2] === "hooks") {
				return { stdout: "/tmp/.git/hooks\n", stderr: "", code: 0 };
			}
			if (args[0] === "rev-parse") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			// Amplify fails
			if (args[0] === "commit" && args[1] === "--amend") {
				return {
					stdout: "",
					stderr: "error: failed to commit",
					code: 1,
				};
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	commitExtension(localMockPi);
	expect(commitAmendTool).not.toBeNull();

	const result = await commitAmendTool.execute(
		"call-amend-3",
		{},
		undefined,
		undefined,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("failed to commit");
});

test("commit_amend calls onUpdate with progress messages", async () => {
	const gitCommands: string[][] = [];
	let commitAmendTool: any = null;

	const localMockPi = {
		...mockPi,
		registerTool: (def: any) => {
			if (def.name === "commit_amend") commitAmendTool = def;
		},
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git") gitCommands.push(args);
			// Return hooks dir path
			if (args[0] === "rev-parse" && args[1] === "--git-path" && args[2] === "hooks") {
				return { stdout: "/tmp/.git/hooks\n", stderr: "", code: 0 };
			}
			if (args[0] === "rev-parse") {
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			if (args[0] === "commit" && args[1] === "--amend") {
				return { stdout: "[main abc1234] feat: test", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	commitExtension(localMockPi);
	expect(commitAmendTool).not.toBeNull();

	const onUpdateCalls: unknown[] = [];
	const onUpdate = (update: unknown) => {
		onUpdateCalls.push(update);
	};

	await commitAmendTool.execute(
		"call-amend-4",
		{},
		undefined,
		onUpdate,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	// Should have multiple onUpdate calls: staging, hooks, amend
	expect(onUpdateCalls.length).toBeGreaterThanOrEqual(3);
	// The first update should mention staging
	const firstUpdate = onUpdateCalls[0] as { content: { text: string }[] };
	expect(firstUpdate.content[0].text).toContain("Staging");
	// The second update should mention hooks
	const secondUpdate = onUpdateCalls[1] as { content: { text: string }[] };
	expect(secondUpdate.content[0].text).toContain("pre-commit");
});
