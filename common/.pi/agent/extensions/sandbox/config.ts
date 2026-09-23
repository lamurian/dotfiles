/**
 * config.ts — Sandbox config types, loading, merging, and file discovery
 */

import { execSync, spawnSync } from "node:child_process";
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
		allowRead?: string[];
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
		result.bash = mergeSection(base.bash ?? {}, overrides.bash);
	}
	if (overrides.network) {
		result.network = mergeSection(base.network ?? {}, overrides.network);
	}
	if (overrides.filesystem) {
		result.filesystem = mergeSection(base.filesystem ?? {}, overrides.filesystem);
	}
	if (overrides.tools) {
		result.tools = mergeSection(base.tools ?? {}, overrides.tools);
	}
	return result;
}

/**
 * Merge two section objects, concatenating arrays instead of replacing them.
 * Scalars and nested objects are replaced (existing behavior).
 * Arrays are concatenated with dedup.
 */
function mergeSection<T extends Record<string, unknown>>(
	base: T,
	overrides: Partial<T>,
): T {
	const result = { ...base };
	for (const key of Object.keys(overrides) as Array<keyof T>) {
		const overrideVal = overrides[key];
		if (overrideVal === undefined) continue;
		const baseVal = base[key];
		if (Array.isArray(baseVal) && Array.isArray(overrideVal)) {
			// Concatenate + deduplicate
			result[key] = [...new Set([...baseVal, ...overrideVal])] as T[keyof T];
		} else {
			// Scalar or object replacement (existing behavior)
			result[key] = overrideVal;
		}
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

/**
 * Discover all files or directories matching a given name under searchable paths.
 *
 * Searches:
 * 1. The user's home directory
 * 2. All allowWrite paths from config
 * 3. Each ancestor of cwd up to root
 *
 * Uses find with -maxdepth 8 and a 5-second timeout per search dir.
 */
export function discoverPaths(
	cwd: string,
	config: SandboxConfig,
	name: string,
	type: "f" | "d",
): string[] {
	const searchDirs = new Set<string>();
	searchDirs.add(homedir());

	const allowWrite = config.filesystem?.allowWrite ?? [];
	for (const raw of allowWrite) {
		const absPath = resolvePath(cwd, raw);
		if (existsSync(absPath)) searchDirs.add(absPath);
	}

	// Walk up from cwd to root
	let dir = resolve(cwd);
	while (dir.startsWith(homedir()) || dir.startsWith("/")) {
		searchDirs.add(dir);
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	const results = new Set<string>();
	for (const searchDir of searchDirs) {
		try {
			const result = spawnSync("find", [
				searchDir,
				"-maxdepth", "8",
				"-name", name,
				"-type", type,
			], { timeout: 5000, encoding: "utf-8" });
			if (result.status === 0 && result.stdout) {
				for (const line of result.stdout.trim().split("\n").filter(Boolean)) {
					results.add(line);
				}
			}
		} catch {
			// skip inaccessible dirs
		}
	}
	return [...results];
}

export function getDiscoveredFiles(cwd: string, config: SandboxConfig): string[] {
	if (discoveredCache && Date.now() - discoveredCache.timestamp < CACHE_TTL) {
		return [...discoveredCache.files];
	}
	const files = discoverPaths(cwd, config, ".env", "f");
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
