import { spawnSync } from "node:child_process";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PROMPT_CHAR = "π";
const PROMPT_SPACE = " ";
const CONTINUATION_PREFIX = "  ";
const MIN_RENDER_WIDTH = 12;

const COLOR_PWD = "#89b4fa";
const COLOR_JJ = "#b4befe";
const COLOR_MODEL = "#cba6f7";
const COLOR_MUTED = "#7f849c";
const COLOR_PROMPT_OK = "#a6e3a1";
const COLOR_THINKING_OFF = "#585b70";
const COLOR_THINKING_MINIMAL = "#6c7086";
const COLOR_THINKING_LOW = "#89b4fa";
const COLOR_THINKING_MEDIUM = "#74c7ec";
const COLOR_THINKING_HIGH = "#cba6f7";
const COLOR_THINKING_XHIGH = "#f38ba8";

const ANSI_RESET = "\x1b[0m";
const TERMINAL_FOCUS_REPORTING_ENABLE = "\x1b[?1004h";
const TERMINAL_FOCUS_REPORTING_DISABLE = "\x1b[?1004l";
const TERMINAL_FOCUS_IN = "\x1b[I";
const TERMINAL_FOCUS_OUT = "\x1b[O";

type ModelRef = {
  readonly provider: string;
  readonly id: string;
};

type Rgb = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
};

const formatModel = (model: ModelRef | undefined): string => {
  if (!model) {
    return "no-model";
  }

  return `${model.provider}/${model.id}`;
};

