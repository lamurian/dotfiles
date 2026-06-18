import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Result of spawning a pi subprocess.
 */
export interface SpawnResult {
  /** Process exit code. */
  exitCode: number;
  /** stdout output. */
  stdout: string;
  /** stderr output. */
  stderr: string;
  /** Whether the process was killed/signal-terminated. */
  killed: boolean;
}

/** Cached absolute path of the package content directory. */
let _contentDir: string | undefined;

/**
 * Get the absolute path to the content directory.
 */
function getContentDir(): string {
  if (!_contentDir) {
    _contentDir = resolve(
      fileURLToPath(new URL("..", import.meta.url)),
      "content",
    );
  }
  return _contentDir;
}

/**
 * Load the plan prompt template from the content directory.
 *
 * @returns The prompt template string.
 */
export async function loadPlanPrompt(): Promise<string> {
  const promptPath = resolve(getContentDir(), "plan-prompt.md");
  return readFile(promptPath, "utf-8");
}

/**
 * Render the plan prompt template with plan file reference.
 *
 * @param planFile - Path to the plan file (will be embedded in the prompt via @ref).
 * @returns The rendered prompt string.
 */
export async function renderPlanPrompt(planFile: string): Promise<string> {
  const template = await loadPlanPrompt();
  return template.replaceAll("{{planFile}}", planFile);
}

/**
 * Spawn a pi subprocess in print mode with the given prompt.
 *
 * @param prompt - The prompt text to send to pi.
 * @param cwd    - Working directory for the pi process.
 * @param signal - Optional AbortSignal to cancel the process.
 * @returns SpawnResult with exit code and output.
 */
export function spawnPiSession(
  prompt: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    let proc;
    try {
      proc = spawn("pi", ["-p"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        signal,
      });
    } catch {
      resolvePromise({
        exitCode: -1,
        stdout: "",
        stderr: "Failed to spawn pi process. Is pi installed and in PATH?",
        killed: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code, signalCode) => {
      resolvePromise({
        exitCode: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        killed: signalCode !== null,
      });
    });

    proc.on("error", (err) => {
      resolvePromise({
        exitCode: -1,
        stdout: stdout.trim(),
        stderr: `Failed to spawn pi process: ${err.message}`,
        killed: false,
      });
    });

    // Write the prompt to stdin and close it
    proc.stdin!.write(prompt);
    proc.stdin!.end();
  });
}
