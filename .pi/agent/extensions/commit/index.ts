/**
 * Commit Extension
 *
 * Registers `/commit` — a transparent, auto-committing slash command.
 * Shows every git command it runs and the generated commit message.
 * Handles pre-commit hook failures with automatic analysis, fix, and retry.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { performCommit, OutputBuilder } from "./commit.ts";

export default function commitExtension(pi: ExtensionAPI): void {
	pi.registerCommand("commit", {
		description:
			"Stage and commit changes with a conventional commit message. " +
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

			const out = new OutputBuilder();
			const result = await performCommit(
				pi, { type, scope, description, addAll: true }, undefined, out, ctx,
			);

			ctx.ui.notify(result.content[0].text, result.isError ? "error" : "info");
		},
	});
}
