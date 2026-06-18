/**
 * Tests for the pi session spawner and prompt rendering.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPlanPrompt, renderPlanPrompt, spawnPiSession } from "../session.ts";

describe("plan prompt template", () => {
  it("loads the template from content directory", async () => {
    const template = await loadPlanPrompt();
    assert.ok(template.includes("{{planFile}}"), "template should contain {{planFile}} placeholder");
    assert.ok(template.includes("implement_plan"), "template should mention implement_plan tool");
    assert.ok(template.length > 50, "template should have substantial content");
  });

  it("renders the prompt with plan file path", async () => {
    const prompt = await renderPlanPrompt("docs/plans/001-task.md");
    assert.ok(prompt.includes("docs/plans/001-task.md"), "prompt should include the plan file path");
    assert.ok(!prompt.includes("{{planFile}}"), "placeholder should be replaced");
  });
});

describe("spawnPiSession", () => {
  it("fails gracefully when pi is not available", async () => {
    // Temporarily remove pi from PATH to test graceful failure
    const originalPath = process.env.PATH;
    process.env.PATH = "/nonexistent-path-dir";

    try {
      const result = await spawnPiSession("test prompt", "/tmp");
      assert.equal(result.exitCode, -1);
      assert.ok(
        result.stderr.length > 0,
        `expected error about pi, got: ${result.stderr}`,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
