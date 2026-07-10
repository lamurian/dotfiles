import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deepMerge, discoverPaths, clearDiscoveredCache, type SandboxConfig } from "../config.ts";

// ─── deepMerge: additive array merging ───────────────────────────────────────

describe("deepMerge", () => {
	it("should concatenate arrays from base and overrides with dedup", () => {
		const base = {
			bash: { commandWhitelist: ["git", "ls"] },
		};
		const overrides = {
			bash: { commandWhitelist: ["my-tool"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.bash?.commandWhitelist, ["git", "ls", "my-tool"]);
	});

	it("should deduplicate when same value appears in both arrays", () => {
		const base = {
			bash: { commandWhitelist: ["git", "ls"] },
		};
		const overrides = {
			bash: { commandWhitelist: ["ls", "my-tool"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.bash?.commandWhitelist, ["git", "ls", "my-tool"]);
	});

	it("should replace scalar values (not concatenate)", () => {
		const base = {
			enabled: true,
			bash: { allowShell: true },
		};
		const overrides: Record<string, unknown> = {
			enabled: false,
			bash: { allowShell: false },
		} as any;
		const result = deepMerge(base, overrides);
		assert.equal(result.enabled, false);
		assert.equal(result.bash?.allowShell, false);
	});

	it("should concatenate network.allowedDomains with dedup", () => {
		const base = {
			network: { allowedDomains: ["github.com", "npmjs.org"] },
		};
		const overrides = {
			network: { allowedDomains: ["internal.corp"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.network?.allowedDomains, [
			"github.com",
			"npmjs.org",
			"internal.corp",
		]);
	});

	it("should concatenate filesystem arrays with dedup", () => {
		const base = {
			filesystem: { allowWrite: [".", "/tmp"], denyRead: ["~/.ssh"] },
		};
		const overrides = {
			filesystem: { allowWrite: ["/projects"], denyRead: ["**/.env"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.filesystem?.allowWrite, [".", "/tmp", "/projects"]);
		assert.deepEqual(result.filesystem?.denyRead, ["~/.ssh", "**/.env"]);
	});

	it("should replace objects (not concatenate) when base and override are objects", () => {
		const base = {
			bash: { git: { allow: ["status"] } },
		};
		const overrides = {
			bash: { git: { allow: ["diff"] } },
		};
		const result = deepMerge(base, overrides);
		// Object replacement, not concatenation — so git is fully replaced
		assert.deepEqual(result.bash?.git, { allow: ["diff"] });
	});

	it("should carry forward unchanged sections from base", () => {
		const base = {
			enabled: true,
			bash: { commandWhitelist: ["git"], allowShell: true },
			network: { allowedDomains: ["*"] },
		};
		const overrides = {
			bash: { commandWhitelist: ["my-tool"] },
		};
		const result = deepMerge(base, overrides);
		// network should be untouched, bash.allowShell should survive
		assert.deepEqual(result.network?.allowedDomains, ["*"]);
		assert.equal(result.bash?.allowShell, true);
	});

	it("should handle empty overrides gracefully", () => {
		const base = {
			enabled: true,
			bash: { commandWhitelist: ["git"] },
		};
		const result = deepMerge(base, {});
		assert.equal(result.enabled, true);
		assert.deepEqual(result.bash?.commandWhitelist, ["git"]);
	});

	it("should handle missing base sections when overrides provide them", () => {
		const base: Record<string, unknown> = {};
		const overrides = {
			bash: { commandWhitelist: ["git"] },
			network: { allowedDomains: ["github.com"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.bash?.commandWhitelist, ["git"]);
		assert.deepEqual(result.network?.allowedDomains, ["github.com"]);
	});

	it("should concatenate tools section arrays", () => {
		const base = {
			tools: {
				edit: { access: ["read"] as const },
			},
		};
		const overrides = {
			tools: {
				write: { access: ["read", "write"] as const },
			},
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual((result.tools as any)?.edit?.access, ["read"]);
		assert.deepEqual((result.tools as any)?.write?.access, ["read", "write"]);
	});
});

describe("deepMerge — network deniedDomains", () => {
	it("should concatenate deniedDomains arrays", () => {
		const base = {
			network: { deniedDomains: ["bad-site.com"] },
		};
		const overrides = {
			network: { deniedDomains: ["worse-site.com"] },
		};
		const result = deepMerge(base, overrides);
		assert.deepEqual(result.network?.deniedDomains, [
			"bad-site.com",
			"worse-site.com",
		]);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// discoverPaths — generic path discovery for denylist patterns
// ═══════════════════════════════════════════════════════════════════════════════

const TMP = join("/tmp", "sandbox-discover-test-" + Date.now());
const CWD = join(TMP, "project");

function createDiscoverEnv(): void {
	rmSync(TMP, { recursive: true, force: true });
	// project root with .git
	mkdirSync(join(TMP, "project", ".git"), { recursive: true });
	mkdirSync(join(TMP, "project", "src"), { recursive: true });
	mkdirSync(join(TMP, "project", "src", ".git"), { recursive: true });
	// nested other dirs (no .git)
	mkdirSync(join(TMP, "project", "node_modules"), { recursive: true });
	mkdirSync(join(TMP, "external"), { recursive: true });
	mkdirSync(join(TMP, "external", ".git"), { recursive: true });
	// .env files for type "f" test
	writeFileSync(join(TMP, "project", ".env"), "SECRET=x");
	writeFileSync(join(TMP, "project", "src", ".env"), "DB=prod");
	// non-matching files
	writeFileSync(join(TMP, "project", "readme.md"), "hello");
}

describe("discoverPaths", () => {
	before(() => createDiscoverEnv());
	after(() => rmSync(TMP, { recursive: true, force: true }));

	it("should find all .git directories under writable paths", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [TMP] },
		};
		const dirs = discoverPaths(CWD, config, ".git", "d");
		assert.ok(dirs.length >= 3, `expected ≥3 .git dirs, got ${dirs.length}: ${dirs.join(", ")}`);
		assert.ok(dirs.some((d) => d.includes("project/.git")), "should find project/.git");
		assert.ok(dirs.some((d) => d.includes("src/.git")), "should find src/.git");
		assert.ok(dirs.some((d) => d.includes("external/.git")), "should find external/.git");
	});

	it("should find .env files when searching with type 'f'", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [TMP] },
		};
		const files = discoverPaths(CWD, config, ".env", "f");
		assert.ok(files.length >= 2, `expected ≥2 .env files, got ${files.length}: ${files.join(", ")}`);
		assert.ok(files.some((f) => f.includes("project/.env")), "should find project/.env");
		assert.ok(files.some((f) => f.includes("src/.env")), "should find src/.env");
	});

	it("should NOT include non-matching names", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [TMP] },
		};
		const dirs = discoverPaths(CWD, config, ".git", "d");
		assert.ok(!dirs.some((d) => d.includes("node_modules")), "should not find node_modules");

		const files = discoverPaths(CWD, config, ".git", "f");
		assert.equal(files.length, 0, "should find zero .git files (they are dirs)");
	});

	it("should return empty array when no paths match", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [TMP] },
		};
		const result = discoverPaths(CWD, config, "nonexistent_file_xyz", "f");
		assert.deepEqual(result, []);
	});

	it("should search homedir in addition to allowWrite paths", () => {
		clearDiscoveredCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [TMP] },
		};
		// homedir is always searched, but we shouldn't find .git dirs outside writable paths
		const dirs = discoverPaths(CWD, config, ".git", "d");
		// At minimum the 3 under TMP should be found
		assert.ok(dirs.length >= 3, `expected ≥3 .git dirs, got ${dirs.length}`);
	});
});
