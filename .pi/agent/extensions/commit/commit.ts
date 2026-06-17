/**
 * Simplified commit execution for the commit extension.
 *
 * Just runs `git commit -m "<message>"` and returns the result.
 * Pre-commit hook retries are the caller's responsibility (AI or user).
 */

import { spawn } from "node:child_process";
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

// ─── Run Commit with Streaming ───────────────────────────────────────────────

/**
 * Run `git commit -m "<message>"` with real-time output streaming.
 *
 * Uses `child_process.spawn` so pre-commit hook output is reported
 * progressively via the `onProgress` callback. Also sets
 * `GIT_PROGRESS_DELAY=0` to reduce hook output buffering.
 *
 * @param _pi        - ExtensionAPI (unused, kept for interface consistency).
 * @param message   - Commit subject line.
 * @param body      - Optional body for multi-line messages.
 * @param signal    - Optional abort signal.
 * @param onProgress - Optional callback for streaming progress updates.
 * @param cwd       - Working directory for the git command (defaults to process.cwd()).
 * @returns Combined stdout+stderr output and exit code.
 */
export async function runCommitStreaming(
	_pi: ExtensionAPI,
	message: string,
	body?: string,
	signal?: AbortSignal,
	onProgress?: (update: { content: { type: string; text: string }[] }) => void,
	cwd?: string,
): Promise<{ output: string; code: number }> {
	const args = ["commit", "-m", message];
	if (body) {
		args.push("-m", body);
	}

	const env = { ...process.env, GIT_PROGRESS_DELAY: "0" };

	return new Promise((resolve, reject) => {
		const proc = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			signal,
			env,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		const flushProgress = (): void => {
			if (settled) return;
			const combined = stdout + stderr;
			if (combined.trim()) {
				onProgress?.({ content: [{ type: "text", text: combined.trim() }] });
			}
		};

		proc.stdout!.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			flushProgress();
		});

		proc.stderr!.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			flushProgress();
		});

		proc.on("close", (code, signalCode) => {
			if (settled) return;
			settled = true;
			// If the process was killed by a signal (e.g., abort), reject
			if (signalCode !== null) {
				reject(new Error(`Commit was aborted (signal: ${signalCode})`));
				return;
			}
			resolve({
				output: (stdout + stderr).trim(),
				code: code ?? -1,
			});
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			reject(err);
		});
	});
}
