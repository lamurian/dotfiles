import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Configuration for model temperature. */
export interface TemperatureConfig {
  /** Default temperature applied when no model or provider matches. */
  default: number;
  /** Per-provider temperature overrides (keyed by provider name). */
  providers: Record<string, number>;
  /** Per-model temperature overrides (keyed by full model ID). */
  models: Record<string, number>;
}

/** Default configuration: temperature 0.1 for all models. */
export const DEFAULT_CONFIG: TemperatureConfig = {
  default: 0.1,
  providers: {},
  models: {},
};

/**
 * Load and deep-merge temperature configuration from global and project locations.
 *
 * Resolution order: DEFAULT_CONFIG → global config → project config.
 * Objects at `providers` and `models` are shallow-merged (project keys override global).
 *
 * @param cwd - Working directory for project config lookup
 * @param agentDir - Agent directory for global config lookup
 * @returns Merged configuration
 */
export function loadConfig(cwd: string, agentDir: string): TemperatureConfig {
  const projectConfigPath = join(cwd, ".pi", "temperature.json");
  const globalConfigPath = join(agentDir, "temperature.json");

  let globalConfig: Partial<TemperatureConfig> = {};
  let projectConfig: Partial<TemperatureConfig> = {};

  if (existsSync(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
    } catch {
      // Malformed JSON — ignore and use defaults
    }
  }

  if (existsSync(projectConfigPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
    } catch {
      // Malformed JSON — ignore
    }
  }

  return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function deepMerge(
  base: TemperatureConfig,
  overrides: Partial<TemperatureConfig>,
): TemperatureConfig {
  return {
    default: overrides.default ?? base.default,
    providers: { ...base.providers, ...overrides.providers },
    models: { ...base.models, ...overrides.models },
  };
}

/**
 * Resolve the temperature for a given model ID.
 *
 * Resolution order:
 * 1. Exact model ID match in `config.models`
 * 2. Provider-level match in `config.providers` (provider extracted from model ID)
 * 3. `config.default`
 *
 * @param config - The merged temperature configuration
 * @param modelId - Full model ID (e.g., "opencode-go/deepseek4-flash") or undefined
 * @returns The resolved temperature value
 */
export function resolveTemperature(
  config: TemperatureConfig,
  modelId?: string,
): number {
  if (modelId) {
    // 1. Model-specific match
    if (config.models[modelId] !== undefined) {
      return config.models[modelId];
    }
    // 2. Provider-level match
    const provider = modelId.split("/")[0];
    if (provider && config.providers[provider] !== undefined) {
      return config.providers[provider];
    }
  }
  // 3. Default
  return config.default;
}
