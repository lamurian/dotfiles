/**
 * Git helper utilities for the commit extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Execute a git command via pi.exec.
 * Returns { stdout, stderr, code, killed } — does NOT throw on non-zero exit.
 *
 * @param pi      - ExtensionAPI for executing commands.
 * @param args    - Git arguments.
 * @param signal  - Optional AbortSignal to cancel the command.
 * @param timeout - Optional timeout in ms. If undefined, no hard timeout is set,
 *                  so long-running operations (e.g. pre-commit hooks with tests)
 *                  are not killed prematurely.
 */
export async function execGit(
	pi: ExtensionAPI,
	args: string[],
	signal?: AbortSignal,
	timeout?: number,
): Promise<GitResult> {
	const opts: { signal?: AbortSignal; timeout?: number } = { signal };
	if (timeout !== undefined) opts.timeout = timeout;
	return pi.exec("git", args, opts) as unknown as GitResult;
}

/**
 * Get the git hooks directory path.
 * Returns the path as reported by `git rev-parse --git-path hooks`.
 *
 * @param pi     - ExtensionAPI for executing commands.
 * @param signal - Optional abort signal.
 * @returns The hooks directory path.
 */
export async function getHooksDir(
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<string> {
	const { stdout } = await execGit(pi, ["rev-parse", "--git-path", "hooks"], signal);
	return stdout.trim();
}

/**
 * Run the pre-commit hook if it exists and is executable.
 * Uses `pi.exec` to run the hook script directly (bypasses sandbox).
 *
 * @param pi     - ExtensionAPI for executing commands.
 * @param signal - Optional abort signal.
 * @returns Object with `ran` boolean, and if ran: `output` and `code`.
 */
export async function runPreCommitHook(
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<{ ran: boolean; output?: string; code?: number }> {
	const hooksDir = await getHooksDir(pi, signal);
	const hookPath = `${hooksDir}/pre-commit`;

	// Check if hook exists and is executable
	const checkResult = await pi.exec(
		"sh", ["-c", `test -x "${hookPath}"`], { signal },
	) as unknown as GitResult;

	if (checkResult.code !== 0) {
		return { ran: false }; // Hook doesn't exist or isn't executable
	}

	// Run the hook and capture output
	const result = await pi.exec(
		"sh", ["-c", `"${hookPath}" 2>&1`], { signal },
	) as unknown as GitResult;

	return {
		ran: true,
		output: (result.stdout || result.stderr).trim(),
		code: result.code,
	};
}

/**
 * Trim a commit subject to fit within 75 characters.
 * Ensures lowercase after colon and no trailing period.
 */
export function trimSubject(subject: string): string {
	const colonIdx = subject.indexOf(":");
	if (colonIdx === -1) {
		return subject.length > 75
			? subject.slice(0, 72).trimEnd() + "..."
			: subject;
	}

	const prefix = subject.slice(0, colonIdx + 1).toLowerCase();
	let rest = subject.slice(colonIdx + 1).trim();

	rest = rest.charAt(0).toLowerCase() + rest.slice(1);
	rest = rest.replace(/\.$/, "");

	const full = `${prefix} ${rest}`;
	if (full.length <= 75) return full;
	return `${prefix} ${rest.slice(0, 72 - prefix.length - 1).trimEnd()}...`;
}
