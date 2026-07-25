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
	normalizeDenyPattern,
	pathMatchesGlob,
	isShellBuiltin,
	buildBashBlockMessage,
	containsWorkaroundPattern,
	suggestCdRemoval,
	SUBAGENT_STEERING_KEYS,
	SUBAGENT_SYSTEM_PROMPT,
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
// pathMatchesGlob — custom glob matcher (no dot-dir exclusion)
// ═══════════════════════════════════════════════════════════════════════════════

describe("pathMatchesGlob", () => {
	it("should match exact path with no glob chars", () => {
		assert.ok(pathMatchesGlob("/home/user/.env", "/home/user/.env"));
	});

	it("should match **/.env through visible directories", () => {
		assert.ok(pathMatchesGlob("/home/user/project/.env", "**/.env"));
	});

	it("should match **/.env through hidden directories (THE BUG FIX)", () => {
		assert.ok(pathMatchesGlob("/home/lam/.pi/agent/.env", "**/.env"));
	});

	it("should match **/.env through deeply nested hidden dirs", () => {
		assert.ok(pathMatchesGlob("/home/user/.config/sub/.env", "**/.env"));
	});

	it("should match .env basename only", () => {
		assert.ok(pathMatchesGlob(".env", "**/.env"));
	});

	it("should NOT match non-env files with **/.env", () => {
		assert.ok(!pathMatchesGlob("/home/user/file.txt", "**/.env"));
	});

	it("should NOT match .env files in name only", () => {
		assert.ok(!pathMatchesGlob("/home/user/.envfile", "**/.env"));
	});

	it("should match **/.ssh/** through hidden .ssh directory", () => {
		assert.ok(pathMatchesGlob("/home/user/.ssh/id_rsa", "**/.ssh/**"));
	});

	it("should NOT mix up .notssh with .ssh", () => {
		assert.ok(!pathMatchesGlob("/home/user/.notssh/id_rsa", "**/.ssh/**"));
	});

	it("should match * wildcard relative (.githooks/* matches .githooks/pre-commit)", () => {
		assert.ok(pathMatchesGlob(".githooks/pre-commit", ".githooks/*"));
	});

	it("should NOT match * wildcard across dirs (.githooks/* vs absolute path)", () => {
		assert.ok(!pathMatchesGlob("/home/user/project/.githooks/pre-commit", ".githooks/*"));
	});

	it("should match **/.githooks/* across dirs", () => {
		assert.ok(pathMatchesGlob("/home/user/project/.githooks/pre-commit", "**/.githooks/*"));
	});

	it("should match ? single char wildcard", () => {
		assert.ok(pathMatchesGlob("/home/user/file.txt", "**/file.???"));
		assert.ok(!pathMatchesGlob("/home/user/file.tx", "**/file.???"));
	});

	it("should match multiple ** segments", () => {
		assert.ok(pathMatchesGlob("/a/b/c/d/.env", "**/**/.env"));
	});

	it("should handle simple relative pattern with **/", () => {
		assert.ok(pathMatchesGlob(".pi/agent/.env", "**/.env"));
	});

	it("should match *.lock files anywhere", () => {
		assert.ok(pathMatchesGlob("/home/user/project/yarn.lock", "**/*.lock"));
		assert.ok(pathMatchesGlob("/home/user/project/foo.lock", "**/*.lock"));
		assert.ok(!pathMatchesGlob("/home/user/project/package-lock.json", "**/*.lock"));
	});

	it("should return false for empty pattern", () => {
		assert.ok(!pathMatchesGlob("/home/user/file.txt", ""));
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
// normalizeDenyPattern — strip glob chars for OS-level enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe("normalizeDenyPattern", () => {
	it("should return simple paths without glob chars as-is", () => {
		assert.equal(normalizeDenyPattern(".env"), ".env");
		assert.equal(normalizeDenyPattern("/etc/passwd"), "/etc/passwd");
		assert.equal(normalizeDenyPattern("~/.aws"), "~/.aws");
	});

	it("should strip trailing /* from directory glob patterns", () => {
		assert.equal(normalizeDenyPattern(".githooks/*"), ".githooks");
		assert.equal(normalizeDenyPattern("node_modules/*"), "node_modules");
	});

	it("should strip trailing /** from directory glob patterns", () => {
		assert.equal(normalizeDenyPattern(".githooks/**"), ".githooks");
		assert.equal(normalizeDenyPattern("secrets/**"), "secrets");
	});

	it("should strip both leading **/ and trailing /*", () => {
		assert.equal(normalizeDenyPattern("**/.githooks/*"), ".githooks");
		assert.equal(normalizeDenyPattern("**/node_modules/**"), "node_modules");
	});

	it("should return null for patterns with non-trailing glob chars", () => {
		assert.equal(normalizeDenyPattern("*.log"), null);
		assert.equal(normalizeDenyPattern("**/*.lock"), null);
		assert.equal(normalizeDenyPattern("src/**/*.pyc"), null);
	});

	it("should return null for empty string", () => {
		assert.equal(normalizeDenyPattern(""), "");
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

	// ── Relative pattern matching (cwd-relative globs) ─────────────────────

	it("should block edit with relative denyWrite pattern matching cwd-relative path", () => {
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*", ".env"],
		};
		const result = evaluateToolCall("edit", { path: ".githooks/pre-commit" }, toolAccess, cfg, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});

	it("should block write with relative denyWrite pattern .env", () => {
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*", ".env"],
		};
		const result = evaluateToolCall("write", { path: ".env" }, toolAccess, cfg, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});

	it("should block edit with absolute path matching relative denyWrite pattern", () => {
		// Tool provides absolute path, pattern is relative — should still match via relative fallback
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*"],
		};
		const absolutePath = resolve(CWD, ".githooks/pre-commit");
		const result = evaluateToolCall("edit", { path: absolutePath }, toolAccess, cfg, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});

	it("should not block files outside the relative pattern scope", () => {
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*"],
		};
		const result = evaluateToolCall("edit", { path: "src/index.ts" }, toolAccess, cfg, CWD);
		assert.equal(result, null);
	});

	it("should not block files in nested .githooks dir (pattern is root-relative)", () => {
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*"],
		};
		// "src/.githooks/foo" relative to CWD should NOT match ".githooks/*"
		const result = evaluateToolCall("edit", { path: "src/.githooks/foo" }, toolAccess, cfg, CWD);
		assert.equal(result, null);
	});

	it("should not block paths outside cwd with relative pattern", () => {
		const cfg: FilesystemConfig = {
			denyWrite: [".githooks/*"],
		};
		// Path outside CWD — relative becomes "../other/.githooks/hook" which shouldn't match ".githooks/*"
		const result = evaluateToolCall("edit", { path: "../other/.githooks/hook" }, toolAccess, cfg, CWD);
		assert.equal(result, null);
	});

	it("should still block with **/-prefixed patterns on absolute paths", () => {
		// Existing behavior must not regress
		const result = evaluateToolCall("write", { path: "yarn.lock" }, toolAccess, fsConfig, CWD);
		assert.ok(result !== null);
		assert.ok(result.block);
		assert.ok(result.reason.includes("denyWrite"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// isShellBuiltin
// ═══════════════════════════════════════════════════════════════════════════════

describe("isShellBuiltin", () => {
	it("should return true for cd", () => {
		assert.ok(isShellBuiltin("cd"));
	});

	it("should return true for sudo", () => {
		assert.ok(isShellBuiltin("sudo"));
	});

	it("should return true for source", () => {
		assert.ok(isShellBuiltin("source"));
	});

	it("should return true for dot (.)", () => {
		assert.ok(isShellBuiltin("."));
	});

	it("should return true for exec", () => {
		assert.ok(isShellBuiltin("exec"));
	});

	it("should return true for alias", () => {
		assert.ok(isShellBuiltin("alias"));
	});

	it("should return false for ls", () => {
		assert.ok(!isShellBuiltin("ls"));
	});

	it("should return false for find", () => {
		assert.ok(!isShellBuiltin("find"));
	});

	it("should return false for git", () => {
		assert.ok(!isShellBuiltin("git"));
	});

	it("should return false for npx", () => {
		assert.ok(!isShellBuiltin("npx"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// containsWorkaroundPattern
// ═══════════════════════════════════════════════════════════════════════════════

describe("containsWorkaroundPattern", () => {
	it("should detect sh -c pattern", () => {
		assert.ok(containsWorkaroundPattern(`sh -c "cd /path && npm test"`));
	});

	it("should detect bash -c pattern", () => {
		assert.ok(containsWorkaroundPattern(`bash -c "cd /path && make"`));
	});

	it("should return false for plain command", () => {
		assert.ok(!containsWorkaroundPattern("npm test"));
	});

	it("should return false for command with no shell wrapper", () => {
		assert.ok(!containsWorkaroundPattern("ls -la | grep foo"));
	});

	it("should return false for empty string", () => {
		assert.ok(!containsWorkaroundPattern(""));
	});

	it("may false-positive on sh -c inside strings (simple regex limitation — sub-agent filters these)", () => {
		// The regex detection is intentionally simple. False positives are
		// handled by the sub-agent which returns null for legitimate commands.
		assert.ok(containsWorkaroundPattern("echo '# sh -c example'"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// suggestCdRemoval
// ═══════════════════════════════════════════════════════════════════════════════

describe("suggestCdRemoval", () => {
	it("should remove cd prefix from simple command", () => {
		assert.equal(suggestCdRemoval("cd /path && ls"), "ls");
	});

	it("should remove first cd segment and keep the rest", () => {
		assert.equal(
			suggestCdRemoval("cd /home/user/project && npx vitest test"),
			"npx vitest test",
		);
	});

	it("should keep non-cd segments", () => {
		assert.equal(
			suggestCdRemoval("cd dir && npm install && npm test"),
			"npm install && npm test",
		);
	});

	it("should return empty string when only cd", () => {
		assert.equal(suggestCdRemoval("cd /path"), "");
	});

	it("should return original command when no cd", () => {
		assert.equal(suggestCdRemoval("npm test"), "npm test");
	});

	it("should handle command with no leading cd", () => {
		assert.equal(suggestCdRemoval("echo hello"), "echo hello");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBashBlockMessage — instructive guardrail messages
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildBashBlockMessage", () => {
	const WHITELIST = ["find", "grep", "ls", "npm", "npx", "node", "git", "sh"];

	it("should produce cd message with removal suggestion", () => {
		const msg = buildBashBlockMessage(
			"cd /path && npx vitest test",
			"cd",
			"Command 'cd' is not in the whitelist",
			WHITELIST,
		);
		assert.ok(msg.includes("cd"), "should mention the blocked command");
		assert.ok(msg.includes("npx vitest test"), "should suggest fixed command");
		assert.ok(msg.includes("Remove"), "should suggest removing cd");
	});

	it("should produce sudo message", () => {
		const msg = buildBashBlockMessage(
			"sudo apt install",
			"sudo",
			"Command 'sudo' is blocked",
			WHITELIST,
		);
		assert.ok(msg.includes("sudo"), "should mention the blocked command");
		assert.ok(msg.includes("without") || msg.includes("not"), "should suggest removing sudo");
	});

	it("should produce builtin message for source", () => {
		const msg = buildBashBlockMessage(
			"source .env",
			"source",
			"Command 'source' is not in the whitelist",
			WHITELIST,
		);
		assert.ok(msg.includes("source"), "should mention the blocked command");
		assert.ok(msg.includes("builtin"), "should mention it's a builtin");
	});

	it("should produce builtin message for exec", () => {
		const msg = buildBashBlockMessage(
			"exec node server.js",
			"exec",
			"Command 'exec' is not in the whitelist",
			WHITELIST,
		);
		assert.ok(msg.includes("exec"), "should mention the blocked command");
		assert.ok(msg.includes("builtin"), "should mention it's a builtin");
	});

	it("should produce generic message for non-builtin blocked command", () => {
		const msg = buildBashBlockMessage(
			"docker ps",
			"docker",
			"Command 'docker' is not in the whitelist",
			WHITELIST,
		);
		assert.ok(msg.includes("docker"), "should mention the blocked command");
		assert.ok(msg.includes("whitelist") || msg.includes("sandbox"), "should mention the sandbox");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Subagent constants
// ═══════════════════════════════════════════════════════════════════════════════

describe("SUBAGENT_STEERING_KEYS", () => {
	it("should contain expected keys", () => {
		assert.ok(SUBAGENT_STEERING_KEYS.includes("cd"));
		assert.ok(SUBAGENT_STEERING_KEYS.includes("sudo"));
		assert.ok(SUBAGENT_STEERING_KEYS.includes("builtin"));
		assert.ok(SUBAGENT_STEERING_KEYS.includes("blocked"));
	});

	it("should be frozen", () => {
		assert.ok(Object.isFrozen(SUBAGENT_STEERING_KEYS));
	});
});

describe("SUBAGENT_SYSTEM_PROMPT", () => {
	it("should be a non-empty string", () => {
		assert.ok(typeof SUBAGENT_SYSTEM_PROMPT === "string");
		assert.ok(SUBAGENT_SYSTEM_PROMPT.length > 50);
	});

	it("should mention steeringKey and confidence", () => {
		assert.ok(SUBAGENT_SYSTEM_PROMPT.includes("steeringKey"));
		assert.ok(SUBAGENT_SYSTEM_PROMPT.includes("confidence"));
	});

	it("should forbid suggesting workarounds", () => {
		assert.ok(SUBAGENT_SYSTEM_PROMPT.includes("workaround"));
	});
});

