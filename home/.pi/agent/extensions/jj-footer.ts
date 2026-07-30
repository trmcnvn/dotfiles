import type { Usage } from "@earendil-works/pi-ai";
import { SettingsManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JjState =
	| { kind: "loading" }
	| { kind: "none" }
	| { kind: "found"; uniquePrefix: string; rest: string };

type JjReadResult = JjState | { kind: "unavailable" };

const JJ_ID_PATTERN = /^[k-z]+$/;
const JJ_ID_TEMPLATE = 'change_id.shortest(12).prefix() ++ "\\0" ++ change_id.shortest(12).rest()';

const formatTokens = (count: number): string => {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
};

const sanitizeStatusText = (text: string): string =>
	text
		.replace(/⏸[\uFE0E\uFE0F]?/gu, "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();

const formatCwd = (cwd: string): string => {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;

	const relativeToHome = relative(resolve(home), resolve(cwd));
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;

	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
};

const readJjChangeId = async (cwd: string): Promise<JjReadResult> => {
	try {
		const { stdout } = await execFileAsync(
			"jj",
			["log", "--ignore-working-copy", "--no-graph", "--color=never", "-r", "@", "-T", JJ_ID_TEMPLATE],
			{ cwd, timeout: 1000 },
		);
		const [uniquePrefix, rest, extra] = stdout.trim().split("\0");
		if (
			!uniquePrefix ||
			rest === undefined ||
			extra !== undefined ||
			uniquePrefix.length + rest.length < 12 ||
			!JJ_ID_PATTERN.test(uniquePrefix) ||
			(rest.length > 0 && !JJ_ID_PATTERN.test(rest))
		) {
			return { kind: "unavailable" };
		}
		return { kind: "found", uniquePrefix, rest };
	} catch (error: unknown) {
		if (
			typeof error === "object" &&
			error !== null &&
			"stderr" in error &&
			typeof error.stderr === "string" &&
			error.stderr.includes("There is no jj repo")
		) {
			return { kind: "none" };
		}
		return { kind: "unavailable" };
	}
};

function installJjFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	let jjState: JjState = { kind: "loading" };
	let refreshInFlight = false;
	let disposed = false;
	let requestRender: (() => void) | undefined;
	const settingsManager = SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
	let autoCompactEnabled = settingsManager.getCompactionEnabled();

	const refresh = (): void => {
		if (refreshInFlight || disposed) return;
		refreshInFlight = true;
		void Promise.allSettled([readJjChangeId(ctx.cwd), settingsManager.reload()]).then(([jjResult, settingsResult]) => {
			refreshInFlight = false;
			if (disposed) return;
			if (jjResult.status === "fulfilled" && jjResult.value.kind !== "unavailable") jjState = jjResult.value;
			if (settingsResult.status === "fulfilled") autoCompactEnabled = settingsManager.getCompactionEnabled();
			requestRender?.();
		});
	};

	ctx.ui.setFooter((tui, theme, footerData) => {
		requestRender = () => tui.requestRender();
		const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
		const interval = setInterval(refresh, 3000);
		refresh();

		return {
			dispose() {
				disposed = true;
				clearInterval(interval);
				unsubscribeBranch();
			},
			invalidate() {},
			render(width: number): string[] {
				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;
				let latestCacheHitRate: number | undefined;
				const addUsage = (usage: Usage): void => {
					totalInput += usage.input;
					totalOutput += usage.output;
					totalCacheRead += usage.cacheRead;
					totalCacheWrite += usage.cacheWrite;
					totalCost += usage.cost.total;
				};

				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						addUsage(entry.message.usage);
						const latestPromptTokens =
							entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
						latestCacheHitRate =
							latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
					} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
						addUsage(entry.message.usage);
					} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
						addUsage(entry.usage);
					}
				}

				let pwd = theme.fg("dim", formatCwd(ctx.sessionManager.getCwd()));
				const gitBranch = footerData.getGitBranch();
				if (jjState.kind === "found") {
					pwd +=
						theme.fg("dim", " (jj:") +
						theme.fg("accent", jjState.uniquePrefix) +
						theme.fg("dim", `${jjState.rest})`);
				} else if (gitBranch) {
					pwd += theme.fg("dim", ` (git:${gitBranch})`);
				}

				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) pwd += theme.fg("dim", ` • ${sessionName}`);

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
				if ((totalCacheRead > 0 || totalCacheWrite > 0) && latestCacheHitRate !== undefined) {
					statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
				}

				const usingSubscription = ctx.model
					? ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model)
					: false;
				if (totalCost || usingSubscription) {
					statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
				}

				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercentValue = contextUsage?.percent ?? 0;
				const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
				const autoIndicator = autoCompactEnabled ? " (auto)" : "";
				const contextDisplay =
					contextPercent === "?"
						? `?/${formatTokens(contextWindow)}${autoIndicator}`
						: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
				if (contextPercentValue > 90) statsParts.push(theme.fg("error", contextDisplay));
				else if (contextPercentValue > 70) statsParts.push(theme.fg("warning", contextDisplay));
				else statsParts.push(contextDisplay);
				if (process.env.PI_EXPERIMENTAL === "1") {
					statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
				}

				let statsLeft = statsParts.join(" ");
				let statsLeftWidth = visibleWidth(statsLeft);
				if (statsLeftWidth > width) {
					statsLeft = truncateToWidth(statsLeft, width, "...");
					statsLeftWidth = visibleWidth(statsLeft);
				}

				const modelName = ctx.model?.id ?? "no-model";
				let rightSideWithoutProvider = modelName;
				if (ctx.model?.reasoning) {
					const thinkingLevel = pi.getThinkingLevel() || "off";
					rightSideWithoutProvider =
						thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
				}

				let rightSide = rightSideWithoutProvider;
				if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
					rightSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
					if (statsLeftWidth + 2 + visibleWidth(rightSide) > width) rightSide = rightSideWithoutProvider;
				}

				const rightSideWidth = visibleWidth(rightSide);
				let statsLine: string;
				if (statsLeftWidth + 2 + rightSideWidth <= width) {
					statsLine = statsLeft + " ".repeat(width - statsLeftWidth - rightSideWidth) + rightSide;
				} else {
					const availableForRight = width - statsLeftWidth - 2;
					if (availableForRight > 0) {
						const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
						statsLine =
							statsLeft + " ".repeat(Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight))) + truncatedRight;
					} else {
						statsLine = statsLeft;
					}
				}

				const lines = [
					truncateToWidth(pwd, width, theme.fg("dim", "...")),
					theme.fg("dim", statsLeft) + theme.fg("dim", statsLine.slice(statsLeft.length)),
				];

				const statuses = [...footerData.getExtensionStatuses().entries()]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([, text]) => sanitizeStatusText(text));
				if (statuses.length > 0) lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));

				return lines;
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installJjFooter(pi, ctx);
	});
}
