/**
 * Git helper utilities for the commit extension.
 */

import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
 * Parse untracked and modified file paths from `git status --short` output.
 * Lines starting with `??` are untracked files; ` M` / `M ` are modified.
 */
export function parseStatusFiles(stdout: string): string[] {
	const files: string[] = [];
	for (const line of stdout.trim().split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		// Match: "?? path/to/file" or " M path/to/file" or "M  path/to/file"
		// After the two status columns, everything else is the path
		const pathMatch = line.match(/^\S\S\s+(.+)$/);
		if (pathMatch) files.push(pathMatch[1].trim());
	}
	return files;
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

/**
 * Execute a git command with streaming output via bash operations.
 * Unlike execGit (which buffers all output), this delivers chunks in
 * real-time via the onChunk callback, useful for long-running commands
 * like git commit where pre-commit hooks produce incremental progress.
 */
export async function execGitWithStream(
	args: string[],
	signal: AbortSignal | undefined,
	cwd: string,
	onChunk: (chunk: string) => void,
	timeout = 60_000,
): Promise<GitResult> {
	const escapedArgs = args.map((a) => {
		if (a.includes("'")) {
			return `"${a.replace(/"/g, '\\"')}"`;
		}
		if (a.includes(" ") || a.includes("(") || a.includes(")")) {
			return `'${a}'`;
		}
		return a;
	});
	const command = `git ${escapedArgs.join(" ")}`;

	const ops = createLocalBashOperations();
	let allOutput = "";

	const { exitCode } = await ops.exec(command, cwd, {
		onData: (data: Buffer) => {
			const chunk = data.toString();
			allOutput += chunk;
			onChunk(chunk);
		},
		signal,
		timeout,
	});

	return {
		stdout: allOutput,
		stderr: allOutput,
		code: exitCode ?? 1,
		killed: exitCode === null,
	};
}
