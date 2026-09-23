import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
	buildBwrapArgs,
	createSandboxedBashOps,
	getDiscoveredFiles,
	clearDiscoveredCache,
	clearBwrapArgsCache,
	discoverPaths,
	resolveBinaries,
	type SandboxConfig,
} from "../index.ts";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

const TMP = join("/tmp", "sandbox-test-" + Date.now());
const CWD = join(TMP, "project");

function createTestEnv(): void {
	rmSync(TMP, { recursive: true, force: true });
	// project root
	mkdirSync(join(TMP, "project"), { recursive: true });
	writeFileSync(join(TMP, "project", ".env"), "SECRET=exposed");
	// hidden dir
	mkdirSync(join(TMP, "project", ".config"), { recursive: true });
	writeFileSync(join(TMP, "project", ".config", ".env"), "KEY=value");
	// nested visible dir
	mkdirSync(join(TMP, "project", "src"), { recursive: true });
	writeFileSync(join(TMP, "project", "src", ".env"), "DB=prod");
	// non-.env file (should NOT be discovered)
	writeFileSync(join(TMP, "project", "note.txt"), "hello");
	// .env outside HOME hunt (should still be found via writable paths)
	mkdirSync(join(TMP, "external"), { recursive: true });
	writeFileSync(join(TMP, "external", ".env"), "EXT=secret");
}

// ═══════════════════════════════════════════════════════════════════════════════
// getDiscoveredFiles — lazy .env discovery
// ═══════════════════════════════════════════════════════════════════════════════

describe("getDiscoveredFiles", () => {
	before(() => createTestEnv());
	after(() => rmSync(TMP, { recursive: true, force: true }));

	it("should find .env files in cwd and subdirectories", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				allowWrite: [TMP],
			},
		};
		const files = getDiscoveredFiles(CWD, config);
		assert.ok(files.length >= 3, `expected ≥3 .env files, got ${files.length}: ${files.join(", ")}`);
		assert.ok(files.some((f) => f.includes("project/.env")), "should find project/.env");
		assert.ok(
			files.some((f) => f.includes(".config/.env")),
			"should find .env in hidden dir",
		);
		assert.ok(
			files.some((f) => f.includes("external/.env")),
			"should find .env in writable paths",
		);
	});

	it("should NOT include non-.env files", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				allowWrite: [TMP],
			},
		};
		const files = getDiscoveredFiles(CWD, config);
		assert.ok(!files.some((f) => f.includes("note.txt")), "should not include non-.env files");
	});

	it("should cache results and return same set on second call", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				allowWrite: [TMP],
			},
		};
		const first = getDiscoveredFiles(CWD, config);
		const second = getDiscoveredFiles(CWD, config);
		assert.deepEqual(first, second);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — network isolation + filesystem deny
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildBwrapArgs — deny .env files", () => {
	before(() => createTestEnv());
	after(() => rmSync(TMP, { recursive: true, force: true }));

	it("should add --ro-bind /dev/null for each discovered .env file when **/.env is in denyRead", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyRead: ["**/.env"],
				allowWrite: [TMP],
			},
		};
		const result = buildBwrapArgs(CWD, config);

		// Count --ro-bind /dev/null entries
		const nullBinds = result.args.filter(
			(_, i) => result.args[i] === "--ro-bind" && result.args[i + 1] === "/dev/null",
		);
		assert.ok(nullBinds.length >= 3, `expected ≥3 /dev/null binds, got ${nullBinds.length}`);

		// Each .env file should have a /dev/null mount
		const envPaths = result.args.filter((_, i) => {
			const next = result.args[i + 1];
			return next && next.endsWith(".env");
		});
		assert.ok(envPaths.length >= 3, `expected ≥3 .env paths in args, got ${envPaths.length}`);
	});

	it("should add --ro-bind /dev/null for .env in hidden directories", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyRead: ["**/.env"],
				allowWrite: [TMP],
			},
		};
		const result = buildBwrapArgs(CWD, config);

		// Find args referencing .config/.env
		const hasHiddenEnv = result.args.some((a) => a.includes(".config") && a.includes(".env"));
		assert.ok(hasHiddenEnv, "should hide .env inside .config hidden directory");
	});

	it("should NOT add /dev/null binds when **/.env is NOT in denyRead", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyRead: ["~/.ssh"],
				allowWrite: [TMP],
			},
		};
		const result = buildBwrapArgs(CWD, config);
		const nullBinds = result.args.filter(
			(_, i) => result.args[i] === "--ro-bind" && result.args[i + 1] === "/dev/null",
		);
		// The deny-write loop may add some for .ssh, but they should NOT be .env files
		const envBinds = result.args.filter((_, i) => {
			return result.args[i] === "/dev/null" && i > 0 && result.args[i - 1] === "--ro-bind"
				&& result.args[i + 1]?.endsWith(".env");
		});
		assert.equal(envBinds.length, 0, "should not hide .env when pattern is not **/.env");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — network isolation logic (existing tests preserved)
