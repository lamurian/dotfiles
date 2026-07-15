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
import { mergeToolConfigs, evaluateToolCall } from "./guardrail.ts";
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

	pi.registerTool({
		...localBash,
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
	});

	// ── Tool guardrail: block read/write/edit on denied paths ────────────
	pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
		if (!sandboxEnabled) return;
		if (event.toolName === "bash") return;

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
		} catch {
			sandboxEnabled = false;
			ctx.ui.notify("bwrap not found. Install bubblewrap: sudo apt install bubblewrap", "error");
			return;
		}

		sandboxEnabled = true;

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
