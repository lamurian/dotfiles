import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createPlan, listPlans } from "./plan.ts";
import { relative } from "node:path";

/**
 * Register the `plan_create` AI tool so the agent can write complete plan files.
 *
 * Unlike the `/plan` slash command, this tool accepts full plan content
 * and writes a complete, filled-in plan document.
 *
 * @param pi - ExtensionAPI reference.
 */
export function registerPlanTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "plan_create",
    label: "Create Plan",
    description:
      "Create a complete plan file linked to a spec. " +
      "Use this to write finished plans with implementation steps, risks, and UAT. " +
      "Returns the created file path.",

    parameters: Type.Object({
      specNumber: Type.String({
        description: "Full spec number this plan implements (e.g. '1.1' for spec 001 task 1)",
      }),
      title: Type.String({
        description: "Short descriptive title (<5 words), e.g. 'Implement Auth Endpoints'",
      }),
      content: Type.String({
        description:
          "Full plan body in markdown. Must include:\n" +
          "- # Overview: context and motivation\n" +
          "- # Goals: measurable outcomes as bullet points\n" +
          "- # Implementation Steps: actionable tasks as checkboxes (- [ ])\n" +
          "- # Risks: table with Likelihood, Impact, Mitigation\n" +
          "- # UAT: numbered steps to guide user testing\n" +
          "- # References: will auto-link to the spec",
      }),
      description: Type.Optional(
        Type.String({
          description: "One-sentence summary (defaults to title if omitted)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { specNumber, title, content, description } = params;

      if (!specNumber || !title || !content) {
        return {
          content: [
            {
              type: "text",
              text: "Error: specNumber, title, and content are required.",
            },
          ],
          isError: true,
        };
      }

      try {
        const planPath = await createPlan(specNumber, title, content, ctx.cwd, description);
        const relPath = relative(ctx.cwd, planPath);
        return {
          content: [
            {
              type: "text",
              text: `Plan created: ${relPath}\nTitle: ${title}\nLinked to spec ${specNumber}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to create plan: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "plan_list",
    label: "List Plans",
    description: "List all plan files in the project.",

    parameters: Type.Object({
      specNumber: Type.Optional(
        Type.String({
          description: "Filter by spec number (optional). If omitted, lists all plans.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const files = await listPlans(params.specNumber ?? "", ctx.cwd);
        if (files.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: params.specNumber
                  ? `No plans found for spec ${params.specNumber}.`
                  : "No plans found in the project.",
              },
            ],
          };
        }
        const relPaths = files.map((f) => relative(ctx.cwd, f));
        return {
          content: [
            {
              type: "text",
              text: `Found ${files.length} plan(s):\n${relPaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Failed to list plans: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  });
}
