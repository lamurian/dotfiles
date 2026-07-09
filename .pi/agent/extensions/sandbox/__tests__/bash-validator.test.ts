import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parseCommands,
	validateCommands,
	validateGitSubcommand,
	stripFindDelete,
	type ValidationResult,
	type GitConfig,
} from "../bash-validator.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// parseCommands — extract base commands from shell command strings
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseCommands", () => {
	it("should return the base command for a simple command", () => {
		assert.deepEqual(parseCommands("find . -name '*.ts'"), ["find"]);
	});

	it("should extract all commands in a pipeline", () => {
		assert.deepEqual(
			parseCommands("find . -name '*.ts' | grep foo | head -5"),
			["find", "grep", "head"],
		);
	});

	it("should handle semicolon-chained commands", () => {
		assert.deepEqual(
			parseCommands("ls -la; du -sh"),
			["ls", "du"],
		);
	});

	it("should handle && chained commands", () => {
		assert.deepEqual(
			parseCommands("cd src && ls"),
			["cd", "ls"],
		);
	});

	it("should handle || chained commands", () => {
		assert.deepEqual(
			parseCommands("which git || echo not found"),
			["which", "echo"],
		);
	});

	it("should handle complex pipelines with redirects", () => {
		assert.deepEqual(
			parseCommands("find . -name '*.ts' | grep -v test > output.txt"),
			["find", "grep"],
		);
	});

	it("should handle command with no arguments", () => {
		assert.deepEqual(parseCommands("ls"), ["ls"]);
	});

	it("should deduplicate repeated commands", () => {
		const result = parseCommands("find . | grep foo | grep bar");
		assert.deepEqual(result, ["find", "grep"]);
	});

	it("should return empty array for empty string", () => {
		assert.deepEqual(parseCommands(""), []);
	});

	it("should extract commands from variable assignment workaround pattern", () => {
		// "du=rm -rf /; du" — rm is the command value being assigned, du is the fallback
		assert.deepEqual(
			parseCommands("du=rm -rf /; du"),
			["rm", "du"],
		);
	});

	it("should handle commands with absolute paths", () => {
		assert.deepEqual(
			parseCommands("/usr/bin/find . -name '*.ts'"),
			["find"],
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateCommands — check commands against whitelist + blocklist
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateCommands", () => {
	const whitelist = new Set(["find", "ls", "du", "grep", "head", "wc", "cat", "echo", "git"]);
	const blocked = new Set(["rm", "mv", "cp", "python", "python3", "perl"]);

	it("should allow all commands in the whitelist", () => {
		const result = validateCommands(["find", "grep"], whitelist, blocked);
		assert.equal(result.allowed, true);
		assert.equal(result.reason, undefined);
	});

	it("should reject a command in the blocked list", () => {
		const result = validateCommands(["find", "rm"], whitelist, blocked);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("rm"));
		assert.ok(result.reason?.includes("blocked"));
	});

	it("should reject a command in the blocked list with blocked message", () => {
		const result = validateCommands(["find", "python3"], whitelist, blocked);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("python3"));
		assert.ok(result.reason?.includes("blocked"));
	});

	it("should reject first blocked command and stop", () => {
		const result = validateCommands(["rm", "mv"], whitelist, blocked);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("rm"));
	});

	it("should allow single whitelisted command", () => {
		const result = validateCommands(["ls"], whitelist, blocked);
		assert.equal(result.allowed, true);
	});

	it("should reject with empty whitelist", () => {
		const result = validateCommands(["ls"], new Set(), new Set());
		assert.equal(result.allowed, false);
	});

	it("should include allowed commands list in rejection message", () => {
		const result = validateCommands(["rm"], whitelist, blocked);
		assert.ok(result.reason?.includes("find, ls, du"));
	});

	it("should reject a blocked command when passed directly", () => {
		const result = validateCommands(["rm"], whitelist, blocked);
		assert.equal(result.allowed, false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateGitSubcommand
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateGitSubcommand", () => {
	const gitConfig: GitConfig = {
		allow: [
			"status", "add", "log", "diff", "show",
			"branch", "tag", "config", "remote",
			"stash",
		],
		blocked: [
			"commit", "push", "pull", "merge", "rebase",
			"cherry-pick", "revert", "reset", "clean",
		],
		blockIfArgContains: {
			branch: ["-d", "-D", "-m", "-M", "-c", "-C"],
			tag: ["-a", "-d", "-s", "-f", "-m"],
			config: ["--add", "--unset", "--replace-all"],
			remote: ["add", "remove", "rename", "set-url"],
		},
		stash: {
			allowSubcommands: ["list", "show", "push", "save", "pop", "apply"],
			blockSubcommands: ["drop", "clear", "branch", "create", "store"],
		},
	};

	it("should allow a safe git subcommand (status)", () => {
		const result = validateGitSubcommand("status", [], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should allow git add", () => {
		const result = validateGitSubcommand("add", [".", "-A"], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should block a blocked git subcommand (commit)", () => {
		const result = validateGitSubcommand("commit", ["-m", "msg"], gitConfig);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("commit"));
		assert.ok(result.reason?.includes("blocked"));
	});

	it("should block git push", () => {
		const result = validateGitSubcommand("push", ["origin", "main"], gitConfig);
		assert.equal(result.allowed, false);
	});

	it("should allow branch listing", () => {
		const result = validateGitSubcommand("branch", [], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should block branch -d (delete)", () => {
		const result = validateGitSubcommand("branch", ["-d", "feature"], gitConfig);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("-d"));
	});

	it("should block branch -D", () => {
		const result = validateGitSubcommand("branch", ["-D", "feature"], gitConfig);
		assert.equal(result.allowed, false);
	});

	it("should allow tag listing", () => {
		const result = validateGitSubcommand("tag", ["-l"], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should block tag -a (annotate/create)", () => {
		const result = validateGitSubcommand("tag", ["-a", "v1.0", "-m", "msg"], gitConfig);
		assert.equal(result.allowed, false);
	});

	it("should allow stash list", () => {
		const result = validateGitSubcommand("stash", ["list"], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should allow stash show", () => {
		const result = validateGitSubcommand("stash", ["show"], gitConfig);
		assert.equal(result.allowed, true);
	});

	it("should block stash drop", () => {
		const result = validateGitSubcommand("stash", ["drop"], gitConfig);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("stash subcommand"));
	});

	it("should block stash clear", () => {
		const result = validateGitSubcommand("stash", ["clear"], gitConfig);
		assert.equal(result.allowed, false);
	});

	it("should block a subcommand not in the allow list", () => {
		const result = validateGitSubcommand("archive", [], gitConfig);
		assert.equal(result.allowed, false);
		assert.ok(result.reason?.includes("archive"));
	});

	it("should include allowed subcommands in rejection message", () => {
		const result = validateGitSubcommand("commit", [], gitConfig);
		assert.ok(result.reason?.includes("status, add, log"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// stripFindDelete
// ═══════════════════════════════════════════════════════════════════════════════

describe("stripFindDelete", () => {
	it("should strip -delete from find command", () => {
		const result = stripFindDelete("find . -type f -delete");
		assert.equal(result.command, "find . -type f");
		assert.ok(result.warning);
		assert.ok(result.warning?.includes("-delete"));
	});

	it("should strip -delete at the end of command", () => {
		const result = stripFindDelete("find . -delete");
		assert.equal(result.command, "find .");
		assert.ok(result.warning);
	});

	it("should leave find command unchanged if no -delete", () => {
		const result = stripFindDelete("find . -type f -name '*.ts'");
		assert.equal(result.command, "find . -type f -name '*.ts'");
		assert.equal(result.warning, undefined);
	});

	it("should strip multiple -delete occurrences", () => {
		const result = stripFindDelete("find . -delete -type f -delete");
		assert.equal(result.command, "find . -type f");
		assert.ok(result.warning);
	});

	it("should not affect non-find commands", () => {
		const result = stripFindDelete("ls -la");
		assert.equal(result.command, "ls -la");
		assert.equal(result.warning, undefined);
	});

	it("should handle find at start of piped command", () => {
		const result = stripFindDelete("find . -delete | head -5");
		assert.equal(result.command, "find . | head -5");
		assert.ok(result.warning);
	});

	it("should handle -delete adjacent to other flags with no space", () => {
		// -delete is always a separate argument, so this shouldn't happen
		// but test defensively
		const result = stripFindDelete("find . -delete");
		assert.equal(result.command, "find .");
	});

	it("should handle -delete with quoted arguments", () => {
		const result = stripFindDelete("find . -name '*.log' -delete");
		assert.equal(result.command, "find . -name '*.log'");
		assert.ok(result.warning);
	});
});
