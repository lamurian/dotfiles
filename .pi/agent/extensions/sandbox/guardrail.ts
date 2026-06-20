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

import { relative, resolve } from "node:path";
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

// ─── Custom glob matching (no hidden-directory exclusion) ────────────────────

/**
 * Match a file path against a glob pattern.
 *
 * Unlike Node.js `path.matchesGlob`, this does NOT skip dot-directories (names
 * starting with `.`). This is a security sandbox — `**` must traverse everything.
 *
 * Supported syntax:
 *   `**`  — matches zero or more path segments (any depth)
 *   `*`   — matches any characters within one path segment (except `/`)
 *   `?`   — matches exactly one character within one path segment
 *
 * Handles both absolute and relative paths.
 */
export function pathMatchesGlob(filePath: string, pattern: string): boolean {
	if (!pattern) return false;

	const pathSegs = normalizeSlashes(filePath).split("/");
	const patSegs = normalizeSlashes(pattern).split("/");

	return matchSegments(pathSegs, patSegs, 0, 0);
}

/** Normalize slashes and strip trailing slash. */
function normalizeSlashes(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Recursively match path segments against pattern segments.
 * `pi` = path index (current path segment), `pj` = pattern index.
 */
function matchSegments(
	pathSegs: string[],
	patSegs: string[],
	pi: number,
	pj: number,
): boolean {
	// Pattern consumed: path must also be fully consumed
	if (pj >= patSegs.length) return pi >= pathSegs.length;

	const pat = patSegs[pj];

	// Handle ** — matches zero or more path segments
	if (pat === "**") {
		for (let i = pi; i <= pathSegs.length; i++) {
			if (matchSegments(pathSegs, patSegs, i, pj + 1)) return true;
		}
		return false;
	}

	// No more path segments — pattern can't be satisfied (unless remaining is **)
	if (pi >= pathSegs.length) return false;

	// Match this segment, then recurse
	if (!matchSegment(pathSegs[pi], pat)) return false;

	return matchSegments(pathSegs, patSegs, pi + 1, pj + 1);
}

/**
 * Match a single path segment against a single pattern segment.
 * Supports `*` (any characters) and `?` (single char).
 */
function matchSegment(segment: string, pattern: string): boolean {
	return matchInSegment(segment, 0, pattern, 0);
}

function matchInSegment(
	seg: string,
	si: number,
	pat: string,
	pi: number,
): boolean {
	if (pi >= pat.length) return si >= seg.length;

	if (pat[pi] === "*") {
		// Consume all consecutive *
		while (pi < pat.length && pat[pi] === "*") pi++;

		// * at end matches rest of segment
		if (pi >= pat.length) return true;

		// Try matching * against 0…(seg.length - si) characters, then
		// check whether the rest of the pattern matches from that point.
		const nextChar = pat[pi];
		for (let i = si; i <= seg.length; i++) {
			// Either we've matched up to a char that equals nextChar,
			// or we've run out of segment (which only works if rest is * or empty)
			if (i < seg.length && seg[i] !== nextChar) continue;
			if (matchInSegment(seg, i, pat, pi)) return true;
		}
		return false;
	}

	if (pat[pi] === "?") {
		if (si >= seg.length) return false;
		return matchInSegment(seg, si + 1, pat, pi + 1);
	}

	// Literal character
	if (si >= seg.length || seg[si] !== pat[pi]) return false;
	return matchInSegment(seg, si + 1, pat, pi + 1);
}

/**
 * Check if a file path matches any glob pattern in a list.
 * Patterns support ~/ expansion and glob syntax via pathMatchesGlob.
 */
export function isPathDenied(filePath: string, patterns: string[]): boolean {
	for (const raw of patterns) {
		const pattern = expandTilde(raw);
		if (pathMatchesGlob(filePath, pattern)) {
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

// ─── Deny pattern normalization (for OS-level enforcement) ─────────────────

/**
 * Normalize a deny pattern for filesystem resolution by stripping trailing
 * glob characters that would prevent existsSync from working at the OS level.
 *
 * Patterns without glob chars are returned as-is (e.g. \".env\").
 * Patterns ending with a trailing glob segment have that segment stripped
 * (e.g. \".githooks/*\" becomes \".githooks\").
 * Leading star-star-slash is also stripped if present.
 * Patterns with non-trailing globs return null (can't resolve to a single path).
 */
export function normalizeDenyPattern(pattern: string): string | null {
	if (!pattern.includes("*") && !pattern.includes("?")) {
		return pattern;
	}

	// Strip trailing /* or /**
	let result = pattern.replace(/\/\*+$/, "");
	if (result === pattern) {
		// No trailing /* or /** — can't resolve this pattern
		return null;
	}

	// Strip leading **/ if present
	result = result.replace(/^\*\*\//, "");

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

		// Check against absolute path (for patterns like /etc/passwd, ~/.ssh/**)
		let reason = checkToolAccess(config.access, absolutePath, fsConfig);

		// Also check against path relative to cwd (for cwd-relative patterns like .githooks/*, .env)
		if (reason === null) {
			const relativePath = relative(cwd, absolutePath);
			if (relativePath !== absolutePath) {
				reason = checkToolAccess(config.access, relativePath, fsConfig);
			}
		}

		if (reason !== null) {
			return {
				block: true,
				reason: `Sandbox guardrail: ${reason} for path '${rawPath}'`,
			};
		}
	}

	return null;
}
