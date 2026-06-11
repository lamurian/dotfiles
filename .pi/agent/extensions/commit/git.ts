/**
 * Git helper utilities for the commit extension.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitDiffStat {
	files: string[];
	insertions: number;
	deletions: number;
}

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
 */
export async function execGit(
	pi: ExtensionAPI,
	args: string[],
	signal?: AbortSignal,
	timeout = 30_000,
): Promise<GitResult> {
	return pi.exec("git", args, { signal, timeout }) as unknown as GitResult;
}

/**
 * Parse git diff --stat output into a structured summary.
 */
function parseDiffStat(stdout: string): GitDiffStat {
	const lines = stdout.trim().split("\n");
	const files: string[] = [];
	let insertions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (!line.trim()) continue;
		const fileMatch = line.match(/^(.+?)\s+\|/);
		if (fileMatch) files.push(fileMatch[1].trim());
		const insMatch = line.match(/(\d+) insertion/);
		const delMatch = line.match(/(\d+) deletion/);
		if (insMatch) insertions += parseInt(insMatch[1], 10);
		if (delMatch) deletions += parseInt(delMatch[1], 10);
	}

	return { files, insertions, deletions };
}

/**
 * Get diff stat for staged changes (--cached).
 */
export async function getStagedDiffStat(
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<GitDiffStat> {
	const { stdout } = await execGit(pi, ["diff", "--stat", "--cached"], signal);
	return parseDiffStat(stdout);
}

/**
 * Get diff stat for unstaged working tree changes.
 */
export async function getWorkingTreeDiffStat(
	pi: ExtensionAPI,
	signal?: AbortSignal,
): Promise<GitDiffStat> {
	const { stdout } = await execGit(pi, ["diff", "--stat"], signal);
	return parseDiffStat(stdout);
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

	const prefix = subject.slice(0, colonIdx + 1);
	let rest = subject.slice(colonIdx + 1).trim();

	rest = rest.charAt(0).toLowerCase() + rest.slice(1);
	rest = rest.replace(/\.$/, "");

	const full = `${prefix} ${rest}`;
	if (full.length <= 75) return full;
	return `${prefix} ${rest.slice(0, 72 - prefix.length - 1).trimEnd()}...`;
}
