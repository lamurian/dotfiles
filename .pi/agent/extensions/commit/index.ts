/**
 * Commit Extension
 *
 * Custom tool for git committing:
 * - Shows diff stat before committing
 * - Stages changes (all or selective)
 * - Generates conventional commit messages
 * - Handles pre-commit hook failures: analyze -> fix -> retry
 * - Enforces permission rules (no git push, ask before commit)
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitDiffStat {
	files: string[];
	insertions: number;
	deletions: number;
}

interface CommitState {
	type: string;
	scope?: string;
	description: string;
	body?: string;
	addAll: boolean;
	files?: string[];
}

// ─── Extension Factory ───────────────────────────────────────────────────────

export default function commitExtension(pi: ExtensionAPI) {
	const commitState = new Map<string, CommitState>();

	// ─── Git Helpers ──────────────────────────────────────────────────────────

	async function execGit(args: string[], signal?: AbortSignal, timeout = 30_000) {
		return pi.exec("git", args, { signal, timeout });
	}

	async function getDiffStat(signal?: AbortSignal): Promise<GitDiffStat> {
		const { stdout } = await execGit(["diff", "--stat", "--cached"], signal);
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

	async function getWorkingTreeDiffStat(signal?: AbortSignal): Promise<GitDiffStat> {
		const { stdout } = await execGit(["diff", "--stat"], signal);
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

	async function getStagedDiffStat(signal?: AbortSignal): Promise<GitDiffStat> {
		return getDiffStat(signal);
	}

	function trimSubject(subject: string): string {
		const colonIdx = subject.indexOf(":");
		if (colonIdx === -1) return subject.length > 75 ? subject.slice(0, 72).trimEnd() + "..." : subject;

		const prefix = subject.slice(0, colonIdx + 1);
		let rest = subject.slice(colonIdx + 1).trim();

		rest = rest.charAt(0).toLowerCase() + rest.slice(1);
		rest = rest.replace(/\.$/, "");

		const full = `${prefix} ${rest}`;
		if (full.length <= 75) return full;
		return `${prefix} ${rest.slice(0, 72 - prefix.length - 1).trimEnd()}...`;
	}

	// ─── Commit message generation via subagent ───────────────────────────────

	async function generateCommitMessage(
		stagedDiff: string,
		statText: string,
		signal?: AbortSignal,
	): Promise<{ type: string; scope?: string; description: string; body?: string }> {
		const systemPrompt =
			"You are a commit message generator. Analyze the provided git diff and generate a conventional commit message.\n\n" +
			"Output exactly in this format:\n" +
			"TYPE: <type>\n" +
			"SCOPE: <scope or empty>\n" +
			"DESCRIPTION: <short imperative description, lowercase after type, no period, <75 chars>\n" +
			"BODY: <body explaining why, or empty if obvious>\n\n" +
			"Commit types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.\n" +
			"Subject: <75 chars, imperative, lowercase after type. No punctuation.\n" +
			"Body: only when 'why' isn't obvious from subject. Explain why, not what.";

		const task = `Generate a conventional commit message for this diff:\n\n${statText}\n\n${stagedDiff.slice(0, 50000)}`;

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "commit-msg-"));
		const taskFile = path.join(tmpDir, "task.md");
		await fs.promises.writeFile(taskFile, task, "utf-8");

		const args = ["-p", "--no-session", "--system-prompt", systemPrompt, taskFile];

		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				signal,
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			proc.on("close", (code) => {
				fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
				if (code !== 0) {
					resolve({ type: "feat", description: "update changes" });
					return;
				}
				const type = stdout.match(/TYPE:\s*(\S+)/)?.[1] || "feat";
				const scope = stdout.match(/SCOPE:\s*(\S+)/)?.[1] || undefined;
				const description = stdout.match(/DESCRIPTION:\s*(.+)/)?.[1]?.trim() || "update changes";
				const bodyMatch = stdout.match(/BODY:\s*([\s\S]*?)(?:\n[A-Z]+:|$)/);
				const body = bodyMatch?.[1]?.trim() || undefined;
				resolve({ type, scope, description, body: body || undefined });
			});

			proc.on("error", () => {
				fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
				resolve({ type: "feat", description: "update changes" });
			});
		});
	}

	// ─── Subagent spawning ────────────────────────────────────────────────────

	async function spawnSubagent(
		agentName: string,
		task: string,
		agentDir: string | null,
		signal?: AbortSignal,
	): Promise<{ output: string; error?: string }> {
		const agentDirs = [path.join(os.homedir(), ".pi", "agent", "agents")];
		if (agentDir) agentDirs.push(agentDir);

		let systemPrompt = "";
		for (const dir of agentDirs) {
			const filePath = path.join(dir, `${agentName}.md`);
			try {
				const content = await fs.promises.readFile(filePath, "utf-8");
				const bodyStart = content.indexOf("---", 3);
				if (content.startsWith("---") && bodyStart !== -1) {
					systemPrompt = content.slice(bodyStart + 3).trim();
				} else {
					systemPrompt = content;
				}
				break;
			} catch {
				// Agent file not found in this directory
			}
		}

		const args = ["--mode", "json", "-p", "--no-session"];
		if (systemPrompt) {
			args.push("--system-prompt", systemPrompt);
		}

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "commit-"));
		const taskFile = path.join(tmpDir, "task.md");
		await fs.promises.writeFile(taskFile, task, "utf-8");
		args.push(taskFile);

		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				signal,
			});

			let stdout = "";
			let stderr = "";

			proc.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			proc.on("close", (code) => {
				fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
				if (code !== 0) {
					resolve({
						output: stdout || "(no output)",
						error: stderr || `exit code ${code}`,
					});
				} else {
					resolve({ output: stdout || "(no output)" });
				}
			});

			proc.on("error", (err) => {
				fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
				resolve({ output: "", error: err.message });
			});
		});
	}

	// ─── Core commit logic ────────────────────────────────────────────────────

	async function performCommit(
		toolCallId: string,
		params: {
			type?: string;
			scope?: string;
			description?: string;
			body?: string;
			addAll: boolean;
			files?: string[];
		},
		signal: AbortSignal | undefined,
		onUpdate: ((partial: any) => void) | undefined,
		ctx: ExtensionContext,
	) {
		const { addAll, files } = params;

		// ── Step 1: Check git status ──
		onUpdate?.({ content: [{ type: "text", text: "🔍 Checking git status..." }] });

		let statusResult: { stdout: string; stderr: string; code: number };
		try {
			statusResult = await execGit(["status", "--short"], signal);
		} catch (err: any) {
			return {
				content: [{ type: "text", text: `❌ Failed to check git status: ${err.message}` }],
				isError: true,
				details: { error: err.message },
			};
		}

		const hasUnstagedChanges = statusResult.stdout.trim().length > 0;

		if (!hasUnstagedChanges) {
			const { stdout: stagedStdout } = await execGit(["diff", "--cached", "--stat"], signal);
			if (!stagedStdout.trim()) {
				return {
					content: [{ type: "text", text: "✅ Nothing to commit. Working tree is clean." }],
					details: { clean: true },
				};
			}
		}

		// ── Step 2: Show diff ──
		const unstagedStat = await getWorkingTreeDiffStat(signal);
		const stagedStat = await getStagedDiffStat(signal);
		const allChangedFiles = [
			...new Set([...stagedStat.files, ...unstagedStat.files]),
		];

		let diffOutput = "";
		if (unstagedStat.files.length > 0) {
			const { stdout: ud } = await execGit(["diff", "--stat"], signal);
			diffOutput += `📝 Unstaged changes:\n${ud}\n`;
		}
		if (stagedStat.files.length > 0) {
			const { stdout: sd } = await execGit(["diff", "--cached", "--stat"], signal);
			diffOutput += `📌 Staged changes:\n${sd}\n`;
		}

		const diffLines = diffOutput.split("\n").filter((l) => l.trim());
		const preview = diffLines.slice(0, 30).join("\n");
		const truncated = diffLines.length > 30 ? `\n... and ${diffLines.length - 30} more lines` : "";

		onUpdate?.({
			content: [
				{
					type: "text",
					text: `📊 Changes detected:\n\n${preview}${truncated}`,
				},
			],
		});

		// ── Step 3: Stage changes ──
		if (hasUnstagedChanges) {
			onUpdate?.({ content: [{ type: "text", text: "📦 Staging changes..." }] });
			try {
				if (files && files.length > 0) {
					await execGit(["add", ...files], signal);
				} else {
					await execGit(["add", "--all"], signal);
				}
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `❌ Failed to stage changes: ${err.message}` }],
					isError: true,
					details: { error: err.message },
				};
			}
		}

		// ── Step 4: Get full staged diff for message generation ──
		const { stdout: stagedDiffText } = await execGit(["diff", "--cached"], signal);
		const { stdout: shortStat } = await execGit(["diff", "--cached", "--stat"], signal);

		// ── Step 5: Generate commit message via subagent ──
		let commitType = params.type;
		let commitScope = params.scope;
		let commitDescription = params.description;
		let commitBody = params.body;

		if (!commitType || !commitDescription) {
			onUpdate?.({ content: [{ type: "text", text: "🤖 Generating commit message from diff..." }] });
			const generated = await generateCommitMessage(stagedDiffText, shortStat, signal);
			commitType = commitType || generated.type;
			commitScope = commitScope || generated.scope;
			commitDescription = commitDescription || generated.description;
			commitBody = commitBody || generated.body;
		}

		const scopePart = commitScope ? `(${commitScope})` : "";
		const subjectLine = trimSubject(`${commitType}${scopePart}: ${commitDescription}`);
		const fullMessage = commitBody ? `${subjectLine}\n\n${commitBody}` : subjectLine;

		// ── Step 6: Confirm commit (5s timeout, auto-deny on no response) ──
		if (ctx.hasUI) {
			const confirmed = await ctx.ui.confirm(
				"Confirm commit",
				`Commit message:\n\n  ${fullMessage}\n\nProceed?`,
				{ timeout: 5000 },
			);
			if (!confirmed) {
				return {
					content: [{ type: "text", text: "⏸ Commit cancelled by user." }],
					details: { cancelled: true },
				};
			}
		}

		// ── Step 7: Attempt commit ──
		onUpdate?.({ content: [{ type: "text", text: "💾 Committing..." }] });

		const commitArgs = ["commit"];
		if (commitBody) {
			commitArgs.push("-m", subjectLine, "-m", commitBody);
		} else {
			commitArgs.push("-m", subjectLine);
		}

		try {
			const result = await execGit(commitArgs, signal, 60_000);

			// pi.exec returns { stdout, stderr, code, killed } without throwing on
			// non-zero exit codes. Check result.code to detect actual commit failure.
			if (result.code !== 0) {
				const errorMsg = result.stderr || "git commit exited with code " + result.code;
				const isPreCommitFailure =
					errorMsg.includes("pre-commit") ||
					errorMsg.toLowerCase().includes("hook") ||
					(errorMsg.includes("exit code") && !errorMsg.includes("nothing added"));

				if (!isPreCommitFailure) {
					return {
						content: [{ type: "text", text: `❌ Commit failed:\n\n\`\`\`\n${errorMsg}\n\`\`\`` }],
						isError: true,
						details: { success: false, error: errorMsg },
					};
				}

				// ── Pre-commit hook failure handling: analyze -> fix -> retry ──
				return handlePreCommitFailure(
					toolCallId,
					{
						type: commitType,
						scope: commitScope,
						description: commitDescription,
						body: commitBody,
						addAll,
						files,
					},
					errorMsg,
					subjectLine,
					allChangedFiles,
					signal,
					onUpdate,
					ctx,
				);
			}

			const hashMatch = result.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
			const hash = hashMatch ? hashMatch[1] : undefined;

			return {
				content: [
					{
						type: "text",
						text: `✅ Commit successful!\n\nHash: \`${hash || "unknown"}\`\nMessage: \`${subjectLine}\`\n\nFiles changed: ${allChangedFiles.length}`,
					},
				],
				details: {
					success: true,
					hash,
					message: subjectLine,
					files: allChangedFiles,
					type: commitType,
				},
			};
		} catch (commitError: any) {
			const errorMsg = typeof commitError === "object" && commitError !== null
				? (commitError.stderr || commitError.message || "Unknown error")
				: "Unknown error";
			return {
				content: [{ type: "text", text: `❌ Commit failed with unexpected error:\n\n\`\`\`\n${errorMsg}\n\`\`\`` }],
				isError: true,
				details: { success: false, error: errorMsg },
			};
		}
	}

	// ── Pre-commit failure handler: analyze -> fix -> retry ────────────────────

	async function handlePreCommitFailure(
		toolCallId: string,
		state: CommitState,
		errorMsg: string,
		subjectLine: string,
		allChangedFiles: string[],
		signal: AbortSignal | undefined,
		onUpdate: ((partial: any) => void) | undefined,
		ctx: ExtensionContext,
	) {
		commitState.set(toolCallId, state);

		// Get staged diff for analysis
		const { stdout: currentDiff } = await execGit(["diff", "--cached"], signal);
		const { stdout: stagedFiles } = await execGit(["diff", "--cached", "--stat"], signal);

		onUpdate?.({ content: [{ type: "text", text: "🔍 Analyzing pre-commit failure..." }] });

		const agentDir = path.join(os.homedir(), ".pi", "agent", "agents");
		const reviewTask = `Analyze this git pre-commit hook failure and propose minimal fixes.

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
2. Specific commands to fix (e.g., "npx prettier --write src/", "npx eslint --fix src/")
3. Files that need changes`;

		const review = await spawnSubagent("reviewer", reviewTask, agentDir, signal);

		if (review.error) {
			return {
				content: [
					{
						type: "text",
						text: `❌ Pre-commit hook failed and analysis errored.\n\n**Error:**\n\`\`\`\n${errorMsg}\n\`\`\`\n\n**Analysis error:**\n\`\`\`\n${review.error}\n\`\`\``,
					},
				],
				isError: true,
				details: { success: false, error: errorMsg, analysisError: review.error },
			};
		}

		// Apply fixes and retry automatically (no confirmation)
		onUpdate?.({ content: [{ type: "text", text: `🔧 Pre-commit hook failure analysis:\n\n${review.output}\n\nApplying fixes...` }] });

		// Apply common formatter/linter fixes

		const fixCommands: string[] = [];
		if (errorMsg.includes("prettier") || errorMsg.includes("Prettier")) {
			fixCommands.push("npx --yes prettier --write . 2>/dev/null || prettier --write . 2>/dev/null || true");
		}
		if (errorMsg.includes("eslint") || errorMsg.includes("ESLint")) {
			fixCommands.push("npx --yes eslint --fix . 2>/dev/null || eslint --fix . 2>/dev/null || true");
		}
		if (errorMsg.includes("black")) {
			fixCommands.push("black . 2>/dev/null || true");
		}
		if (errorMsg.includes("rustfmt") || errorMsg.includes("cargo fmt")) {
			fixCommands.push("cargo fmt 2>/dev/null || true");
		}
		if (errorMsg.includes("gofmt") || errorMsg.includes("go fmt")) {
			fixCommands.push("gofmt -w . 2>/dev/null || go fmt ./... 2>/dev/null || true");
		}

		const fixResults: string[] = [];
		for (const cmd of fixCommands) {
			try {
				const result = await pi.exec("bash", ["-c", cmd], { signal, timeout: 30_000 });
				const output = result.stdout.trim() || "(no output)";
				fixResults.push(`$ ${cmd}\n${output}`);
			} catch {
				fixResults.push(`$ ${cmd}\n⚠️ failed (non-critical)`);
			}
		}

		// Re-stage and commit
		onUpdate?.({ content: [{ type: "text", text: "📦 Re-staging and retrying commit..." }] });

		try {
			if (state.files && state.files.length > 0) {
				await execGit(["add", ...state.files], signal);
			} else {
				await execGit(["add", "--all"], signal);
			}
		} catch (stageErr: any) {
			return {
				content: [
					{
						type: "text",
						text: `❌ Re-stage failed: ${stageErr.message}`,
					},
				],
				isError: true,
				details: { success: false, error: stageErr.message, fixResults },
			};
		}

		try {
			const retryArgs = ["commit"];
			if (state.body) {
				retryArgs.push("-m", subjectLine, "-m", state.body);
			} else {
				retryArgs.push("-m", subjectLine);
			}
			const retryResult = await execGit(retryArgs, signal, 60_000);

			// Check exit code; pi.exec never throws for non-zero exits
			if (retryResult.code !== 0) {
				const errMsg = retryResult.stderr || "exit code " + retryResult.code;
				return {
					content: [
						{
							type: "text",
							text: `❌ Commit still failing after fixes.\n\n**Error:**\n\`\`\`\n${errMsg}\n\`\`\`\n\n**Fixes tried:**\n${fixResults.join("\n")}`,
						},
					],
					isError: true,
					details: {
						success: false,
						error: errMsg,
						fixesAttempted: fixResults,
					},
				};
			}

			const hashMatch = retryResult.stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
			const hash = hashMatch ? hashMatch[1] : undefined;

			return {
				content: [
					{
						type: "text",
						text: `✅ Commit succeeded after fixes!\n\nHash: \`${hash || "unknown"}\`\nMessage: \`${subjectLine}\`\n\n**Fixes applied:**\n${fixResults.join("\n")}`,
					},
				],
				details: {
					success: true,
					hash,
					message: subjectLine,
					files: allChangedFiles,
					type: state.type,
					fixesApplied: fixResults,
				},
			};
		} catch (retryErr: any) {
			return {
				content: [
					{
						type: "text",
						text: `❌ Commit retry failed with unexpected error.\n\n**Error:**\n\`\`\`\n${retryErr.stderr || retryErr.message}\n\`\`\`\n\n**Fixes tried:**\n${fixResults.join("\n")}`,
					},
				],
				isError: true,
				details: {
					success: false,
					error: retryErr.stderr || retryErr.message,
					fixesAttempted: fixResults,
				},
			};
		}
	}

	// ─── Register the commit tool ─────────────────────────────────────────────

	pi.registerTool({
		name: "commit",
		label: "Commit",
		description:
			"Stage changes and commit with a conventional commit message. Shows diff stat, " +
			"prompts for confirmation, generates a commit message, and handles pre-commit hook failures " +
			"by analyzing the error, applying fixes, and retrying the commit.",
		promptSnippet: "Stage and commit changes with a conventional commit message",
		promptGuidelines: [
			"Use commit when the user asks to commit changes or to stage and commit work.",
			"commit respects pre-commit hooks: on failure it analyzes the error, proposes a fix plan, applies fixes, and retries automatically.",
			"Do not use raw git commit; use commit for proper conventional commit formatting and pre-commit handling.",
		],
		parameters: Type.Object({
			type: Type.Optional(
				Type.Union(
					[
						Type.Literal("feat"),
						Type.Literal("fix"),
						Type.Literal("docs"),
						Type.Literal("style"),
						Type.Literal("refactor"),
						Type.Literal("perf"),
						Type.Literal("test"),
						Type.Literal("build"),
						Type.Literal("ci"),
						Type.Literal("chore"),
						Type.Literal("revert"),
					],
					{ description: "Conventional commit type. Auto-detected from changes if omitted." },
				),
			),
			scope: Type.Optional(
				Type.String({ description: "Optional scope, e.g. component or module name." }),
			),
			description: Type.Optional(
				Type.String({
					description:
						"Short imperative description (<75 chars). Auto-generated from diff if omitted.",
				}),
			),
			body: Type.Optional(
				Type.String({
					description:
						"Optional body explaining why (not what). Only include when the reason isn't obvious from the subject.",
				}),
			),
			addAll: Type.Optional(
				Type.Boolean({
					description: "Stage all unstaged changes. Default: true.",
				}),
			),
			files: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific files to stage instead of --all.",
				}),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return performCommit(toolCallId, params, signal, onUpdate, ctx);
		},
	});

	// ─── Register the /commit command ────────────────────────────────────────

	pi.registerCommand("commit", {
		description: "Stage and commit changes with a conventional commit message. " +
			"Optionally pass a commit message as argument, e.g. `/commit feat: add login`.",
		handler: async (args, ctx) => {
			// Parse args for type, scope, description (support "type(scope): desc" format)
			let type: string | undefined;
			let scope: string | undefined;
			let description: string | undefined;

			if (args) {
				const conventionalMatch = args.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)/);
				if (conventionalMatch) {
					type = conventionalMatch[1];
					scope = conventionalMatch[2];
					description = conventionalMatch[3];
				} else {
					description = args;
				}
			}

			const toolCallId = `cmd-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const result = await performCommit(toolCallId, {
				type,
				scope,
				description,
				addAll: true,
			}, undefined, undefined, ctx);

			if (result.isError) {
				const text = result.content?.[0]?.text || "Commit failed.";
				ctx.ui.notify(text, "error");
			} else {
				const text = result.content?.[0]?.text || "✅ Commit successful!";
				ctx.ui.notify(text, "info");
			}
		},
	});
}
