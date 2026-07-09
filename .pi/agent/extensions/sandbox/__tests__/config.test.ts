import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deepMerge } from "../config.ts";

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
