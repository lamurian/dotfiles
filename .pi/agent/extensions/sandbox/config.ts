/**
 * config.ts — Sandbox config types, loading, merging, and file discovery
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeDenyPattern, type ToolsConfig } from "./guardrail.ts";
import type { GitConfig } from "./bash-validator.ts";

export type { GitConfig } from "./bash-validator.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BashConfig {
	allowShell?: boolean;
	commandWhitelist?: string[];
	blockedCommands?: string[];
	git?: GitConfig;
}

export interface SandboxConfig {
	enabled?: boolean;
	bash?: BashConfig;
	network?: {
		allowedDomains?: string[];
		deniedDomains?: string[];
	};
	filesystem?: {
		denyRead?: string[];
		allowWrite?: string[];
		denyWrite?: string[];
	};
	tools?: ToolsConfig;
}

// ─── Defaults & Constants ────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SandboxConfig = {
	enabled: true,
	bash: {
		allowShell: true,
	},
	network: {
		allowedDomains: [
			"github.com",
			"*.github.com",
			"npmjs.org",
			"*.npmjs.org",
			"pypi.org",
			"*.pypi.org",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
		allowWrite: ["."],
	},
};

// ─── Config loading ──────────────────────────────────────────────────────────

export function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, ".pi", "sandbox.json");
	const globalConfigPath = join(getAgentDir(), "extensions", "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

	return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}

export function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
	const result: SandboxConfig = { ...base };
	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.bash) {
		result.bash = { ...base.bash, ...overrides.bash };
	}
	if (overrides.network) {
		result.network = { ...base.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...base.filesystem, ...overrides.filesystem };
	}
	if (overrides.tools) {
		result.tools = { ...base.tools, ...overrides.tools };
	}
	return result;
}

// ─── Lazy file discovery cache ───────────────────────────────────────────────

interface DiscoveredCache {
	timestamp: number;
	files: string[];
}

let discoveredCache: DiscoveredCache | null = null;
const CACHE_TTL = 30_000;

export function clearDiscoveredCache(): void {
	discoveredCache = null;
}

export function getDiscoveredFiles(cwd: string, config: SandboxConfig): string[] {
	if (discoveredCache && Date.now() - discoveredCache.timestamp < CACHE_TTL) {
		return [...discoveredCache.files];
	}

	const searchDirs = new Set<string>();
	searchDirs.add(homedir());

	const allowWrite = config.filesystem?.allowWrite ?? [];
	for (const raw of allowWrite) {
		const absPath = resolvePath(cwd, raw);
		if (existsSync(absPath)) searchDirs.add(absPath);
	}

	let dir = resolve(cwd);
	while (dir.startsWith(homedir()) || dir.startsWith("/")) {
		searchDirs.add(dir);
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	const files = new Set<string>();
	for (const searchDir of searchDirs) {
		try {
			const result = execSync(
				`find "${searchDir}" -maxdepth 8 -name '.env' -type f 2>/dev/null`,
				{ timeout: 5000, encoding: "utf-8" },
			);
			for (const line of result.trim().split("\n").filter(Boolean)) {
				files.add(line);
			}
		} catch {
			// Ignore inaccessible or non-existent directories
		}
	}

	discoveredCache = { timestamp: Date.now(), files: [...files] };
	return [...files];
}

// ─── Path helpers ────────────────────────────────────────────────────────────

export function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

export function resolvePath(cwd: string, raw: string): string {
	if (raw.startsWith("~")) {
		return expandTilde(raw);
	}
	return resolve(cwd, raw);
}

export function resolveDenyPath(cwd: string, pattern: string): string | null {
	const base = normalizeDenyPattern(pattern);
	if (base === null) return null;
	const absPath = resolvePath(cwd, base);
	if (existsSync(absPath)) return absPath;
	return null;
}
