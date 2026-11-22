/**
 * Tests for commit tool descriptions and prompt guidelines.
 * Verifies clarity about auto-staging and prevents misuse of commit_amend.
 */
import { expect, test, mock, beforeAll, describe } from "bun:test";
import { EventEmitter } from "node:events";

// ─── Mock helpers ───────────────────────────────────────────────────────────

interface MockSpawnConfig {
	stdout?: string;
	stderr?: string;
	code?: number;
	delay?: number;
}

function createMockSpawn(config: MockSpawnConfig = {}) {
	const { stdout = "", stderr = "", code = 0, delay = 0 } = config;
	return (_cmd: string, _args: string[], _opts?: any) => {
		const proc = new EventEmitter() as any;
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();

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

const defaultSpawn = createMockSpawn();
let spawnFactory: (cmd: string, args: string[], opts?: any) => any = defaultSpawn;

mock.module("node:child_process", () => ({
	spawn: (cmd: string, args: string[], opts?: any) => spawnFactory(cmd, args, opts),
}));

mock.module("@earendil-works/pi-coding-agent", () => ({
	createLocalBashOperations: () => ({
		exec: async () => ({ exitCode: 0 }),
	}),
}));

// ─── Captured tool registrations ────────────────────────────────────────────

interface CapturedTool {
	name: string;
	execute: Function;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

let commitExtension: Function;
const registeredTools: CapturedTool[] = [];

const mockPi = {
	registerCommand: () => {},
	registerTool: (def: CapturedTool) => {
		registeredTools.push(def);
	},
	exec: async () => ({ stdout: "", stderr: "", code: 0 }),
	sendUserMessage: () => {},
	on: () => {},
};

beforeAll(async () => {
	const mod = await import("../index.ts");
	commitExtension = mod.default;
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("commit_changes tool description", () => {
	beforeEach(() => {
		registeredTools.length = 0;
		commitExtension(mockPi);
	});

	test("description mentions auto-staging", () => {
		const tool = registeredTools.find(t => t.name === "commit_changes");
		expect(tool).toBeDefined();

		// Description should clarify that commit_changes auto-stages
		// This is critical for preventing misuse of commit_amend as a fallback
		const description = tool!.description.toLowerCase();
		expect(description).toContain("auto-stage");
	});

	test("description mentions commit_amend equivalence", () => {
		const tool = registeredTools.find(t => t.name === "commit_changes");
		expect(tool).toBeDefined();

		// Should mention that auto-staging is similar to commit_amend
		// to set correct expectations about the tool's behavior
		const description = tool!.description.toLowerCase();
		expect(description).toContain("commit_amend");
	});

	test("promptGuidelines warns against using commit_amend as fallback", () => {
		const tool = registeredTools.find(t => t.name === "commit_changes");
		expect(tool).toBeDefined();
		expect(tool!.promptGuidelines).toBeDefined();

		// Find the guideline that warns about commit_amend misuse
		const amendWarning = tool!.promptGuidelines!.find(g =>
			g.toLowerCase().includes("commit_amend") && g.toLowerCase().includes("fallback")
		);
		expect(amendWarning).toBeDefined();
	});

	test("promptGuidelines warns about hash continuity", () => {
		const tool = registeredTools.find(t => t.name === "commit_changes");
		expect(tool).toBeDefined();
		expect(tool!.promptGuidelines).toBeDefined();

		// Should explicitly mention hash continuity as the reason
		const hashWarning = tool!.promptGuidelines!.find(g =>
			g.toLowerCase().includes("hash continuity") || g.toLowerCase().includes("rewrite")
		);
		expect(hashWarning).toBeDefined();
	});

	test("promptGuidelines advises about sandbox-blocked git commands", () => {
		const tool = registeredTools.find(t => t.name === "commit_changes");
		expect(tool).toBeDefined();
		expect(tool!.promptGuidelines).toBeDefined();

		// Should tell the agent to ask user when sandbox blocks commands
		const sandboxGuideline = tool!.promptGuidelines!.find(g =>
			g.toLowerCase().includes("sandbox") || g.toLowerCase().includes("outside")
		);
		expect(sandboxGuideline).toBeDefined();
	});
});

describe("commit_amend tool description", () => {
	beforeEach(() => {
		registeredTools.length = 0;
		commitExtension(mockPi);
	});

	test("description does not suggest using as fallback for commit_changes", () => {
		const tool = registeredTools.find(t => t.name === "commit_amend");
		expect(tool).toBeDefined();

		// commit_amend should NOT be described as a fallback or alternative
		const description = tool!.description.toLowerCase();
		expect(description).not.toContain("fallback");
		expect(description).not.toContain("alternative to commit_changes");
		expect(description).not.toContain("use when commit_changes fails");
	});

	test("description explicitly states it rewrites history", () => {
		const tool = registeredTools.find(t => t.name === "commit_amend");
		expect(tool).toBeDefined();

		// Should mention that amending rewrites the previous commit
		const description = tool!.description.toLowerCase();
		expect(description).toContain("rewrite") || expect(description).toContain("amend");
	});
});
