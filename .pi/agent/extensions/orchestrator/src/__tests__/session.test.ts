/**
 * Tests for session utility functions.
 *
 * These tests cover the log forwarding infrastructure:
 * - Assistant message truncation for widget display
 * - JSON event parsing with callback wiring
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncateForLog, handleJsonEvent } from "../session.ts";
import type { SpawnOptions } from "../session.ts";

// ─── truncateForLog ──────────────────────────────────────────────

describe("truncateForLog", () => {
  it("returns short text unchanged", () => {
    assert.equal(truncateForLog("Hello world"), "Hello world");
  });

  it("truncates at 120 chars by default", () => {
    const long = "a".repeat(200);
    const result = truncateForLog(long);
    assert.equal(result.length, 123); // 120 + "..."
    assert.ok(result.endsWith("..."));
    assert.equal(result.slice(0, 120), "a".repeat(120));
  });

  it("truncates at custom maxLen", () => {
    // "Implementing authent..." = 20 chars + "..." = 23 chars
    const long = "Implementing authentication flow with JWT tokens";
    const result = truncateForLog(long, 20);
    assert.equal(result, "Implementing authent...");
    assert.equal(result.length, 20 + 3); // maxLen + "..."
  });

  it("handles empty string", () => {
    assert.equal(truncateForLog(""), "");
  });

  it("handles exactly maxLen characters", () => {
    const text = "a".repeat(120);
    assert.equal(truncateForLog(text), text);
  });

  it("handles exactly maxLen + 1 characters", () => {
    const text = "a".repeat(121);
    const result = truncateForLog(text);
    assert.equal(result.length, 123); // 120 + "..."
  });
});

// ─── handleJsonEvent ─────────────────────────────────────────────

describe("handleJsonEvent", () => {
  it("detects agent_end", () => {
    const result = handleJsonEvent(
      '{"type":"agent_end"}',
      {},
    );
    assert.equal(result.completed, true);
    assert.deepEqual(result.assistantMessages, []);
  });

  it("calls onToolCall for tool_execution_start", () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    handleJsonEvent(
      '{"type":"tool_execution_start","toolName":"read","args":{"path":"/test.txt"}}',
      {
        onToolCall: (toolName, args) => calls.push({ toolName, args }),
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].toolName, "read");
    assert.equal(calls[0].args.path, "/test.txt");
  });

  it("calls onAssistantMessage for message_end with text", () => {
    const messages: string[] = [];
    handleJsonEvent(
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Hello from pi"}]}}',
      {
        onAssistantMessage: (text) => messages.push(text),
      },
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0], "Hello from pi");
  });

  it("does not call onAssistantMessage for non-assistant messages", () => {
    const messages: string[] = [];
    handleJsonEvent(
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}',
      {
        onAssistantMessage: (text) => messages.push(text),
      },
    );
    assert.equal(messages.length, 0);
  });

  it("handles multiple text blocks in one message", () => {
    const messages: string[] = [];
    handleJsonEvent(
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Part 1"},{"type":"text","text":"Part 2"}]}}',
      {
        onAssistantMessage: (text) => messages.push(text),
      },
    );
    assert.equal(messages.length, 1);
    assert.equal(messages[0], "Part 1\nPart 2");
  });

  it("skips malformed JSON silently", () => {
    const result = handleJsonEvent("not json", {});
    assert.equal(result.completed, false);
    assert.deepEqual(result.assistantMessages, []);
  });
});

// ─── SpawnOptions.onLog ──────────────────────────────────────────

describe("SpawnOptions.onLog type", () => {
  it("accepts onLog in options", () => {
    // Type-level test: verify the interface accepts onLog
    const opts: SpawnOptions = {
      timeoutMs: 5000,
      onLog: (line: string) => {
        assert.ok(typeof line === "string");
      },
    };
    assert.equal(opts.timeoutMs, 5000);
    assert.equal(typeof opts.onLog, "function");
  });
});
