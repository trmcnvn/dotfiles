import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerMcpExtension from "../mcp/index.js";
import { registerCodesearchTool } from "../codesearch/shared.js";
import { registerWebfetchTool } from "../webfetch/shared.js";
import { registerWebsearchTool } from "../websearch/shared.js";
import { registerTruncatedBuiltinsOverflowHandler } from "../truncated-builtins.js";

const TEMPERATURE_ENV = "PI_SUBAGENT_TEMPERATURE";
const LEGACY_TOOLS_ENV = "PI_SUBAGENT_TOOLS";
const PERMISSIONS_ENV = "PI_SUBAGENT_PERMISSION";
const READ_ONLY_ENV = "PI_SUBAGENT_READ_ONLY";

type JsonRecord = Record<string, unknown>;
type PermissionEffect = "allow" | "deny";

type ToolPermissionPolicy = {
  readonly defaultEffect: PermissionEffect;
  readonly rules: Readonly<Record<string, PermissionEffect>>;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeToolName = (value: string): string => value.trim().toLowerCase();

const READ_ONLY_BLOCKED_TOOLS = new Set(["bash", "edit", "write"]);

const parseTemperature = (): number | null => {
  const rawValue = process.env[TEMPERATURE_ENV];
  if (typeof rawValue !== "string") {
    return null;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 2) {
    return null;
  }

  return parsedValue;
};

const parsePermissionEffect = (value: unknown): PermissionEffect | null => {
  if (typeof value === "boolean") {
    return value ? "allow" : "deny";
  }

  if (typeof value !== "string") {
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

const parsePermissionPolicy = (): ToolPermissionPolicy | null => {
  const rawValue = process.env[PERMISSIONS_ENV];
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return null;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (!isRecord(parsedValue)) {
    return null;
  }

  let defaultEffect: PermissionEffect = "allow";
  const explicitDefault = parsePermissionEffect(parsedValue.defaultEffect);
  if (explicitDefault !== null) {
    defaultEffect = explicitDefault;
  }

  const rules: Record<string, PermissionEffect> = {};
  if (!isRecord(parsedValue.rules)) {
    return {
      defaultEffect,
      rules,
    };
  }

  for (const [rawToolName, rawEffect] of Object.entries(parsedValue.rules)) {
    const effect = parsePermissionEffect(rawEffect);
    if (effect === null) {
      continue;
    }

    const toolName = normalizeToolName(rawToolName);
    if (toolName.length === 0) {
      continue;
    }

    if (toolName === "*") {
      defaultEffect = effect;
    } else {
      rules[toolName] = effect;
    }
  }

  return {
    defaultEffect,
    rules,
  };
};

const parseLegacyRequestedTools = (): readonly string[] | null => {
  const rawValue = process.env[LEGACY_TOOLS_ENV];
  if (typeof rawValue !== "string") {
    return null;
  }

  const tools = rawValue
    .split(",")
    .map((tool) => normalizeToolName(tool))
    .filter((tool) => tool.length > 0);

  if (tools.length === 0) {
    return null;
  }

  return Array.from(new Set(tools));
};

const parseReadOnlyMode = (): boolean => {
  const rawValue = process.env[READ_ONLY_ENV];
  if (typeof rawValue !== "string") {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const isSameToolList = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

const isToolAllowed = (
  toolName: string,
  policy: ToolPermissionPolicy,
): boolean => {
  const normalizedToolName = normalizeToolName(toolName);
  const effect = policy.rules[normalizedToolName] ?? policy.defaultEffect;
  return effect === "allow";
};

const isReadOnlyAllowedTool = (toolName: string): boolean =>
  !READ_ONLY_BLOCKED_TOOLS.has(normalizeToolName(toolName));

const applyRequestedTools = (
  pi: ExtensionAPI,
  policy: ToolPermissionPolicy | null,
  legacyTools: readonly string[] | null,
  readOnlyMode: boolean,
): void => {
  if (policy === null && legacyTools === null && !readOnlyMode) {
    return;
  }

  const activeTools = pi.getActiveTools();
  if (activeTools.length === 0) {
    return;
  }

  let selectedTools: readonly string[];
  if (readOnlyMode) {
    selectedTools = activeTools.filter((toolName) => isReadOnlyAllowedTool(toolName));
  } else if (policy !== null) {
    selectedTools = activeTools.filter((toolName) => isToolAllowed(toolName, policy));
  } else {
    const requestedToolSet = new Set(legacyTools ?? []);
    selectedTools = activeTools.filter((toolName) =>
      requestedToolSet.has(normalizeToolName(toolName))
    );
  }

  if (isSameToolList(activeTools, selectedTools)) {
    return;
  }

  pi.setActiveTools([...selectedTools]);
};

export default function subagentsRuntimeExtension(pi: ExtensionAPI) {
  registerWebfetchTool(pi);
  registerWebsearchTool(pi);
  registerCodesearchTool(pi);
  registerMcpExtension(pi);
  registerTruncatedBuiltinsOverflowHandler(pi);

  const temperature = parseTemperature();
  const permissionPolicy = parsePermissionPolicy();
  const legacyRequestedTools = parseLegacyRequestedTools();
  const readOnlyMode = parseReadOnlyMode();

  pi.on("session_start", () => {
    applyRequestedTools(pi, permissionPolicy, legacyRequestedTools, readOnlyMode);
  });

  pi.on("before_provider_request", (event) => {
    applyRequestedTools(pi, permissionPolicy, legacyRequestedTools, readOnlyMode);

    if (temperature === null || !isRecord(event.payload)) {
      return undefined;
    }

    return {
      ...event.payload,
      temperature,
    };
  });
}
