import { loadConfig, resolveTemperature } from "./config.ts";

/** Minimal interface matching the pi ExtensionAPI methods we use. */
interface PiApi {
  on(
    event: "before_provider_request",
    handler: (event: { type: string; payload: unknown }, ctx: { model?: { id?: string } }) => unknown,
  ): void;
}

/**
 * Create the model-temperature extension.
 *
 * Returns an extension factory that sets temperature on every provider request.
 * Uses config from agentDir/temperature.json (global) and cwd/.pi/temperature.json (project).
 *
 * @param agentDir - Pi agent directory for global config lookup
 * @param cwd - Working directory for project config lookup
 */
export function createExtension(
  agentDir: string,
  cwd: string,
): (pi: PiApi) => void {
  return (pi: PiApi): void => {
    const config = loadConfig(cwd, agentDir);

    pi.on("before_provider_request", (event, ctx) => {
      const modelId = ctx.model?.id;
      const temperature = resolveTemperature(config, modelId);
      return {
        ...(event.payload as Record<string, unknown>),
        temperature,
      };
    });
  };
}
