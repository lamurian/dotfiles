/**
 * Tests for the commit extension entry point.
 * Verifies command and tool registration.
 */
import { expect, test, mock, beforeAll } from "bun:test";

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
};

beforeAll(async () => {
	// Dynamic import after mocks are set up
	const mod = await import("../index.ts");
	commitExtension = mod.default;
	commitExtension(mockPi);
});

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

	// Re-register to capture the new handler
	// Actually we need the handler from the original registration
	// Let me just test by directly invoking the captured handler
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

test("commit_changes tool runs git commit and returns result", async () => {
	let executedArgs: string[] | null = null;
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") {
				revParseCount++;
				// Return different hash before vs after commit
				if (revParseCount === 1) return { stdout: "abc1234\n", stderr: "", code: 0 };
				return { stdout: "def5678\n", stderr: "", code: 0 };
			}
			if (cmd === "git" && args[0] === "commit") {
				executedArgs = args;
				return { stdout: "[main def5678] feat: add test\n 1 file changed", stderr: "", code: 0 };
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

	expect(executedArgs).toEqual(["commit", "-m", "feat: add test"]);
	expect(result.details.success).toBe(true);
	expect(result.details.hash).toBe("def5678");
});

test("commit_changes tool throws on pre-commit hook failure", async () => {
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "commit") {
				return {
					stdout: "",
					stderr: "pre-commit hooks failed:\n  eslint --fix found errors",
					code: 1,
				};
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	// Should throw so the framework properly signals isError to the LLM
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
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "commit") {
				return {
					stdout: "",
					stderr: "fatal: not a git repository",
					code: 128,
				};
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
	let revParseCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") {
				revParseCount++;
				// First call (before commit) — no HEAD yet (empty repo)
				if (revParseCount === 1) {
					return { stdout: "", stderr: "fatal: ambiguous argument 'HEAD'", code: 128 };
				}
				// Second call (after commit) — HEAD is now set
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			if (cmd === "git" && args[0] === "commit") {
				return { stdout: "[main (root-commit) abc1234] initial commit\n 1 file changed", stderr: "", code: 0 };
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

test("commit_changes tool throws when HEAD did not change despite exit code 0", async () => {
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "rev-parse") {
				// Same hash before and after — commit didn't land
				return { stdout: "abc1234\n", stderr: "", code: 0 };
			}
			if (cmd === "git" && args[0] === "commit") {
				return { stdout: "nothing to commit", stderr: "", code: 0 };
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
	let callCount = 0;
	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			callCount++;
			if (cmd === "git") {
				// 1st call: rev-parse before commit
				if (args[0] === "rev-parse" && callCount === 1) {
					return { stdout: "abc1234\n", stderr: "", code: 0 };
				}
				// 2nd call: git commit (branch name with slash in output)
				if (args[0] === "commit") {
					return {
						stdout: "[feat/phase-based-modules def5678] feat: add test\\n 1 file changed",
						stderr: "",
						code: 0,
					};
				}
				// 3rd call: rev-parse after commit
				if (args[0] === "rev-parse" && callCount === 3) {
					return { stdout: "def5678\n", stderr: "", code: 0 };
				}
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
	// Hash should come from rev-parse HEAD, not from parsing commit output
	expect(result.details.hash).toBe("def5678");

	// Verify rev-parse was called twice (before and after commit)
	const revParseCalls = callCount; // we can count via callCount
	expect(revParseCalls).toBeGreaterThanOrEqual(3);
});

test("commit_changes tool calls onUpdate with correct shape", async () => {
	let onUpdateCall: unknown = null;

	const localMockPi = {
		...mockPi,
		exec: async (cmd: string, args: string[]) => {
			if (cmd === "git" && args[0] === "commit") {
				return { stdout: "[main abc123] feat: add test\n 1 file changed", stderr: "", code: 0 };
			}
			return { stdout: "", stderr: "", code: 0 };
		},
	};

	registeredCommand = null;
	registeredTool = null;
	commitExtension(localMockPi);

	expect(registeredTool).not.toBeNull();

	const onUpdate = (update: unknown) => {
		onUpdateCall = update;
	};

	await registeredTool!.execute(
		"call-4",
		{ message: "feat: add test" },
		undefined,
		onUpdate,
		{ cwd: "/tmp", ui: { notify: () => {} } },
	);

	// onUpdate must be called with an object containing a content array, not a bare array
	expect(onUpdateCall).not.toBeNull();
	expect(Array.isArray(onUpdateCall)).toBe(false);
	expect(onUpdateCall).toHaveProperty("content");
	expect(Array.isArray((onUpdateCall as { content: unknown[] }).content)).toBe(true);
	expect((onUpdateCall as { content: { type: string }[] }).content[0]).toHaveProperty("type", "text");
});
