import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const [statePath, ...args] = process.argv.slice(2);
const state = JSON.parse(await readFile(statePath, "utf8"));
state.calls.push(args);
state.panes ??= {};
const command = `${args[0]} ${args[1]}`;
const response = (result) => process.stdout.write(`${JSON.stringify({ id: "fake", result })}\n`);
const fail = (code, message) => {
	process.stderr.write(`${JSON.stringify({ id: "fake", error: { code, message } })}\n`);
	process.exitCode = 1;
};
const identity = (pane) => ({
	name: state.scenario === "replaced" || state.scenario === "failed-replaced-on-cleanup" ? "other" : pane.agentName,
	pane_id: pane.id, agent_status: pane.status,
	agent_session: state.scenario === "missing" ? null : { value: pane.session },
});
const target = Object.values(state.panes).find((pane) => pane.id === args[2] || pane.agentName === args[2]);

if (command === "tab create") {
	const env = {};
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--env") continue;
		const [key, ...value] = args[index + 1].split("=");
		env[key] = value.join("=");
	}
	state.created = (state.created ?? 0) + 1;
	const suffix = state.created === 1 ? "" : `-${state.created}`;
	const pane = {
		id: `worker-pane${suffix}`, tabId: `worker-tab${suffix}`,
		workspaceId: args[args.indexOf("--workspace") + 1], env,
	};
	state.panes[pane.id] = pane;
	response({
		type: "tab_created",
		workspace: { workspace_id: pane.workspaceId },
		tab: { tab_id: pane.tabId, workspace_id: pane.workspaceId },
		root_pane: { pane_id: pane.id, tab_id: pane.tabId, workspace_id: pane.workspaceId, agent: null },
	});
} else if (command === "agent start") {
	const pane = state.panes[args[args.indexOf("--pane") + 1]];
	state.startAttempts = (state.startAttempts ?? 0) + 1;
	if (state.scenario === "busy-once" && state.startAttempts === 1) {
		fail("agent_pane_busy", "shell is starting");
	} else if (state.scenario === "startup-shim-error") {
		fail("timeout", "mise ERROR pi is not installed for node 26.8.2");
	} else {
		pane.agentName = args[2];
		[pane.provider, pane.model] = args[args.indexOf("--model") + 1].split(/\/(.*)/s).slice(0, 2);
		pane.thinking = args[args.indexOf("--thinking") + 1];
		pane.session = join(dirname(statePath), `${pane.agentName}.jsonl`);
		await writeFile(pane.session, `${JSON.stringify({ type: "session", version: 3, id: `session-${pane.agentName}`, timestamp: new Date().toISOString(), cwd: dirname(statePath) })}\n`);
		pane.status = state.scenario === "startup-blocked" ? "blocked" : "idle";
		if (state.scenario === "startup-blocked") fail("agent_not_ready", "startup blocked");
		else response({ agent: { ...identity(pane), name: state.scenario === "replaced" ? "other" : pane.agentName } });
	}
} else if (command === "agent get") {
	if (!target?.agentName) fail("agent_not_found", "missing");
	else if (state.scenario === "missing") fail("agent_not_running", "missing");
	else response({ agent: identity(target) });
} else if (command === "agent prompt") {
	if (state.scenario === "timeout" || state.scenario === "stalled" || state.scenario === "timeout-stuck") {
		target.status = "working";
		fail(state.scenario === "stalled" ? "agent_prompt_stalled" : "timeout", "timed out");
	} else {
		const match = /^\[\[herdr-delegate:v1:([A-Za-z0-9_-]+)\]\]/.exec(args[3]);
		const envelope = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
		const resultPath = join(target.env.PI_HERDR_DELEGATE_RESULT_ROOT, envelope.worker, `${envelope.taskId}.json`);
		target.status = state.scenario === "blocked" ? "blocked" : "idle";
		if (state.scenario !== "blocked" && state.scenario !== "malformed") {
			await mkdir(dirname(resultPath), { recursive: true });
			await writeFile(resultPath, JSON.stringify({
				version: 1,
				taskId: state.scenario === "stale" ? "stale-task" : envelope.taskId,
				worker: envelope.worker,
				status: ["failed", "failed-empty", "failed-replaced-on-cleanup"].includes(state.scenario) ? "failed" : "completed",
				output: `done:${args[3].split("\n").slice(1).join("\n")}`,
				error: state.scenario === "failed" || state.scenario === "failed-replaced-on-cleanup" ? "child failure" : state.scenario === "failed-empty" ? "" : undefined,
				stopReason: state.scenario === "failed-empty" ? "" : undefined,
				session: target.session, provider: target.provider, model: target.model, thinking: target.thinking,
				finishedAt: Date.now(),
			}));
		}
		if (state.scenario === "malformed") response({});
		else response({ agent: { ...identity(target), name: target.agentName } });
	}
} else if (command === "agent send-keys") {
	if (state.scenario !== "timeout-stuck") target.status = "idle";
	response({});
} else if (command === "agent wait") {
	if (state.scenario === "timeout-stuck") fail("timeout", "still working");
	else response({ agent: identity(target) });
} else if (command === "pane get") {
	if (!target) fail("pane_not_found", "missing");
	else response({ pane: { pane_id: target.id, tab_id: target.tabId, workspace_id: target.workspaceId, agent: target.agentName ? "pi" : null } });
} else if (command === "pane close") {
	if (state.scenario === "cleanup-fails") fail("close_failed", "pane remained open");
	else {
		delete state.panes[args[2]];
		response({});
	}
} else {
	fail("unsupported", command);
}

await writeFile(statePath, JSON.stringify(state));
