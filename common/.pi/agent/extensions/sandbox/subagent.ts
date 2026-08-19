/**
 * subagent.ts — Tool-less sub-agent for command intent analysis
 *
 * Invokes an LLM via pi's provider infrastructure to analyze whether a
 * command is a workaround attempt for a sandbox-blocked operation.
 * The sub-agent has NO tool access — pure text-in/text-out completion.
 * No session file is created (no createAgentSession, no SessionManager).
 *
 * Fail-soft: returns null on any auth failure, parse failure, or timeout.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SubagentInput, SubagentResponse } from "./guardrail.ts";
import { SUBAGENT_SYSTEM_PROMPT } from "./guardrail.ts";

/**
 * Lazy-load completeSimple from pi-ai via pi-coding-agent's module resolution.
 * This avoids a direct dependency on @earendil-works/pi-ai in the extension's
 * package.json. The import resolves at runtime through pi-coding-agent's
 * node_modules where pi-ai is installed.
 */
type _CompleteSimpleFn = (model: any, context: any, options?: any) => Promise<{ content: Array<{ type: string; text?: string }> }>;
let _completeSimple: _CompleteSimpleFn | null = null;

async function getCompleteSimple() {
	if (!_completeSimple) {
		const pcaPath = import.meta.resolve("@earendil-works/pi-coding-agent");
		const pcaUrl = new URL(pcaPath);
		const compatUrl = new URL("../node_modules/@earendil-works/pi-ai/dist/compat.js", pcaUrl);
		const compat = await import(compatUrl.href);
		_completeSimple = compat.completeSimple;
	}
	return _completeSimple;
}

/**
 * Analyze a command using a tool-less sub-agent LLM call.
 *
 * Resolves auth via ctx.modelRegistry (same credentials as main session),
 * calls completeSimple with a constrained system prompt, and validates
 * the structured JSON response.
 *
 * Returns null (fail-soft) on any failure: auth failure, undefined model,
 * API error, parse failure, or validation rejection.
 */
/**
 * Parse and validate a safety-review response.
 * @param text Raw model output.
 * @returns Valid response, or null when malformed or low confidence.
 */
export function parseSubagentResponse(text: string): SubagentResponse | null {
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		if ((parsed.decision !== "allow" && parsed.decision !== "block") ||
			typeof parsed.confidence !== "number" || !Number.isFinite(parsed.confidence) ||
			parsed.confidence < 0.5 || parsed.confidence > 1 || typeof parsed.explanation !== "string") return null;
		return { decision: parsed.decision, confidence: parsed.confidence, explanation: parsed.explanation };
	} catch {
		return null;
	}
}

export async function analyzeWithSubagent(
	input: SubagentInput,
	ctx: ExtensionContext,
): Promise<SubagentResponse | null> {
	if (!ctx.model) return null;

	// Resolve auth using the same credentials as the main session
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) return null;

	try {
		const completeSimple = await getCompleteSimple();
		const response = await completeSimple(
			ctx.model,
			{
				systemPrompt: SUBAGENT_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: JSON.stringify(input),
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				timeoutMs: 5000,
			},
		);

		// Extract text from response
		const textContent = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		if (!textContent) return null;

		// Parse JSON
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(textContent);
		} catch {
			return null;
		}

		// Validate structure
		if (!parsed || typeof parsed !== "object") return null;

		return parseSubagentResponse(textContent);
	} catch {
		return null;
	}
}
