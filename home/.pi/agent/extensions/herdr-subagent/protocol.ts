const AGENT_STATUSES = ["idle", "working", "blocked", "done", "unknown"] as const;

/** Herdr lifecycle states reported for a recognized agent. */
export type HerdrAgentStatus = (typeof AGENT_STATUSES)[number];

/** A parsed result or a safe explanation of why boundary parsing failed. */
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** Geometry of a Herdr pane in terminal cells. */
export interface PaneRect {
	readonly width: number;
	readonly height: number;
}

/** Identifiers returned when Herdr creates a background tab. */
export interface CreatedTab {
	readonly tabId: string;
	readonly paneId: string;
}

/** Foreground process information used to determine whether a pane is reusable. */
export interface PaneProcessInfo {
	readonly shellPid: number;
	readonly foregroundPids: readonly number[];
}

/** Durable result emitted by a delegated Pi child. */
export interface ChildResult {
	readonly version: 1;
	readonly status: "completed" | "failed";
	readonly output: string;
	readonly error?: string;
	readonly stopReason?: string;
	readonly sessionFile?: string;
	readonly provider?: string;
	readonly model?: string;
	readonly thinking?: string;
	readonly finishedAt: number;
}

function success<T>(value: T): ParseResult<T> {
	return { ok: true, value };
}

function failure<T>(error: string): ParseResult<T> {
	return { ok: false, error };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): ParseResult<unknown> {
	try {
		return success(JSON.parse(value));
	} catch {
		return failure("response was not valid JSON");
	}
}

function resultRecord(value: string): ParseResult<Record<PropertyKey, unknown>> {
	const decoded = parseJson(value);
	if (!decoded.ok) return decoded;
	if (!isRecord(decoded.value) || !isRecord(decoded.value.result)) {
		return failure("response did not contain a result object");
	}
	return success(decoded.value.result);
}

function optionalString(record: Record<PropertyKey, unknown>, key: string): ParseResult<string | undefined> {
	const value = record[key];
	if (value === undefined) return success(undefined);
	return typeof value === "string" ? success(value) : failure(`${key} was not a string`);
}

function isAgentStatus(value: unknown): value is HerdrAgentStatus {
	return typeof value === "string" && AGENT_STATUSES.some((status) => status === value);
}

/** Read a private extension flag directly from argv during extension initialization. */
export function readCliFlag(argv: readonly string[], name: string): string | undefined {
	const flag = `--${name}`;
	for (let index = 2; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--") break;
		if (argument === flag) {
			const value = argv[index + 1];
			return value === undefined || value.startsWith("--") ? "" : value;
		}
		if (argument.startsWith(`${flag}=`)) return argument.slice(flag.length + 1);
	}
	return undefined;
}

