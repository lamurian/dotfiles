/**
 * Tests for sandbox.ts — bwrap runtime, binary resolution, command wrapping
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	createSandboxedBashOps,
	buildBwrapArgs,
	buildWrappedCommand,
	clearBwrapArgsCache,
} from "../sandbox.ts";
import type { SandboxConfig } from "../config.ts";
import type { SandboxConfig } from "../config.ts";

/** Minimal config that works for unit testing. */
const MINIMAL_CONFIG: SandboxConfig = {
	enabled: true,
	bash: {
		commandWhitelist: ["echo"],
	},
	filesystem: {},
	network: {},
};

describe("createSandboxedBashOps", () => {
	let hasBwrap = false;

	before(() => {
		try {
			execSync("bwrap --version", { stdio: "ignore", timeout: 3000 });
			hasBwrap = true;
		} catch {
			hasBwrap = false;
		}
	});

	it("returns an object with an exec function", () => {
		const ops = createSandboxedBashOps(MINIMAL_CONFIG);
		assert.equal(typeof ops.exec, "function");
	});

	it("passes env to spawned command", { skip: !hasBwrap }, async () => {
		const ops = createSandboxedBashOps({
			...MINIMAL_CONFIG,
			bash: { commandWhitelist: ["echo"] },
		});
		const chunks: Buffer[] = [];
		const result = await ops.exec("echo $TEST_VAR", process.cwd(), {
			env: { TEST_VAR: "hello", PATH: process.env.PATH ?? "" },
			onData: (chunk) => chunks.push(chunk),
		});
		const output = Buffer.concat(chunks).toString("utf-8").trim();
		assert.equal(result.exitCode, 0);
		assert.equal(output, "hello", "env.TEST_VAR should be visible inside sandbox");
	});

	it("throws improved error with [Sandbox Blocked] prefix for blocked commands", async () => {
		const config: SandboxConfig = {
			bash: { commandWhitelist: ["echo", "ls"] },
		};
		const ops = createSandboxedBashOps(config);
		try {
			await ops.exec("cd /tmp && echo hi", "/tmp", {});
			assert.fail("Expected error was not thrown");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(msg.includes("[Sandbox Blocked]"), `Expected [Sandbox Blocked] prefix in: ${msg}`);
			assert.ok(msg.includes("echo") && msg.includes("ls"), `Expected allowed commands in: ${msg}`);
		}
	});

	it("throws improved error with [Sandbox Blocked] for blocked git subcommand", async () => {
		const config: SandboxConfig = {
			bash: {
				commandWhitelist: ["git", "echo"],
				git: { allow: ["push"], blocked: ["push"] },
			},
		};
		const ops = createSandboxedBashOps(config);
		try {
			await ops.exec("git pull", "/tmp", {});
			assert.fail("Expected error was not thrown");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			assert.ok(msg.includes("[Sandbox Blocked]"), `Expected [Sandbox Blocked] prefix in: ${msg}`);
		}
	});
});

describe("buildBwrapArgs", () => {
	it("returns args with --new-session --die-with-parent", () => {
		const { args } = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		assert.ok(args.includes("--new-session"));
		assert.ok(args.includes("--die-with-parent"));
	});

	it("mounts /bin from /usr/bin on merged-/usr systems in per-binary mode", () => {
		// Only meaningful on systems where /bin is a symlink to /usr/bin
		const realBin = realpathSync("/bin");
		const realUsrBin = realpathSync("/usr/bin");
		if (realBin !== realUsrBin) {
			return; // skip on non-merged systems
		}

		const resolved = new Map([
			["ls", "/usr/bin/ls"],
			["bash", "/usr/bin/bash"],
		]);
		const { args } = buildBwrapArgs("/tmp", MINIMAL_CONFIG, resolved);

		// Should mount /usr/bin at /bin so hardcoded paths like /bin/sh work
		const hasBinMount = args.some(
			(a, i) => a === "--ro-bind" && args[i + 1] === "/usr/bin" && args[i + 2] === "/bin",
		);
		assert.ok(hasBinMount, "should mount /usr/bin at /bin for merged-/usr compatibility");
	});

	it("includes --unshare-pid", () => {
		const { args } = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		assert.ok(args.includes("--unshare-pid"));
	});

	it("mounts root when no resolvedBinaries", () => {
		const { args } = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		const roBindIndex = args.indexOf("--ro-bind");
		assert.ok(roBindIndex >= 0);
		assert.equal(args[roBindIndex + 1], "/");
		assert.equal(args[roBindIndex + 2], "/");
	});

	it("caches and reuses args for same config", () => {
		clearBwrapArgsCache();
		const first = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		const second = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		assert.deepEqual(first.args, second.args);
	});

	it("includes --unshare-net when no domains allowed", () => {
		const { args } = buildBwrapArgs(process.cwd(), MINIMAL_CONFIG);
		assert.ok(args.includes("--unshare-net"));
	});
});

