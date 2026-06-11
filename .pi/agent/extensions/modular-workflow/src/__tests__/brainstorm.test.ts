import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
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
// runBrainstorming
// ═══════════════════════════════════════════════════════════════════════════════

describe("runBrainstorming", () => {
  it("sends a user message with deliverAs 'steer' in requirements phase", async () => {
    // Set up mocks BEFORE importing the module under test
    mock.module("../architecture.ts", {
      namedExports: {
        ensureArchitectureMd: async () => {},
        addAdrToArchitecture: async () => {},
      },
    });

    mock.module("../detect-hooks.ts", {
      namedExports: {
        detectExistingHooks: async () => ({}),
      },
    });

    mock.module("../cross-ref.ts", {
      namedExports: {
        resolveCrossReferences: async () => ({ content: "", chain: [], errors: [] }),
      },
    });

    // Dynamic import after mocks are registered
    const { runBrainstorming } = await import("../brainstorm.ts");

    const pi = mockPi();
    const ctx = mockCtx("/tmp/test");

    await runBrainstorming("build a new API", pi, ctx);

    const sendCalls = pi.calls["sendUserMessage"] ?? [];
    assert.ok(sendCalls.length >= 1, "sendUserMessage should be called");

    const lastCall = sendCalls[sendCalls.length - 1] as [string, { deliverAs: string }];
    const opts = lastCall[1];
    assert.equal(opts.deliverAs, "steer");
  });
});
