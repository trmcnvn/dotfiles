import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

export const SUBAGENT_DIR = join(homedir(), ".pi", "agent", "agents");
export const DEFAULT_THINKING_LEVEL = "medium";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
export const TEXT_VERBOSITY_LEVELS = ["low", "medium", "high"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type TextVerbosity = (typeof TEXT_VERBOSITY_LEVELS)[number];
export type PermissionEffect = "allow" | "deny";
export type SubagentPermissionSource =
  | "default"
  | "permission"
  | "legacy-tools"
  | "read-only";

export type SubagentPermissionPolicy = {
  readonly defaultEffect: PermissionEffect;
  readonly rules: Readonly<Record<string, PermissionEffect>>;
};

type SubagentFrontmatter = Readonly<{
  name?: unknown;
  description?: unknown;
  model?: unknown;
  tools?: unknown;
  permission?: unknown;
  permissions?: unknown;
  readOnly?: unknown;
  readonly?: unknown;
  reasoningEffort?: unknown;
  thinkingLevel?: unknown;
  temperature?: unknown;
  textVerbosity?: unknown;
}>;

export type SubagentConfig = {
  readonly name: string;
  readonly description: string;
  readonly model: string | null;
  readonly permissions: SubagentPermissionPolicy | null;
  readonly permissionSource: SubagentPermissionSource;
  readonly readOnly: boolean;
  readonly thinkingLevel: ThinkingLevel;
  readonly temperature: number | null;
  readonly textVerbosity: TextVerbosity | null;
  readonly systemPrompt: string;
  readonly filePath: string;
};

type JsonRecord = Record<string, unknown>;

type SubagentPermissionResolution = {
  readonly policy: SubagentPermissionPolicy | null;
  readonly source: SubagentPermissionSource;
  readonly readOnly: boolean;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeToolName = (value: string): string => value.trim().toLowerCase();

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  value === "off" ||
  value === "minimal" ||
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh";

const isTextVerbosity = (value: string): value is TextVerbosity =>
  value === "low" || value === "medium" || value === "high";

const parseStringList = (value: unknown): readonly string[] => {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const items: string[] = [];
  for (const item of value) {
    if (isNonEmptyString(item)) {
      items.push(item.trim());
    }
  }
  return items;
};

const parsePermissionEffect = (value: unknown): PermissionEffect | null => {
  if (typeof value === "boolean") {
    return value ? "allow" : "deny";
  }

  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "allow" || normalized === "allowed") {
    return "allow";
  }

  if (normalized === "deny" || normalized === "denied") {
    return "deny";
  }

  return null;
};

const parseBooleanFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (!isNonEmptyString(value)) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const parsePermissionPolicy = (value: unknown): SubagentPermissionPolicy | null => {
  if (!isRecord(value)) {
    return null;
  }

  let hasAnyValidRule = false;
  let defaultEffect: PermissionEffect = "allow";
  const rules: Record<string, PermissionEffect> = {};

  for (const [rawToolName, rawEffect] of Object.entries(value)) {
    if (!isNonEmptyString(rawToolName)) {
      continue;
    }

    const effect = parsePermissionEffect(rawEffect);
    if (effect === null) {
      continue;
    }

    hasAnyValidRule = true;
    const toolName = normalizeToolName(rawToolName);
    if (toolName === "*") {
      defaultEffect = effect;
    } else {
      rules[toolName] = effect;
    }
  }

  if (!hasAnyValidRule) {
    return null;
  }

  return {
    defaultEffect,
    rules,
  };
};

const parseLegacyToolsPolicy = (value: unknown): SubagentPermissionPolicy | null => {
  const toolNames = parseStringList(value).map(normalizeToolName);
  if (toolNames.length === 0) {
    return null;
  }

  const rules: Record<string, PermissionEffect> = {};
  for (const toolName of toolNames) {
    if (toolName.length === 0) {
      continue;
    }
    rules[toolName] = "allow";
  }

  if (Object.keys(rules).length === 0) {
    return null;
  }

  return {
    defaultEffect: "deny",
    rules,
  };
};

const resolvePermissionPolicy = (
  frontmatter: SubagentFrontmatter,
): SubagentPermissionResolution => {
  const explicitPermission = parsePermissionPolicy(
    frontmatter.permission ?? frontmatter.permissions,
  );
  if (explicitPermission !== null) {
    return {
      policy: explicitPermission,
      source: "permission",
      readOnly: false,
    };
  }

  const readOnly = parseBooleanFlag(frontmatter.readOnly ?? frontmatter.readonly);
  if (readOnly) {
    return {
      policy: null,
      source: "read-only",
      readOnly: true,
    };
  }

  const legacyToolsPolicy = parseLegacyToolsPolicy(frontmatter.tools);
  if (legacyToolsPolicy !== null) {
    return {
      policy: legacyToolsPolicy,
      source: "legacy-tools",
      readOnly: false,
    };
  }

  return {
    policy: null,
    source: "default",
    readOnly: false,
  };
};

const parseThinkingLevel = (value: unknown): ThinkingLevel => {
  if (!isNonEmptyString(value)) {
    return DEFAULT_THINKING_LEVEL;
  }

  const normalizedValue = value.trim().toLowerCase();
  return isThinkingLevel(normalizedValue)
    ? normalizedValue
    : DEFAULT_THINKING_LEVEL;
};

const parseTemperature = (value: unknown): number | null => {
  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 2) {
    return null;
  }

  return parsedValue;
};