/** Parsers for all JSON values crossing the Herdr and child-process boundaries. */
export const HerdrProtocol = {
	/** Parse the background tab and root pane returned by `herdr tab create`. */
	parseCreatedTab(value: string): ParseResult<CreatedTab> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.tab) || typeof result.value.tab.tab_id !== "string") {
			return failure("tab response did not contain a tab id");
		}
		if (!isRecord(result.value.root_pane) || typeof result.value.root_pane.pane_id !== "string") {
			return failure("tab response did not contain a root pane id");
		}
		return success({ tabId: result.value.tab.tab_id, paneId: result.value.root_pane.pane_id });
	},

	/** Parse the new pane id returned by `herdr pane split`. */
	parseSplitPaneId(value: string): ParseResult<string> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.pane) || typeof result.value.pane.pane_id !== "string") {
			return failure("split response did not contain a pane id");
		}
		return success(result.value.pane.pane_id);
	},

	/** Parse the caller pane geometry returned by `herdr pane layout`. */
	parsePaneRect(value: string, paneId: string): ParseResult<PaneRect> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.layout) || !Array.isArray(result.value.layout.panes)) {
			return failure("layout response did not contain panes");
		}

		for (const pane of result.value.layout.panes) {
			if (!isRecord(pane) || pane.pane_id !== paneId || !isRecord(pane.rect)) continue;
			const width = pane.rect.width;
			const height = pane.rect.height;
			if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
				return failure("pane width was invalid");
			}
			if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
				return failure("pane height was invalid");
			}
			return success({ width, height });
		}

		return failure(`layout response did not contain pane ${paneId}`);
	},

	/** Parse the effective cwd returned by `herdr pane get`. */
	parsePaneCwd(value: string): ParseResult<string> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.pane)) return failure("pane response did not contain a pane");
		const cwd = result.value.pane.foreground_cwd ?? result.value.pane.cwd;
		return typeof cwd === "string" ? success(cwd) : failure("pane response did not contain a cwd");
	},

	/** Parse the lifecycle state returned by `herdr agent get`. */
	parseAgentStatus(value: string): ParseResult<HerdrAgentStatus> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.agent) || !isAgentStatus(result.value.agent.agent_status)) {
			return failure("agent response did not contain a recognized status");
		}
		return success(result.value.agent.agent_status);
	},

	/** Parse process information returned by `herdr pane process-info`. */
	parseProcessInfo(value: string): ParseResult<PaneProcessInfo> {
		const result = resultRecord(value);
		if (!result.ok) return result;
		if (!isRecord(result.value.process_info)) {
			return failure("process response did not contain process_info");
		}
		const shellPid = result.value.process_info.shell_pid;
		const processes = result.value.process_info.foreground_processes;
		if (typeof shellPid !== "number" || !Number.isInteger(shellPid) || !Array.isArray(processes)) {
			return failure("process response contained invalid shell information");
		}

		const foregroundPids: number[] = [];
		for (const process of processes) {
			if (!isRecord(process) || typeof process.pid !== "number" || !Number.isInteger(process.pid)) {
				return failure("process response contained an invalid foreground process");
			}
			foregroundPids.push(process.pid);
		}
		return success({ shellPid, foregroundPids });
	},

	/** Parse the atomic result file emitted by a delegated Pi child. */
	parseChildResult(value: string): ParseResult<ChildResult> {
		const decoded = parseJson(value);
		if (!decoded.ok) return decoded;
		if (!isRecord(decoded.value)) return failure("child result was not an object");
		if (decoded.value.version !== 1) return failure("child result used an unsupported version");
		if (decoded.value.status !== "completed" && decoded.value.status !== "failed") {
			return failure("child result contained an invalid status");
		}
		if (typeof decoded.value.output !== "string") return failure("child result output was not a string");
		if (typeof decoded.value.finishedAt !== "number" || !Number.isFinite(decoded.value.finishedAt)) {
			return failure("child result finishedAt was invalid");
		}

		const error = optionalString(decoded.value, "error");
		if (!error.ok) return error;
		const stopReason = optionalString(decoded.value, "stopReason");
		if (!stopReason.ok) return stopReason;
		const sessionFile = optionalString(decoded.value, "sessionFile");
		if (!sessionFile.ok) return sessionFile;
		const provider = optionalString(decoded.value, "provider");
		if (!provider.ok) return provider;
		const model = optionalString(decoded.value, "model");
		if (!model.ok) return model;
		const thinking = optionalString(decoded.value, "thinking");
		if (!thinking.ok) return thinking;

		return success({
			version: 1,
			status: decoded.value.status,
			output: decoded.value.output,
			...(error.value === undefined ? {} : { error: error.value }),
			...(stopReason.value === undefined ? {} : { stopReason: stopReason.value }),
			...(sessionFile.value === undefined ? {} : { sessionFile: sessionFile.value }),
			...(provider.value === undefined ? {} : { provider: provider.value }),
			...(model.value === undefined ? {} : { model: model.value }),
			...(thinking.value === undefined ? {} : { thinking: thinking.value }),
			finishedAt: decoded.value.finishedAt,
		});
	},
} as const;
