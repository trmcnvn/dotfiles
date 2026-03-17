import { complete, type Message } from "@mariozechner/pi-ai";
import {
  BorderedLoader,
  convertToLlm,
  serializeConversation,
  type ExtensionAPI,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { resolveToolModel } from "../../helpers/model-routing.js";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

type HandoffGenerationResult =
  | {
      readonly status: "ok";
      readonly prompt: string;
    }
  | {
      readonly status: "cancelled";
    }
  | {
      readonly status: "error";
      readonly message: string;
    };

const messageText = (value: unknown): string =>
  value instanceof Error ? value.message : "Unknown error while generating handoff prompt.";

const formatModel = (provider: string, id: string): string => `${provider}/${id}`;

const extractConversationMessages = (entries: readonly SessionEntry[]) =>
  entries
    .filter((entry): entry is SessionEntry & { readonly type: "message" } =>
      entry.type === "message"
    )
    .map((entry) => entry.message);

type MessageTextPart = { readonly type: "text"; readonly text: string };

const isMessageTextPart = (part: unknown): part is MessageTextPart =>
  typeof part === "object" &&
  part !== null &&
  "type" in part &&
  part.type === "text" &&
  "text" in part &&
  typeof part.text === "string";

const extractResponseText = (message: Message): string => {
  if (typeof message.content === "string") {
    return message.content.trim();
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter(isMessageTextPart)
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export default function handoffExtension(pi: ExtensionAPI) {
  pi.registerCommand("handoff", {
    description: "Transfer context to a new focused session",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("handoff requires interactive mode", "error");
        return;
      }

      const goal = args.trim();
      if (goal.length === 0) {
        ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
        return;
      }

      const activeModel = ctx.model;
      if (activeModel === undefined) {
        ctx.ui.notify("No active model is selected for /handoff.", "error");
        return;
      }

      const modelResolution = await resolveToolModel(
        ctx.modelRegistry,
        "handoff",
        {
          provider: activeModel.provider,
          modelId: activeModel.id,
        },
      );

      if (modelResolution.configIssue !== null) {
        ctx.ui.notify(modelResolution.configIssue, "warning");
      }

      const handoffModel = modelResolution.model;
      if (handoffModel === undefined) {
        ctx.ui.notify(
          `Model ${formatModel(modelResolution.selected.provider, modelResolution.selected.modelId)} is unavailable.`,
          "error",
        );
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      const messages = extractConversationMessages(branch);
      if (messages.length === 0) {
        ctx.ui.notify("No conversation to hand off", "error");
        return;
      }

      const currentSessionFile = ctx.sessionManager.getSessionFile();
      const conversationText = serializeConversation(convertToLlm(messages));

      const generationResult = await ctx.ui.custom<HandoffGenerationResult>(
        (tui, theme, _kb, done) => {
          const loader = new BorderedLoader(
            tui,
            theme,
            `Generating handoff prompt with ${handoffModel.id}...`,
          );

          let finished = false;
          const finish = (result: HandoffGenerationResult): void => {
            if (finished) {
              return;
            }

            finished = true;
            done(result);
          };

          loader.onAbort = () => {
            finish({ status: "cancelled" });
          };

          const generatePrompt = async (): Promise<HandoffGenerationResult> => {
            const apiKey = await ctx.modelRegistry.getApiKey(handoffModel);
            if (apiKey === undefined) {
              return {
                status: "error",
                message: `No API key configured for ${formatModel(handoffModel.provider, handoffModel.id)}.`,
              };
            }

            const userMessage: Message = {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
                },
              ],
              timestamp: Date.now(),
            };

            const response = await complete(
              handoffModel,
              {
                systemPrompt: SYSTEM_PROMPT,
                messages: [userMessage],
              },
              {
                apiKey,
                signal: loader.signal,
              },
            );

            if (response.stopReason === "aborted") {
              return { status: "cancelled" };
            }

            const prompt = extractResponseText(response);
            if (prompt.length === 0) {
              return {
                status: "error",
                message: "Model returned an empty handoff prompt. Try again with a more specific goal.",
              };
            }

            return {
              status: "ok",
              prompt,
            };
          };

          void generatePrompt()
            .then(finish)
            .catch((error: unknown) => {
              console.error("handoff generation failed:", error);
              finish({ status: "error", message: messageText(error) });
            });

          return loader;
        },
      );

      if (generationResult === undefined) {
        ctx.ui.notify("handoff is unavailable in RPC mode. Use interactive TUI mode.", "error");
        return;
      }

      if (generationResult.status === "cancelled") {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      if (generationResult.status === "error") {
        ctx.ui.notify(generationResult.message, "error");
        return;
      }

      const editedPrompt = await ctx.ui.editor("Edit handoff prompt", generationResult.prompt);
      if (editedPrompt === undefined) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      const newSessionResult =
        typeof currentSessionFile === "string" && currentSessionFile.trim().length > 0
          ? await ctx.newSession({ parentSession: currentSessionFile })
          : await ctx.newSession({});

      if (newSessionResult.cancelled) {
        ctx.ui.notify("New session cancelled", "info");
        return;
      }

      ctx.ui.setEditorText(editedPrompt);
      ctx.ui.notify("Handoff ready. Submit when ready.", "info");
    },
  });
}
