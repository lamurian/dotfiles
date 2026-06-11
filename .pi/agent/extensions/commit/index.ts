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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execGit, trimSubject } from "./git.ts";
import { runCommit, type CommitResult } from "./commit.ts";

export default function commitExtension(pi: ExtensionAPI): void {
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
			onUpdate?.([{ type: "text", text: "Running git commit..." }]);

			const result = await runCommit(pi, params.message, params.body, signal);

			if (result.code === 0) {
				// Extract hash from output: "[branch hash] ..."
				const hashMatch = result.output.match(/\[[\w-]+ ([a-f0-9]+)\]/);
				const hash = hashMatch?.[1] || "unknown";

				ctx.ui.notify(`✓ ${params.message}`, "info");

				return {
					content: [{ type: "text", text: `Commit successful. Hash: ${hash}` }],
					details: { success: true, hash, message: params.message },
				};
			}

			// Check if pre-commit hook failure
			const isPreCommitFailure =
				result.output.toLowerCase().includes("pre-commit") ||
				result.output.toLowerCase().includes("hook failed");

			if (isPreCommitFailure) {
				return {
					content: [
						{
							type: "text",
							text: `Commit failed due to pre-commit hooks:\n\n${result.output}\n\nFix the reported issues, stage fixes with \`git add\`, then call \`commit_changes\` again with the same message.`,
						},
					],
					details: { success: false, isPreCommitFailure, message: params.message },
				};
			}

			// Genuine error
			ctx.ui.notify(`✗ Commit failed: ${params.message}`, "error");
			return {
				content: [{ type: "text", text: `Commit failed:\n${result.output}` }],
				isError: true,
				details: { success: false, error: result.output },
			};
		},
	});
}
