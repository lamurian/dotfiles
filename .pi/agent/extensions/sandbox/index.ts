/**
 * Sandbox Extension — OS-level sandboxing for bash commands
 *
 * Replaces the built-in bash tool with a bwrap-sandboxed version.
 * Supports per-binary mounting for command whitelisting.
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/extensions/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json (project-local)
 *
 * Usage:
 *   pi --no-sandbox         disable sandboxing
 *   /sandbox                show current configuration
 *
 * Linux requires: bubblewrap (bwrap)
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import {
	mergeToolConfigs,
	evaluateToolCall,
	buildBashBlockMessage,
	containsWorkaroundPattern,
	type SubagentInput,
} from "./guardrail.ts";
import { parseCommands, validateCommands } from "./bash-validator.ts";
import { loadConfig } from "./config.ts";
import { resolveBinaries, createSandboxedBashOps, clearBwrapArgsCache, type SocatBridge } from "./sandbox.ts";

export { buildBwrapArgs, createSandboxedBashOps, resolveBinaries, buildWrappedCommand, clearBwrapArgsCache } from "./sandbox.ts";
export { getDiscoveredFiles, clearDiscoveredCache, discoverPaths, type SandboxConfig } from "./config.ts";

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-sandbox", {
		description: "Disable OS-level sandboxing for bash commands",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);
	let sandboxEnabled = false;
	let currentBridge: SocatBridge | null = null;
	let resolvedBinaries: Map<string, string> | null = null;

	function disableSandbox() {
		sandboxEnabled = false;
		currentBridge?.cleanup();
		currentBridge = null;
	}

	/**
	 * Handle a bash/sandbox-bash tool call through the guardrail tiers:
	 * 1. Deterministic whitelist check (fast path) → hardcoded message
	 * 2. Workaround pattern detection → sub-agent analysis
	 * 3. Defense-in-depth: sandbox.ts also validates at execution time
	 */
	async function handleBashToolCall(
		event: ToolCallEvent,
		ctx: Parameters<typeof pi.on<'tool_call'>>[1],
	): Promise<{ block: true; reason: string } | undefined> {
		const config = loadConfig(ctx.cwd);
		const bashConfig = config.bash;
		const whitelist = bashConfig?.commandWhitelist;

		if (!whitelist || whitelist.length === 0) return undefined;

		const command = (event.input as Record<string, unknown>)?.command as string | undefined;
		if (!command) return undefined;

		// Tier 1: Deterministic whitelist check
		const commands = parseCommands(command);
		const result = validateCommands(
			commands,
			new Set(whitelist),
			new Set(bashConfig?.blockedCommands ?? []),
		);

		if (!result.allowed) {
			const blockedCmd = commands.find((c) => !whitelist.includes(c)) ?? "unknown";
			return {
				block: true,
				reason: buildBashBlockMessage(command, blockedCmd, result.reason ?? "Command blocked", whitelist),
			};
		}

		// Tier 2: Workaround pattern detection → sub-agent
		if (containsWorkaroundPattern(command)) {
			try {
				const { analyzeWithSubagent } = await import("./subagent.ts");
				const input: SubagentInput = { command, whitelist, cwd: ctx.cwd };
				const analysis = await analyzeWithSubagent(input, ctx as any);

				if (analysis && analysis.steeringKey && analysis.confidence >= 0.5) {
					return {
						block: true,
						reason: buildBashBlockMessage(
							command,
							analysis.steeringKey,
							"Workaround detected",
							whitelist,
						),
					};
				}
			} catch {
				// Sub-agent failed (auth, timeout, parse) — allow execution (fail-soft)
			}
		}

		return undefined; // Allow execution
	}

	const sandboxBashTool = {
		...localBash,
		name: "sandbox-bash",
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled) {
				return localBash.execute(id, params, signal, onUpdate);
			}
			const config = loadConfig(localCwd);
			const ops = createSandboxedBashOps(config, resolvedBinaries ?? undefined);
			const tool = createBashTool(localCwd, { operations: ops });
			return tool.execute(id, params, signal, onUpdate);
		},
	};
	pi.registerTool(sandboxBashTool);

	// ── Tool guardrail: block read/write/edit on denied paths
	// ── Bash guardrail: block bash commands via whitelist + sub-agent ───
	pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
		if (!sandboxEnabled) return;

		if (event.toolName === "bash" || event.toolName === "sandbox-bash") {
			return handleBashToolCall(event, ctx);
		}

		const config = loadConfig(ctx.cwd);
		const toolAccess = mergeToolConfigs(config.tools);
		const result = evaluateToolCall(
			event.toolName,
			event.input as Record<string, unknown>,
			toolAccess,
			config.filesystem ?? {},
			ctx.cwd,
		);
		if (result) {
			return { block: true, reason: result.reason };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		disableSandbox();
		if (pi.getFlag("no-sandbox") as boolean) {
			ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
			return;
		}

		const config = loadConfig(ctx.cwd);
		if (!config.enabled) {
			ctx.ui.notify("Sandbox disabled via config", "info");
			return;
		}
		if (process.platform !== "linux") {
			ctx.ui.notify(`Sandbox not supported on ${process.platform}`, "warning");
			return;
		}

		try {
			execSync("bwrap --version", { stdio: "ignore", timeout: 3000 });
			// Verify bwrap can actually create user namespaces and run a trivial command
			execSync("bwrap --ro-bind / / -- true", { stdio: "ignore", timeout: 5000 });
		} catch {
			sandboxEnabled = false;
			ctx.ui.notify(
				"bwrap namespace creation failed. Try:\n" +
					"  sudo sysctl -w kernel.unprivileged_userns_clone=1\n" +
					"  or: sudo setcap cap_sys_admin+ep $(which bwrap)",
				"error",
			);
			return;
		}

		sandboxEnabled = true;

		// Replace built-in "bash" with "sandbox-bash" in active tools.
		// Deduplicate via Set since "sandbox-bash" may already be active
		// from the initial includeAllExtensionTools registration.
		pi.setActiveTools(
			[...new Set(
				pi.getActiveTools().map((t: string) => (t === "bash" ? "sandbox-bash" : t)),
			)],
		);

		const bashConfig = config.bash;
		const whitelist = bashConfig?.commandWhitelist;
		if (whitelist && whitelist.length > 0) {
			const allNames = [...new Set([...whitelist, "bash"])];
			resolvedBinaries = await resolveBinaries(allNames);
		} else {
			resolvedBinaries = null;
		}

		const writeCount = config.filesystem?.allowWrite?.length ?? 0;
		const denyCount = config.filesystem?.denyRead?.length ?? 0;
		const hasNetwork = (config.network?.allowedDomains?.length ?? 0) > 0;
		const netMode = hasNetwork ? "allowed" : "isolated";
		ctx.ui.setStatus(
			"sandbox",
			ctx.ui.theme.fg("accent", `✚ bwrap: ${writeCount} writable, ${denyCount} denied, net=${netMode}`),
		);
		ctx.ui.notify("Sandbox active", "info");
	});

	pi.on("session_shutdown", () => {
		disableSandbox();
		clearBwrapArgsCache();
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration",
		handler: async (_args, ctx) => {
			if (!sandboxEnabled) {
				ctx.ui.notify("Sandbox is disabled", "info");
				return;
			}
			const config = loadConfig(ctx.cwd);
			const toolAccess = mergeToolConfigs(config.tools);
			const guardedTools = Object.entries(toolAccess)
				.filter(([_, cfg]) => cfg.access.length > 0)
				.map(([name, cfg]) => `  ${name}: [${cfg.access.join(", ")}]`);

			const bashConfig = config.bash;
			const whitelist = bashConfig?.commandWhitelist;
			const blocklist = bashConfig?.blockedCommands;
			const gitAllow = bashConfig?.git?.allow;

			const lines = [
				"Sandbox (direct bwrap):",
				"",
				"Network:",
				`  Mode: ${(config.network?.allowedDomains?.length ?? 0) > 0 ? "host (allowedDomains)" : "isolated (--unshare-net)"}`,
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(block all)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(read-only)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				"",
				"Bash Whitelist:",
				`  Mode: ${whitelist && whitelist.length > 0 ? "per-binary" : "full-root"}`,
				`  Allowed commands: ${whitelist?.join(", ") || "(all)"}`,
				`  Blocked commands: ${blocklist?.join(", ") || "(none)"}`,
				`  Git allowed: ${gitAllow?.join(", ") || "(none)"}`,
				"",
				"Tool Guardrail:",
				...(guardedTools.length > 0 ? guardedTools : ["  (no tools configured)"]),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
