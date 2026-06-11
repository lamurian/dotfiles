/**
 * Commit Extension
 *
 * Registers `/commit`:
 * - With a message (`/commit feat: add login`) → commits directly with that message.
 * - Without a message (`/commit`) → stages all changes, then asks the pi AI
 *   to generate a conventional commit message and call `/commit` with it.
 *
 * Output is raw terminal-style — like running `!git commit -m "..."` in pi.
 * Pre-commit hook output appears inline where the hook runs.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execGit } from "./git.ts";
import { performCommit, OutputBuilder } from "./commit.ts";

export default function commitExtension(pi: ExtensionAPI): void {
	pi.registerCommand("commit", {
		description:
			"Stage and commit changes with a conventional commit message. " +
			"Usage: /commit (generates message via AI) | /commit type(scope): description",
		handler: async (args, ctx) => {
			// Parse explicit message from args
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

			// ── Explicit message provided → commit directly ──
			if (type && description) {
				const out = new OutputBuilder();
				const result = await performCommit(
					pi, { type, scope, description, addAll: true }, undefined, out, ctx,
				);
				ctx.ui.notify(result.content[0].text, result.isError ? "error" : "info");
				return;
			}

			// ── No explicit message → stage and ask AI to generate one ──

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

			// Stage all changes
			if (hasUnstagedChanges) {
				await execGit(pi, ["add", "--all"], undefined);
			}

			// Get staged diff for the AI
			const [{ stdout: statText }, { stdout: diffText }] = await Promise.all([
				execGit(pi, ["diff", "--cached", "--stat"], undefined),
				execGit(pi, ["diff", "--cached"], undefined),
			]);

			const task = `I staged the following changes. Please generate a conventional commit message and call \`/commit\` with it.

Staged changes:
${statText}

Diff (first 20000 chars):
${diffText.slice(0, 20000)}

Call /commit with your message in this format:
/commit type(scope): description

Examples:
/commit feat(auth): add JWT token validation
/commit fix(api): handle null pointer in user lookup
/commit docs: update README with setup instructions`;

			// Queue as a follow-up message so the AI processes it after this command completes
			pi.sendUserMessage(task, { deliverAs: "followUp" });
			ctx.ui.notify("Changes staged. Generating commit message...", "info");
		},
	});
}
