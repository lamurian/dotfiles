/**
 * commit_amend tool implementation.
 *
 * Handles git add --all, manual pre-commit hook execution,
 * and git commit --amend --no-edit with HEAD verification.
 *
 * This exists as a separate file to keep index.ts ≤300 lines.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execGit, runPreCommitHook } from "./git.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AmendResult {
	content: { type: string; text: string }[];
	isError?: boolean;
	details?: Record<string, unknown>;
}

// ─── Execute Amend ──────────────────────────────────────────────────────────

/**
 * Execute the commit_amend flow:
 * 1. Stage all changes via `git add --all`
 * 2. Run pre-commit hook manually (git's `--amend` skips hooks by default)
 * 3. If hook fails → throw error with fix guidance
 * 4. Capture HEAD before amend
 * 5. Run `git commit --amend --no-edit`
 * 6. Verify HEAD changed (ensures the amend actually landed)
 * 7. Return success/failure
 *
 * @param pi       - ExtensionAPI for executing commands.
 * @param signal   - Optional abort signal.
 * @param onUpdate - Optional callback for progress updates.
 * @param ctx      - Tool execution context with cwd and UI notify.
 * @returns AmendResult with content and details.
 */
export async function executeAmend(
	pi: ExtensionAPI,
	signal: AbortSignal | undefined,
	onUpdate:
		| ((update: { content: { type: string; text: string }[] }) => void)
		| undefined,
	ctx: { cwd: string; ui: { notify: (msg: string, type: string) => void } },
): Promise<AmendResult> {
	onUpdate?.({ content: [{ type: "text", text: "Staging all changes..." }] });
	await execGit(pi, ["add", "--all"], signal);

	// Run pre-commit hook manually (git commit --amend doesn't trigger hooks)
	onUpdate?.({ content: [{ type: "text", text: "Running pre-commit hooks..." }] });
	const hookResult = await runPreCommitHook(pi, signal);

	if (hookResult.ran && hookResult.code !== 0) {
		ctx.ui.notify("✗ Pre-commit hook failed", "error");
		throw new Error(
			`Pre-commit hook failed:\n\n${hookResult.output}\n\n` +
				`Fix the reported issues, then call \`commit_amend\` again.`,
		);
	}

	onUpdate?.({ content: [{ type: "text", text: "Amending last commit..." }] });

	// Capture HEAD before amend
	const { stdout: before, code: beforeCode } = await execGit(
		pi, ["rev-parse", "--short", "HEAD"], signal,
	);
	const hashBefore = beforeCode === 0 ? before.trim() : "";

	const result = await execGit(pi, ["commit", "--amend", "--no-edit"], signal);

	if (result.code === 0) {
		// Get the new hash after amend
		const { stdout: after, code: afterCode } = await execGit(
			pi, ["rev-parse", "--short", "HEAD"], signal,
		);
		const hashAfter = afterCode === 0 ? after.trim() : "unknown";

		// Verify the amend actually happened (new hash = new commit)
		if (hashBefore !== hashAfter || !hashBefore) {
			ctx.ui.notify("✓ Amended last commit", "info");
			return {
				content: [
					{
						type: "text",
						text: `Commit amended successfully. Hash: ${hashAfter}`,
					},
				],
				details: { success: true, hash: hashAfter },
			};
		}

		// HEAD didn't change — no new changes to include
		ctx.ui.notify("No changes to amend", "info");
		return {
			content: [
				{
					type: "text",
					text: `No changes to amend — working tree matches last commit. Hash: ${hashAfter}`,
				},
			],
			details: { success: true, hash: hashAfter },
		};
	}

	// Amend failed
	ctx.ui.notify("✗ Amend failed", "error");
	return {
		content: [
			{
				type: "text",
				text: `Failed to amend commit:\n${result.stderr || result.stdout}`,
			},
		],
		isError: true,
	};
}
