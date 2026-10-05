/**
 * tool-registration.test.ts — The sandboxed shell tool IS "bash"
 *
 * Verifies the built-in override contract:
 * - The extension registers exactly one shell tool, named `bash`
 *   (SDK default via createBashTool spread), never `sandbox-bash`.
 * - session_start does not rewrite pi's active tool set.
 * - The tool_call guardrail routes `bash` calls to the bash handler.
 *
 * Context: the old `sandbox-bash` rename made models emit `bash` (their
 * trained habit), which failed resolution with "Tool bash not found" and
 * looped. Registering under `bash` makes the habit correct.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sandboxExtension from "../index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ═══════════════════════════════════════════════════════════════════════════════
// Mock ExtensionAPI
// ═══════════════════════════════════════════════════════════════════════════════

interface RegisteredTool {
	name: string;
	label: string;
}

type MockHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

interface MockPi {
	tools: RegisteredTool[];
	handlers: Map<string, MockHandler>;
	activeToolCalls: string[][];
	notifications: string[];
	pi: ExtensionAPI;
}

/**
 * Build a mock ExtensionAPI that records registerTool/on/setActiveTools calls.
 */
function createMockPi(): MockPi {
	const tools: RegisteredTool[] = [];
	const handlers = new Map<string, MockHandler>();
	const activeToolCalls: string[][] = [];
	const notifications: string[] = [];
	const pi = {
		registerFlag: () => {},
		registerTool: (tool: RegisteredTool) => {
			tools.push(tool);
		},
		on: (event: string, handler: MockHandler) => {
			handlers.set(event, handler);
			return () => {};
		},
		registerCommand: () => {},
		getFlag: () => false,
		getActiveTools: () => ["read", "bash", "edit", "write"],
		setActiveTools: (names: string[]) => {
			activeToolCalls.push(names);
		},
	} as unknown as ExtensionAPI;
	return { tools, handlers, activeToolCalls, notifications, pi };
}

/**
 * Build a mock extension context with a notification recorder.
 */
function makeCtx(mock: MockPi, cwd: string): Record<string, unknown> {
	return {
		cwd,
		ui: {
			notify: (msg: string) => {
				mock.notifications.push(msg);
			},
			setStatus: () => {},
			theme: { fg: (_color: string, text: string) => text },
		},
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// T1 — registered tool name
// ═══════════════════════════════════════════════════════════════════════════════

describe("tool registration — bash overrides the built-in", () => {
	it("registers exactly one tool named bash, never sandbox-bash", () => {
		const mock = createMockPi();
		sandboxExtension(mock.pi);
		assert.equal(mock.tools.length, 1, "exactly one tool should be registered");
		assert.equal(mock.tools[0].name, "bash", "the sandboxed tool must be named bash (built-in override)");
		assert.ok(
			!mock.tools.some((t) => t.name === "sandbox-bash"),
			"no sandbox-bash tool may be registered",
		);
	});

	it("keeps a UI label override distinct from the SDK default", () => {
		const mock = createMockPi();
		sandboxExtension(mock.pi);
		// The SDK default label is "bash"; the override must visibly distinguish
		// the sandboxed tool in the UI without changing the model-facing name.
		assert.match(
			mock.tools[0].label,
			/^bash \(/,
			"label override should distinguish the sandboxed tool in the UI",
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// T2 — session_start performs no active-tool rewrite
// ═══════════════════════════════════════════════════════════════════════════════

describe("session_start — no active-tool rewrite", () => {
	it("never calls setActiveTools and always notifies", async () => {
		const mock = createMockPi();
		sandboxExtension(mock.pi);
		const sessionStart = mock.handlers.get("session_start");
		assert.ok(sessionStart, "session_start handler should be registered");

		const tmpCwd = join("/tmp", "sandbox-reg-test-" + Date.now());
		mkdirSync(tmpCwd, { recursive: true });
		try {
			await sessionStart({}, makeCtx(mock, tmpCwd));
			assert.equal(
				mock.activeToolCalls.length,
				0,
				"session_start must not rewrite the active tool set",
			);
			assert.ok(
				mock.notifications.length >= 1,
				"session_start should notify (activation or an error path)",
			);
		} finally {
			rmSync(tmpCwd, { recursive: true, force: true });
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// T3 — tool_call guardrail routes bash to the bash handler
// ═══════════════════════════════════════════════════════════════════════════════

describe("tool_call guardrail — bash routes to the bash handler", () => {
	it("blocks non-whitelisted bash commands after session_start", async (t) => {
		const mock = createMockPi();
		sandboxExtension(mock.pi);
		const sessionStart = mock.handlers.get("session_start");
		const toolCall = mock.handlers.get("tool_call");
		assert.ok(sessionStart && toolCall, "handlers should be registered");

		const tmpCwd = join("/tmp", "sandbox-guard-test-" + Date.now());
		mkdirSync(join(tmpCwd, ".pi"), { recursive: true });
		writeFileSync(
			join(tmpCwd, ".pi", "sandbox.json"),
			JSON.stringify({ bash: { commandWhitelist: ["ls", "grep"] } }),
		);
		try {
			await sessionStart({}, makeCtx(mock, tmpCwd));
			if (!mock.notifications.includes("Sandbox active")) {
				t.skip("bwrap unavailable in this environment — guardrail inactive");
				return;
			}

			const event = { toolName: "bash", input: { command: "docker ps" } };
			const result = (await toolCall(event, makeCtx(mock, tmpCwd))) as
				| { block: boolean; reason: string }
				| undefined;
			assert.ok(result, "non-whitelisted command must be blocked");
			assert.equal(result.block, true, "result should be a block");
			assert.ok(
				result.reason.includes("docker"),
				`reason should name the blocked command, got: ${result.reason}`,
			);
		} finally {
			rmSync(tmpCwd, { recursive: true, force: true });
		}
	});
});
