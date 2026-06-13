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
