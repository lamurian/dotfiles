import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";

export const FOCUS_PROMPT = `⚠️ Command blocked by sandbox.

Pause and assess:
1. What is the current state of implementation?
2. What tasks remain to complete the goal?
3. If all implementation is done and only verification remains:
   provide the user with clear handoff instructions
   (what was changed, what command to run, what to check in the output).
4. If implementation is not done: continue with remaining tasks.`;

const BLOCK_PATTERNS = [
	"blocked",
	"not in the whitelist",
	"not allowed",
	"eacces",
	"permission denied",
	"read-only",
	"bwrap",
];

export function isSandboxBlockedError(text: string): boolean {
	const lower = text.toLowerCase();
	return BLOCK_PATTERNS.some((p) => lower.includes(p));
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_result", async (event, _ctx) => {
		if (!isBashToolResult(event)) return;
		if (!event.isError) return;

		const text = event.content
			.filter((c: { type: string; text: string }) => c.type === "text")
			.map((c: { type: string; text: string }) => c.text)
			.join("\n");

		if (!isSandboxBlockedError(text)) return;

		return {
			content: [
				...event.content,
				{ type: "text" as const, text: `\n${FOCUS_PROMPT}` },
			],
		};
	});
}
