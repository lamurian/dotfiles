import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBwrapArgs, createSandboxedBashOps, type SandboxConfig } from "../index.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — network isolation logic
// ═══════════════════════════════════════════════════════════════════════════════

const CWD = "/home/user/project";

describe("buildBwrapArgs — network", () => {
	it("should NOT add --unshare-net and return needsSocat=false when allowedDomains is non-empty", () => {
		const config: SandboxConfig = {
			network: {
				allowedDomains: ["npmjs.org", "github.com"],
			},
		};
		const result = buildBwrapArgs(CWD, config);
		assert.equal(result.needsSocat, false);
		assert.ok(!result.args.includes("--unshare-net"), "should not add --unshare-net when allowedDomains is set");
	});

	it("should add --unshare-net and return needsSocat=false when allowedDomains is empty", () => {
		const config: SandboxConfig = {
			network: {
				allowedDomains: [],
			},
		};
		const result = buildBwrapArgs(CWD, config);
		assert.equal(result.needsSocat, false);
		assert.ok(result.args.includes("--unshare-net"), "should add --unshare-net when allowedDomains is empty");
	});

	it("should add --unshare-net and return needsSocat=false when network config is absent", () => {
		const config: SandboxConfig = {};
		const result = buildBwrapArgs(CWD, config);
		assert.equal(result.needsSocat, false);
		assert.ok(result.args.includes("--unshare-net"), "should add --unshare-net when no network config");
	});

	it("should still include filesystem args regardless of network setting", () => {
		const config: SandboxConfig = {
			network: {
				allowedDomains: ["npmjs.org"],
			},
		};
		const result = buildBwrapArgs(CWD, config);
		assert.ok(result.args.includes("--ro-bind"), "should include filesystem mount args");
		assert.ok(result.args.includes("--proc"), "should include /proc mount");
		assert.ok(result.args.includes("--dev"), "should include /dev mount");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// createSandboxedBashOps — should not throw on config reference
// ═══════════════════════════════════════════════════════════════════════════════

describe("createSandboxedBashOps", () => {
	it("should return BashOperations without throwing", () => {
		const ops = createSandboxedBashOps({});
		assert.ok(ops, "should return a BashOperations object");
		assert.equal(typeof ops.exec, "function", "should have an exec method");
	});

	it("should not throw ReferenceError when exec is called", async () => {
		const ops = createSandboxedBashOps({});
		try {
			// This will try to build a bwrap command using config.
			// Before the fix, this throws: "config is not defined"
			await ops.exec("echo hello", CWD, {});
		} catch (err) {
			// We expect a non-ReferenceError (e.g., bwrap not found in test env, or IO error).
			// A ReferenceError means the config variable is not in scope.
			if (err instanceof ReferenceError) {
				assert.fail(`Got ReferenceError: ${err.message} — config variable is not in scope`);
			}
			// Any other error (ENOENT for bwrap, missing directory, etc.) is fine for this test
		}
	});
});
