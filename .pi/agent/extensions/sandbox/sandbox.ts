/**
 * sandbox.ts — Bwrap runtime: binary resolution, arg building, command wrapping
 */

import { execSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import {
	getAgentDir,
	createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";
import {
	parseCommands,
	validateCommands,
	validateGitSubcommand,
	stripFindDelete,
} from "./bash-validator.ts";
import {
	getDiscoveredFiles,
	discoverPaths,
	resolveDenyPath,
	resolvePath,
	type SandboxConfig,
} from "./config.ts";

// ─── Binary path resolution ──────────────────────────────────────────────────

export async function resolveBinaries(names: string[]): Promise<Map<string, string>> {
	if (names.length === 0) return new Map();

	const result = new Map<string, string>();
	try {
		const output = execSync(
			`bash -c "type ${names.map(n => n.includes("'") ? `"${n}"` : `'${n}'`).join(" ")}" 2>/dev/null; true`,
			{ timeout: 5000, encoding: "utf-8" },
		);
		for (const line of output.trim().split("\n")) {
			const match = line.match(/^(.+?)\s+is\s+(\/.+)$/);
			if (match) {
				result.set(match[1], match[2]);
			}
		}
	} catch {
		// Failed — return whatever we have
	}
	return result;
}

// ─── Bwrap arg builder ───────────────────────────────────────────────────────

let bwrapArgsCache: { key: string; args: string[] } | null = null;

export function clearBwrapArgsCache(): void {
	bwrapArgsCache = null;
}

export function buildBwrapArgs(
	cwd: string,
	config: SandboxConfig,
	resolvedBinaries?: Map<string, string>,
): { args: string[]; needsSocat: boolean } {
	// Compute cache key from config file mtimes
	const globalPath = join(getAgentDir(), "extensions", "sandbox.json");
	const projectPath = join(cwd, ".pi", "sandbox.json");

	const globalMtime = statSync(globalPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
	const projectMtime = statSync(projectPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
	const configHash = JSON.stringify(config);
	const key = `${globalMtime}:${projectMtime}:${cwd}:${configHash}`;

	if (bwrapArgsCache?.key === key) {
		return { args: [...bwrapArgsCache.args], needsSocat: false };
	}

	const args: string[] = [];

	args.push("--new-session", "--die-with-parent");
	args.push("--unshare-pid");

	// ── Filesystem ───────────────────────────────────────────────────────

	const hasBinaryMode = resolvedBinaries !== undefined && resolvedBinaries.size > 0;

	if (hasBinaryMode) {
		for (const [, absPath] of resolvedBinaries) {
			args.push("--ro-bind", absPath, absPath);
		}
		for (const libDir of ["/usr/lib", "/lib", "/lib64", "/usr/lib64", "/usr/share"]) {
			if (existsSync(libDir)) {
				args.push("--ro-bind", libDir, libDir);
			}
		}

		// On merged-/usr systems (where /bin -> /usr/bin), mount /usr/bin at /bin
		// so hardcoded paths like /bin/sh (used by Node.js execSync) resolve correctly.
		try {
			if (realpathSync("/bin") !== "/bin" && realpathSync("/bin") === realpathSync("/usr/bin")) {
				args.push("--ro-bind", "/usr/bin", "/bin");
			}
		} catch {
			// If realpath fails, skip the mount
		}
	} else {
		args.push("--ro-bind", "/", "/");
	}

	args.push("--proc", "/proc");
	args.push("--dev", "/dev");

	const allowWrite = config.filesystem?.allowWrite ?? [];
	for (const raw of allowWrite) {
		const absPath = resolvePath(cwd, raw);
		if (!existsSync(absPath)) continue;
		args.push("--bind", absPath, absPath);
	}

	const allowRead = config.filesystem?.allowRead ?? [];
	for (const raw of allowRead) {
		const absPath = resolvePath(cwd, raw);
		if (!existsSync(absPath)) continue;
		const st = statSync(absPath);
		if (st.isDirectory()) {
			args.push("--ro-bind", absPath, absPath);
		} else if (st.isFile()) {
			args.push("--ro-bind", absPath, absPath);
		}
	}

	const denyWrite = config.filesystem?.denyWrite ?? [];
	for (const raw of denyWrite) {
		// Handle **/name pattern — discover all matching dirs under writable paths
		if (raw.startsWith("**/")) {
			const name = raw.slice(3);
			if (!name.includes("*") && !name.includes("?") && !name.includes("/")) {
				const discovered = discoverPaths(cwd, config, name, "d");
				for (const dirPath of discovered) {
					args.push("--ro-bind", dirPath, dirPath);
				}
				continue;
			}
		}

		// Single explicit path
		const absPath = resolveDenyPath(cwd, raw);
		if (!absPath) continue;
		const st = statSync(absPath);
		if (st.isDirectory()) {
			args.push("--ro-bind", absPath, absPath);
		} else if (st.isFile()) {
			args.push("--ro-bind", "/dev/null", absPath);
		}
	}

	const denyRead = config.filesystem?.denyRead ?? [];
	for (const raw of denyRead) {
		if (raw.startsWith("**/")) {
			const suffix = raw.slice(3);
			if (!suffix.includes("*") && !suffix.includes("?") && !suffix.includes("/")) {
				const discovered = getDiscoveredFiles(cwd, config);
				for (const filePath of discovered) {
					if (filePath.endsWith("/" + suffix) || filePath === suffix) {
						args.push("--ro-bind", "/dev/null", filePath);
					}
				}
				continue;
			}
		}
		const absPath = resolveDenyPath(cwd, raw);
		if (!absPath) continue;
		const st = statSync(absPath);
		if (st.isDirectory()) {
			args.push("--tmpfs", absPath);
		} else if (st.isFile()) {
			args.push("--ro-bind", "/dev/null", absPath);
		}
	}

	// ── Network ───────────────────────────────────────────────────────────

	const allowedDomains = config.network?.allowedDomains;
	const hasAllowed = allowedDomains !== undefined && allowedDomains.length > 0;
	if (!hasAllowed) {
		args.push("--unshare-net");
	}
	// Store in cache
	bwrapArgsCache = { key, args };
	return { args, needsSocat: false };
}

// ─── Socat bridge type (used by buildWrappedCommand) ─────────────────────────

export interface SocatBridge {
	httpSocketPath: string;
	socksSocketPath: string;
	cleanup: () => void;
}

// ─── Build full bwrap command ────────────────────────────────────────────────

export function buildWrappedCommand(
	command: string,
	cwd: string,
	config: SandboxConfig,
	bridge: SocatBridge | null,
	resolvedBinaries?: Map<string, string>,
): string {
	clearBwrapArgsCache();
	const { args } = buildBwrapArgs(cwd, config, resolvedBinaries);
	const shell = "bash";

	if (bridge) {
		const socatSetup = [
			`socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:${bridge.httpSocketPath} >/dev/null 2>&1 &`,
			`socat TCP-LISTEN:1080,fork,reuseaddr UNIX-CONNECT:${bridge.socksSocketPath} >/dev/null 2>&1 &`,
			'trap "kill %1 %2 2>/dev/null; exit" EXIT',
		].join("\n");

		const innerScript = `${socatSetup}\n${command}`;
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

export function createSandboxedBashOps(
	config: SandboxConfig,
	resolvedBinaries?: Map<string, string>,
): BashOperations {
	const bridge: SocatBridge | null = null;
	const localOps = createLocalBashOperations();

	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			let validatedCommand = command;
			const bashConfig = config.bash;
			const whitelist = bashConfig?.commandWhitelist;
			const blocklist = bashConfig?.blockedCommands;

			if (whitelist && whitelist.length > 0) {
				const commands = parseCommands(validatedCommand);
				const result = validateCommands(
					commands,
					new Set(whitelist),
					new Set(blocklist ?? []),
				);
				if (!result.allowed) {
					throw new Error(result.reason ?? "Command blocked");
				}

				if (bashConfig?.git && commands.includes("git")) {
					const gitMatch = validatedCommand.match(/\bgit\s+([a-zA-Z][a-zA-Z0-9_-]+)/);
					if (gitMatch) {
						const subcommand = gitMatch[1];
						const afterSub = validatedCommand.slice(
							validatedCommand.indexOf(gitMatch[0]) + gitMatch[0].length,
						).trim();
						const args = afterSub ? afterSub.split(/\s+/) : [];
						const gitResult = validateGitSubcommand(subcommand, args, bashConfig.git);
						if (!gitResult.allowed) {
							throw new Error(gitResult.reason ?? "Git subcommand blocked");
						}
					}
				}
			}

			if (validatedCommand.trim().toLowerCase().startsWith("find")) {
				const stripped = stripFindDelete(validatedCommand);
				validatedCommand = stripped.command;
			}

			const wrappedCommand = buildWrappedCommand(validatedCommand, cwd, config, bridge, resolvedBinaries);

			return localOps.exec(wrappedCommand, cwd, { onData, signal, timeout, env });
		},
	};
}

