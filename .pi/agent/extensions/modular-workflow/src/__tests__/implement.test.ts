import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { startTdd } from "../implement.ts";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ── Mock factories ───────────────────────────────────────────────────────────

function mockPi(): ExtensionAPI & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => {
    calls[name] = [];
    return (...args: unknown[]) => {
      calls[name]!.push(args);
    };
  };

  return {
    on: record("on") as ExtensionAPI["on"],
    registerCommand: record("registerCommand") as ExtensionAPI["registerCommand"],
    appendEntry: record("appendEntry") as ExtensionAPI["appendEntry"],
    sendUserMessage: record("sendUserMessage") as ExtensionAPI["sendUserMessage"],
    exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    calls,
  } as unknown as ExtensionAPI & { calls: typeof calls };
}

function mockCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    sessionManager: {
      getBranch: () => [],
    },
    ui: {
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      theme: { fg: () => "" },
      addAutocompleteProvider: () => {},
    },
  } as unknown as ExtensionContext;
}

// ═══════════════════════════════════════════════════════════════════════════════
// startTdd
// ═══════════════════════════════════════════════════════════════════════════════

describe("startTdd", () => {
  it("sends a user message with deliverAs 'steer'", async () => {
    const pi = mockPi();
    const ctx = mockCtx("/tmp/test");

    await startTdd("implement a login button", pi, ctx);

    const sendCalls = pi.calls["sendUserMessage"] ?? [];
    assert.ok(sendCalls.length >= 1, "sendUserMessage should be called");

    const lastCall = sendCalls[sendCalls.length - 1] as [string, { deliverAs: string }];
    const opts = lastCall[1];
    assert.equal(opts.deliverAs, "steer");
  });
});
