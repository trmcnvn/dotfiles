import { complete } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { resolveToolModel } from "../helpers/model-routing.js";

const MAX_TITLE_LENGTH = 72;
const FALLBACK_WORD_LIMIT = 8;
const NAMING_MAX_TOKENS = 24;

const SESSION_NAME_SYSTEM_PROMPT = `You write short session titles for coding tasks.
Return exactly one plain-text title.
Requirements:
- 3 to 7 words
- describe the concrete coding task
- no quotes, no markdown, no trailing punctuation`;

const CONTINUE = { action: "continue" as const };

type SessionModel = NonNullable<ExtensionContext["model"]>;

const hasPriorUserMessages = (entries: readonly SessionEntry[]): boolean =>
  entries.some((entry) => {
    if (entry.type !== "message") {
      return false;
    }

    if (!("role" in entry.message)) {
      return false;
    }

    return entry.message.role === "user";
  });

const truncateTitle = (value: string): string => {
  if (value.length <= MAX_TITLE_LENGTH) {
    return value;
  }

  const sliced = value.slice(0, MAX_TITLE_LENGTH).trim();
  const lastWordBoundary = sliced.lastIndexOf(" ");

  if (lastWordBoundary > 20) {
    return sliced.slice(0, lastWordBoundary).trim();
  }

  return sliced;
};

const normalizeTitle = (raw: string): string | null => {
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return null;
  }

  const withoutPrefix = firstLine
    .replace(/^[-*]\s+/, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^session\s*name\s*:\s*/i, "");

  const withoutQuotes = withoutPrefix.replace(/^["'`]+|["'`]+$/g, "");
  const compact = withoutQuotes.replace(/\s+/g, " ").trim();

  if (compact.length === 0) {
    return null;
  }

  return truncateTitle(compact);
};

const fallbackTitleFromPrompt = (prompt: string): string | null => {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, FALLBACK_WORD_LIMIT);

  if (words.length === 0) {
    return null;
  }

  return normalizeTitle(words.join(" "));
};

const buildCandidateModels = (
  preferred: SessionModel | undefined,
  current: SessionModel | undefined,
): readonly SessionModel[] => {
  const candidates: SessionModel[] = [];

  const addCandidate = (model: SessionModel | undefined) => {
    if (!model) {
      return;
    }

    const alreadyIncluded = candidates.some(
      (candidate) => candidate.provider === model.provider && candidate.id === model.id,
    );

    if (!alreadyIncluded) {
      candidates.push(model);
    }
  };

  addCandidate(preferred);
  addCandidate(current);

  return candidates;
};

const buildNamingPrompt = (prompt: string): string =>
  [
    "Create a concise session title for this initial user request.",
    "Return title only.",
    "",
    "<initial_prompt>",
    prompt,
    "</initial_prompt>",
  ].join("\n");

const generateTitleWithModel = async (
  model: SessionModel,
  apiKey: string,
  prompt: string,
): Promise<string | null> => {
  const response = await complete(
    model,
    {
      systemPrompt: SESSION_NAME_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: buildNamingPrompt(prompt) }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey,
      maxTokens: NAMING_MAX_TOKENS,
    },
  );

  const responseText = response.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  return normalizeTitle(responseText);
};

const getAutoSessionName = async (
  prompt: string,
  preferredModel: SessionModel | undefined,
  currentModel: SessionModel | undefined,
  getApiKey: (model: SessionModel) => Promise<string | undefined>,
): Promise<string | null> => {
  const candidates = buildCandidateModels(preferredModel, currentModel);

  for (const model of candidates) {
    const apiKey = await getApiKey(model);
    if (!apiKey) {
      continue;
    }

    try {
      const generated = await generateTitleWithModel(model, apiKey, prompt);
      if (generated) {
        return generated;
      }
    } catch {
      // Fall through to the next candidate model.
    }
  }

  return fallbackTitleFromPrompt(prompt);
};

export default function autoSessionNameExtension(pi: ExtensionAPI) {
  let attemptedInCurrentSession = false;
  let sessionEpoch = 0;

  const resetAttemptState = () => {
    attemptedInCurrentSession = false;
    sessionEpoch += 1;
  };

  pi.on("session_start", resetAttemptState);
  pi.on("session_switch", resetAttemptState);
  pi.on("session_fork", resetAttemptState);

  pi.on("input", (event, ctx) => {
    if (attemptedInCurrentSession) {
      return CONTINUE;
    }

    if (!ctx.hasUI) {
      return CONTINUE;
    }

    if (event.source === "extension") {
      return CONTINUE;
    }

    const prompt = event.text.trim();
    if (prompt.length === 0 || prompt.startsWith("/")) {
      return CONTINUE;
    }

    const existingName = pi.getSessionName();
    if (existingName && existingName.trim().length > 0) {
      attemptedInCurrentSession = true;
      return CONTINUE;
    }

    if (hasPriorUserMessages(ctx.sessionManager.getBranch())) {
      attemptedInCurrentSession = true;
      return CONTINUE;
    }

    const activeModel = ctx.model;
    if (activeModel === undefined) {
      return CONTINUE;
    }

    attemptedInCurrentSession = true;
    const attemptEpoch = sessionEpoch;

    void resolveToolModel(
      ctx.modelRegistry,
      "auto-session-name",
      {
        provider: activeModel.provider,
        modelId: activeModel.id,
      },
    )
      .then((resolution) => {
        if (resolution.configIssue !== null) {
          ctx.ui.notify(resolution.configIssue, "warning");
        }

        return getAutoSessionName(
          prompt,
          resolution.model,
          activeModel,
          (model) => ctx.modelRegistry.getApiKey(model),
        );
      })
      .then((generatedName) => {
        if (attemptEpoch !== sessionEpoch) {
          return;
        }

        if (generatedName && !pi.getSessionName()) {
          pi.setSessionName(generatedName);
        }
      })
      .catch(() => {
        // Best-effort naming only.
      });

    return CONTINUE;
  });
}
