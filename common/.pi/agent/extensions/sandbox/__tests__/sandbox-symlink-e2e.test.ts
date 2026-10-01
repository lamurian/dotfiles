/**
 * E2E tests — bwrap with symlinked mount destinations (stow layout)
 *
 * Reproduces the real-world failure: sandbox.json denies writes to a path
 * that is a symlink (stow-managed ~/.pi). bwrap refuses to mount onto a
 * symlink destination, aborting every sandboxed command. These tests assert
 * that commands run successfully and that deny-write still holds at the OS
 * level via both the symlink spelling and the canonical real path.
 *
 * Skipped when bwrap is not available (same pattern as sandbox.test.ts).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSandboxedBashOps, clearBwrapArgsCache } from "../sandbox.ts";
import type { SandboxConfig } from "../config.ts";

/** Config: allow writes in the temp root, deny writes to the symlinked config path. */
function e2eConfig(realRoot: string, linkFile: string): SandboxConfig {
	return {
		enabled: true,
		filesystem: { allowWrite: [realRoot], denyWrite: [linkFile] },
	};
}

describe("stow symlink e2e — bwrap mount on symlinked denyWrite path", () => {
	let hasBwrap = false;
	let realRoot: string;
	let realFile: string;
	let linkFile: string;

	before(() => {
		try {
			execSync("bwrap --version", { stdio: "ignore", timeout: 3000 });
			hasBwrap = true;
		} catch {
			hasBwrap = false;
		}
		const root = mkdtempSync(join(tmpdir(), "pi-sandbox-e2e-"));
		realRoot = realpathSync(root);
		realFile = join(realRoot, "sandbox.json");
		writeFileSync(realFile, "{}");
		linkFile = join(realRoot, "link-sandbox.json");
		symlinkSync(realFile, linkFile, "file");
	});

	after(() => {
		rmSync(realRoot, { recursive: true, force: true });
	});

	it("runs commands successfully when denyWrite targets a symlinked path", { skip: !hasBwrap }, async () => {
		clearBwrapArgsCache();
		const ops = createSandboxedBashOps(e2eConfig(realRoot, linkFile));
		const chunks: Buffer[] = [];
		const result = await ops.exec("echo ok", realRoot, {
			timeout: 20000,
			onData: (chunk) => chunks.push(chunk),
		});
		const output = Buffer.concat(chunks).toString("utf-8").trim();
		assert.equal(result.exitCode, 0, `sandboxed command must succeed. output: ${output}`);
		assert.ok(!output.includes("Can't mount on symlink destination"), output);
	});

	it("denies writes via the symlink spelling at OS level", { skip: !hasBwrap }, async () => {
		clearBwrapArgsCache();
		const ops = createSandboxedBashOps(e2eConfig(realRoot, linkFile));
		const result = await ops.exec(`echo x > ${linkFile}`, realRoot, { timeout: 20000 });
		assert.notEqual(result.exitCode, 0, "write through the symlink path must fail inside the sandbox");
	});

	it("denies writes via the canonical real path at OS level", { skip: !hasBwrap }, async () => {
		clearBwrapArgsCache();
		const ops = createSandboxedBashOps(e2eConfig(realRoot, linkFile));
		const result = await ops.exec(`echo x > ${realFile}`, realRoot, { timeout: 20000 });
		assert.notEqual(result.exitCode, 0, "write through the canonical path must fail inside the sandbox");
	});
});
