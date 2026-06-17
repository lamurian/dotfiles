import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	isPathDenied,
	checkToolAccess,
	expandTilde,
	mergeToolConfigs,
	getToolPaths,
	evaluateToolCall,
	type FilesystemConfig,
	type ToolConfig,
	type ToolAccess,
} from "../guardrail.ts";

const HOME = homedir();

// ═══════════════════════════════════════════════════════════════════════════════
// expandTilde
// ═══════════════════════════════════════════════════════════════════════════════

describe("expandTilde", () => {
	it("should expand ~/ to homedir", () => {
		assert.equal(expandTilde("~/foo"), resolve(HOME, "foo"));
	});

	it("should return path unchanged if no tilde", () => {
		assert.equal(expandTilde("/absolute/path"), "/absolute/path");
	});

	it("should handle ~ alone", () => {
		assert.equal(expandTilde("~"), HOME);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// isPathDenied — glob pattern matching against deny lists
// ═══════════════════════════════════════════════════════════════════════════════

describe("isPathDenied", () => {
	it("should match exact file path", () => {
		assert.ok(isPathDenied("/home/user/secrets/key.txt", ["/home/user/secrets/key.txt"]));
	});

	it("should match with **/ prefix glob", () => {
		assert.ok(isPathDenied("/home/user/project/secrets/key.txt", ["**/secrets/**"]));
	});

	it("should match deep nested paths", () => {
		assert.ok(isPathDenied("/var/lib/project/node_modules/foo/bar/index.js", ["**/node_modules/**"]));
	});

	it("should match *.lock files anywhere", () => {
		assert.ok(isPathDenied("/home/user/project/yarn.lock", ["**/*.lock"]));
		assert.ok(isPathDenied("/home/user/project/foo.lock", ["**/*.lock"]));
		assert.ok(!isPathDenied("/home/user/project/package-lock.json", ["**/*.lock"]));
	});

	it("should not match when pattern does not apply", () => {
		assert.ok(!isPathDenied("/home/user/project/src/index.ts", ["**/secrets/**"]));
	});

	it("should not match similar but different paths", () => {
		assert.ok(!isPathDenied("/home/user/.notssh/key.txt", ["**/.ssh/**"]));
	});

	it("should match tilde-expanded home directory patterns", () => {
		assert.ok(isPathDenied(`${HOME}/.ssh/id_rsa`, ["~/.ssh/**"]));
		assert.ok(isPathDenied(`${HOME}/.aws/config`, ["~/.aws/**"]));
	});

	it("should handle multiple patterns and match any", () => {
		const patterns = ["**/secrets/**", "**/*.env", "**/*.lock"];
		assert.ok(isPathDenied("/home/user/project/secrets/db.txt", patterns));
		assert.ok(isPathDenied("/home/user/project/foo.env", patterns));
		assert.ok(isPathDenied("/home/user/project/yarn.lock", patterns));
		assert.ok(!isPathDenied("/home/user/project/src/index.ts", patterns));
	});

	it("should return false for empty patterns list", () => {
		assert.ok(!isPathDenied("/home/user/file.txt", []));
	});

	it("should match with trailing /** pattern on directory", () => {
		assert.ok(isPathDenied(`${HOME}/.ssh/subdir/key`, ["~/.ssh/**"]));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// checkToolAccess — permission logic combining denyRead and denyWrite
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkToolAccess", () => {
	const fsConfig: FilesystemConfig = {
		denyRead: ["**/secrets/**", "~/.ssh/**"],
		denyWrite: ["**/*.lock", "**/node_modules/**"],
	};
	const home = HOME;

	it("should allow read access to non-denied paths", () => {
		assert.equal(checkToolAccess(["read"], "/home/user/project/src/index.ts", fsConfig), null);
	});

	it("should allow write access to non-denied paths", () => {
		assert.equal(checkToolAccess(["write"], "/home/user/project/src/index.ts", fsConfig), null);
	});

	it("should allow read+write access to non-denied paths", () => {
		assert.equal(checkToolAccess(["read", "write"], "/home/user/project/src/index.ts", fsConfig), null);
	});

	it("should block read access to denyRead paths", () => {
		const result = checkToolAccess(["read"], "/home/user/project/secrets/db.txt", fsConfig);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyRead"));
	});

	it("should block write access to denyRead paths", () => {
		const result = checkToolAccess(["write"], `${home}/.ssh/id_rsa`, fsConfig);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyRead"));
	});

	it("should block both read and write for denyRead paths", () => {
		const result = checkToolAccess(["read", "write"], "/home/user/project/secrets/db.txt", fsConfig);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyRead"));
	});

	it("should allow read access to denyWrite-only paths", () => {
		assert.equal(checkToolAccess(["read"], "/home/user/project/node_modules/pkg/index.js", fsConfig), null);
	});

	it("should block write access to denyWrite paths", () => {
		const result = checkToolAccess(["write"], "/home/user/project/yarn.lock", fsConfig);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyWrite"));
	});

	it("should block edit (read+write) access to denyWrite paths", () => {
		const result = checkToolAccess(["read", "write"], "/home/user/project/yarn.lock", fsConfig);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyWrite"));
	});

	it("should allow write access to paths not in any deny list", () => {
		assert.equal(checkToolAccess(["write"], "/home/user/project/src/lib/helper.ts", fsConfig), null);
	});

	it("should handle empty fsConfig gracefully", () => {
		assert.equal(checkToolAccess(["read"], "/home/user/file.txt", {}), null);
		assert.equal(checkToolAccess(["write"], "/home/user/file.txt", {}), null);
	});

	it("should denyRead take precedence over denyWrite", () => {
		const cfg: FilesystemConfig = {
			denyRead: ["**/secrets/**"],
			denyWrite: ["**/secrets/**"],
		};
		const result = checkToolAccess(["read", "write"], "/home/user/secrets/file.txt", cfg);
		assert.ok(result !== null);
		assert.ok(result!.includes("denyRead"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// mergeToolConfigs — merging user config with built-in defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe("mergeToolConfigs", () => {
	const defaults = {
		read: { access: ["read"] as ToolAccess[], pathParams: ["path"] },
		write: { access: ["write"] as ToolAccess[], pathParams: ["path"] },
		edit: { access: ["read", "write"] as ToolAccess[], pathParams: ["path"] },
	};

	it("should return defaults when no user config", () => {
		const result = mergeToolConfigs(undefined, defaults);
		assert.equal(Object.keys(result).length, 3);
		assert.deepEqual(result.read.access, ["read"]);
		assert.deepEqual(result.edit.access, ["read", "write"]);
	});

	it("should override defaults with user config", () => {
		const result = mergeToolConfigs({ read: ["write"] }, defaults);
		assert.deepEqual(result.read.access, ["write"]);
	});

	it("should add new tools from user config", () => {
		const result = mergeToolConfigs({ "my-tool": ["read"] }, {});
		assert.deepEqual(result["my-tool"].access, ["read"]);
		assert.deepEqual(result["my-tool"].pathParams, ["path"]);
	});

	it("should handle full ToolConfig objects with custom pathParams", () => {
		const result = mergeToolConfigs(
			{ "my-tool": { access: ["read"], pathParams: ["targetFile"] } },
			{},
		);
		assert.deepEqual(result["my-tool"].access, ["read"]);
		assert.deepEqual(result["my-tool"].pathParams, ["targetFile"]);
	});

	it("should preserve defaults for tools not in user config", () => {
		const result = mergeToolConfigs({ write: ["write"] }, defaults);
		assert.deepEqual(result.read.access, ["read"]); // unchanged
		assert.deepEqual(result.write.access, ["write"]); // overridden (same value)
		assert.deepEqual(result.edit.access, ["read", "write"]); // unchanged
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// getToolPaths — extracting file paths from tool parameters
// ═══════════════════════════════════════════════════════════════════════════════

describe("getToolPaths", () => {
	it("should extract path from params", () => {
		const paths = getToolPaths("read", { path: "/foo/bar.txt" });
		assert.deepEqual(paths, ["/foo/bar.txt"]);
	});

	it("should use custom pathParams from tool config", () => {
		const paths = getToolPaths("my-tool", { targetFile: "/foo/bar.txt" }, { access: ["read"], pathParams: ["targetFile"] });
		assert.deepEqual(paths, ["/foo/bar.txt"]);
	});

	it("should return empty array for non-path params", () => {
		const paths = getToolPaths("bash", { command: "echo hello" });
		assert.deepEqual(paths, []);
	});

	it("should fall back to file_path if path is not found and pathParams defaults", () => {
		const paths = getToolPaths("read", { file_path: "/foo/bar.txt" });
		assert.deepEqual(paths, ["/foo/bar.txt"]);
	});

	it("should skip empty string values", () => {
		const paths = getToolPaths("read", { path: "" });
		assert.deepEqual(paths, []);
	});

	it("should skip non-string path values", () => {
		const paths = getToolPaths("read", { path: 42 });
		assert.deepEqual(paths, []);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateToolCall — end-to-end guardrail evaluation
// ═══════════════════════════════════════════════════════════════════════════════

describe("evaluateToolCall", () => {
	const toolAccess = mergeToolConfigs({
		read: ["read"],
		write: ["write"],
		edit: ["read", "write"],
	});

	const fsConfig: FilesystemConfig = {
		denyRead: ["**/secrets/**", "~/.ssh/**"],
		denyWrite: ["**/*.lock", "**/node_modules/**"],
	};

	const CWD = "/home/user/project";

	it("should allow read on non-denied path", () => {
		const result = evaluateToolCall("read", { path: "src/index.ts" }, toolAccess, fsConfig, CWD);
		assert.equal(result, null);
	});

	it("should block read on denyRead path", () => {
		const result = evaluateToolCall("read", { path: "secrets/db.txt" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyRead"));
	});

	it("should block write on denyWrite path", () => {
		const result = evaluateToolCall("write", { path: "yarn.lock" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});

	it("should block edit on denyWrite path via read+write check", () => {
		const result = evaluateToolCall("edit", { path: "node_modules/pkg/index.js" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});

	it("should block write on denyRead path (implied)", () => {
		const result = evaluateToolCall("write", { path: `${HOME}/.ssh/id_rsa` }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyRead"));
	});

	it("should allow unconfigured tools", () => {
		const result = evaluateToolCall("unknown-tool", { path: "anything" }, toolAccess, fsConfig, CWD);
		assert.equal(result, null);
	});

	it("should allow tools with no path params", () => {
		const result = evaluateToolCall("ls", { limit: 10 }, toolAccess, fsConfig, CWD);
		assert.equal(result, null);
	});

	it("should resolve relative paths against cwd", () => {
		const result = evaluateToolCall("read", { path: "secrets/db.txt" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
	});

	it("should handle absolute paths correctly", () => {
		const result = evaluateToolCall("read", { path: "/etc/passwd" }, toolAccess, fsConfig, CWD);
		assert.equal(result, null); // not in any deny list
	});

	it("should include the raw path in the error message", () => {
		const result = evaluateToolCall("read", { path: "secrets/db.txt" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.reason.includes("secrets/db.txt"));
	});
});
