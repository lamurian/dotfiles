import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createAdrFromBrainstorm } from "./brainstorm.ts";
import { listAdrs } from "./adr.ts";
import { relative } from "node:path";

/**
 * Register the `adr_create` AI tool so the agent can write complete ADR files.
 *
 * Unlike the `/adr new` slash command (which creates a TBD skeleton),
 * this tool accepts full content and writes a complete, filled-in ADR.
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerAdrTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "adr_create",
    label: "Create ADR",
    description:
      "Create a complete Architecture Decision Record. " +
      "Use this to write a finished ADR with full context, decision, and impact. " +
      "Always draft ALL ADRs for the project before moving to specs. " +
      "Returns the created file path.",

    parameters: Type.Object({
      title: Type.String({
        description: "Short descriptive title (<5 words), e.g. 'PostgreSQL for Persistence'",
      }),
      description: Type.String({
        description: "One sentence summarizing the decision",
      }),
      context: Type.String({
        description:
          "Problem statement or user story. What options were considered. " +
          "Include why this decision matters and what alternatives were evaluated.",
      }),
      decision: Type.String({
        description:
          "Chosen approach and detailed rationale. Why this option over alternatives. " +
          "Include technical reasoning, trade-off analysis, and any constraints that shaped the choice.",
      }),
      impact: Type.String({
        description:
          "Consequences of this decision. Trade-offs, costs, benefits, risks. " +
          "What becomes easier/harder. Migration path if applicable.",
      }),
      summary: Type.String({
        description: "One-line summary for ARCHITECTURE.md tracking (≤80 chars)",
      }),
      status: Type.Optional(
        Type.String({
          description:
            "Decision status. Default: 'proposed'. Use 'accepted' once reviewed and confirmed.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { title, description, context, decision, impact, summary, status } = params;

      if (!title || !description || !context || !decision || !impact || !summary) {
        return {
          content: [
            {
              type: "text",
              text: "Error: All fields (title, description, context, decision, impact, summary) are required.",
            },
          ],
          isError: true,
        };
      }

      try {
        const adrPath = await createAdrFromBrainstorm(
          {
            title,
            description,
            context,
            decision,
            impact,
            summary,
            status: (status as "proposed" | "accepted" | "deprecated" | "superseded") || "proposed",
          },
          ctx.cwd,
        );

        const relPath = relative(ctx.cwd, adrPath);
        return {
          content: [
            {
              type: "text",
              text: `ADR created: ${relPath}\n\nTitle: ${title}\nStatus: ${status || "proposed"}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create ADR: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "adr_list",
    label: "List ADRs",
    description: "List all existing ADR files in the project. Use to check what ADRs have been created.",

    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      try {
        const files = await listAdrs(ctx.cwd);
        if (files.length === 0) {
          return {
            content: [{ type: "text", text: "No ADRs found in the project." }],
          };
        }
        const relPaths = files.map((f) => relative(ctx.cwd, f));
        return {
          content: [
            {
              type: "text",
              text: `Found ${files.length} ADR(s):\n${relPaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Failed to list ADRs: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
