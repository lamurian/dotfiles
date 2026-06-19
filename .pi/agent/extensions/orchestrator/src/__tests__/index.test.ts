/**
 * Tests for the orchestrator extension entry point.
 *
 * Verifies that commands and tools are registered correctly.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

// We can't easily import and call the default factory without typebox
// being fully resolved. Instead, test the module's structural contracts.

describe("orchestrator extension", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    assert.equal(typeof mod.default, "function", "default export should be a function");
  });

  it("truncates widget lines to fit within terminal width", async () => {
    const mod = await import("../index.ts");

    const longLine =
      "  tool: explore Understand the project structure: list all files in extensions/, common/, types/, and any existing tsconfig or eslint config files";

    const logBuffer = [
      "short line",
      longLine,
    ];

    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };

    // This should truncate long lines to fit within the given width
    const rendered = mod.renderWidgetLines(logBuffer, 15, 50, theme);

    // Every rendered line must not exceed the given VISIBLE width
    for (const line of rendered) {
      const vw = visibleWidth(line);
      assert.ok(
        vw <= 50,
        `visible width of line (${vw}) exceeds terminal width 50: "${line}"`,
      );
    }
  });

  it("renders nothing for empty log buffer", async () => {
    const mod = await import("../index.ts");
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const rendered = mod.renderWidgetLines([], 15, 119, theme);
    assert.deepEqual(rendered, [], "empty buffer should produce empty output");
  });

  it("preserves lines that already fit within width", async () => {
    const mod = await import("../index.ts");
    const logBuffer = ["  tool: read /some/path.md"];
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };
    const rendered = mod.renderWidgetLines(logBuffer, 15, 119, theme);
    assert.ok(rendered.length >= 2, "should include title + log line + count");
    // Second line should contain the log text (visible width check)
    assert.ok(
      visibleWidth(rendered[1]!) <= 119,
      "line should not exceed terminal width after truncation",
    );
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
