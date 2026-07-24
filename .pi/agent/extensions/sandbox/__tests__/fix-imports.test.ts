/**
 * Tests verifying sandbox.ts uses only public SDK exports.
 * Ensures createSandboxedBashOps no longer imports private API functions
 * (trackDetachedChildPid, untrackDetachedChildPid, waitForChildProcess, killProcessTree).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── White-box test: verify imports via source analysis ────────────────────────
// These tests check the sandbox.ts source code directly to confirm no broken
// imports remain. This is a regression guard, not a behavior test.

describe("sandbox.ts imports (white-box)", () => {
	const sandboxPath = resolve(__dirname, "..", "sandbox.ts");
	let source: string;

	it("can read sandbox.ts source", () => {
		source = readFileSync(sandboxPath, "utf-8");
		assert.ok(source.length > 0);
	});

	it("does NOT import killProcessTree from the pi SDK", () => {
		const matches = source.match(/import\s*\{[^}]*killProcessTree[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
		assert.equal(matches, null, "killProcessTree should not be imported from the SDK");
	});

	it("does NOT import trackDetachedChildPid from the pi SDK", () => {
		const matches = source.match(/import\s*\{[^}]*trackDetachedChildPid[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
		assert.equal(matches, null, "trackDetachedChildPid should not be imported from the SDK");
	});

	it("does NOT import untrackDetachedChildPid from the pi SDK", () => {
		const matches = source.match(/import\s*\{[^}]*untrackDetachedChildPid[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
		assert.equal(matches, null, "untrackDetachedChildPid should not be imported from the SDK");
	});

	it("does NOT import waitForChildProcess from the pi SDK", () => {
		const matches = source.match(/import\s*\{[^}]*waitForChildProcess[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
		assert.equal(matches, null, "waitForChildProcess should not be imported from the SDK");
	});

	it("imports createLocalBashOperations from the pi SDK", () => {
		const matches = source.match(/import\s*\{[^}]*createLocalBashOperations[^}]*\}\s*from\s*["']@earendil-works\/pi-coding-agent["']/);
		assert.notEqual(matches, null, "createLocalBashOperations must be imported from the SDK");
	});
});

// ── Black-box test: verify the createSandboxedBashOps return value ────────────
describe("createSandboxedBashOps (black-box)", () => {
	it("can be imported without SyntaxError", async () => {
		// This import exercises the module's import chain.
		// If it loads without error, all SDK imports are valid.
		let mod;
		try {
			mod = await import("../sandbox.ts");
		} catch (err) {
			assert.fail(`Failed to import sandbox.ts: ${err instanceof Error ? err.message : String(err)}`);
		}
		assert.ok(mod.createSandboxedBashOps, "createSandboxedBashOps should be exported");
		assert.equal(typeof mod.createSandboxedBashOps, "function");
	});
});
