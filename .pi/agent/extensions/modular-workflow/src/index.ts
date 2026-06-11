import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { loadState, updateUi, type WorkflowState } from "./state.ts";
import { runBrainstorming, buildPhasePrompt } from "./brainstorm.ts";
import { runDiscussion } from "./discuss.ts";
import { archivePlan } from "./plan.ts";
import { startTdd, buildTddPrompt } from "./implement.ts";
import { readLatestAdr } from "./adr.ts";
import { getAdrContext } from "./adr-detect.ts";
import { readArchitecture } from "./architecture.ts";
import { registerAdrCommand, registerSpecCommand, registerPlanCommand } from "./commands.ts";
import { parseArgs, getSkillsDir, detectDocType } from "./utils.ts";
import { setupAutocomplete } from "./autocomplete.ts";
import { handlePreCompact, handlePostCompact } from "./compaction.ts";
import { loadWorkflowConfig } from "./paths.ts";
import { resolveCrossReferences } from "./cross-ref.ts";
import { isAbsolute, resolve } from "node:path";

export default function (pi: ExtensionAPI): void {
  let state: WorkflowState | null = null;

  // ─── Resources Discovery ────────────────────────────────────
  pi.on("resources_discover", async () => {
    return { skillPaths: [getSkillsDir()] };
  });

  // ─── Session Lifecycle ──────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    state = loadState(ctx);
    updateUi(state, ctx);
    setupAutocomplete(ctx, ctx.cwd);
  });

  // ─── Compaction Preservation ─────────────────────────────────
  pi.on("session_before_compact", async (event, ctx) => {
    const result = await handlePreCompact(event, ctx);
    if (result) return result;
  });

  pi.on("session_compact", async (event, ctx) => {
    await handlePostCompact(event, ctx);
    state = loadState(ctx);
  });

  // ─── Context Injection ──────────────────────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const adrContext = await getAdrContext(ctx.cwd);
    let systemExtra = "";
    if (adrContext) {
      systemExtra += `\n\n### Project Documents\n${adrContext}`;
    }

    // Always read fresh state from session to avoid stale module-level cache
    // after transitionTo() calls from brainstorm/discuss command handlers.
    const currentState = loadState(ctx);

    if (!currentState || currentState.phase === "idle") {
      if (systemExtra) return { systemPrompt: `${event.systemPrompt}${systemExtra}` };
      return;
    }

    // Phase-specific protocol prompt
    const phase = currentState.phase;
    const phasePrompt = await buildPhasePrompt(
      phase,
      phase === "requirements"
        ? (await loadWorkflowConfig(ctx.cwd)).brainstorm?.skipQuestionnaire ?? false
        : true, // only requirements phase has questionnaire
    );

    const topic = currentState.specText ? `\n\nTopic: ${currentState.specText}` : "";

    return {
      systemPrompt: `${event.systemPrompt}\n\n${phasePrompt}${topic}${systemExtra}`,
    };
  });

  // ─── Register Commands ──────────────────────────────────────
  registerAdrCommand(pi);
  registerSpecCommand(pi);
  registerPlanCommand(pi);

  // ── Phase-based edit restrictions ───────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    const currentState = loadState(ctx);
    if (!currentState || currentState.phase === "idle") return;

    if (currentState.phase === "discussing") {
      // /discuss: no file edits allowed
      if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
        return {
          block: true,
          reason: "The /discuss command does not allow file editing. " +
            "Discuss the approach first, then use /implement to execute the agreed plan."
        };
      }
      return;
    }

    // /brainstorm phases (requirements, specifying, planning): only .md files
    if (isToolCallEventType("write", event)) {
      const path: string = event.input.path ?? "";
      if (!path.endsWith(".md")) {
        return {
          block: true,
          reason: `During /brainstorm you can only write .md files (ADRs, specs, plans). ` +
            `Blocked write to "${path}". Use /implement for code changes.`
        };
      }
    }

    if (isToolCallEventType("edit", event)) {
      const path: string = event.input.path ?? "";
      if (!path.endsWith(".md")) {
        return {
          block: true,
          reason: `During /brainstorm you can only edit .md files (ADRs, specs, plans). ` +
            `Blocked edit to "${path}". Use /implement for code changes.`
        };
      }
    }
  });

  // ── /discuss ───────────────────────────────────────────────
  pi.registerCommand("discuss", {
    description:
      "Discuss an issue, bug, chore, or small fix with the engineer. " +
      "Usage: /discuss <topic>",
    handler: async (args, ctx) => {
      await runDiscussion(args, pi, ctx);
    },
  });

  // ── /brainstorm ─────────────────────────────────────────────
  pi.registerCommand("brainstorm", {
    description:
      "Start or continue a brainstorming session. " +
      "Usage: /brainstorm <topic> | /brainstorm @docs/ADR/<file> | /brainstorm @docs/specs/<file>",
    handler: async (args, ctx) => {
      await runBrainstorming(args, pi, ctx);
    },
  });

  // ── /implement ──────────────────────────────────────────────
  pi.registerCommand("implement", {
    description:
      "TDD implementation. Usage: /implement @docs/plans/<file> | /implement [spec]",
    handler: async (args, ctx) => {
      const { topic, fileContents } = await parseArgs(args, ctx.cwd);

      // If file refs are provided, prefer cross-reference resolution
      // for plan files (resolves plan -> spec -> ADR chain)
      const refRegex = /@(\S+)/g;
      const refs: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = refRegex.exec(args)) !== null) {
        refs.push(match[1]);
      }

      if (refs.length > 0) {
        // Check if any referenced file is a plan document
        const planRef = refs.find((r) => {
          const abs = isAbsolute(r) ? r : resolve(ctx.cwd, r);
          return detectDocType(abs) === "plan";
        });

        if (planRef) {
          // Resolve cross-references from the plan file
          const resolved = await resolveCrossReferences(planRef, ctx.cwd);
          if (resolved.errors.length > 0) {
            ctx.ui.notify(
              `Warning resolving references: ${resolved.errors.join(", ")}`,
              "warning",
            );
          }
          const spec = resolved.content || fileContents.join("\n\n---\n\n");

          // Archive the plan file now that it's being consumed
          const planAbs = isAbsolute(planRef) ? planRef : resolve(ctx.cwd, planRef);
          await archivePlan(planAbs, ctx.cwd);
          ctx.ui.notify(`Plan archived: ${planAbs}`, "info");

          await startTdd(spec, pi, ctx);
          return;
        }

        // Non-plan refs: use parsed file contents directly
        if (fileContents.length > 0) {
          const spec = fileContents.join("\n\n---\n\n");
          await startTdd(spec, pi, ctx);
          return;
        }
      }

      if (!topic && fileContents.length === 0) {
        // If there's an active discussion, use that as the plan
        const discussionState = loadState(ctx);
        if (discussionState && discussionState.phase === "discussing") {
          await startTdd(
            `Discussion topic: ${discussionState.specText}\n\n` +
              "The user and you agreed on an implementation strategy during " +
              "the discussion. Refer to the conversation history for the full plan.",
            pi,
            ctx,
          );
          return;
        }

        const latestAdr = await readLatestAdr(ctx.cwd);
        if (latestAdr) {
          const spec = [
            `Title: ${latestAdr.title}`,
            `Description: ${latestAdr.description}`,
            `Context: ${latestAdr.context}`,
            `Decision: ${latestAdr.decision}`,
            `Impact: ${latestAdr.impact}`,
          ].join("\n");
          await startTdd(spec, pi, ctx);
          return;
        }
        ctx.ui.notify(
          "No spec provided and no ADR found. Run /brainstorm first or provide a spec.",
          "warning",
        );
        return;
      }

      const spec = topic || fileContents.join("\n\n---\n\n");
      await startTdd(spec, pi, ctx);
    },
  });

  // ── /status ─────────────────────────────────────────────────
  pi.registerCommand("status", {
    description: "Show current workflow phase and document status",
    handler: async (_args, ctx) => {
      const current = loadState(ctx) ?? state;
      if (!current || current.phase === "idle") {
        const entries = await readArchitecture(ctx.cwd);
        if (entries.length > 0) {
          const lines = entries.map((e) => `${e.filePath}: ${e.status} — ${e.summary}`);
          ctx.ui.notify(`ADR Status:\n${lines.join("\n")}`, "info");
        } else {
          ctx.ui.notify("No active workflow. Start with /brainstorm.", "info");
        }
        return;
      }

      const lines: string[] = [`Phase: ${current.phase.replace(/_/g, " ")}`];
      if (current.adrFiles.length > 0) lines.push(`ADRs: ${current.adrFiles.join(", ")}`);
      if (current.specFiles.length > 0) lines.push(`Specs: ${current.specFiles.join(", ")}`);
      if (current.planFiles.length > 0) lines.push(`Plans: ${current.planFiles.join(", ")}`);
      if (current.lastTestResults) {
        const r = current.lastTestResults;
        lines.push(
          `Tests: ${r.passed} passed, ${r.failed} failed` +
            (r.coveragePercent != null ? `, ${r.coveragePercent}% coverage` : ""),
        );
      }

      const entries = await readArchitecture(ctx.cwd);
      if (entries.length > 0) {
        lines.push("", "ARCHITECTURE.md:");
        for (const e of entries) lines.push(`  ${e.filePath}: ${e.status} — ${e.summary}`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
