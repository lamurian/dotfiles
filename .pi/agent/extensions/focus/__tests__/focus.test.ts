import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSandboxBlockedError } from "../index.ts";

describe("isSandboxBlockedError", () => {
	it("should detect 'blocked' in error text", () => {
		assert.ok(isSandboxBlockedError("Command 'rm' is blocked. Allowed: find, grep, ls"));
	});

	it("should detect 'not in the whitelist' in error text", () => {
		assert.ok(isSandboxBlockedError("Command 'rm' is not in the whitelist. Allowed: find, grep, ls"));
	});

	it("should detect 'not allowed' in error text", () => {
		assert.ok(isSandboxBlockedError("Git subcommand 'commit' is not allowed. Allowed: status, add"));
	});

	it("should detect 'EACCES' in error text", () => {
		assert.ok(isSandboxBlockedError("Error: EACCES: permission denied, open '/project/.env'"));
	});

	it("should detect 'permission denied' in error text", () => {
		assert.ok(isSandboxBlockedError("bwrap: execvp: Permission denied"));
	});

	it("should detect 'bwrap' in error text", () => {
		assert.ok(isSandboxBlockedError("bwrap: execvp ...: No such file or directory"));
	});

	it("should return false for non-blocked error messages", () => {
		assert.equal(isSandboxBlockedError("SyntaxError: Unexpected token"), false);
		assert.equal(isSandboxBlockedError("ReferenceError: x is not defined"), false);
		assert.equal(isSandboxBlockedError(""), false);
	});

	it("should return false for successful command output", () => {
		assert.equal(isSandboxBlockedError("All tests passed!"), false);
		assert.equal(isSandboxBlockedError("✓ 3 passing"), false);
	});

	it("should be case-insensitive for 'BLOCKED' in uppercase", () => {
		assert.ok(isSandboxBlockedError("COMMAND IS BLOCKED: timeout"));
	});

	it("should be case-insensitive for 'Permission Denied' in mixed case", () => {
		assert.ok(isSandboxBlockedError("Permission Denied: cannot read file"));
	});
});
