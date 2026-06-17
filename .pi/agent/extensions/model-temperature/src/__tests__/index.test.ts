import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createExtension } from "../extension.ts";

// ── Mock factories ───────────────────────────────────────────────────────────

interface HandlerEntry {
  handler: (event: unknown, ctx: unknown) => unknown;
}

function mockPi(): {
  handlers: Map<string, HandlerEntry>;
  on: (event: string, handler: HandlerEntry["handler"]) => void;
} {
  const handlers = new Map<string, HandlerEntry>();
  return {
    handlers,
    on: (event: string, handler: HandlerEntry["handler"]) => {
      handlers.set(event, { handler });
    },
  };
}

function mockCtx(modelId?: string) {
  return {
    model: modelId ? { id: modelId } : undefined,
  };
}

// ── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;

function setupWithConfig(config: object) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = join(tmpdir(), `pi-temp-test-${id}`);
  mkdirSync(join(tmpDir, ".pi"), { recursive: true });
  writeFileSync(join(tmpDir, "temperature.json"), JSON.stringify(config));
  return { agentDir: tmpDir, cwd: tmpDir };
}

function teardown() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("model-temperature extension", () => {
  afterEach(teardown);

  it("injects default temperature 0.1 into provider payload when no config exists", () => {
    const { agentDir, cwd } = setupWithConfig({});
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    assert.ok(entry, "before_provider_request handler should be registered");

    const originalPayload = { model: "test", messages: [] };
    const ctx = mockCtx("opencode-go/gpt-5.1");

    const result = entry.handler(
      { type: "before_provider_request", payload: originalPayload },
      ctx,
    );

    assert.ok(typeof result === "object" && result !== null);
    assert.equal((result as Record<string, unknown>).temperature, 0.1);
    assert.equal((result as Record<string, unknown>).model, "test");
  });

  it("uses temperature from config file when available", () => {
    const { agentDir, cwd } = setupWithConfig({ default: 0.7 });
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    const ctx = mockCtx("unknown/model");

    const result = entry!.handler(
      { type: "before_provider_request", payload: {} },
      ctx,
    );

    assert.equal((result as Record<string, unknown>).temperature, 0.7);
  });

  it("uses model-specific temperature when model ID matches config", () => {
    const { agentDir, cwd } = setupWithConfig({
      default: 0.1,
      models: { "opencode-go/deepseek4-flash": 0.9 },
    });
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    const ctx = mockCtx("opencode-go/deepseek4-flash");

    const result = entry!.handler(
      { type: "before_provider_request", payload: {} },
      ctx,
    );

    assert.equal((result as Record<string, unknown>).temperature, 0.9);
  });

  it("uses provider-level temperature when provider matches but model does not", () => {
    const { agentDir, cwd } = setupWithConfig({
      default: 0.1,
      providers: { "opencode-go": 0.5 },
    });
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    const ctx = mockCtx("opencode-go/some-unknown");

    const result = entry!.handler(
      { type: "before_provider_request", payload: {} },
      ctx,
    );

    assert.equal((result as Record<string, unknown>).temperature, 0.5);
  });

  it("falls back to default when ctx.model is undefined", () => {
    const { agentDir, cwd } = setupWithConfig({ default: 0.3 });
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    const ctx = mockCtx(); // no modelId

    const result = entry!.handler(
      { type: "before_provider_request", payload: {} },
      ctx,
    );

    assert.equal((result as Record<string, unknown>).temperature, 0.3);
  });

  it("preserves existing payload fields when injecting temperature", () => {
    const { agentDir, cwd } = setupWithConfig({});
    const factory = createExtension(agentDir, cwd);
    const pi = mockPi();
    factory(pi as any);

    const entry = pi.handlers.get("before_provider_request");
    const ctx = mockCtx("test/model");

    const original = { model: "gpt-5.1", messages: [{ role: "user" }], max_tokens: 4096 };
    const result = entry!.handler(
      { type: "before_provider_request", payload: original },
      ctx,
    );

    assert.equal((result as Record<string, unknown>).temperature, 0.1);
    assert.equal((result as Record<string, unknown>).model, "gpt-5.1");
    assert.equal((result as Record<string, unknown>).max_tokens, 4096);
    assert.ok(Array.isArray((result as Record<string, unknown>).messages));
  });
});
