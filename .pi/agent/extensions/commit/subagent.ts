/**
 * Subagent spawning utility for the commit extension.
 * Used to analyze pre-commit hook failures by delegating to a pi agent.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Spawn a subagent (pi process) to analyze a failure and propose fixes.
 *
 * Loads the agent's system prompt from ~/.pi/agent/agents/<name>.md,
 * then runs pi in JSON print mode with the task as input.
 *
 * Falls back to default output when the subagent is unavailable (offline, missing agent file, etc.).
 */
export async function spawnSubagent(
	agentName: string,
	task: string,
	signal?: AbortSignal,
): Promise<{ output: string; error?: string }> {
	// Load agent system prompt
	const agentDirs = [path.join(os.homedir(), ".pi", "agent", "agents")];
	let systemPrompt = "";

	for (const dir of agentDirs) {
		try {
			const content = await fs.promises.readFile(path.join(dir, `${agentName}.md`), "utf-8");
			const bodyStart = content.indexOf("---", 3);
			systemPrompt = content.startsWith("---") && bodyStart !== -1
				? content.slice(bodyStart + 3).trim()
				: content;
			break;
		} catch {
			// Agent file not found in this directory
		}
	}

	// Build pi args
	const args = ["--mode", "json", "-p", "--no-session"];
	if (systemPrompt) args.push("--system-prompt", systemPrompt);

	// Write task to temp file
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "commit-"));
	const taskFile = path.join(tmpDir, "task.md");
	await fs.promises.writeFile(taskFile, task, "utf-8");
	args.push(taskFile);

	return new Promise((resolve) => {
		const proc = spawn("pi", args, {
			stdio: ["ignore", "pipe", "pipe"],
			signal,
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

		proc.on("close", (code) => {
			fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
			if (code !== 0) {
				resolve({ output: stdout || "(no output)", error: stderr || `exit code ${code}` });
			} else {
				resolve({ output: stdout || "(no output)" });
			}
		});

		proc.on("error", (err) => {
			fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
			resolve({ output: "", error: err.message });
		});
	});
}
