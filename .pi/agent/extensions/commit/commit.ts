/**
 * Core commit logic for the commit extension.
 * Shows raw terminal-style output — like running `!git commit` in pi.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execGit, execGitWithStream, getStagedDiffStat, getWorkingTreeDiffStat, trimSubject, parseStatusFiles } from "./git.ts";
import { generateCommitMessage } from "./message.ts";
import { spawnSubagent } from "./subagent.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommitParams {
	type?: string;
	scope?: string;
	description?: string;
	body?: string;
	addAll: boolean;
	files?: string[];
}

export interface CommitResult {
	content: { type: string; text: string }[];
	isError?: boolean;
	details?: Record<string, unknown>;
}

// ─── Output Builder ──────────────────────────────────────────────────────────

export class OutputBuilder {
	private lines: string[] = [];

	push(text: string): void {
		this.lines.push(text);
	}

	get text(): string {
		return this.lines.join("\n");
	}
}

// ─── Main Commit Flow ────────────────────────────────────────────────────────

export async function performCommit(
	pi: ExtensionAPI,
	params: CommitParams,
	signal: AbortSignal | undefined,
	out: OutputBuilder,
	ctx: ExtensionContext,
): Promise<CommitResult> {
	const { addAll, files } = params;

	// ── Step 1: Check git status ──
	const statusResult = await execGit(pi, ["status", "--short"], signal);
	const hasUnstagedChanges = statusResult.stdout.trim().length > 0;

	if (!hasUnstagedChanges) {
		const { stdout: stagedStdout } = await execGit(pi, ["diff", "--cached", "--stat"], signal);
		if (!stagedStdout.trim()) {
			out.push("nothing to commit, working tree clean");
			return { content: [{ type: "text", text: out.text }], details: { clean: true } };
		}
	}

	// ── Step 2: Gather stats ──
	const [unstagedStat, stagedStat] = await Promise.all([
		getWorkingTreeDiffStat(pi, signal),
		getStagedDiffStat(pi, signal),
	]);

	// Untracked files are not shown in diff --stat, capture from status --short
	const untrackedFiles = parseStatusFiles(statusResult.stdout);
	const allChangedFiles = [...new Set([...stagedStat.files, ...unstagedStat.files, ...untrackedFiles])];

	// ── Step 3: Stage changes ──
	if (hasUnstagedChanges) {
		if (files && files.length > 0) {
			out.push(`$ git add ${files.join(" ")}`);
			await execGit(pi, ["add", ...files], signal);
		} else {
			out.push("$ git add --all");
			await execGit(pi, ["add", "--all"], signal);
		}
	}

	// ── Step 4: Get staged diff for message generation ──
	const [{ stdout: stagedDiffText }, { stdout: shortStat }] = await Promise.all([
		execGit(pi, ["diff", "--cached"], signal),
		execGit(pi, ["diff", "--cached", "--stat"], signal),
	]);

	// ── Step 5: Build commit message ──
	let commitType = params.type;
	let commitScope = params.scope;
	let commitDescription = params.description;
	let commitBody = params.body;

	if (!commitType || !commitDescription) {
		const generated = generateCommitMessage(stagedDiffText, shortStat, allChangedFiles);
		commitType = commitType || generated.type;
		commitScope = commitScope || generated.scope;
		commitDescription = commitDescription || generated.description;
		commitBody = commitBody || generated.body;
	}

	const scopePart = commitScope ? `(${commitScope})` : "";
	const subjectLine = trimSubject(`${commitType}${scopePart}: ${commitDescription}`);

	// ── Step 6: Show commit command with message ──
	out.push(`$ git commit -m "${subjectLine}"`);

	// Build commit args
	const commitArgs = ["commit", "-m", subjectLine];
	if (commitBody) {
		commitArgs.push("-m", commitBody);
	}

	// ── Step 7: Run commit with streaming output ──
	// Use bash operations with onData callback so pre-commit hook output
	// appears in real-time rather than being buffered until completion.
	const liveLines: string[] = [];
	ctx.ui.setWidget("pre-commit", ["Running pre-commit hooks..."]);
	const result = await execGitWithStream(
		commitArgs,
		signal,
		ctx.cwd,
		(chunk: string) => {
			const lines = chunk.split("\n").filter((l) => l.length > 0);
			for (const line of lines) {
				out.push(line);
				liveLines.push(line);
			}
			ctx.ui.setWidget("pre-commit", liveLines.slice(-15));
		},
		60_000,
	);
	ctx.ui.setWidget("pre-commit", []);

	if (result.code !== 0) {
		const errorMsg = result.stderr || `exit code ${result.code}`;
		const isPreCommitFailure =
			errorMsg.includes("pre-commit") ||
			errorMsg.toLowerCase().includes("hook") ||
			(errorMsg.includes("exit code") && !errorMsg.includes("nothing added"));

		if (!isPreCommitFailure) {
			return { content: [{ type: "text", text: out.text }], isError: true, details: { success: false, error: errorMsg } };
		}

		return handlePreCommitFailure(pi, params, errorMsg, subjectLine, allChangedFiles, signal, out, ctx);
	}

	return {
		content: [{ type: "text", text: out.text }],
		details: {
			success: true,
			hash: result.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/)?.[1] || "unknown",
			message: subjectLine,
			files: allChangedFiles,
			type: commitType,
		},
	};
}

// ── Pre-commit Failure Handler ───────────────────────────────────────────────

async function handlePreCommitFailure(
	pi: ExtensionAPI,
	state: CommitParams,
	errorMsg: string,
	subjectLine: string,
	_allChangedFiles: string[],
	signal: AbortSignal | undefined,
	out: OutputBuilder,
	ctx: ExtensionContext,
): Promise<CommitResult> {
	out.push(""); // blank line before section
	out.push("# Pre-commit hook failed. Analyzing...");

	const [{ stdout: currentDiff }, { stdout: stagedFiles }] = await Promise.all([
		execGit(pi, ["diff", "--cached"], signal),
		execGit(pi, ["diff", "--cached", "--stat"], signal),
	]);

	const review = await spawnSubagent(
		"reviewer",
		`Analyze this git pre-commit hook failure and propose minimal fixes.

## Staged changes
\`\`\`
${stagedFiles}
\`\`\`

## Pre-commit error
\`\`\`
${errorMsg}
\`\`\`

## Staged diff (first 10000 chars)
\`\`\`
${currentDiff.slice(0, 10000)}
\`\`\`

Provide concise:
1. Root cause of the failure
2. Specific commands to fix
3. Files that need changes`,
		signal,
	);

	if (review.error) {
		out.push(`# Analysis error: ${review.error}`);
		return { content: [{ type: "text", text: out.text }], isError: true, details: { success: false, error: errorMsg } };
	}

	out.push(`# ${review.output.replace(/\n/g, "\n# ")}`);

	// Apply common formatter/linter fixes
	const fixCommands: string[] = [];
	if (errorMsg.includes("prettier") || errorMsg.includes("Prettier")) {
		fixCommands.push("npx --yes prettier --write . 2>/dev/null || prettier --write . 2>/dev/null || true");
	}
	if (errorMsg.includes("eslint") || errorMsg.includes("ESLint")) {
		fixCommands.push("npx --yes eslint --fix . 2>/dev/null || eslint --fix . 2>/dev/null || true");
	}
	if (errorMsg.includes("black")) fixCommands.push("black . 2>/dev/null || true");
	if (errorMsg.includes("rustfmt") || errorMsg.includes("cargo fmt")) fixCommands.push("cargo fmt 2>/dev/null || true");
	if (errorMsg.includes("gofmt") || errorMsg.includes("go fmt")) fixCommands.push("gofmt -w . 2>/dev/null || go fmt ./... 2>/dev/null || true");

	if (fixCommands.length > 0) {
		for (const cmd of fixCommands) {
			try {
				out.push(`$ ${cmd}`);
				const r = await pi.exec("bash", ["-c", cmd], { signal, timeout: 30_000 });
				if (r.stdout.trim()) out.push(r.stdout.trim());
			} catch {
				out.push(`# (non-critical failure)`);
			}
		}
	}

	// Re-stage and retry
	if (state.files && state.files.length > 0) {
		await execGit(pi, ["add", ...state.files], signal);
	} else {
		await execGit(pi, ["add", "--all"], signal);
	}

	const retryArgs = ["commit", "-m", subjectLine];
	if (state.body) retryArgs.push("-m", state.body);

	out.push(`$ git commit -m "${subjectLine}"`);
	const retryLines: string[] = [];
	ctx.ui.setWidget("pre-commit", ["Retrying commit (pre-commit hooks re-run)..."]);
	const retryResult = await execGitWithStream(
		retryArgs,
		signal,
		ctx.cwd,
		(chunk: string) => {
			const lines = chunk.split("\n").filter((l) => l.length > 0);
			for (const line of lines) {
				out.push(line);
				retryLines.push(line);
			}
			ctx.ui.setWidget("pre-commit", retryLines.slice(-15));
		},
		60_000,
	);
	ctx.ui.setWidget("pre-commit", []);

	if (retryResult.code !== 0) {
		return { content: [{ type: "text", text: out.text }], isError: true, details: { success: false, error: retryResult.stderr } };
	}

	return {
		content: [{ type: "text", text: out.text }],
		details: {
			success: true,
			hash: retryResult.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/)?.[1] || "unknown",
			message: subjectLine,
		},
	};
}
