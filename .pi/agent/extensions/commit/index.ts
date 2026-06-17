/**
 * Commit Extension
 *
 * Registers `/commit` and the `commit_changes` tool.
 *
 * Flow:
 * 1. User types `/commit` → stages all changes, sends followUp to AI
 * 2. AI generates conventional commit message → calls `commit_changes` tool
 * 3. Tool runs `git commit -m "message"` → returns result
 * 4. If pre-commit hooks fail: AI fixes, re-stages, calls tool again
 *
 * For explicit messages (`/commit type: description`) → commits directly.
 */

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execGit, trimSubject } from "./git.ts";
import { runCommit, runCommitStreaming, type CommitResult } from "./commit.ts";

export default function commitExtension(pi: ExtensionAPI): void {
	// ── Guardrail: block git commit via bash ──────────────────────────────
	pi.on("tool_call", async (event: ToolCallEvent, _ctx) => {
		if (event.toolName !== "bash") return;
		const cmd = (event.input as { command?: string }).command ?? "";
		// Block "git commit" (including bypass patterns like git -c core.hooksPath=/dev/null commit)
		if (/\bgit\s+(?:-\S+(?:\s+\S+)?\s+)*commit\b/.test(cmd)) {
			return {
				block: true,
				reason:
					"Use the commit_changes tool instead of running git commit directly via bash. " +
					"The commit_changes tool verifies the commit actually landed and handles pre-commit hook failures correctly.",
			};
		}
	});
	// ── /commit command ────────────────────────────────────────────────────
	pi.registerCommand("commit", {
		description:
			"Stage and commit changes. " +
			"Usage: /commit (AI generates message) | /commit type(scope): description",

		handler: async (args, ctx) => {
			// ── Parse explicit message from args ──
			let type: string | undefined;
			let scope: string | undefined;
			let description: string | undefined;

			if (args) {
				const conventionalMatch = args.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)/);
				if (conventionalMatch) {
					type = conventionalMatch[1];
					scope = conventionalMatch[2];
					description = conventionalMatch[3];
				}
			}

			// ── Explicit message → commit directly ──
			if (type && description) {
				// Check if there's anything to commit
				const statusResult = await execGit(pi, ["status", "--short"], undefined);
				const hasUnstagedChanges = statusResult.stdout.trim().length > 0;

				if (!hasUnstagedChanges) {
					const { stdout: stagedStdout } = await execGit(pi, ["diff", "--cached", "--stat"], undefined);
					if (!stagedStdout.trim()) {
						ctx.ui.notify("nothing to commit, working tree clean", "info");
						return;
					}
				}

				if (hasUnstagedChanges) {
					await execGit(pi, ["add", "--all"], undefined);
				}

				const subjectLine = trimSubject(`${type}${scope ? `(${scope})` : ""}: ${description}`);
				const result = await runCommit(pi, subjectLine, undefined, undefined);

				if (result.code === 0) {
					ctx.ui.notify(`✓ ${subjectLine}`, "info");
				} else {
					ctx.ui.notify(`✗ Commit failed:\n${result.output}`, "error");
				}
				return;
			}

			// ── No explicit message → stage and ask AI ──
			const statusResult = await execGit(pi, ["status", "--short"], undefined);
			const hasUnstagedChanges = statusResult.stdout.trim().length > 0;

			if (!hasUnstagedChanges) {
				const { stdout: stagedStdout } = await execGit(pi, ["diff", "--cached", "--stat"], undefined);
				if (!stagedStdout.trim()) {
					ctx.ui.notify("nothing to commit, working tree clean", "info");
					return;
				}
			}

			// Stage all changes
			if (hasUnstagedChanges) {
				await execGit(pi, ["add", "--all"], undefined);
			}

			// Get only the stat summary — token efficient
			const { stdout: statText } = await execGit(pi, ["diff", "--cached", "--stat"], undefined);

			const task = `I staged the following changes. Generate a conventional commit message and call \`commit_changes\` to finalize.

Staged changes:
${statText}

- Prefer a one-line subject (≤75 chars) in conventional format: \`type(scope): description\`
- Use a body only if the change needs additional explanation; otherwise commit must be single-line
- If pre-commit hooks fail, fix the reported issues, stage with \`git add\`, and call \`commit_changes\` again with the same message

Examples:
  feat(auth): add JWT token validation
  fix(api): handle null pointer in user lookup
  docs: update README with setup instructions`;

			pi.sendUserMessage(task, { deliverAs: "followUp" });
			ctx.ui.notify("Changes staged. Generating commit message...", "info");
		},
	});

	// ── commit_changes tool ──────────────────────────────────────────────
	pi.registerTool({
		name: "commit_changes",
		description:
			"Run git commit with staged changes. Call this after generating a commit message. " +
			"If pre-commit hooks fail, fix issues and call this tool again with the same message.",
		parameters: Type.Object({
			message: Type.String({
				description:
					"Conventional commit message (subject line, ≤75 chars, e.g. 'feat(auth): add login')",
			}),
			body: Type.Optional(
				Type.String({
					description:
						"Optional body for multi-line commit messages. Use only when extra context is needed.",
				}),
			),
		}),
		promptSnippet:
			"Run git commit with staged changes using a conventional commit message. If pre-commit hooks fail, fix and retry.",
		promptGuidelines: [
			"Use commit_changes to finalize a commit after generating the message. " +
				"If pre-commit hooks fail, fix the issues, re-stage with git add, then call commit_changes again.",
		],
		async execute(
			toolCallId: string,
			params: { message: string; body?: string },
			signal: AbortSignal | undefined,
			onUpdate: ((update: { content: { type: string; text: string }[] }) => void) | undefined,
			ctx: { cwd: string; ui: { notify: (msg: string, type: string) => void } },
		): Promise<CommitResult> {
			onUpdate?.({ content: [{ type: "text", text: "Running git commit..." }] });

			// Capture HEAD before commit to verify the commit actually happens.
			// Use --short for consistent format with the after-commit check.
			const { stdout: before, code: beforeCode } = await execGit(
				pi, ["rev-parse", "--short", "HEAD"], signal,
			);
			const hashBefore = beforeCode === 0 ? before.trim() : "";

			const result = await runCommitStreaming(pi, params.message, params.body, signal, onUpdate, ctx.cwd);

			if (result.code === 0) {
				// Get the actual commit hash via rev-parse — robust across all branch
				// names, root commits, and detached HEAD states.
				const { stdout: after, code: afterCode } = await execGit(
					pi, ["rev-parse", "--short", "HEAD"], signal,
				);
				const hashAfter = afterCode === 0 ? after.trim() : "unknown";

				// Verify the commit actually happened by checking HEAD changed
				if (hashBefore !== hashAfter || !hashBefore) {
					ctx.ui.notify(`✓ ${params.message}`, "info");

					return {
						content: [{ type: "text", text: `Commit successful. Hash: ${hashAfter}` }],
						details: { success: true, hash: hashAfter, message: params.message },
					};
				}

				// HEAD didn't change — check if pre-commit hooks ran (code 0 + hook output)
				const output = result.output.toLowerCase();
				const hasPreCommitOutput =
					output.includes("pre-commit") ||
					output.includes("running pre-commit");

				if (hasPreCommitOutput) {
					throw new Error(
						`Commit was blocked by pre-commit hooks.\n\n${result.output}\n\n` +
							`Fix the reported issues, re-stage with \`git add\`, ` +
							`then call \`commit_changes\` again with the same message.`,
					);
				}

				// HEAD didn't change with no hook output — staging issue
				throw new Error(
					`Commit reported success but HEAD did not change.\n\n${result.output}\n\n` +
						`Ensure changes are staged and try again.`,
				);
			}

			// Check if pre-commit hook failure
			const isPreCommitFailure =
				result.output.toLowerCase().includes("pre-commit") ||
				result.output.toLowerCase().includes("hook failed");

			if (isPreCommitFailure) {
				ctx.ui.notify(`✗ Commit failed due to pre-commit hooks: ${params.message}`, "error");
				throw new Error(
					`Commit failed due to pre-commit hooks:\n\n${result.output}\n\n` +
						`Fix the reported issues, stage fixes with \`git add\`, then call \`commit_changes\` again with the same message.`,
				);
			}

			// Genuine error
			ctx.ui.notify(`✗ Commit failed: ${params.message}`, "error");
			throw new Error(`Commit failed:\n${result.output}`);
		},
	});
}
