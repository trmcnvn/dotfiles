import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const [statePath, ...args] = process.argv.slice(2);
const state = JSON.parse(await readFile(statePath, "utf8"));
state.calls.push(args);
const command = `${args[0]} ${args[1]}`;
const response = (result) => process.stdout.write(`${JSON.stringify({ id: "fake", result })}\n`);
const fail = (code, message) => {
	process.stderr.write(`${JSON.stringify({ id: "fake", error: { code, message } })}\n`);
	process.exitCode = 1;
};

if (command === "tab create") {
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--env") continue;
		const [key, ...value] = args[index + 1].split("=");
		state.env[key] = value.join("=");
	}
	state.workspaceId = args[args.indexOf("--workspace") + 1];
	state.tabId = "worker-tab";
	response({
		type: "tab_created",
		workspace: { workspace_id: state.workspaceId },
		tab: { tab_id: state.tabId, workspace_id: state.workspaceId },
		root_pane: { pane_id: "worker-pane", tab_id: state.tabId, workspace_id: state.workspaceId, agent: null },
	});
} else if (command === "agent start") {
	state.agentName = args[2];
	state.startAttempts = (state.startAttempts ?? 0) + 1;
	if (state.scenario === "busy-once" && state.startAttempts === 1) {
		fail("agent_pane_busy", "shell is starting");
		await writeFile(statePath, JSON.stringify(state));
		process.exit();
	}
	const configuredModel = args[args.indexOf("--model") + 1];
	if (configuredModel?.includes("/")) [state.modelProvider, state.model] = configuredModel.split(/\/(.*)/s).slice(0, 2);
	state.thinking = args[args.indexOf("--thinking") + 1] ?? state.thinking;
	state.session = join(dirname(statePath), `${state.agentName}.jsonl`);
	await writeFile(state.session, `${JSON.stringify({ type: "session", version: 3, id: `session-${state.agentName}`, timestamp: new Date().toISOString(), cwd: dirname(statePath) })}\n`);
	state.status = state.scenario === "startup-blocked" ? "blocked" : "idle";
	if (state.scenario === "startup-blocked") fail("agent_not_ready", "startup blocked");
	else response({ agent: { name: state.scenario === "replaced" ? "other" : state.agentName, pane_id: "worker-pane", agent_status: "idle", agent_session: state.scenario === "missing" ? null : { value: state.session } } });
} else if (command === "agent get") {
	if (state.scenario === "missing") fail("agent_not_running", "missing");
	else response({ agent: { name: state.scenario === "replaced" ? "other" : state.agentName, pane_id: "worker-pane", agent_status: state.status, agent_session: state.session ? { value: state.session } : null } });
} else if (command === "agent prompt") {
	if (state.scenario === "timeout" || state.scenario === "stalled" || state.scenario === "timeout-stuck") {
		state.status = "working";
		fail(state.scenario === "stalled" ? "agent_prompt_stalled" : "timeout", "timed out");
	} else {
		const match = /^\[\[herdr-delegate:v1:([A-Za-z0-9_-]+)\]\]/.exec(args[3]);
		const envelope = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
		const resultPath = join(state.env.PI_HERDR_DELEGATE_RESULT_ROOT, envelope.worker, `${envelope.taskId}.json`);
		state.status = state.scenario === "blocked" ? "blocked" : "idle";
		if (state.scenario !== "blocked" && state.scenario !== "malformed") {
			await mkdir(dirname(resultPath), { recursive: true });
			await writeFile(resultPath, JSON.stringify({
				version: 1,
				taskId: state.scenario === "stale" ? "stale-task" : envelope.taskId,
				worker: envelope.worker,
				status: state.scenario === "failed" ? "failed" : "completed",
				output: `done:${args[3].split("\n").slice(1).join("\n")}`,
				error: state.scenario === "failed" ? "child failure" : undefined,
				session: state.session,
				provider: state.modelProvider,
				model: state.model,
				thinking: state.thinking,
				finishedAt: Date.now(),
			}));
		}
		if (state.scenario === "malformed") response({});
		else response({ agent: { name: state.agentName, pane_id: "worker-pane", agent_status: state.status, agent_session: { value: state.session } } });
	}
} else if (command === "agent send-keys") {
	if (state.scenario !== "timeout-stuck") state.status = "idle";
	response({});
} else if (command === "agent wait") {
	if (state.scenario === "timeout-stuck") fail("timeout", "still working");
	else response({ agent: { name: state.agentName, pane_id: "worker-pane", agent_status: state.status } });
} else if (command === "pane get") {
	response({ pane: { pane_id: "worker-pane", tab_id: state.tabId, workspace_id: state.workspaceId, ...(state.scenario === "startup-blocked" ? { agent: "pi" } : {}) } });
} else if (command === "pane close") {
	response({});
} else {
	fail("unsupported", command);
}

await writeFile(statePath, JSON.stringify(state));
