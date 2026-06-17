/**
 * Model Temperature Extension
 *
 * Sets a default temperature for all model providers, configurable via:
 * - ~/.pi/agent/extensions/model-temperature/temperature.json (global)
 * - .pi/temperature.json (project override)
 *
 * Temperature resolution: model → provider → default (0.1)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createExtension } from "./extension.ts";

export { createExtension } from "./extension.ts";

export default function (pi: ExtensionAPI): void {
  createExtension(getAgentDir(), process.cwd())(pi);
}