describe("buildWrappedCommand", () => {
	it("prepends bwrap to the command and quotes args with spaces", () => {
		const result = buildWrappedCommand("echo hi", process.cwd(), MINIMAL_CONFIG, null);
		assert.ok(result.startsWith("bwrap "), `expected bwrap prefix, got: ${result}`);
		// The command arg "echo hi" is quoted because it contains a space
		assert.ok(result.includes("-- bash -c"), `expected -- bash -c, got: ${result}`);
		// The last single-quoted segment should be the original command
		const quoted = result.match(/'[^']+'/g);
		const lastQuote = quoted ? quoted[quoted.length - 1] : null;
		assert.equal(lastQuote, "'echo hi'");
	});
});

describe("buildBwrapArgs — symlinked mount destinations (stow layout)", () => {
	let realRoot: string;
	let realDir: string;
	let realFile: string;
	let linkDir: string;
	let linkFile: string;

	before(() => {
		const root = mkdtempSync(join(tmpdir(), "pi-sandbox-symlink-"));
		realRoot = realpathSync(root);
		realDir = join(realRoot, "real-dir");
		mkdirSync(realDir, { recursive: true });
		realFile = join(realDir, "file.txt");
		writeFileSync(realFile, "x");
		linkDir = join(realRoot, "link-dir");
		symlinkSync(realDir, linkDir, "dir");
		linkFile = join(realRoot, "link-file.txt");
		symlinkSync(realFile, linkFile, "file");
	});

	after(() => {
		rmSync(realRoot, { recursive: true, force: true });
	});

	it("canonicalizes allowWrite/allowRead symlink destinations", () => {
		clearBwrapArgsCache();
		const config: SandboxConfig = {
			filesystem: { allowWrite: [linkDir], allowRead: [linkFile] },
		};
		const { args } = buildBwrapArgs(realRoot, config);
		const joined = args.join(" ");

		assert.ok(!joined.includes(linkDir), `allowWrite destination must be canonicalized. args: ${joined}`);
		assert.ok(!joined.includes(linkFile), `allowRead destination must be canonicalized. args: ${joined}`);
		assert.ok(joined.includes(`--bind ${realDir} ${realDir}`), `expected --bind on real dir. args: ${joined}`);
		assert.ok(joined.includes(`--ro-bind ${realFile} ${realFile}`), `expected --ro-bind on real file. args: ${joined}`);
	});

	it("canonicalizes denyWrite file symlink destination (mounts /dev/null on real file)", () => {
		clearBwrapArgsCache();
		const config: SandboxConfig = { filesystem: { denyWrite: [linkFile] } };
		const { args } = buildBwrapArgs(realRoot, config);
		const joined = args.join(" ");

		assert.ok(!joined.includes(linkFile), `denyWrite must not target the symlink path. args: ${joined}`);
		assert.ok(joined.includes(`--ro-bind /dev/null ${realFile}`), `expected /dev/null bind on real file. args: ${joined}`);
	});

	it("canonicalizes denyRead directory symlink destination (tmpfs on real dir)", () => {
		clearBwrapArgsCache();
		const config: SandboxConfig = { filesystem: { denyRead: [linkDir] } };
		const { args } = buildBwrapArgs(realRoot, config);
		const joined = args.join(" ");

		assert.ok(!joined.includes(linkDir), `denyRead must not target the symlink path. args: ${joined}`);
		assert.ok(joined.includes(`--tmpfs ${realDir}`), `expected tmpfs on real dir. args: ${joined}`);
	});

	it("leaves non-symlink destinations unchanged", () => {
		clearBwrapArgsCache();
		const plainDir = join(realRoot, "plain-dir");
		mkdirSync(plainDir, { recursive: true });
		const plainFile = join(plainDir, "plain.txt");
		writeFileSync(plainFile, "y");
		const config: SandboxConfig = {
			filesystem: { allowWrite: [plainDir], denyWrite: [plainFile] },
		};
		const { args } = buildBwrapArgs(realRoot, config);
		const joined = args.join(" ");

		assert.ok(joined.includes(`--bind ${plainDir} ${plainDir}`), `expected --bind on plain dir. args: ${joined}`);
		assert.ok(joined.includes(`--ro-bind /dev/null ${plainFile}`), `expected /dev/null bind on plain file. args: ${joined}`);
	});
});