const findJjRepoRoot = (cwd: string): string | null => {
  let current = cwd;

  for (;;) {
    if (existsSync(join(current, ".jj"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
};

const replaceHomeWithTilde = (cwd: string): string => {
  const home = process.env.HOME?.trim();
  if (!home || home.length === 0) {
    return cwd;
  }

  if (cwd === home) {
    return "~";
  }

  if (cwd.startsWith(`${home}/`)) {
    return `~/${cwd.slice(home.length + 1)}`;
  }

  return cwd;
};

const contractPwd = (cwd: string): string => {
  const displayPath = replaceHomeWithTilde(cwd);
  const jjRoot = findJjRepoRoot(cwd);
  const jjBase = jjRoot ? basename(jjRoot) : "";

  const parts = displayPath.split("/");
  const lastIndex = parts.length - 1;

  return parts
    .map((part, index) => {
      if (part.length === 0) {
        return part;
      }

      const isLast = index === lastIndex;
      const isJjRoot = jjBase.length > 0 && part === jjBase;

      if (isLast || isJjRoot || part === "~") {
        return part;
      }

      if (part.startsWith(".")) {
        return part.slice(0, Math.min(2, part.length));
      }

      return part.slice(0, 1);
    })
    .join("/");
};

type JjBookmark = {
  readonly name: string;
  readonly distance: number;
};

type JjPromptRecord = {
  readonly changeId: string;
  readonly changeIdPrefixLen: number;
  readonly closestBookmark: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseBookmarks = (value: unknown): readonly JjBookmark[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const bookmarks: JjBookmark[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const nameValue = item.name;
    const distanceValue = item.distance;

    if (typeof nameValue !== "string") {
      continue;
    }

    if (typeof distanceValue !== "number" || !Number.isFinite(distanceValue)) {
      continue;
    }

    const name = nameValue.trim();
    if (name.length === 0) {
      continue;
    }

    bookmarks.push({ name, distance: distanceValue });
  }

  return bookmarks;
};

const getClosestBookmarkName = (bookmarks: readonly JjBookmark[]): string | null => {
  let closest: JjBookmark | null = null;

  for (const bookmark of bookmarks) {
    if (closest === null || bookmark.distance < closest.distance) {
      closest = bookmark;
    }
  }

  if (!closest) {
    return null;
  }

  return closest.name;
};

const parseJjPromptRecord = (stdout: string): JjPromptRecord | null => {
  const raw = stdout.trim();
  if (raw.length === 0) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const changeIdValue = parsed.change_id;
  if (typeof changeIdValue !== "string") {
    return null;
  }

  const changeId = changeIdValue.trim();
  if (changeId.length === 0) {
    return null;
  }

  const prefixLenValue = parsed.change_id_prefix_len;
  const changeIdPrefixLen =
    typeof prefixLenValue === "number" && Number.isInteger(prefixLenValue) && prefixLenValue >= 0
      ? prefixLenValue
      : 0;

  const bookmarks = parseBookmarks(parsed.bookmarks);
  const closestBookmark = getClosestBookmarkName(bookmarks);

  return { changeId, changeIdPrefixLen, closestBookmark };
};

const JJ_PROMPT_COMMAND = "jj-prompt | to json -r";

const formatJjPrompt = (record: JjPromptRecord): string => {
  const prefixLength = Math.max(1, Math.min(record.changeIdPrefixLen, record.changeId.length));
  const changePrefix = record.changeId.slice(0, prefixLength);
  const changeRest = record.changeId.slice(prefixLength);

  const restText = changeRest.length > 0 ? colorize(COLOR_JJ, changeRest, { dim: true }) : "";
  const changeId = `${colorize(COLOR_JJ, changePrefix)}${restText}`;

  if (!record.closestBookmark) {
    return changeId;
  }

  return `${changeId} ${colorize(COLOR_JJ, record.closestBookmark)}`;
};

const readJjPrompt = (cwd: string): string => {
  const result = spawnSync("nu", ["-c", JJ_PROMPT_COMMAND], {
    cwd,
    encoding: "utf8",
    timeout: 750,
    env: process.env,
  });

  if (result.error || result.status !== 0) {
    return "";
  }

  const parsed = parseJjPromptRecord(result.stdout);
  if (!parsed) {
    return "";
  }

  return formatJjPrompt(parsed);
};

const parseHexColor = (value: string): Rgb => {
  const normalized = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return { r: 255, g: 255, b: 255 };
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  return { r, g, b };
};

const colorize = (hex: string, text: string, options?: { readonly dim?: boolean }): string => {
  const rgb = parseHexColor(hex);
  const dim = options?.dim === true ? "\x1b[2m" : "";
  return `${dim}\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}${ANSI_RESET}`;
};

class PromptFlairEditor extends CustomEditor {
  private infoProvider: () => string = () => "";
  private rightInfoProvider: () => string = () => "";
  private promptPrefixProvider: () => string = () => `${PROMPT_CHAR}${PROMPT_SPACE}`;
  private terminalIsActive = true;

  setInfoProvider(infoProvider: () => string): void {
    this.infoProvider = infoProvider;
  }

  setRightInfoProvider(rightInfoProvider: () => string): void {
    this.rightInfoProvider = rightInfoProvider;
  }

  setPromptPrefixProvider(promptPrefixProvider: () => string): void {
    this.promptPrefixProvider = promptPrefixProvider;
  }

  private setTerminalActive(nextActive: boolean): void {
    if (this.terminalIsActive === nextActive) {
      return;
    }

    this.terminalIsActive = nextActive;
    this.tui.requestRender();
  }

  private shouldRenderCursor(): boolean {
    return this.focused && this.terminalIsActive;
  }

  private stripCursorFromLine(line: string): string {
    return line
      .replace(/\x1b\[7m([\s\S]*?)\x1b\[(?:0|27)m/g, "$1")
      .replaceAll(CURSOR_MARKER, "");
  }

  private normalizeCursorVisibility(lines: readonly string[]): string[] {
    if (this.shouldRenderCursor()) {
      return [...lines];
    }

    return lines.map((line) => this.stripCursorFromLine(line));
  }

  private composeInfoLine(width: number): string {
    const left = this.infoProvider();
    const right = this.rightInfoProvider();

    if (right.length === 0) {
      return this.fitLine(left.length > 0 ? left : colorize(COLOR_PWD, "ready"), width);
    }

    const rightWidth = visibleWidth(right);
    if (rightWidth >= width) {
      return this.fitLine(right, width);
    }

    const maxLeftWidth = Math.max(0, width - rightWidth - 1);
    const leftBase = left.length > 0 ? left : colorize(COLOR_PWD, "ready");
    const leftClipped = truncateToWidth(leftBase, maxLeftWidth, "");
    const gap = " ".repeat(Math.max(1, width - visibleWidth(leftClipped) - rightWidth));

    return this.fitLine(`${leftClipped}${gap}${right}`, width);
  }

  private isSimpleBorderLine(line: string): boolean {
    const withoutAnsi = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    const compact = withoutAnsi.replace(/\s/g, "");

    return compact.length > 0 && /^[-─]+$/.test(compact);
  }

  private removeDefaultHorizontalBorders(lines: readonly string[]): string[] {
    if (lines.length < 3) {
      return [...lines];
    }

    const startIndex = this.isSimpleBorderLine(lines[0] ?? "") ? 1 : 0;

    let bottomBorderIndex = -1;
    for (let index = lines.length - 1; index >= startIndex; index -= 1) {
      if (this.isSimpleBorderLine(lines[index] ?? "")) {
        bottomBorderIndex = index;
        break;
      }
    }

    if (bottomBorderIndex === -1) {
      return lines.slice(startIndex);
    }

    return [...lines.slice(startIndex, bottomBorderIndex), ...lines.slice(bottomBorderIndex + 1)];
  }

  private fitLine(line: string, width: number): string {
    const clipped = truncateToWidth(line, width, "");
    const padding = Math.max(0, width - visibleWidth(clipped));
    return `${clipped}${" ".repeat(padding)}`;
  }

  override handleInput(data: string): void {
    if (data === TERMINAL_FOCUS_IN) {
      this.setTerminalActive(true);
      return;
    }

    if (data === TERMINAL_FOCUS_OUT) {
      this.setTerminalActive(false);
      return;
    }

    super.handleInput(data);
  }

  override render(width: number): string[] {
    if (width < MIN_RENDER_WIDTH) {
      const lines = super.render(width);
      return this.normalizeCursorVisibility(lines);
    }

    const firstLinePrefix = this.promptPrefixProvider();
    const prefixWidth = Math.max(visibleWidth(firstLinePrefix), visibleWidth(CONTINUATION_PREFIX));

    const baseEditorWidth = Math.max(1, width - prefixWidth);
    const baseLines = super.render(baseEditorWidth);
    const bodyLines = this.removeDefaultHorizontalBorders(baseLines);
    const normalizedBodyLines = this.normalizeCursorVisibility(bodyLines);

    const prefixedLines = normalizedBodyLines.map((line, index) => {
      const prefix = index === 0 ? firstLinePrefix : CONTINUATION_PREFIX;
      return `${prefix}${line}`;
    });

    const divider = colorize(COLOR_MUTED, "─".repeat(width), { dim: true });

    return [
      divider,
      this.composeInfoLine(width),
      ...prefixedLines.map((line) => this.fitLine(line, width)),
      divider,
    ];
  }
}

const applyPromptFlair = (
  ctx: ExtensionContext,
  infoProvider: () => string,
  rightInfoProvider: () => string,
  promptPrefixProvider: () => string,
): void => {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.setEditorComponent((tui, theme, keybindings) => {
    const editor = new PromptFlairEditor(tui, theme, keybindings);
    editor.setInfoProvider(infoProvider);
    editor.setRightInfoProvider(rightInfoProvider);
    editor.setPromptPrefixProvider(promptPrefixProvider);
    return editor;
  });
};

type PromptMetrics = {
  readonly input: number;
  readonly output: number;
  readonly cost: number;
};

const formatCompactNumber = (value: number): string => {
  if (value < 1000) {
    return `${value}`;
  }

  if (value < 1_000_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return `${(value / 1_000_000).toFixed(1)}m`;
};

const readPromptMetrics = (ctx: ExtensionContext): PromptMetrics => {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") {
      continue;
    }

    const message = entry.message;
    if (message.role !== "assistant") {
      continue;
    }

    input += message.usage.input;
    output += message.usage.output;
    cost += message.usage.cost.total;
  }

  return { input, output, cost };
};

const hideFooter = (ctx: ExtensionContext): void => {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.setFooter(() => ({
    invalidate() {},
    render(): string[] {
      return [];
    },
  }));
};

const setTerminalFocusReporting = (enabled: boolean): void => {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write(enabled ? TERMINAL_FOCUS_REPORTING_ENABLE : TERMINAL_FOCUS_REPORTING_DISABLE);
};

export default function promptFlairExtension(pi: ExtensionAPI) {
  let cwdLabel = "";
  let jjLabel = "";
  let modelLabel = "no-model";
  let focusReportingEnabled = false;

  const separator = colorize(COLOR_MUTED, " / ", { dim: true });
  const metricsSeparator = colorize(COLOR_MUTED, " · ", { dim: true });

  const formatModelInfo = (value: string): string => {
    const separatorIndex = value.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex >= value.length - 1) {
      return colorize(COLOR_MUTED, value);
    }

    const provider = value.slice(0, separatorIndex);
    const model = value.slice(separatorIndex + 1);

    return `${colorize(COLOR_MUTED, provider)} ${colorize(COLOR_MODEL, model)}`;
  };

  const getThinkingLevelColor = (thinkingLevel: string): string => {
    switch (thinkingLevel) {
      case "off":
        return COLOR_THINKING_OFF;
      case "minimal":
        return COLOR_THINKING_MINIMAL;
      case "low":
        return COLOR_THINKING_LOW;
      case "medium":
        return COLOR_THINKING_MEDIUM;
      case "high":
        return COLOR_THINKING_HIGH;
      case "xhigh":
        return COLOR_THINKING_XHIGH;
      default:
        return COLOR_MUTED;
    }
  };

  const formatThinkingInfo = (): string => {
    const thinkingLevel = pi.getThinkingLevel();
    return `${colorize(COLOR_MUTED, "thinking")} ${colorize(getThinkingLevelColor(thinkingLevel), thinkingLevel)}`;
  };

  const getInfo = () => {
    const locationInfo =
      jjLabel.length > 0 ? `${colorize(COLOR_PWD, cwdLabel)} ${jjLabel}` : colorize(COLOR_PWD, cwdLabel);

    const parts: string[] = [locationInfo, formatModelInfo(modelLabel), formatThinkingInfo()];

    return parts.join(separator);
  };

  const getRightInfo = (ctx: ExtensionContext): string => {
    const metrics = readPromptMetrics(ctx);
    const usage = ctx.getContextUsage();

    const parts: string[] = [
      colorize(COLOR_MUTED, `↑${formatCompactNumber(metrics.input)} ↓${formatCompactNumber(metrics.output)}`),
      colorize(COLOR_MUTED, `$${metrics.cost.toFixed(3)}`),
    ];

    if (usage && usage.percent !== null) {
      parts.push(colorize(COLOR_MUTED, `ctx ${usage.percent.toFixed(1)}%`));
    }

    return parts.join(metricsSeparator);
  };

  const getPromptPrefix = () =>
    `${colorize(COLOR_PROMPT_OK, PROMPT_CHAR)}${PROMPT_SPACE}`;

  const refreshMetadata = (ctx: ExtensionContext): void => {
    cwdLabel = contractPwd(ctx.cwd);
    jjLabel = readJjPrompt(ctx.cwd);
    modelLabel = formatModel(ctx.model);
  };

  const initializeSessionUi = (ctx: ExtensionContext): void => {
    refreshMetadata(ctx);

    if (ctx.hasUI && !focusReportingEnabled) {
      setTerminalFocusReporting(true);
      focusReportingEnabled = true;
    }

    applyPromptFlair(ctx, getInfo, () => getRightInfo(ctx), getPromptPrefix);
    hideFooter(ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    initializeSessionUi(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    initializeSessionUi(ctx);
  });

  pi.on("session_shutdown", () => {
    if (!focusReportingEnabled) {
      return;
    }

    setTerminalFocusReporting(false);
    focusReportingEnabled = false;
  });

  pi.on("model_select", (event) => {
    modelLabel = formatModel(event.model);
  });

  pi.on("turn_end", (_event, ctx) => {
    jjLabel = readJjPrompt(ctx.cwd);
  });
}
