import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, resolveTemperature, DEFAULT_CONFIG } from "../config.ts";
import type { TemperatureConfig } from "../config.ts";

// ── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;
let globalConfigDir: string;
let projectConfigDir: string;

function setup(globalConfig?: object, projectConfig?: object) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = join(tmpdir(), `pi-temp-test-${id}`);
  globalConfigDir = join(tmpDir, "global");
  projectConfigDir = join(tmpDir, "project");
  mkdirSync(globalConfigDir, { recursive: true });
  mkdirSync(join(projectConfigDir, ".pi"), { recursive: true });

  if (globalConfig !== undefined) {
    writeFileSync(
      join(globalConfigDir, "temperature.json"),
      JSON.stringify(globalConfig, null, 2),
    );
  }
  if (projectConfig !== undefined) {
    writeFileSync(
      join(projectConfigDir, ".pi", "temperature.json"),
      JSON.stringify(projectConfig, null, 2),
    );
  }
  return { cwd: projectConfigDir, agentDir: globalConfigDir };
}

function teardown() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── loadConfig tests ─────────────────────────────────────────────────────────

describe("loadConfig", () => {
  afterEach(teardown);

  it("returns default config when no config files exist", () => {
    const { cwd, agentDir } = setup();
    const config = loadConfig(cwd, agentDir);
    assert.equal(config.default, 0.1);
    assert.deepEqual(config.providers, {});
    assert.deepEqual(config.models, {});
  });

  it("loads and deep-merges global config over defaults", () => {
    const { cwd, agentDir } = setup({
      default: 0.3,
      providers: { "opencode-go": 0.2 },
    });
    const config = loadConfig(cwd, agentDir);

    assert.equal(config.default, 0.3);
    assert.equal(config.providers["opencode-go"], 0.2);
    assert.deepEqual(config.models, {});
  });

  it("deep-merges project config over global config", () => {
    const { cwd, agentDir } = setup(
      { default: 0.3, providers: { "opencode-go": 0.2 } },
      { default: 0.5, providers: { anthropic: 0.0 } },
    );
    const config = loadConfig(cwd, agentDir);

    assert.equal(config.default, 0.5);
    // Project provider merged alongside global
    assert.equal(config.providers["opencode-go"], 0.2);
    assert.equal(config.providers["anthropic"], 0.0);
  });

  it("returns default config when file contains malformed JSON", () => {
    const { cwd, agentDir } = setup();
    writeFileSync(
      join(agentDir, "temperature.json"),
      "this is not json {{{",
    );
    const config = loadConfig(cwd, agentDir);

    assert.equal(config.default, 0.1);
  });

  it("handles missing project config gracefully when global exists", () => {
    const { cwd, agentDir } = setup({ default: 0.7 });
    const config = loadConfig(cwd, agentDir);

    assert.equal(config.default, 0.7);
  });

  it("project models override global models", () => {
    const { cwd, agentDir } = setup(
      { models: { "opencode-go/gpt-5.1": 0.1 } },
      { models: { "opencode-go/gpt-5.1": 0.9 } },
    );
    const config = loadConfig(cwd, agentDir);

    assert.equal(config.models["opencode-go/gpt-5.1"], 0.9);
  });
});

// ── resolveTemperature tests ─────────────────────────────────────────────────

describe("resolveTemperature", () => {
  const baseConfig: TemperatureConfig = {
    default: 0.1,
    providers: { "opencode-go": 0.2, anthropic: 0.3 },
    models: {
      "opencode-go/deepseek4-flash": 0.5,
      "opencode-go/gpt-5.1": 0.0,
    },
  };

  it("returns model-specific temperature when model ID matches", () => {
    assert.equal(
      resolveTemperature(baseConfig, "opencode-go/deepseek4-flash"),
      0.5,
    );
    assert.equal(
      resolveTemperature(baseConfig, "opencode-go/gpt-5.1"),
      0.0,
    );
  });

  it("returns provider-level temperature when provider matches but model does not", () => {
    assert.equal(
      resolveTemperature(baseConfig, "opencode-go/some-unknown-model"),
      0.2,
    );
    assert.equal(
      resolveTemperature(baseConfig, "anthropic/claude-sonnet"),
      0.3,
    );
  });

  it("returns default temperature when nothing matches", () => {
    assert.equal(
      resolveTemperature(baseConfig, "unknown/missing-model"),
      0.1,
    );
  });

  it("returns default temperature when modelId is undefined", () => {
    assert.equal(resolveTemperature(baseConfig, undefined), 0.1);
    assert.equal(resolveTemperature(baseConfig, ""), 0.1);
  });

  it("returns provider temperature when model has no slash (bare provider)", () => {
    assert.equal(resolveTemperature(baseConfig, "opencode-go"), 0.2);
  });

  it("returns model override even when provider also configured", () => {
    const cfg: TemperatureConfig = {
      default: 0.1,
      providers: { "opencode-go": 0.2 },
      models: { "opencode-go/deepseek4-flash": 0.7 },
    };
    assert.equal(
      resolveTemperature(cfg, "opencode-go/deepseek4-flash"),
      0.7,
    );
  });
});