const parseTextVerbosity = (value: unknown): TextVerbosity | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();
  return isTextVerbosity(normalizedValue) ? normalizedValue : null;
};

const parseName = (value: unknown, filePath: string): string => {
  if (isNonEmptyString(value)) {
    return value.trim();
  }

  return basename(filePath, ".md");
};

const parseDescription = (value: unknown, name: string): string => {
  if (isNonEmptyString(value)) {
    return value.trim();
  }

  return `Subagent ${name}.`;
};

const buildSystemPrompt = (
  promptBody: string,
  textVerbosity: TextVerbosity | null,
): string | null => {
  const trimmedPrompt = promptBody.trim();
  if (trimmedPrompt.length === 0) {
    return null;
  }

  if (textVerbosity === null) {
    return trimmedPrompt;
  }

  return `${trimmedPrompt}\n\nPreferred response verbosity: ${textVerbosity}.`;
};

const loadSubagentFile = async (filePath: string): Promise<SubagentConfig | null> => {
  let rawConfig: string;
  try {
    rawConfig = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter<SubagentFrontmatter>(rawConfig);
  const name = parseName(frontmatter.name, filePath);
  const textVerbosity = parseTextVerbosity(frontmatter.textVerbosity);
  const systemPrompt = buildSystemPrompt(body, textVerbosity);
  if (systemPrompt === null) {
    return null;
  }

  const permissionResolution = resolvePermissionPolicy(frontmatter);

  return {
    name,
    description: parseDescription(frontmatter.description, name),
    model: isNonEmptyString(frontmatter.model)
      ? frontmatter.model.trim()
      : null,
    permissions: permissionResolution.policy,
    permissionSource: permissionResolution.source,
    readOnly: permissionResolution.readOnly,
    thinkingLevel: parseThinkingLevel(
      frontmatter.reasoningEffort ?? frontmatter.thinkingLevel,
    ),
    temperature: parseTemperature(frontmatter.temperature),
    textVerbosity,
    systemPrompt,
    filePath,
  };
};

export const loadSubagents = async (): Promise<readonly SubagentConfig[]> => {
  let entries: readonly string[];
  try {
    entries = await readdir(SUBAGENT_DIR);
  } catch {
    return [];
  }

  const filePaths = entries
    .filter((entry) => entry.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => join(SUBAGENT_DIR, entry));

  const subagents = await Promise.all(filePaths.map(loadSubagentFile));
  const configs = subagents.filter(
    (subagent): subagent is SubagentConfig => subagent !== null,
  );

  const deduped = new Map<string, SubagentConfig>();
  for (const config of configs) {
    deduped.set(config.name.toLowerCase(), config);
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

export const findSubagentByName = async (
  name: string,
): Promise<SubagentConfig | null> => {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName.length === 0) {
    return null;
  }

  const subagents = await loadSubagents();
  return (
    subagents.find((subagent) => subagent.name.toLowerCase() === normalizedName) ??
    null
  );
};

const formatAgentSetting = (label: string, value: string | number | null): string =>
  value === null ? "" : `, ${label}: ${value}`;

const permissionSourceLabel = (source: SubagentPermissionSource): string => {
  switch (source) {
    case "permission":
      return "custom-permissions";
    case "legacy-tools":
      return "legacy-tools";
    case "read-only":
      return "read-only";
    case "default":
      return "default";
  }
};

export const buildAvailableSubagentsPrompt = (
  subagents: readonly SubagentConfig[],
): string | null => {
  if (subagents.length === 0) {
    return null;
  }

  const lines = subagents.map(
    (subagent) =>
      `- ${subagent.name}: ${subagent.description} [model: ${subagent.model ?? "session"}, thinking: ${subagent.thinkingLevel}${formatAgentSetting("temperature", subagent.temperature)}${formatAgentSetting("verbosity", subagent.textVerbosity)}, permissions: ${permissionSourceLabel(subagent.permissionSource)}]`,
  );

  return [
    "Available subagents:",
    ...lines,
    "Use the consult_subagent tool when a task would benefit from a deeper, isolated analysis or implementation pass.",
  ].join("\n");
};

export const listSubagentNames = (
  subagents: readonly SubagentConfig[],
): string =>
  subagents.length === 0
    ? "none"
    : subagents.map((subagent) => subagent.name).join(", ");
