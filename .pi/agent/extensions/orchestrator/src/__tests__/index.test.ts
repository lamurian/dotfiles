/**
 * Tests for the orchestrator extension entry point.
 *
 * Verifies that commands and tools are registered correctly.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// We can't easily import and call the default factory without typebox
// being fully resolved. Instead, test the module's structural contracts.

describe("orchestrator extension", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    assert.equal(typeof mod.default, "function", "default export should be a function");
  });

  it("registers command and tools when invoked", async () => {
    const registeredCommands: string[] = [];
    const registeredTools: string[] = [];

    const mockPi = {
      registerCommand: (name: string, _opts: unknown) => {
        registeredCommands.push(name);
      },
      registerTool: (def: { name: string; label?: string }) => {
        registeredTools.push(def.name);
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    const mod = await import("../index.ts");
    mod.default(mockPi);

    assert.ok(registeredCommands.includes("orchestrate"), "should register /orchestrate command");
    assert.ok(registeredTools.includes("implement_plan"), "should register implement_plan tool");
    // commit_amend is registered by the commit extension, not the orchestrator
  });
});
