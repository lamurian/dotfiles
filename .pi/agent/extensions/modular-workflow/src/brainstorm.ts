import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadContent, renderTemplate, detectDocType } from "./utils.ts";
import { createAdr, type Adr } from "./adr.ts";
import { ensureArchitectureMd, addAdrToArchitecture } from "./architecture.ts";
import { type WorkflowState, transitionTo, updateUi } from "./state.ts";
import { detectExistingHooks } from "./detect-hooks.ts";
import { loadWorkflowConfig } from "./paths.ts";
import { resolveCrossReferences } from "./cross-ref.ts";
import { relative } from "node:path";

/** Default brainstorming topic when none is provided. */
const DEFAULT_TOPIC = "Let's discuss the implementation requirements for this project.";

/**
 * Phase determined by the type of @file the user passes.
 *
 * - No recognized file ref → requirements phase (elicit → ADR)
 * - @docs/ADR/*.md       → specifying phase (ADR → spec)
 * - @docs/specs/*.md     → planning phase (spec → plan)
 */
type DetectedPhase = "requirements" | "specifying" | "planning";

/**
 * Detect the phase from command arguments by checking @file references.
 *
 * @param args - Raw command argument string.
 * @param cwd  - Project working directory.
 * @returns The detected phase and the resolved file path (if any).
 */
async function detectPhaseFromArgs(
  args: string,
  cwd: string,
): Promise<{ phase: DetectedPhase; filePath: string | null }> {
  const refRegex = /@(\S+)/g;
  let match: RegExpExecArray | null;
  let specPath: string | null = null;

  while ((match = refRegex.exec(args)) !== null) {
    const ref = match[1];
    // Resolve relative to cwd for type detection
    const resolved = ref.startsWith("/") ? ref : `${cwd}/${ref}`;
    const docType = detectDocType(resolved);
    if (docType === "adr") {
      return { phase: "specifying", filePath: ref };
    }
    if (docType === "spec") {
      return { phase: "planning", filePath: ref };
    }
    if (docType === "plan") {
      specPath = ref;
    }
  }

  // If a plan was referenced, treat it as planning (user wants to review before /implement)
  if (specPath) {
    return { phase: "planning", filePath: specPath };
  }

  return { phase: "requirements", filePath: null };
}

/**
 * Run a brainstorming session.
 *
 * Phase is determined by what the user references:
 * - No @file or topic string → requirements phase
 * - @docs/ADR/xxx.md        → specifying phase
 * - @docs/specs/xxx.md      → planning phase
 *
 * @param args - Raw command arguments (topic and/or @file refs).
 * @param pi   - ExtensionAPI reference.
 * @param ctx  - Current extension context.
 */
export async function runBrainstorming(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const { phase, filePath } = await detectPhaseFromArgs(args, ctx.cwd);
  const workflowConfig = await loadWorkflowConfig(ctx.cwd);
  const skipQuestionnaire = workflowConfig.brainstorm?.skipQuestionnaire ?? false;

  // Build context from @file references
  let contextText = args.replace(/@\S+/g, "").trim() || DEFAULT_TOPIC;
  let crossRefContent = "";

  if (filePath) {
    const resolved = await resolveCrossReferences(filePath, ctx.cwd);
    if (resolved.errors.length > 0) {
      ctx.ui.notify(
        `Warning reading ${filePath}: ${resolved.errors.join(", ")}`,
        "warning",
      );
    }
    if (resolved.content) {
      crossRefContent = resolved.content;
      contextText = resolved.chain.length > 1
        ? `Referenced document: ${filePath}\n\nFull context:\n${resolved.content}`
        : `Referenced document: ${filePath}\n\n${resolved.content}`;
    }
  }

  const state: WorkflowState = {
    phase,
    specText: contextText,
    adrFiles: filePath && phase === "specifying" ? [filePath] : [],
    specFiles: filePath && phase === "planning" ? [filePath] : [],
    planFiles: [],
  };

  transitionTo(pi, state, phase);
  updateUi(state, ctx);

  // Auto-detect existing hooks only during requirements phase
  if (phase === "requirements" && !skipQuestionnaire) {
    const existingHooks = await detectExistingHooks(ctx.cwd);
    const detectionLines: string[] = [];

    if (existingHooks.preCommit) {
      detectionLines.push(`- Pre-commit: ${existingHooks.preCommit.detail}`);
    }
    if (existingHooks.prePush) {
      detectionLines.push(`- Pre-push: ${existingHooks.prePush.detail}`);
    }
    if (detectionLines.length > 0) {
      ctx.ui.notify(
        `Detected existing hooks:\n${detectionLines.join("\n")}`,
        "info",
      );
    }
  }

  // Ensure ARCHITECTURE.md exists (requirements phase)
  if (phase === "requirements") {
    await ensureArchitectureMd(ctx.cwd);
  }

  ctx.ui.notify(
    `Starting ${phase} phase. I'll guide you through the process.`,
    "info",
  );

  // Kick off the LLM conversation
  pi.sendUserMessage(contextText, { deliverAs: "steer" });
}

/**
 * Build the phase-specific system prompt.
 *
 * @param phase - Current workflow phase.
 * @param skipQuestionnaire - Whether to omit env/hook questions (requirements only).
 * @returns The rendered system prompt string.
 */
export async function buildPhasePrompt(
  phase: string,
  skipQuestionnaire = false,
): Promise<string> {
  const promptFile = `phase-${phase}.md`;

  let template: string;
  try {
    template = await loadContent(promptFile);
  } catch {
    // Fallback to requirements prompt if phase file not found
    template = await loadContent("phase-requirements.md");
  }

  // Only requirements phase has the questionnaire section
  if (phase === "requirements") {
    const questionnaireSection = skipQuestionnaire
      ? ""
      : [
        "## Questionnaire",
        "",
        "Guide the user toward best practices for:",
        "- Pre-commit hooks (code quality gates, linting, formatting)",
        "- Pre-push hooks (CI validation, build, integration tests)",
        "- Environment management (secrets, dotenv, validation)",
        "",
        "Ask about their preferences but don't force things they don't need.",
      ].join("\n");
    return renderTemplate(template, { questionnaire_section: questionnaireSection });
  }

  return template;
}

/**
 * Create an ADR from brainstorming decisions and track it in ARCHITECTURE.md.
 *
 * @param adr     - The ADR data (status is set to "proposed" automatically).
 * @param cwd     - Project working directory.
 * @returns Absolute path to the created ADR file.
 */
export async function createAdrFromBrainstorm(
  adr: Omit<Adr, "status"> & { summary: string },
  cwd: string,
): Promise<string> {
  const fullAdr: Adr = {
    ...adr,
    status: "proposed",
  };

  const adrPath = await createAdr(fullAdr, cwd);

  // Store the relative path for architecture tracking
  const relPath = relative(cwd, adrPath);
  await addAdrToArchitecture(cwd, relPath, adr.summary, "drafted");

  return adrPath;
}
