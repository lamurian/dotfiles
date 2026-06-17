/**
 * Sandbox Guardrail — tool-level filesystem access control
 *
 * Intercepts tool calls and checks them against denyRead/denyWrite glob
 * patterns before the tool executes. denyRead blocks all access (read + write).
 * denyWrite blocks only write access (read still allowed).
 *
 * Configurable per tool via sandbox.json's `tools` field.
 * Built-in defaults for standard pi tools; users can add/override for custom tools.
 */

import { matchesGlob, resolve } from "node:path";
import { homedir } from "node:os";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolAccess = "read" | "write";

export interface ToolConfig {
	/** Access types this tool requires (read, write, or both). */
	access: ToolAccess[];
	/**
	 * Parameter names that contain file paths.
	 * Defaults to ["path"] if not specified.
	 */
	pathParams?: string[];
}

export interface FilesystemConfig {
	denyRead?: string[];
	denyWrite?: string[];
}

/**
 * Per-tool access configuration.
 * Key is tool name, value is either an access array (shorthand) or a full ToolConfig object.
 */
export interface ToolsConfig {
	[toolName: string]: ToolConfig | ToolAccess[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/**
 * Built-in tool access defaults. Users can override these in sandbox.json.
 * Tools not listed here have no restriction (backward compatible).
 */
export const DEFAULT_TOOL_ACCESS: Record<string, ToolConfig> = {
	read: { access: ["read"] },
	write: { access: ["write"] },
	edit: { access: ["read", "write"] },
	grep: { access: ["read"] },
	find: { access: ["read"] },
	ls: { access: ["read"] },
};

// ─── Path helpers ────────────────────────────────────────────────────────────

export function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/**
 * Check if a file path matches any glob pattern in a list.
 * Patterns support ~/ expansion and all standard glob syntax via path.matchesGlob.
 */
export function isPathDenied(filePath: string, patterns: string[]): boolean {
	for (const raw of patterns) {
		const pattern = expandTilde(raw);
		if (matchesGlob(filePath, pattern)) {
			return true;
		}
	}
	return false;
}

// ─── Access checking ─────────────────────────────────────────────────────────

/**
 * Check if a tool has the required access to a file path.
 * Returns a reason string if blocked, or null if allowed.
 *
 * - denyRead blocks ALL access (no read, no write)
 * - denyWrite blocks only write access (read still allowed)
 */
export function checkToolAccess(
	access: ToolAccess[],
	filePath: string,
	fsConfig: FilesystemConfig,
): string | null {
	const denyRead = fsConfig.denyRead ?? [];
	const denyWrite = fsConfig.denyWrite ?? [];

	// denyRead blocks everything — check first
	if (isPathDenied(filePath, denyRead)) {
		return `read access denied by denyRead rule`;
	}

	// Write access: also check denyWrite
	if (access.includes("write") && isPathDenied(filePath, denyWrite)) {
		return `write access denied by denyWrite rule`;
	}

	return null;
}

// ─── Config normalization ────────────────────────────────────────────────────

/**
 * Merge user-configured tools with built-in defaults.
 * User config overrides defaults; tools not in either have no restriction.
 */
export function mergeToolConfigs(
	userConfig: ToolsConfig | undefined,
	builtinDefaults: Record<string, ToolConfig> = DEFAULT_TOOL_ACCESS,
): Record<string, ToolConfig> {
	const result: Record<string, ToolConfig> = {};

	// Start with defaults
	for (const [name, config] of Object.entries(builtinDefaults)) {
		result[name] = { ...config, pathParams: [...(config.pathParams ?? ["path"])] };
	}

	// Override with user config
	if (userConfig) {
		for (const [name, value] of Object.entries(userConfig)) {
			if (Array.isArray(value)) {
				// Shorthand: ["read"] means { access: ["read"] }
				result[name] = { access: [...value], pathParams: ["path"] };
			} else {
				// Full ToolConfig object
				result[name] = {
					access: [...value.access],
					pathParams: value.pathParams ? [...value.pathParams] : ["path"],
				};
			}
		}
	}

	return result;
}

// ─── Path extraction ─────────────────────────────────────────────────────────

/**
 * Extract file path candidates from tool parameters.
 *
 * Default path params: ["path"] (all standard pi tools use this).
 * Falls back to checking "file_path" for backward compatibility.
 */
export function getToolPaths(
	toolName: string,
	params: Record<string, unknown>,
	toolConfig?: ToolConfig,
): string[] {
	const paramNames = toolConfig?.pathParams ?? ["path"];
	const paths: string[] = [];

	for (const name of paramNames) {
		const value = params[name];
		if (typeof value === "string" && value.length > 0) {
			paths.push(value);
		}
	}

	// Also check file_path as fallback (some tools use this for display)
	if (!paramNames.includes("file_path") && typeof params.file_path === "string") {
		paths.push(params.file_path);
	}

	return paths;
}

// ─── Guardrail result ────────────────────────────────────────────────────────

export interface GuardrailResult {
	/** Whether the tool call should be blocked. */
	block: boolean;
	/** Human-readable reason for the block. */
	reason: string;
}

/**
 * Evaluate a tool call against the sandbox guardrail.
 * Returns a block result if access is denied, or null if allowed.
 */
export function evaluateToolCall(
	toolName: string,
	params: Record<string, unknown>,
	toolAccess: Record<string, ToolConfig>,
	fsConfig: FilesystemConfig,
	cwd: string,
): GuardrailResult | null {
	const config = toolAccess[toolName];
	if (!config) {
		// Tool not configured — allow (backward compatible)
		return null;
	}

	const paths = getToolPaths(toolName, params, config);
	if (paths.length === 0) {
		// No file paths in this tool call — nothing to check
		return null;
	}

	for (const rawPath of paths) {
		// Resolve relative paths against cwd
		const absolutePath = resolve(cwd, rawPath);

		const reason = checkToolAccess(config.access, absolutePath, fsConfig);
		if (reason !== null) {
			return {
				block: true,
				reason: `Sandbox guardrail: ${reason} for path '${rawPath}'`,
			};
		}
	}

	return null;
}
