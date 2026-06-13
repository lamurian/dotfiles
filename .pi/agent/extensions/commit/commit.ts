/**
 * Simplified commit execution for the commit extension.
 *
 * Just runs `git commit -m "<message>"` and returns the result.
 * Pre-commit hook retries are the caller's responsibility (AI or user).
 */

import { execGit } from "./git.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommitResult {
	content: { type: string; text: string }[];
	isError?: boolean;
	details?: Record<string, unknown>;
}

// ─── Run Commit ──────────────────────────────────────────────────────────────

/**
 * Run `git commit -m "<message>"` with an optional body.
 *
 * @param pi     - ExtensionAPI for executing git commands.
 * @param message- Commit subject line (conventional format, ≤75 chars).
 * @param body   - Optional body for multi-line messages.
 * @param signal - Optional abort signal.
 * @returns Combined stdout+stderr output and exit code.
 */
export async function runCommit(
	pi: ExtensionAPI,
	message: string,
	body?: string,
	signal?: AbortSignal,
): Promise<{ output: string; code: number }> {
	const args = ["commit", "-m", message];
	if (body) {
		args.push("-m", body);
	}

	// No hard timeout — let git hooks run as long as needed.
	// The LLM's AbortSignal (passed via signal) is the right way to cancel a stuck commit.
	const result = await execGit(pi, args, signal);

	return {
		output: (result.stdout + result.stderr).trim(),
		code: result.code,
	};
}