// ═══════════════════════════════════════════════════════════════════════════════

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
// createSandboxedBashOps
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// resolveBinaries — resolve whitelisted binary paths
// ═══════════════════════════════════════════════════════════════════════════════

describe("resolveBinaries", () => {
	it("should resolve external binaries to absolute paths", async () => {
		const result = await resolveBinaries(["ls", "find"]);
		assert.ok(result.has("ls"), "should have ls");
		assert.ok(result.has("find"), "should have find");
		assert.ok(result.get("ls")?.startsWith("/"), "ls path should be absolute");
		assert.ok(result.get("find")?.includes("find"), "find path should contain 'find'");
	});

	it("should return empty map for empty input", async () => {
		const result = await resolveBinaries([]);
		assert.equal(result.size, 0);
	});

	it("should skip shell builtins (no binary to mount)", async () => {
		const result = await resolveBinaries(["echo", "printf", "ls"]);
		// echo and printf are shell builtins — no binary mount needed
		assert.ok(!result.has("echo"), "should skip shell builtins like echo");
		assert.ok(!result.has("printf"), "should skip shell builtins like printf");
		assert.ok(result.has("ls"), "should still resolve external binaries");
	});

	it("should not include unresolvable binary names", async () => {
		const result = await resolveBinaries(["ls", "nonexistent_binary_xyz_123"]);
		assert.ok(result.has("ls"), "should have ls");
		assert.ok(!result.has("nonexistent_binary_xyz_123"), "should not have unresolvable binary");
	});

	it("should resolve 'git' to a path", async () => {
		const result = await resolveBinaries(["git"]);
		assert.ok(result.has("git"), "should have git");
		assert.ok(result.get("git")?.includes("git"), "git path should contain 'git'");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — per-binary mounting mode
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildBwrapArgs — per-binary mount mode", () => {
	before(() => {
		// Ensure writable paths exist
		mkdirSync(TMP, { recursive: true });
		mkdirSync(CWD, { recursive: true });
	});
	after(() => rmSync(TMP, { recursive: true, force: true }));

	it("should mount specific binaries instead of full / when resolvedBinaries provided", () => {
		const config: SandboxConfig = {
			bash: {
				commandWhitelist: ["find", "ls"],
			},
			filesystem: {
				allowWrite: [TMP],
			},
		};
		const resolved = new Map<string, string>([
			["find", "/usr/bin/find"],
			["ls", "/usr/bin/ls"],
			["bash", "/bin/bash"],
		]);
		const result = buildBwrapArgs(CWD, config, resolved);

		// Should NOT mount full root
		assert.ok(!result.args.includes("--ro-bind") || !result.args.some((a, i) => a === "/" && result.args[i - 1] === "--ro-bind"),
			"should not mount full root filesystem");

		// Should mount individual binaries
		const binds = result.args.filter((a) => a.startsWith("/"));
		assert.ok(binds.some((b) => b.includes("/usr/bin/find")), "should mount find");
		assert.ok(binds.some((b) => b.includes("/usr/bin/ls")), "should mount ls");
		assert.ok(binds.some((b) => b.includes("/bin/bash")), "should mount bash");

		// Should mount lib dirs
		assert.ok(binds.some((b) => b === "/usr/lib"), "should mount /usr/lib");
		assert.ok(binds.some((b) => b === "/lib" || b === "/lib64"), "should mount /lib or /lib64");
		assert.ok(binds.some((b) => b === "/usr/share"), "should mount /usr/share for file magic database");

		// Should include writable paths
		assert.ok(binds.some((b) => b.includes(TMP)), "should mount writable path");
	});

	it("should still include standard bwrap boilerplate", () => {
		const config: SandboxConfig = {};
		const resolved = new Map([["bash", "/bin/bash"]]);
		const result = buildBwrapArgs(CWD, config, resolved);

		assert.ok(result.args.includes("--new-session"));
		assert.ok(result.args.includes("--die-with-parent"));
		assert.ok(result.args.includes("--unshare-pid"));
		assert.ok(result.args.includes("--proc"));
		assert.ok(result.args.includes("--dev"));
	});

	it("should fall back to full root mount when no resolved binaries provided", () => {
		const config: SandboxConfig = {};
		const result = buildBwrapArgs(CWD, config);

		// Should still mount full root
		assert.ok(result.args.includes("--ro-bind"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — denyWrite with **/ patterns (e.g., **/.git)
// ═══════════════════════════════════════════════════════════════════════════════

const GIT_TMP = join("/tmp", "sandbox-git-test-" + Date.now());
const GIT_CWD = join(GIT_TMP, "project");

function createGitEnv(): void {
	rmSync(GIT_TMP, { recursive: true, force: true });
	// project with .git dir
	mkdirSync(join(GIT_TMP, "project", ".git"), { recursive: true });
	mkdirSync(join(GIT_TMP, "project", "src", ".git"), { recursive: true });
	// writable external path with .git
	mkdirSync(join(GIT_TMP, "external", ".git"), { recursive: true });
	// non-.git dir (should NOT get --ro-bind)
	mkdirSync(join(GIT_TMP, "project", "node_modules"), { recursive: true });
}

describe("buildBwrapArgs — denyWrite with **/.git patterns", () => {
	before(() => createGitEnv());
	after(() => rmSync(GIT_TMP, { recursive: true, force: true }));

	it("should add --ro-bind for each discovered .git directory", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyWrite: ["**/.git"],
				allowWrite: [GIT_TMP],
			},
		};
		const result = buildBwrapArgs(GIT_CWD, config);

		// Count --ro-bind entries for .git dirs (not /dev/null binds)
		const gitDirBinds = result.args.filter((_, i) => {
			return result.args[i] === "--ro-bind"
				&& result.args[i + 1]?.endsWith("/.git")
				&& result.args[i + 2]?.endsWith("/.git");
		});

		assert.ok(
			gitDirBinds.length >= 3,
			`expected ≥3 .git --ro-bind entries, got ${gitDirBinds.length}: ${result.args.join(" ")}`,
		);
	});

	it("should NOT add --ro-bind for non-.git directories", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyWrite: ["**/.git"],
				allowWrite: [GIT_TMP],
			},
		};
		const result = buildBwrapArgs(GIT_CWD, config);

		// Check that node_modules is NOT mounted --ro-bind
		const nodeModulesBinds = result.args.filter((_, i) => {
			return result.args[i] === "--ro-bind"
				&& result.args[i + 1]?.includes("node_modules");
		});
		assert.equal(nodeModulesBinds.length, 0, "should not mount node_modules read-only");
	});

	it("should not add .git binds when **/.git is NOT in denyWrite", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyWrite: ["**/.env"],
				allowWrite: [GIT_TMP],
			},
		};
		const result = buildBwrapArgs(GIT_CWD, config);

		const gitDirBinds = result.args.filter((_, i) => {
			return result.args[i] === "--ro-bind"
				&& result.args[i + 1]?.endsWith("/.git")
				&& result.args[i + 2]?.endsWith("/.git");
		});
		assert.equal(gitDirBinds.length, 0, "should not bind .git dirs when pattern not present");
	});

	it("should still allow reads on .git directories (not null-bind)", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: {
				denyWrite: ["**/.git"],
				allowWrite: [GIT_TMP],
			},
		};
		const result = buildBwrapArgs(GIT_CWD, config);

		// .git dirs should have --ro-bind DIR DIR (readable), not /dev/null
		const nullBindGit = result.args.filter((_, i) => {
			return result.args[i] === "/dev/null"
				&& i > 1
				&& result.args[i - 1] === "--ro-bind"
				&& (result.args[i + 1]?.endsWith("/.git") || result.args[i - 2]?.endsWith("/.git"));
		});
		assert.equal(nullBindGit.length, 0, "should NOT nullify .git dirs — they should be readable");
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — allowRead
// ═══════════════════════════════════════════════════════════════════════════════

const READ_TMP = join("/tmp", "sandbox-read-test-" + Date.now());

describe("buildBwrapArgs — allowRead", () => {
	before(() => {
		rmSync(READ_TMP, { recursive: true, force: true });
		mkdirSync(join(READ_TMP, "config"), { recursive: true });
		writeFileSync(join(READ_TMP, "config", "settings.conf"), "key=value");
		writeFileSync(join(READ_TMP, "data.txt"), "hello");
	});
	after(() => rmSync(READ_TMP, { recursive: true, force: true }));

	it("should add --ro-bind for allowRead directories", () => {
		const configDir = join(READ_TMP, "config");
		const config: SandboxConfig = {
			filesystem: {
				allowRead: [configDir],
			},
		};
		const result = buildBwrapArgs(CWD, config);

		const binds = result.args.filter((_, i) =>
			result.args[i] === "--ro-bind"
			&& result.args[i + 1] === configDir
			&& result.args[i + 2] === configDir,
		);
		assert.equal(binds.length, 1, "should bind the allowRead directory read-only");
	});

	it("should add --ro-bind for allowRead files", () => {
		const dataFile = join(READ_TMP, "data.txt");
		const config: SandboxConfig = {
			filesystem: {
				allowRead: [dataFile],
			},
		};
		const result = buildBwrapArgs(CWD, config);

		const binds = result.args.filter((_, i) =>
			result.args[i] === "--ro-bind"
			&& result.args[i + 1] === dataFile
			&& result.args[i + 2] === dataFile,
		);
		assert.equal(binds.length, 1, "should bind the allowRead file read-only");
	});

	it("should skip non-existent paths in allowRead", () => {
		const config: SandboxConfig = {
			filesystem: {
				allowRead: ["/nonexistent/path"],
			},
		};
		const result = buildBwrapArgs(CWD, config);

		const noneBinds = result.args.filter((_, i) =>
			result.args[i] === "--ro-bind"
			&& result.args[i + 1] === "/nonexistent/path",
		);
		assert.equal(noneBinds.length, 0, "should not bind non-existent paths");
	});

	it("should have no effect when allowRead is undefined", () => {
		const config: SandboxConfig = {
			filesystem: {},
		};
		const result = buildBwrapArgs(CWD, config);
		assert.ok(result.args.includes("--proc"), "should still include standard args");
	});

	it("should skip non-existent tilde paths in allowRead", () => {
		const result = buildBwrapArgs(CWD, { filesystem: { allowRead: ["~/.nonexistent_xyz_test_dir"] } });
		const binds = result.args.filter((_, i) =>
			result.args[i] === "--ro-bind"
			&& result.args[i + 1]?.includes("nonexistent_xyz_test_dir"),
		);
		assert.equal(binds.length, 0, "should not bind non-existent tilde paths");
	});
});

describe("createSandboxedBashOps", () => {
	it("should return BashOperations without throwing", () => {
		const ops = createSandboxedBashOps({});
		assert.ok(ops, "should return a BashOperations object");
		assert.equal(typeof ops.exec, "function", "should have an exec method");
	});

	it("should not throw ReferenceError when exec is called", async () => {
		const ops = createSandboxedBashOps({});
		try {
			await ops.exec("echo hello", CWD, {});
		} catch (err) {
			// We expect a non-ReferenceError (e.g., bwrap not found in test env, or IO error).
			if (err instanceof ReferenceError) {
				assert.fail(`Got ReferenceError: ${err.message} — config variable is not in scope`);
			}
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildBwrapArgs — caching
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildBwrapArgs — caching", () => {
	it("should return consistent results for same inputs", () => {
		const config: SandboxConfig = {
			network: { allowedDomains: ["npmjs.org"] },
		};
		const result1 = buildBwrapArgs("/tmp", config);
		const result2 = buildBwrapArgs("/tmp", config);

		assert.deepEqual(result1, result2);
	});

	it("should return valid args for different cwds", () => {
		const config: SandboxConfig = {};
		const result1 = buildBwrapArgs("/tmp", config);
		const result2 = buildBwrapArgs("/var/tmp", config);

		assert.ok(result1.args.includes("--new-session"));
		assert.ok(result2.args.includes("--new-session"));
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// clearBwrapArgsCache
// ═══════════════════════════════════════════════════════════════════════════════

describe("clearBwrapArgsCache", () => {
	it("should be a function", () => {
		assert.equal(typeof clearBwrapArgsCache, "function");
	});

	it("should not throw when called", () => {
		clearBwrapArgsCache();
	});

	it("should still allow buildBwrapArgs to produce valid results after cache clear", () => {
		clearBwrapArgsCache();
		const config: SandboxConfig = {
			network: { allowedDomains: [] },
		};
		const result = buildBwrapArgs("/tmp", config);
		assert.ok(result.args.includes("--unshare-net"), "should produce valid bwrap args after cache clear");
		assert.equal(result.needsSocat, false);
	});
});


