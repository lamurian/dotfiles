/**
 * bash-validator.ts — Command parsing and whitelist enforcement
 *
 * Pure functions for:
 * - Parsing shell command strings into base command names
 * - Validating commands against whitelist/blocklist
 * - Git subcommand validation
 * - Stripping dangerous flags from known commands (e.g., find -delete)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitConfig {
	allow?: string[];
	stash?: {
		allowSubcommands?: string[];
		blockSubcommands?: string[];
	};
	blockIfArgContains?: Record<string, string[]>;
	blocked?: string[];
}

export interface ValidationResult {
	allowed: boolean;
	reason?: string;
}

export interface FindDeleteResult {
	command: string;
	warning?: string;
}

// ─── Command parsing ─────────────────────────────────────────────────────────

/**
 * Extract base command names from a shell command string.
 * Handles pipes, semicolons, &&, || chaining.
 * Deduplicates repeated commands.
 * Resolves /usr/bin/find → find (basename-only).
 */
export function parseCommands(command: string): string[] {
	if (!command.trim()) return [];

	const seen = new Set<string>();
	const result: string[] = [];

	// Split on shell separators: |, ;, &&, ||
	const segments = command.split(/\s*[|;&]{1,2}\s*/);

	for (const segment of segments) {
		if (!segment.trim()) continue;
		const trimmed = segment.trim();

		// Extract the first word (base command) — handle:
		// - Simple: "find . -name '*.ts'" → find
		// - Assignment prefix: "du=rm -rf /" → du (second segment's first command after assignment)
		// - Absolute path: "/usr/bin/find" → find

		// Split on whitespace respecting quotes
		const words = splitRespectingQuotes(trimmed);
		if (words.length === 0) continue;

		let firstWord = words[0];

		// Handle variable assignment prefix: "du=rm -rf /"
		// The first word is "du=rm" — extract just the command name after =
		if (firstWord.includes("=")) {
			// Could be assignment with no command after, like "du=rm"
			// In this case, the entire thing is an assignment
			// But we want to catch the command being set, e.g., "du=rm" → "rm"
			// Only handle if there's more after the assignment
			if (firstWord.endsWith("=")) {
				// "du= rm -rf /" — next word after space
				if (words.length > 1) {
					firstWord = words[1];
				} else {
					continue;
				}
			} else {
				// "du=rm" — extract after =, but only if it looks like an assignment
				const eqIdx = firstWord.indexOf("=");
				const value = firstWord.slice(eqIdx + 1);
				if (value) {
					firstWord = value;
				}
			}
		}

		// Strip path prefix
		const cmd = stripPath(firstWord);
		if (cmd && !seen.has(cmd)) {
			seen.add(cmd);
			result.push(cmd);
		}
	}

	return result;
}

/**
 * Split a string by whitespace, respecting single and double quotes.
 */
function splitRespectingQuotes(input: string): string[] {
	const result: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			current += ch;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			current += ch;
		} else if (/\s/.test(ch) && !inSingle && !inDouble) {
			if (current) {
				result.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) result.push(current);
	return result;
}

/**
 * Strip directory path from a command name.
 * "/usr/bin/find" → "find", "git" → "git"
 */
function stripPath(cmd: string): string {
	// Handle paths like /usr/bin/find → find
	const slashIdx = cmd.lastIndexOf("/");
	if (slashIdx >= 0) {
		return cmd.slice(slashIdx + 1);
	}
	return cmd;
}

// ─── Command validation ──────────────────────────────────────────────────────

/**
 * Validate parsed commands against a whitelist and blocklist.
 * Returns { allowed: true } if all commands pass, or { allowed: false, reason }
 * with the first violation.
 *
 * blocklist takes precedence: if a command is in both whitelist and blocklist,
 * it's blocked (this allows git to be handled specially — git is in both,
 * git subcommands are validated separately).
 */
export function validateCommands(
	commands: string[],
	whitelist: Set<string>,
	blocklist: Set<string>,
): ValidationResult {
	if (commands.length === 0) {
		return { allowed: true };
	}

	for (const cmd of commands) {
		if (blocklist.has(cmd)) {
			return {
				allowed: false,
				reason: `Command '${cmd}' is blocked. Allowed: ${[...whitelist].filter(c => !blocklist.has(c)).join(", ")}`,
			};
		}
		if (!whitelist.has(cmd)) {
			return {
				allowed: false,
				reason: `Command '${cmd}' is not in the whitelist. Allowed: ${[...whitelist].join(", ")}`,
			};
		}
	}

	return { allowed: true };
}

// ─── Git subcommand validation ────────────────────────────────────────────────

/**
 * Validate a git subcommand against git config rules.
 *
 * Subcommand is the first non-flag argument to git (e.g., "status", "commit").
 * Args are the remaining arguments (e.g., ["-m", "msg"]).
 */
export function validateGitSubcommand(
	subcommand: string,
	args: string[],
	gitConfig: GitConfig,
): ValidationResult {
	// Check against blocked list first
	const blocked = gitConfig.blocked ?? [];
	if (blocked.includes(subcommand)) {
		const allowed = gitConfig.allow ?? [];
		return {
			allowed: false,
			reason: `Git subcommand '${subcommand}' is blocked. Allowed: ${allowed.join(", ")}`,
		};
	}

	// Check against allow list
	const allowed = gitConfig.allow ?? [];
	if (!allowed.includes(subcommand)) {
		return {
			allowed: false,
			reason: `Git subcommand '${subcommand}' is not allowed. Allowed: ${allowed.join(", ")}`,
		};
	}

	// Check blockIfArgContains for this subcommand
	const blockFlags = gitConfig.blockIfArgContains?.[subcommand];
	if (blockFlags) {
		for (const arg of args) {
			if (blockFlags.some((flag) => arg === flag || arg.startsWith(flag + "="))) {
				return {
					allowed: false,
					reason: `Git '${subcommand}' with flag '${arg}' is blocked`,
				};
			}
		}
	}

	// Check stash sub-subcommands
	if (subcommand === "stash" && gitConfig.stash) {
		const subSub = args[0];
		if (subSub) {
			const blockSubs = gitConfig.stash.blockSubcommands ?? [];
			if (blockSubs.includes(subSub)) {
				return {
					allowed: false,
					reason: `Git stash subcommand '${subSub}' is blocked. Allowed: ${(gitConfig.stash.allowSubcommands ?? []).join(", ")}`,
				};
			}
			const allowSubs = gitConfig.stash.allowSubcommands ?? [];
			if (!allowSubs.includes(subSub) && allowSubs.length > 0) {
				return {
					allowed: false,
					reason: `Git stash subcommand '${subSub}' is not allowed. Allowed: ${allowSubs.join(", ")}`,
				};
			}
		}
	}

	return { allowed: true };
}

// ─── find -delete stripping ──────────────────────────────────────────────────

/**
 * Strip -delete flag from find commands.
 * Returns the modified command and an optional warning.
 * Non-find commands are returned unchanged.
 */
export function stripFindDelete(command: string): FindDeleteResult {
	if (!command.trim().toLowerCase().startsWith("find")) {
		return { command };
	}

	// Simple approach: remove " -delete" or " -delete " occurrences
	const original = command;
	let modified = command.replace(/\s+-delete\s*/g, " ").trim();
	// Handle -delete at end
	modified = modified.replace(/\s+-delete$/, "").trim();

	if (modified !== original) {
		return {
			command: modified,
			warning: "Flag -delete stripped from find command",
		};
	}

	return { command };
}
