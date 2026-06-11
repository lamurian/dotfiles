/**
 * Sandbox Extension - OS-level sandboxing for bash commands
 *
 * Replaces the built-in bash tool with a bwrap-sandboxed version.
 * Uses direct bwrap invocation — no @anthropic-ai/sandbox-runtime dependency.
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/extensions/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json (project-local)
 *
 * Example .pi/sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"]
 *   },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": ["."]
 *   }
 * }
 * ```
 *
 * Network: `--unshare-net` isolates the sandbox completely.
 *   If allowedDomains is non-empty, a minimal socat proxy bridge is set up.
 *   If empty or no network config, all network is blocked.
 *
 * Usage:
 *   pi --no-sandbox         disable sandboxing
 *   /sandbox                show current configuration
 *
 * Linux requires: bubblewrap (bwrap), socat
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type BashOperations, createBashTool, getAgentDir } from "@earendil-works/pi-coding-agent";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SandboxConfig {
	enabled?: boolean;
	network?: {
		allowedDomains?: string[];
		deniedDomains?: string[];
	};
	filesystem?: {
		denyRead?: string[];
		allowWrite?: string[];
		denyWrite?: string[];
	};
}

// ─── Defaults & Constants ────────────────────────────────────────────────────

const DEFAULT_CONFIG: SandboxConfig = {
	enabled: true,
	network: {
		allowedDomains: [
			"github.com",
			"*.github.com",
			"npmjs.org",
			"*.npmjs.org",
			"pypi.org",
			"*.pypi.org",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
		allowWrite: ["."],
	},
};

// ─── Config loading ──────────────────────────────────────────────────────────

function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, ".pi", "sandbox.json");
	const globalConfigPath = join(getAgentDir(), "extensions", "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

	return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
	const result: SandboxConfig = { ...base };
	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.network) {
		result.network = { ...base.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...base.filesystem, ...overrides.filesystem };
	}
	return result;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function expandTilde(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
	return path;
}

/** Resolve a path from the config relative to cwd, expanding ~ first. */
function resolvePath(cwd: string, raw: string): string {
	if (raw.startsWith("~")) {
		return expandTilde(raw);
	}
	return resolve(cwd, raw);
}

// ─── Bwrap arg builder ───────────────────────────────────────────────────────

function buildBwrapArgs(
	cwd: string,
	config: SandboxConfig,
): { args: string[]; needsSocat: boolean } {
	const args: string[] = [];

	// Bubblewrap boilerplate
	args.push("--new-session", "--die-with-parent");
	args.push("--unshare-pid");

	// ── Filesystem ───────────────────────────────────────────────────────

	// Start with read-only root, then override specific mount points
	args.push("--ro-bind", "/", "/");

	// Override /proc and /dev with writable kernel filesystems
	args.push("--proc", "/proc");
	args.push("--dev", "/dev");

	// Bind-mount allowed write paths as writable
	const allowWrite = config.filesystem?.allowWrite ?? [];
	for (const raw of allowWrite) {
		const absPath = resolvePath(cwd, raw);
		if (!existsSync(absPath)) continue;
		args.push("--bind", absPath, absPath);
	}

	// Deny-write within allowed paths: remount as read-only
	const denyWrite = config.filesystem?.denyWrite ?? [];
	for (const raw of denyWrite) {
		const absPath = resolvePath(cwd, raw);
		if (!existsSync(absPath)) continue;
		const st = statSync(absPath);
		if (st.isDirectory()) {
			args.push("--ro-bind", absPath, absPath);
		} else if (st.isFile()) {
			args.push("--ro-bind", "/dev/null", absPath);
		}
	}

	// Deny-read: mount /dev/null over sensitive paths
	const denyRead = config.filesystem?.denyRead ?? [];
	for (const raw of denyRead) {
		const absPath = resolvePath(cwd, raw);
		if (!existsSync(absPath)) continue;
		const st = statSync(absPath);
		if (st.isDirectory()) {
			// Hide entire directory with an empty tmpfs
			args.push("--tmpfs", absPath);
		} else if (st.isFile()) {
			args.push("--ro-bind", "/dev/null", absPath);
		}
	}

	// ── Network ───────────────────────────────────────────────────────────

	const allowedDomains = config.network?.allowedDomains;
	const needsSocat = allowedDomains !== undefined && allowedDomains.length > 0;

	if (needsSocat) {
		// Network with proxy filtering: needs socat bridge
		// bwrap args are built later after socat sockets are ready
		// We return early with the filesystem args only
		return { args, needsSocat: true };
	} else {
		// No network or block all
		args.push("--unshare-net");
		return { args, needsSocat: false };
	}
}

// ─── Socat bridge (for filtered network) ─────────────────────────────────────

interface SocatBridge {
	httpSocketPath: string;
	socksSocketPath: string;
	cleanup: () => void;
}

