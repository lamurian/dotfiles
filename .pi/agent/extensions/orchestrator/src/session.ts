/**
 * Session management for pi subprocess spawning.
 *
 * Spawns pi in JSON mode with the plan context embedded in the prompt,
 * forwards progress via callback or stdout.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTimeoutSignal } from "./session-types.ts";
import type { SpawnResult, SpawnOptions } from "./session-types.ts";
import { DEFAULT_TIMEOUT_MS } from "./session-types.ts";

// Re-export types and utilities for consumers
export type { SpawnResult, SpawnOptions };
export { DEFAULT_TIMEOUT_MS, createTimeoutSignal };

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
 * Render the plan prompt template with plan content embedded inline.
 *
 * Unlike the old renderPlanPrompt which took a file path, this function
 * takes the actual plan content string and embeds it directly in the
 * prompt. The subprocess no longer needs to call implement_plan to
 * get context — everything is provided upfront.
 *
 * @param planContent - The full content of the plan file.
 * @returns The rendered prompt string with plan content substituted.
 */
export async function renderPlanPrompt(planContent: string): Promise<string> {
  const template = await loadPlanPrompt();
  return template.replaceAll("{{planContent}}", planContent);
}

/**
 * Truncate a string to a maximum length, appending "..." if truncated.
 *
 * @param text   - The text to truncate.
 * @param maxLen - Maximum length before truncation (default 120).
 * @returns The truncated text with "..." suffix if needed.
 */
export function truncateForLog(text: string, maxLen: number = 120): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Callbacks for JSON event handling.
 */
interface JsonEventCallbacks {
  /** Called when an assistant message text block is received. */
  onAssistantMessage?: (text: string) => void;
  /** Called when a tool execution starts. */
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
}

/**
 * Result of processing a single JSON event line.
 */
interface JsonEventResult {
  /** Whether agent_end was received. */
  completed: boolean;
  /** Assistant message text blocks accumulated so far. */
  assistantMessages: string[];
}

/**
 * Parse a single JSON event line from a pi JSON-mode session.
 *
 * Extracts assistant messages and tool call information, invoking
 * callbacks for each. Tracks whether agent_end was received.
 *
 * @param line      - A single JSON event line.
 * @param callbacks - Callbacks for detected events.
 * @returns Result with completion state and accumulated assistant messages.
 */
export function handleJsonEvent(
  line: string,
  callbacks: JsonEventCallbacks,
): JsonEventResult {
  const result: JsonEventResult = {
    completed: false,
    assistantMessages: [],
  };

  if (!line.trim()) return result;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return result;
  }

  if (event.type === "agent_end") {
    result.completed = true;
  }

  if (
    event.type === "message_end" &&
    typeof event.message === "object" &&
    event.message !== null &&
    (event.message as Record<string, unknown>).role === "assistant"
  ) {
    const content = (event.message as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const item of content) {
        if (
          typeof item === "object" &&
          item !== null &&
          (item as Record<string, unknown>).type === "text"
        ) {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string") {
            texts.push(text);
          }
        }
      }
      if (texts.length > 0) {
        const joined = texts.join("\n").trim();
        result.assistantMessages.push(joined);
        callbacks.onAssistantMessage?.(joined);
      }
    }
  }

  if (event.type === "tool_execution_start") {
    const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
    const args = (event.args as Record<string, unknown>) ?? {};
    callbacks.onToolCall?.(toolName, args);
  }

  return result;
}

/**
 * Spawn a pi subprocess in JSON mode with the given prompt.
 *
 * Parses JSON events from stdout to detect completion (agent_end) and
 * collect assistant message text. On timeout, the subprocess is killed
 * with SIGKILL.
 *
 * Log output (tool calls and assistant messages) is forwarded via
 * options.onLog callback, falling back to process.stdout.write if
 * no callback is provided.
 *
 * @param prompt  - The prompt text to send to pi (passed as positional arg).
 * @param cwd     - Working directory for the pi process.
 * @param options - Optional spawn options (signal, timeoutMs, onLog).
 * @returns SpawnResult with exit code, completion status, and messages.
 */
export function spawnPiSession(
  prompt: string,
  cwd: string,
  options?: SpawnOptions,
): Promise<SpawnResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolvePromise) => {
    // Build combined timeout + parent signal
    let timeoutClear: (() => void) | null = null;
    let killSignal: AbortSignal | undefined = options?.signal;
    if (timeoutMs > 0) {
      const combined = createTimeoutSignal(timeoutMs, options?.signal);
      killSignal = combined.signal;
      timeoutClear = combined.clear;
    }

    let timedOut = false;
    let proc;
    try {
      // NOTE: Do NOT pass signal to spawn() — Node.js throws an AbortError
      // on the child process before the close event fires, losing signal metadata.
      // Instead, kill manually via the killHandler below.
      proc = spawn("pi", ["--mode", "json", "-p", prompt], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      timeoutClear?.();
      resolvePromise({
        exitCode: -1,
        stdout: "",
        stderr: "Failed to spawn pi process. Is pi installed and in PATH?",
        killed: false,
        timedOut: false,
        completed: false,
        assistantMessages: [],
      });
      return;
    }

    let stderr = "";
    let buffer = "";
    let completed = false;
    const assistantMessages: string[] = [];
    const textParts: string[] = [];

    // ── Parse JSON events from stdout ──────────────────────────

    const processLine = (line: string) => {
      const result = handleJsonEvent(line, {
        onAssistantMessage: (text) => {
          assistantMessages.push(text);
          textParts.push(text);

          // Forward truncated log line
          const logLine = truncateForLog(text);
          if (options?.onLog) {
            options.onLog(logLine);
          } else {
            process.stdout.write(logLine + "\n");
          }
        },
        onToolCall: (toolName, args) => {
          const argsSummary = Object.values(args)
            .filter((v): v is string => typeof v === "string")
            .slice(0, 2)
            .join(", ");
          const logLine = argsSummary
            ? `  tool: ${toolName} ${argsSummary}`
            : `  tool: ${toolName}`;

          if (options?.onLog) {
            options.onLog(logLine);
          } else {
            process.stdout.write(logLine + "\n");
          }
        },
      });

      if (result.completed) {
        completed = true;
      }
    };

    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const finalize = (overrides: Partial<SpawnResult> = {}): SpawnResult => {
      if (buffer.trim()) processLine(buffer);
      return {
        exitCode: -1,
        stdout: textParts.join("\n\n"),
        stderr: stderr.trim(),
        killed: false,
        timedOut: false,
        completed,
        assistantMessages,
        ...overrides,
      };
    };

    proc.on("close", (code, signalCode) => {
      timeoutClear?.();
      const wasKilled = signalCode !== null;
      resolvePromise(finalize({
        exitCode: code ?? -1,
        killed: wasKilled || timedOut,
        timedOut,
      }));
    });

    proc.on("error", (err) => {
      timeoutClear?.();
      resolvePromise(finalize({
        exitCode: -1,
        stderr: `Failed to spawn pi process: ${err.message}`,
      }));
    });

    // Kill handler for timeout signal
    if (killSignal) {
      const killHandler = () => {
        timedOut = true;
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      };
      if (killSignal.aborted) {
        killHandler();
      } else {
        killSignal.addEventListener("abort", killHandler, { once: true });
      }
    }
  });
}
