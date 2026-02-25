import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODEL_ROUTING_CONFIG_PATH = join(
  homedir(),
  ".pi",
  "agent",
  "model-routing.json",
);

export type ModelSelection = {
  readonly provider: string;
  readonly modelId: string;
};

export type ModelResolution<TModel> = {
  readonly model: TModel | undefined;
  readonly selected: ModelSelection;
  readonly source: "configured" | "default";
  readonly configIssue: string | null;
};

type JsonRecord = Record<string, unknown>;

type ConfigLookup = {
  readonly configuredModel: string | null;
  readonly configIssue: string | null;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const parseModelSelection = (value: string): ModelSelection | null => {
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return null;
  }

  const provider = trimmed.slice(0, slashIndex).trim();
  const modelId = trimmed.slice(slashIndex + 1).trim();
  if (provider.length === 0 || modelId.length === 0) {
    return null;
  }

  return { provider, modelId };
};

const parseConfiguredModelValue = (value: unknown): string | null => {
  if (isNonEmptyString(value)) {
    return value.trim();
  }

  if (!isRecord(value)) {
    return null;
  }

  return isNonEmptyString(value.model) ? value.model.trim() : null;
};

const lookupToolConfig = (
  parsed: unknown,
  toolName: string,
): ConfigLookup => {
  if (!isRecord(parsed)) {
    return {
      configuredModel: null,
      configIssue: `Ignoring ${MODEL_ROUTING_CONFIG_PATH}: expected a JSON object at the top level.`,
    };
  }

  if (parsed.tools === undefined) {
    return Object.keys(parsed).length === 0
      ? { configuredModel: null, configIssue: null }
      : {
          configuredModel: null,
          configIssue:
            `Ignoring ${MODEL_ROUTING_CONFIG_PATH}: expected ` +
            '{ "tools": { "<tool>": "provider/model" } }.',
        };
  }

  if (!isRecord(parsed.tools)) {
    return {
      configuredModel: null,
      configIssue: `Ignoring ${MODEL_ROUTING_CONFIG_PATH}: "tools" must be an object.`,
    };
  }

  const normalizedToolName = toolName.trim().toLowerCase();
  const matchingEntries = Object.entries(parsed.tools).filter(
    ([name]) => name.trim().toLowerCase() === normalizedToolName,
  );

  if (matchingEntries.length === 0) {
    return { configuredModel: null, configIssue: null };
  }

  if (matchingEntries.length > 1) {
    return {
      configuredModel: null,
      configIssue:
        `Ignoring ${MODEL_ROUTING_CONFIG_PATH}: multiple routes match ` +
        `"${toolName}" (case-insensitive). Keep only one.`,
    };
  }

  const entry = matchingEntries[0];
  if (entry === undefined) {
    return { configuredModel: null, configIssue: null };
  }

  const [entryName, entryValue] = entry;
  const model = parseConfiguredModelValue(entryValue);
  if (model === null) {
    return {
      configuredModel: null,
      configIssue:
        `Ignoring model route for "${entryName}" in ${MODEL_ROUTING_CONFIG_PATH}: ` +
        'expected "provider/model" or { "model": "provider/model" }.',
    };
  }

  return {
    configuredModel: model,
    configIssue: null,
  };
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isEnoentError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const readToolConfig = async (toolName: string): Promise<ConfigLookup> => {
  let rawConfig: string;

  try {
    rawConfig = await readFile(MODEL_ROUTING_CONFIG_PATH, "utf8");
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return { configuredModel: null, configIssue: null };
    }

    return {
      configuredModel: null,
      configIssue:
        `Could not read ${MODEL_ROUTING_CONFIG_PATH}: ${describeError(error)}. ` +
        "Using default model.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error: unknown) {
    return {
      configuredModel: null,
      configIssue:
        `Could not parse ${MODEL_ROUTING_CONFIG_PATH}: ${describeError(error)}. ` +
        'Using default model. Expected { "tools": { "<tool>": "provider/model" } }.',
    };
  }

  return lookupToolConfig(parsed, toolName);
};

export const resolveToolModel = async <TModel>(
  modelRegistry: {
    find(provider: string, modelId: string): TModel | undefined;
  },
  toolName: string,
  fallback: ModelSelection,
): Promise<ModelResolution<TModel>> => {
  const config = await readToolConfig(toolName);

  if (config.configuredModel === null) {
    return {
      model: modelRegistry.find(fallback.provider, fallback.modelId),
      selected: fallback,
      source: "default",
      configIssue: config.configIssue,
    };
  }

  const configuredSelection = parseModelSelection(config.configuredModel);
  if (configuredSelection === null) {
    return {
      model: modelRegistry.find(fallback.provider, fallback.modelId),
      selected: fallback,
      source: "default",
      configIssue:
        `Invalid model route for "${toolName}" in ${MODEL_ROUTING_CONFIG_PATH}: ` +
        `"${config.configuredModel}". Expected "provider/model".`,
    };
  }

  return {
    model: modelRegistry.find(configuredSelection.provider, configuredSelection.modelId),
    selected: configuredSelection,
    source: "configured",
    configIssue: config.configIssue,
  };
};