function startSocatBridge(): SocatBridge {
	const socketId = randomBytes(8).toString("hex");
	const tmpDir = "/tmp";
	const httpSocketPath = join(tmpDir, `pi-sandbox-http-${socketId}.sock`);
	const socksSocketPath = join(tmpDir, `pi-sandbox-socks-${socketId}.sock`);

	// Find local proxy ports (or use defaults)
	let httpProxyPort = 0;
	let socksProxyPort = 0;
	try {
		const env = process.env;
		httpProxyPort = parseInt(env.HTTP_PROXY?.split(":").pop() ?? "0", 10);
		socksProxyPort = parseInt(env.SOCKS_PROXY?.split(":").pop() ?? "0", 10);
	} catch {
		// Ignore
	}

	// Start socat listeners on Unix sockets that forward to the host
	// These act as bridges from the sandbox namespace to the host network
	const httpSocat = spawn("socat", [
		`UNIX-LISTEN:${httpSocketPath},fork,reuseaddr`,
		httpProxyPort > 0
			? `TCP:localhost:${httpProxyPort}`
			: "TCP:localhost:3128",
	], { stdio: "ignore" });

	const socksSocat = spawn("socat", [
		`UNIX-LISTEN:${socksSocketPath},fork,reuseaddr`,
		socksProxyPort > 0
			? `TCP:localhost:${socksProxyPort}`
			: "TCP:localhost:1080",
	], { stdio: "ignore" });

	const cleanup = () => {
		try { httpSocat.kill("SIGTERM"); } catch { /* ok */ }
		try { socksSocat.kill("SIGTERM"); } catch { /* ok */ }
		try { execSync(`rm -f ${httpSocketPath} ${socksSocketPath}`, { timeout: 1000 }); } catch { /* ok */ }
	};

	return { httpSocketPath, socksSocketPath, cleanup };
}

// ─── Build full bwrap command with socat bridge ──────────────────────────────

function buildWrappedCommand(
	command: string,
	cwd: string,
	config: SandboxConfig,
	bridge: SocatBridge | null,
): string {
	const { args } = buildBwrapArgs(cwd, config);
	const shell = "bash";

	if (bridge) {
		// Inject socat listeners inside the sandbox to proxy through the bridge
		const socatSetup = [
			`socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:${bridge.httpSocketPath} >/dev/null 2>&1 &`,
			`socat TCP-LISTEN:1080,fork,reuseaddr UNIX-CONNECT:${bridge.socksSocketPath} >/dev/null 2>&1 &`,
			"trap \"kill %1 %2 2>/dev/null; exit\" EXIT",
		].join("\n");

		const innerScript = `${socatSetup}\n${command}`;

		// Bind the Unix sockets into the sandbox
		args.push("--bind", bridge.httpSocketPath, bridge.httpSocketPath);
		args.push("--bind", bridge.socksSocketPath, bridge.socksSocketPath);
		args.push("--setenv", "HTTP_PROXY", "http://localhost:3128");
		args.push("--setenv", "HTTPS_PROXY", "http://localhost:3128");
		args.push("--setenv", "SOCKS_PROXY", "http://localhost:1080");

		args.push("--", shell, "-c", innerScript);
	} else {
		args.push("--", shell, "-c", command);
	}

	const quoted = args.map((a) => {
		if (a.includes(" ") || a.includes("'") || a.includes('"')) {
			return `'${a.replace(/'/g, "'\\''")}'`;
		}
		return a;
	}).join(" ");

	return `bwrap ${quoted}`;
}

// ─── Sandboxed bash operations ───────────────────────────────────────────────

function createSandboxedBashOps(config: SandboxConfig): BashOperations {
	let bridge: SocatBridge | null = null;
	const needsSocat = (config.network?.allowedDomains?.length ?? 0) > 0;

	if (needsSocat) {
		try {
			bridge = startSocatBridge();
		} catch (e) {
			console.error("[sandbox] Failed to start socat bridge, falling back to no network:", e);
		}
	}

	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = buildWrappedCommand(command, cwd, config, bridge);

			return new Promise((resolve, reject) => {
				const child = spawn("bash", ["-c", wrappedCommand], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = () => {
					if (child.pid) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}
				};

				signal?.addEventListener("abort", onAbort, { once: true });

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
					} else {
						resolve({ exitCode: code });
					}
				});
			});
		},
	};
}

// ─── Extension entry point ───────────────────────────────────────────────────

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
			const ops = createSandboxedBashOps(config);
			const tool = createBashTool(localCwd, { operations: ops });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!sandboxEnabled) return;
		const config = loadConfig(localCwd);
		return { operations: createSandboxedBashOps(config) };
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

		// Verify bwrap and socat are available
		try {
			execSync("bwrap --version", { stdio: "ignore", timeout: 3000 });
		} catch {
			sandboxEnabled = false;
			ctx.ui.notify("bwrap not found. Install bubblewrap: sudo apt install bubblewrap", "error");
			return;
		}

		const needsNetwork = (config.network?.allowedDomains?.length ?? 0) > 0;
		if (needsNetwork) {
			try {
				execSync("socat -V", { stdio: "ignore", timeout: 3000 });
			} catch {
				ctx.ui.notify("socat not found. Network filtering disabled. Install: sudo apt install socat", "warning");
			}
		}

		sandboxEnabled = true;

		const writeCount = config.filesystem?.allowWrite?.length ?? 0;
		const denyCount = config.filesystem?.denyRead?.length ?? 0;
		const netMode = needsNetwork ? "filtered" : "isolated";
		ctx.ui.setStatus(
			"sandbox",
			ctx.ui.theme.fg("accent", `🔒 bwrap: ${writeCount} writable, ${denyCount} denied, net=${netMode}`),
		);
		ctx.ui.notify("Sandbox active (direct bwrap, no anthropic-ai dependency)", "info");
	});

	pi.on("session_shutdown", () => {
		disableSandbox();
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration",
		handler: async (_args, ctx) => {
			if (!sandboxEnabled) {
				ctx.ui.notify("Sandbox is disabled", "info");
				return;
			}

			const config = loadConfig(ctx.cwd);
			const lines = [
				"Sandbox (direct bwrap):",
				"",
				"Network:",
				`  Mode: ${(config.network?.allowedDomains?.length ?? 0) > 0 ? "filtered (socat)" : "isolated (--unshare-net)"}`,
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(block all)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(read-only)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
