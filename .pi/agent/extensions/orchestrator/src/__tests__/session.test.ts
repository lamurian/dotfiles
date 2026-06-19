/**
 * Tests for session utility functions.
 *
 * These tests cover the log forwarding infrastructure:
 * - Assistant message truncation for widget display
 * - JSON event parsing with callback wiring
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncateForLog, handleJsonEvent, makeLogCallbacks, sanitizeLogLine } from "../session.ts";
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

// ─── sanitizeLogLine ─────────────────────────────────────────────

describe("sanitizeLogLine", () => {
  it("replaces newlines with ↵ character", () => {
    assert.equal(sanitizeLogLine("hello\nworld"), "hello↵ world");
  });

  it("replaces multiple newlines", () => {
    assert.equal(sanitizeLogLine("a\nb\nc"), "a↵ b↵ c");
  });

  it("removes carriage returns", () => {
    assert.equal(sanitizeLogLine("hello\r\nworld"), "hello↵ world");
  });

  it("passes through text without newlines", () => {
    assert.equal(sanitizeLogLine("hello world"), "hello world");
  });

  it("handles empty string", () => {
    assert.equal(sanitizeLogLine(""), "");
  });

  it("handles only newlines", () => {
    assert.equal(sanitizeLogLine("\n\n"), "↵ ↵ ");
  });
});

// ─── makeLogCallbacks format ─────────────────────────────────────

describe("makeLogCallbacks compact format", () => {
  it("formats tool call with basename for path tools", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolCall?.("read", { path: "/home/user/project/src/types.ts" });

    assert.equal(logs.length, 1);
    assert.equal(logs[0], "  read  types.ts");
  });

  it("formats tool call for bash with short command", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolCall?.("bash", { command: "npm run test -- --coverage" });

    assert.equal(logs.length, 1);
    assert.equal(logs[0], "  bash  npm run test -- --coverage");
  });

  it("formats tool call for explore with short instruction", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolCall?.("explore", { instruction: "List all files in the src directory and check for tsconfig" });

    assert.equal(logs.length, 1);
    assert.equal(logs[0], "  explore  List all files in the src directory and check for tsconfig");
  });

  it("sanitizes newlines in tool call args", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolCall?.("read", { path: "multi\nline\nfile.ts" });

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes("↵"));
    assert.ok(!logs[0].includes("\n"));
  });
});

describe("makeLogCallbacks clean results", () => {
  it("formats successful tool result with ✓ and tool name", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolResult?.("edit", "Successfully replaced 1 block", false);

    assert.equal(logs.length, 1);
    assert.equal(logs[0], "  ✓ edit  Successfully replaced 1 block");
  });

  it("formats error tool result with ✗", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolResult?.("bash", "command not found", true);

    assert.equal(logs.length, 1);
    assert.equal(logs[0], "  ✗ bash  command not found");
  });

  it("skips result line for read tool with empty summary", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolResult?.("read", "", false);

    assert.equal(logs.length, 0);
  });

  it("sanitizes newlines in result summary", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolResult?.("edit", "line1\nline2", false);

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes("↵"));
    assert.ok(!logs[0].includes("\n"));
  });
});

describe("makeLogCallbacks no assistant text", () => {
  it("does not log assistant messages", () => {
    const logs: string[] = [];
    const messages: string[] = [];
    const callbacks = makeLogCallbacks(messages, [], (line) => logs.push(line));

    callbacks.onAssistantMessage?.("Let me fix the simpler errors first.");

    // Messages are collected for spawn result but NOT logged
    assert.equal(logs.length, 0, "assistant messages should not appear in logs");
    assert.equal(messages.length, 1, "full text should still be collected");
    assert.equal(messages[0], "Let me fix the simpler errors first.");
  });

  it("does not log assistant message deltas", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onAssistantMessageDelta?.("Hello ");
    callbacks.onAssistantMessageDelta?.("world");

    // Delta handler should not be registered, so this should be a no-op
    assert.equal(logs.length, 0, "deltas should not appear in logs");
  });
});

// ─── handleJsonEvent ─────────────────────────────────────────────

describe("handleJsonEvent", () => {
  it("calls onAssistantMessageDelta for message_update with text_delta", () => {
    const deltas: string[] = [];
    handleJsonEvent(
      '{"type":"message_update","message":{"role":"assistant"},"assistantMessageEvent":{"type":"text_delta","delta":"Hello from pi"}}',
      {
        onAssistantMessageDelta: (delta) => deltas.push(delta),
      },
    );
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0], "Hello from pi");
  });

  it("ignores message_update without assistantMessageEvent", () => {
    const deltas: string[] = [];
    handleJsonEvent(
      '{"type":"message_update","message":{"role":"assistant"}}',
      {
        onAssistantMessageDelta: (delta) => deltas.push(delta),
      },
    );
    assert.equal(deltas.length, 0);
  });

  it("gives empty summary for read tool result (file content is not useful as log)", () => {
    const results: Array<{ toolName: string; summary: string; isError: boolean }> = [];
    handleJsonEvent(
      '{"type":"tool_execution_end","toolCallId":"abc","toolName":"read","result":{"content":[{"type":"text","text":"---\\ntitle: Something"}]},"isError":false}',
      {
        onToolResult: (toolName, summary, isError) => results.push({ toolName, summary, isError }),
      },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].toolName, "read");
    assert.equal(results[0].summary, "", "read tool should have empty summary");
    assert.equal(results[0].isError, false);
  });

  it("gives summary for non-read tool result", () => {
    const results: Array<{ toolName: string; summary: string; isError: boolean }> = [];
    handleJsonEvent(
      '{"type":"tool_execution_end","toolCallId":"abc","toolName":"edit","result":{"content":[{"type":"text","text":"Successfully replaced 1 block"}]},"isError":false}',
      {
        onToolResult: (toolName, summary, isError) => results.push({ toolName, summary, isError }),
      },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].toolName, "edit");
    assert.equal(results[0].summary, "Successfully replaced 1 block");
    assert.equal(results[0].isError, false);
  });

  it("calls onToolResult for tool_execution_end with error", () => {
    const results: Array<{ toolName: string; summary: string; isError: boolean }> = [];
    handleJsonEvent(
      '{"type":"tool_execution_end","toolCallId":"abc","toolName":"bash","result":{"stderr":"command not found"},"isError":true}',
      {
        onToolResult: (toolName, summary, isError) => results.push({ toolName, summary, isError }),
      },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].toolName, "bash");
    assert.equal(results[0].summary, "command not found");
    assert.equal(results[0].isError, true);
  });

  it("ignores tool_execution_end without onToolResult callback", () => {
    const result = handleJsonEvent(
      '{"type":"tool_execution_end","toolCallId":"abc","toolName":"read","result":"ok","isError":false}',
      {},
    );
    assert.equal(result.completed, false);
  });
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

// ─── makeLogCallbacks ───────────────────────────────────────────

describe("makeLogCallbacks", () => {
  it("formats tool result log lines", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    // read tool with empty summary — should be skipped
    callbacks.onToolResult?.("read", "", false);
    // bash error — should show ✗ with summary
    callbacks.onToolResult?.("bash", "error: command not found", true);
    // edit success with summary — should show ✓
    callbacks.onToolResult?.("edit", "1 block replaced", false);

    assert.equal(logs.length, 2);
    assert.equal(logs[0], "  ✗ bash  error: command not found");
    assert.equal(logs[1], "  ✓ edit  1 block replaced");
  });

  it("collects assistant messages without logging", () => {
    const logs: string[] = [];
    const messages: string[] = [];
    const textParts: string[] = [];
    const callbacks = makeLogCallbacks(textParts, messages, (line) => logs.push(line));

    const long = "a".repeat(200);
    callbacks.onAssistantMessage?.(long);

    assert.equal(logs.length, 0, "assistant messages should not be logged");
    assert.equal(messages.length, 1);
    assert.equal(messages[0], long); // full text preserved
    assert.equal(textParts.length, 1);
    assert.equal(textParts[0], long);
  });

  it("formats tool call log lines with basename", () => {
    const logs: string[] = [];
    const callbacks = makeLogCallbacks([], [], (line) => logs.push(line));

    callbacks.onToolCall?.("read", { path: "/home/user/test.txt" });

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes("read"));
    assert.ok(logs[0].includes("test.txt"));
    assert.ok(!logs[0].includes("/home")); // no full path
  });

  it("formats tool call without onLog (stdout fallback)", () => {
    const callbacks = makeLogCallbacks([], []);
    // Should not throw when calling without onLog
    callbacks.onToolCall?.("read", { path: "/test.txt" });
    callbacks.onToolResult?.("edit", "done", false);
    assert.ok(true, "should not throw when no onLog provided");
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
