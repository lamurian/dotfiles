/**
 * Tests for sandbox.ts — bwrap runtime, binary resolution, command wrapping
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
	createSandboxedBashOps,
	buildBwrapArgs,
	buildWrappedCommand,
	clearBwrapArgsCache,
} from "../sandbox.ts";
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
