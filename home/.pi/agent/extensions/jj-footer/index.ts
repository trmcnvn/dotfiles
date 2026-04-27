import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type JjState =
	| { kind: "loading" }
	| { kind: "none" }
	| { kind: "found"; changeId: string };

const formatTokens = (count: number): string => {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
};

const sanitizeStatusText = (text: string): string => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();

const formatCwd = (cwd: string): string => {
	const home = process.env.HOME || process.env.USERPROFILE;
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
};

const readJjChangeId = async (cwd: string): Promise<JjState> => {
	try {
		const { stdout } = await execFileAsync("jj", ["log", "--no-graph", "-r", "@", "-T", "change_id.shortest()"], {
			cwd,
			timeout: 1000,
		});
		const changeId = stdout.trim();
		return changeId ? { kind: "found", changeId } : { kind: "none" };
	} catch {
		return { kind: "none" };
	}
};

function installJjFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	let jjState: JjState = { kind: "loading" };
	let refreshInFlight = false;
	let disposed = false;
	let requestRender: (() => void) | undefined;

	const refresh = (): void => {
		if (refreshInFlight || disposed) return;
		refreshInFlight = true;
		void readJjChangeId(ctx.cwd).then((next) => {
			refreshInFlight = false;
			if (disposed) return;
			jjState = next;
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

				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const message = entry.message as AssistantMessage;
						totalInput += message.usage.input;
						totalOutput += message.usage.output;
						totalCacheRead += message.usage.cacheRead;
						totalCacheWrite += message.usage.cacheWrite;
						totalCost += message.usage.cost.total;
					}
				}

				let pwd = formatCwd(ctx.sessionManager.getCwd());
				const gitBranch = footerData.getGitBranch();
				const branch = jjState.kind === "found" ? `jj:${jjState.changeId}` : gitBranch ? `git:${gitBranch}` : undefined;
				if (branch) pwd = `${pwd} (${branch})`;

				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) pwd = `${pwd} • ${sessionName}`;

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

				const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
				if (totalCost || usingSubscription) {
					statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
				}

				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercentValue = contextUsage?.percent ?? 0;
				const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";
				const contextDisplay =
					contextPercent === "?" ? `?/${formatTokens(contextWindow)}` : `${contextPercent}%/${formatTokens(contextWindow)}`;
				if (contextPercentValue > 90) statsParts.push(theme.fg("error", contextDisplay));
				else if (contextPercentValue > 70) statsParts.push(theme.fg("warning", contextDisplay));
				else statsParts.push(contextDisplay);

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
				const statsLine =
					statsLeftWidth + 2 + rightSideWidth <= width
						? statsLeft + " ".repeat(width - statsLeftWidth - rightSideWidth) + rightSide
						: statsLeft + "  " + truncateToWidth(rightSide, Math.max(0, width - statsLeftWidth - 2), "");

				const lines = [
					truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
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
