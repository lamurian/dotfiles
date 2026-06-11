import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { listAdrs } from "./adr.ts";
import { readArchitecture, updateAdrStatusInArchitecture, type AdrStatus } from "./architecture.ts";
import { createSpec, listSpecs, archiveSpec } from "./spec.ts";
import { createPlan, listPlans, archivePlan, completeTask } from "./plan.ts";
import { createAdrFromBrainstorm } from "./brainstorm.ts";

/**
 * Register the /adr command for managing Architecture Decision Records.
 *
 * Subcommands:
 *   /adr list                                — list all ADRs
 *   /adr show [index]                        — show an ADR
 *   /adr new <title>                         — create a new ADR
 *   /adr status <path> <status>              — update ADR status in ARCHITECTURE.md
 *   /adr (no args)                           — show ARCHITECTURE.md summary
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerAdrCommand(pi: ExtensionAPI): void {
  pi.registerCommand("adr", {
    description:
      "Manage ADRs. Usage: /adr [list|show|new <title>|status <path> <status>]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      if (cmd === "list") {
        await handleAdrList(ctx);
        return;
      }

      if (cmd === "show") {
        await handleAdrShow(ctx, parts[1]);
        return;
      }

      if (cmd === "new") {
        await handleAdrNew(ctx, parts.slice(1).join(" "));
        return;
      }

      if (cmd === "status") {
        await handleAdrStatus(ctx, parts[1], parts[2] as AdrStatus);
        return;
      }

      // Default: show architecture summary
      const entries = await readArchitecture(ctx.cwd);
      if (entries.length === 0) {
        ctx.ui.notify("No ADRs tracked in ARCHITECTURE.md.", "info");
        return;
      }
      const statusFmt = entries.map(
        (e) => `${e.filePath}: ${e.status} — ${e.summary}`,
      );
      ctx.ui.notify(`ADR Status:\n${statusFmt.join("\n")}`, "info");
    },
  });
}

async function handleAdrList(ctx: ExtensionContext): Promise<void> {
  const files = await listAdrs(ctx.cwd);
  if (files.length === 0) {
    ctx.ui.notify("No ADRs found.", "info");
    return;
  }
  const list = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
  ctx.ui.notify(`ADRs:\n${list}`, "info");
}

async function handleAdrShow(ctx: ExtensionContext, indexStr: string): Promise<void> {
  const files = await listAdrs(ctx.cwd);
  if (files.length === 0) {
    ctx.ui.notify("No ADRs found.", "info");
    return;
  }
  const index = indexStr ? parseInt(indexStr, 10) - 1 : undefined;
  const target =
    index != null && index >= 0 && index < files.length
      ? files[index]
      : files[files.length - 1];
  ctx.ui.notify(`ADR: ${target}`, "info");
}

async function handleAdrNew(ctx: ExtensionContext, title: string): Promise<void> {
  if (!title) {
    ctx.ui.notify("Usage: /adr new <title>", "warning");
    return;
  }

  // Build a minimal ADR skeleton; the LLM enriches it via brainstorming
  const adrPath = await createAdrFromBrainstorm(
    {
      title,
      description: title,
      context: "TBD — will be filled during brainstorming.",
      decision: "TBD — will be filled during brainstorming.",
      impact: "TBD — will be filled during brainstorming.",
      summary: title,
    },
    ctx.cwd,
  );
  ctx.ui.notify(`ADR created: ${adrPath}`, "info");
}

async function handleAdrStatus(
  ctx: ExtensionContext,
  filePath: string,
  status: AdrStatus,
): Promise<void> {
  if (!filePath || !status) {
    ctx.ui.notify(
      "Usage: /adr status <path> <drafted|specified|planned|progressed|implemented>",
      "warning",
    );
    return;
  }
  const valid = ["drafted", "specified", "planned", "progressed", "implemented"];
  if (!valid.includes(status)) {
    ctx.ui.notify(`Invalid status. Valid: ${valid.join(", ")}`, "warning");
    return;
  }
  const ok = await updateAdrStatusInArchitecture(ctx.cwd, filePath, status);
  if (ok) {
    ctx.ui.notify(`Updated ${filePath} status to ${status}.`, "info");
  } else {
    ctx.ui.notify(`ADR ${filePath} not found in ARCHITECTURE.md.`, "warning");
  }
}

/**
 * Register the /spec command for managing spec files.
 *
 * Subcommands:
 *   /spec list <adrNumber>              — list specs for an ADR
 *   /spec archive <path>                — archive a spec file
 *   /spec <adrNumber> <title> [body]    — create a new spec
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerSpecCommand(pi: ExtensionAPI): void {
  pi.registerCommand("spec", {
    description:
      "Manage specs. Usage: /spec <adrNumber> <title> [body]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      if (cmd === "list") {
        const adrNum = parseInt(parts[1], 10);
        if (!adrNum) {
          ctx.ui.notify("Usage: /spec list <adrNumber>", "warning");
          return;
        }
        const specs = await listSpecs(adrNum, ctx.cwd);
        if (specs.length === 0) {
          ctx.ui.notify(`No specs found for ADR${adrNum}.`, "info");
          return;
        }
        ctx.ui.notify(`Specs for ADR${adrNum}:\n${specs.join("\n")}`, "info");
        return;
      }

      if (cmd === "archive") {
        const specPath = parts[1];
        if (!specPath) {
          ctx.ui.notify("Usage: /spec archive <path>", "warning");
          return;
        }
        const archived = await archiveSpec(specPath, ctx.cwd);
        ctx.ui.notify(`Archived: ${archived}`, "info");
        return;
      }

      // Default: create a spec
      const adrNum = parseInt(cmd, 10);
      if (!adrNum) {
        ctx.ui.notify("Usage: /spec <adrNumber> <title> [body]", "warning");
        return;
      }
      const title = parts[1];
      if (!title) {
        ctx.ui.notify("Usage: /spec <adrNumber> <title> [body]", "warning");
        return;
      }
      const body = parts.slice(2).join(" ") || "TBD";
      const specPath = await createSpec(adrNum, title, body, ctx.cwd);
      ctx.ui.notify(`Spec created: ${specPath}`, "info");
    },
  });
}

/**
 * Register the /plan command for managing plan files.
 *
 * Subcommands:
 *   /plan list <specNumber>              — list plans for a spec
 *   /plan archive <path>                 — archive a plan file
 *   /plan done <path> <taskIndex>        — mark a task as completed
 *   /plan <specNumber> <title> [body]    — create a new plan
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerPlanCommand(pi: ExtensionAPI): void {
  pi.registerCommand("plan", {
    description:
      "Manage plans. Usage: /plan <specNumber> <title> [body]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      if (cmd === "list") {
        const specNum = parts[1];
        if (!specNum) {
          ctx.ui.notify("Usage: /plan list <specNumber>", "warning");
          return;
        }
        const plans = await listPlans(specNum, ctx.cwd);
        if (plans.length === 0) {
          ctx.ui.notify(`No plans found for spec ${specNum}.`, "info");
          return;
        }
        ctx.ui.notify(`Plans for spec ${specNum}:\n${plans.join("\n")}`, "info");
        return;
      }

      if (cmd === "archive") {
        const planPath = parts[1];
        if (!planPath) {
          ctx.ui.notify("Usage: /plan archive <path>", "warning");
          return;
        }
        const archived = await archivePlan(planPath, ctx.cwd);
        ctx.ui.notify(`Archived: ${archived}`, "info");
        return;
      }

      if (cmd === "done") {
        const planPath = parts[1];
        const taskIndex = parseInt(parts[2], 10);
        if (!planPath || isNaN(taskIndex)) {
          ctx.ui.notify("Usage: /plan done <path> <taskIndex>", "warning");
          return;
        }
        await completeTask(planPath, taskIndex);
        ctx.ui.notify(`Task ${taskIndex} marked done in ${planPath}.`, "info");
        return;
      }

      // Default: create a plan
      const specNum = cmd;
      if (!/^\d+\.\d+$/.test(specNum)) {
        ctx.ui.notify("Usage: /plan <specNumber> <title> [body]", "warning");
        return;
      }
      const title = parts[1];
      if (!title) {
        ctx.ui.notify("Usage: /plan <specNumber> <title> [body]", "warning");
        return;
      }
      const body = parts.slice(2).join(" ") || "TBD";
      const planPath = await createPlan(specNum, title, body, ctx.cwd);
      ctx.ui.notify(`Plan created: ${planPath}`, "info");
    },
  });
}
