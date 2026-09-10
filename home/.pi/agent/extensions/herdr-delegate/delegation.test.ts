import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { afterEach } from "node:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import {
	DelegateRuntime,
	delegateRuntimeStateSchema,
	loadRoleConfig,
	parseDelegateRuntimeState,
	type CommandResult,
	type DelegateRuntimeState,
	type RunHerdr,
} from "./delegation.ts";

const processFailureSchema = Type.Object({
	code: Type.Optional(Type.Number()),
	stdout: Type.Optional(Type.String()),
	stderr: Type.Optional(Type.String()),
});
const fakeStateSchema = Type.Object({ calls: Type.Array(Type.Array(Type.String())) });

const execFileAsync = promisify(execFile);
const fakeHerdr = join(import.meta.dirname, "fake-herdr.mjs");
const fixtureRoots = new Set<string>();

afterEach(async () => {
	await Promise.all([...fixtureRoots].map((root) => rm(root, { recursive: true, force: true })));
	fixtureRoots.clear();
});

async function makeFixture(scenario = "success", roleOverrides: Partial<Record<"model" | "thinking" | "tools", string>> = {}) {
	const root = await mkdtemp(join(tmpdir(), "herdr-delegate-test-"));
	fixtureRoots.add(root);
	const statePath = join(root, "state.json");
	const model = roleOverrides.model ?? "test-provider/sol";
	const separator = model.indexOf("/");
	const provider = model.slice(0, separator);
	const modelId = model.slice(separator + 1);
	await writeFile(statePath, JSON.stringify({
		calls: [], env: {}, scenario, status: "idle", modelProvider: provider, model: modelId,
		thinking: roleOverrides.thinking ?? "medium",
	}));
	const rolePaths = {
		builder: join(root, "builder.md"),
		reviewer: join(root, "reviewer.md"),
	};
	for (const role of ["builder", "reviewer"] as const) {
		const path = rolePaths[role];
		const roleModel = role === "builder" ? model : "test-provider/astra";
		const thinking = role === "builder" ? roleOverrides.thinking ?? "medium" : "xhigh";
		const tools = role === "builder" ? roleOverrides.tools ?? "read, bash, edit, write" : "read, bash";
		await writeFile(path, `---\nname: ${role}\ndescription: ${role} from file\nmodel: ${roleModel}\nthinking: ${thinking}\ntools: ${tools}\n---\n\nDo the ${role} task without delegation.\n`);
		rolePaths[role] = path;
	}
	const processRun: RunHerdr = async (args) => {
		try {
			const result = await execFileAsync(process.execPath, [fakeHerdr, statePath, ...args]);
			return { code: 0, stdout: result.stdout, stderr: result.stderr, killed: false };
		} catch (cause) {
			if (!Value.Check(processFailureSchema, cause)) {
				return { code: 1, stdout: "", stderr: "", killed: false };
			}
			return { code: cause.code ?? 1, stdout: cause.stdout ?? "", stderr: cause.stderr ?? "", killed: false };
		}
	};
	let sequence = 0;
	const runtime = new DelegateRuntime({
		runHerdr: processRun,
		validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: root,
		resultRoot: join(root, "results"),
		reporterPath: "/extension/index.ts",
		rolePaths,
		id: () => `id-${++sequence}`,
	});
	const state = async () => {
		const value: unknown = JSON.parse(await readFile(statePath, "utf8"));
		assert.ok(Value.Check(fakeStateSchema, value));
		return value;
	};
	return { root, runtime, rolePaths, processRun, state };
}

function commandResult(stdout = "", code = 0, stderr = ""): CommandResult {
	return { code, stdout, stderr, killed: false };
}

function requireSuccess<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error }): T {
	if (!result.ok) assert.fail(result.error.message);
	return result.value;
}

test("completes a correlated task and launches the editable role model and thinking exactly", async () => {
	const fixture = await makeFixture("success", { model: "other-provider/new-sol", thinking: "high" });
	const result = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "implement it" }));
	assert.equal(result.output, "done:implement it");
	assert.equal(result.model, "other-provider/new-sol");
	const calls = (await fixture.state()).calls;
	const start = calls.find((call) => call[0] === "agent" && call[1] === "start");
	assert.ok(start);
	assert.deepEqual(start.slice(start.indexOf("--model"), start.indexOf("--model") + 4), [
		"--model", "other-provider/new-sol", "--thinking", "high",
	]);
	const promptPath = start[start.indexOf("--append-system-prompt") + 1];
	assert.ok(promptPath);
	assert.equal(promptPath.includes("\n"), false);
	assert.equal(await readFile(promptPath, "utf8"), "Do the builder task without delegation.\n");
	assert.equal(start.some((argument) => argument.includes("Do the builder task")), false);
	assert.ok(calls.every((call) => call[0] === "agent" || call[0] === "pane" || call[0] === "tab"));
	const create = calls.find((call) => call[0] === "tab" && call[1] === "create");
	assert.ok(create);
	assert.deepEqual(create.slice(0, 8), ["tab", "create", "--workspace", "workspace", "--cwd", fixture.root, "--label", "delegate builder"]);
	assert.ok(create.includes("--no-focus"));
});

test("retries only a known shell-readiness rejection after confirming the created pane", async () => {
	const fixture = await makeFixture("busy-once");
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	const calls = (await fixture.state()).calls;
	assert.equal(calls.filter((call) => call[0] === "agent" && call[1] === "start").length, 2);
	assert.equal(calls.filter((call) => call[0] === "pane" && call[1] === "get").length, 1);
});

test("reuses only the successful builder and correlates a fresh follow-up task", async () => {
	const fixture = await makeFixture();
	const first = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
	const second = requireSuccess(await fixture.runtime.delegate({ worker: first.worker, task: "fix" }));
	assert.notEqual(first.taskId, second.taskId);
	assert.equal(second.worker, first.worker);
	assert.equal((await fixture.state()).calls.filter((call) => call[0] === "tab" && call[1] === "create").length, 1);
});

test("a stale task result leaves a diagnosable unresolved-writer lock", async () => {
	const fixture = await makeFixture("stale");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "worker_unresolved");
		assert.equal(result.error.worker, "id-1");
		assert.match(result.error.message, /Worker: id-1/);
	}
});

test("reads activity only after fake-CLI ownership confirmation", async () => {
	const fixture = await makeFixture();
	const delegated = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	await appendFile(delegated.session, `${JSON.stringify({ type: "message", id: "activity-1", parentId: null, message: { role: "assistant", content: [{ type: "text", text: "progress" }] } })}\n`);
	const activity = requireSuccess(await fixture.runtime.readAgentActivity({ worker: delegated.worker }));
	assert.match(activity.activity, /progress/);
	assert.ok((await fixture.state()).calls.some((call) => call[0] === "agent" && call[1] === "get"));
	const unknown = await fixture.runtime.readAgentActivity({ worker: "not-owned" });
	assert.equal(unknown.ok, false);
	if (!unknown.ok) assert.equal(unknown.error.code, "worker_unknown");
});

for (const scenario of ["timeout", "stalled", "blocked"] as const) {
	test(`${scenario} aborts and settles the owned worker before returning`, async () => {
		const fixture = await makeFixture(scenario);
		const result = await fixture.runtime.delegate({ role: "builder", task: "task", timeoutMs: 5_000 });
		assert.equal(result.ok, false);
		const calls = (await fixture.state()).calls;
		assert.ok(calls.some((call) => call[0] === "agent" && call[1] === "send-keys"));
		if (!result.ok) assert.equal(result.error.code, "worker_unresolved");
	});
}

test("an ambiguous blocked startup pane is left inspectable rather than closed", async () => {
	const fixture = await makeFixture("startup-blocked");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	const calls = (await fixture.state()).calls;
	assert.equal(calls.some((call) => call[0] === "pane" && call[1] === "close"), false);
});

test("malformed successful prompt response is treated as uncertain delivery", async () => {
	const fixture = await makeFixture("malformed");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "worker_unresolved");
});

test("a child-reported failure is returned as a typed task failure", async () => {
	const fixture = await makeFixture("failed");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "task_failed");
});

test("an unsettled timed-out writer locks all later delegation", async () => {
	const fixture = await makeFixture("timeout-stuck");
	const first = await fixture.runtime.delegate({ role: "builder", task: "task", timeoutMs: 5_000 });
	assert.equal(first.ok, false);
	if (!first.ok) assert.equal(first.error.code, "worker_unresolved");
	const callCount = (await fixture.state()).calls.length;
	const second = await fixture.runtime.delegate({ role: "reviewer", task: "do not start" });
	assert.equal(second.ok, false);
	if (!second.ok) assert.equal(second.error.code, "worker_unresolved");
	assert.equal((await fixture.state()).calls.length, callCount);
});

test("a rejected prompt call also triggers owned-worker cancellation", async () => {
	const fixture = await makeFixture();
	const rejectingRun: RunHerdr = async (args, options): Promise<CommandResult> => {
		if (args[0] === "agent" && args[1] === "prompt") throw new Error("aborted by signal");
		return fixture.processRun(args, options);
	};
	const runtime = new DelegateRuntime({
		runHerdr: rejectingRun, validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace", parentSessionId: "parent-session", cwd: fixture.root,
		resultRoot: join(fixture.root, "abort-results"), reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths, id: (() => { let id = 0; return () => `abort-${++id}`; })(),
	});
	const result = await runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	assert.ok((await fixture.state()).calls.some((call) => call[0] === "agent" && call[1] === "send-keys"));
});

test("a pre-aborted request performs no Herdr or filesystem-backed launch mutation", async () => {
	const fixture = await makeFixture();
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" }, AbortSignal.abort());
	assert.equal(result.ok, false);
	assert.deepEqual((await fixture.state()).calls, []);
});

for (const scenario of ["missing", "replaced"] as const) {
	test(`${scenario} initial native identity is rejected without prompting`, async () => {
		const fixture = await makeFixture(scenario);
		const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
		assert.equal(result.ok, false);
		assert.equal((await fixture.state()).calls.some((call) => call[0] === "agent" && call[1] === "prompt"), false);
	});
}

test("role model without a provider separator is rejected", async () => {
	const fixture = await makeFixture();
	await writeFile(fixture.rolePaths.builder, `---
name: builder
description: malformed model
model: gpt-6-sol
thinking: medium
tools: read, bash, edit, write
---

Build without delegation.
`);
	const loaded = await loadRoleConfig(fixture.rolePaths.builder, "builder");
	assert.equal(loaded.ok, false);
	if (!loaded.ok) assert.equal(loaded.error.code, "role_invalid");
});

test("invalid or unavailable role configuration causes no Herdr mutation", async () => {
	const fixture = await makeFixture("success", { tools: "read, delegate" });
	const parsed = await loadRoleConfig(fixture.rolePaths.builder, "builder");
	assert.equal(parsed.ok, false);
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	assert.deepEqual((await fixture.state()).calls, []);
});

test("reload reconstruction preserves an in-flight pending task lock", async () => {
	const fixture = await makeFixture("timeout");
	await fixture.runtime.delegate({ role: "builder", task: "task", timeoutMs: 5_000 });
	const persisted = fixture.runtime.getState();
	assert.ok(persisted.pending);
	const callCount = (await fixture.state()).calls.length;
	const restored = new DelegateRuntime({
		runHerdr: fixture.processRun, validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "parent-session", cwd: fixture.root, resultRoot: join(fixture.root, "reload-results"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths, initialState: persisted,
	});
	const result = await restored.delegate({ role: "reviewer", task: "must not start" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "worker_unresolved");
	assert.equal((await fixture.state()).calls.length, callCount);
});

test("serialized authority contract rejects malformed present optional fields", () => {
	for (const value of [
		{ ownerSessionId: "parent", workers: [], pending: "bad" },
		{ ownerSessionId: "parent", workers: [], pending: null },
		{ ownerSessionId: "parent", workers: [], unsafeWriter: 123 },
	]) {
		assert.equal(Value.Check(delegateRuntimeStateSchema, value), false);
	}
});

test("corrupt persisted authority cannot be cleared by empty cleanup", async () => {
	const fixture = await makeFixture();
	const runtime = new DelegateRuntime({
		runHerdr: fixture.processRun,
		validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: fixture.root,
		resultRoot: join(fixture.root, "corrupt-results"),
		reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths,
		initialStateError: "corrupt authority",
	});
	const result = await runtime.cleanupOwned();
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "state_corrupt");
	assert.deepEqual((await fixture.state()).calls, []);
});

test("cleanup refuses while a delegation call is active", async () => {
	const fixture = await makeFixture();
	let releaseValidation = (): void => undefined;
	let validationStarted = (): void => undefined;
	const started = new Promise<void>((resolve) => { validationStarted = resolve; });
	const validationGate = new Promise<void>((resolve) => { releaseValidation = resolve; });
	const runtime = new DelegateRuntime({
		runHerdr: fixture.processRun,
		validateRole: async () => {
			validationStarted();
			await validationGate;
			return { ok: true, value: undefined };
		},
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: fixture.root,
		resultRoot: join(fixture.root, "busy-results"),
		reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths,
	});
	const delegated = runtime.delegate({ role: "builder", task: "task" });
	await started;
	const cleanup = await runtime.cleanupOwned();
	assert.equal(cleanup.ok, false);
	if (!cleanup.ok) assert.equal(cleanup.error.code, "cleanup_busy");
	releaseValidation();
	requireSuccess(await delegated);
});

test("cleanup reserves the runtime against delegation and another cleanup", async () => {
	const fixture = await makeFixture();
	let releaseGet = (): void => undefined;
	let getStarted = (): void => undefined;
	const started = new Promise<void>((resolve) => { getStarted = resolve; });
	const gate = new Promise<void>((resolve) => { releaseGet = resolve; });
	let calls = 0;
	const runtime = new DelegateRuntime({
		runHerdr: async (args) => {
			calls += 1;
			if (args[0] === "agent" && args[1] === "get") {
				getStarted();
				await gate;
				return commandResult(JSON.stringify({ result: { agent: {
					name: "delegate-builder-worker",
					pane_id: "worker-pane",
					agent_status: "idle",
					agent_session: { value: "/tmp/worker.jsonl" },
				} } }));
			}
			return commandResult("{}");
		},
		validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: fixture.root,
		resultRoot: join(fixture.root, "cleanup-race-results"),
		reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths,
		initialState: {
			ownerSessionId: "parent-session",
			workers: [{
				id: "worker",
				role: "builder",
				agentName: "delegate-builder-worker",
				paneId: "worker-pane",
				session: "/tmp/worker.jsonl",
				roleFingerprint: "fingerprint",
				promptPath: "/tmp/role.md",
			}],
		},
	});
	const cleanup = runtime.cleanupOwned();
	await started;
	const delegated = await runtime.delegate({ role: "reviewer", task: "must not start" });
	const secondCleanup = await runtime.cleanupOwned();
	assert.equal(delegated.ok, false);
	if (!delegated.ok) assert.equal(delegated.error.code, "cleanup_busy");
	assert.equal(secondCleanup.ok, false);
	if (!secondCleanup.ok) assert.equal(secondCleanup.error.code, "cleanup_busy");
	assert.equal(calls, 1);
	releaseGet();
	requireSuccess(await cleanup);
});

test("cleanup publishes each confirmed worker deletion before continuing", async () => {
	const fixture = await makeFixture();
	const workers = ["one", "two"].map((id) => ({
		id,
		role: "builder" as const,
		agentName: `delegate-builder-${id}`,
		paneId: `pane-${id}`,
		session: `/tmp/${id}.jsonl`,
		roleFingerprint: "fingerprint",
		promptPath: `/tmp/${id}.md`,
	}));
	const snapshots: string[][] = [];
	const runtime = new DelegateRuntime({
		runHerdr: async (args) => {
			if (args[0] === "agent" && args[1] === "get") {
				const worker = workers.find((candidate) => candidate.agentName === args[2]);
				assert.ok(worker);
				return commandResult(JSON.stringify({ result: { agent: {
					name: worker.agentName,
					pane_id: worker.paneId,
					agent_status: "idle",
					agent_session: { value: worker.session },
				} } }));
			}
			if (args[0] === "pane" && args[1] === "close" && args[2] === "pane-two") {
				return commandResult("", 1, "close failed");
			}
			return commandResult("{}");
		},
		validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: fixture.root,
		resultRoot: join(fixture.root, "partial-cleanup-results"),
		reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths,
		initialState: { ownerSessionId: "parent-session", workers },
		onStateChange: (state) => { snapshots.push(state.workers.map((worker) => worker.id)); },
	});
	const result = await runtime.cleanupOwned();
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "cleanup_failed");
	assert.deepEqual(snapshots, [["two"]]);
	assert.deepEqual(runtime.getState().workers.map((worker) => worker.id), ["two"]);
});

test("partial cleanup persists reloadable authority after closing the unresolved worker", async () => {
	const fixture = await makeFixture();
	const workers = ["one", "two"].map((id) => ({
		id,
		role: "builder" as const,
		agentName: `delegate-builder-${id}`,
		paneId: `pane-${id}`,
		session: `/tmp/${id}.jsonl`,
		roleFingerprint: "fingerprint",
		promptPath: `/tmp/${id}.md`,
	}));
	const workerOne = workers[0];
	const workerTwo = workers[1];
	assert.ok(workerOne);
	assert.ok(workerTwo);
	let persisted: DelegateRuntimeState = { ownerSessionId: "parent-session", workers: [] };
	const identity = (worker: (typeof workers)[number]) => commandResult(JSON.stringify({ result: { agent: {
		name: worker.agentName, pane_id: worker.paneId, agent_status: "idle", agent_session: { value: worker.session },
	} } }));
	const runtime = new DelegateRuntime({
		runHerdr: async (args) => {
			if (args[0] === "agent" && args[1] === "get") return identity(workers.find((worker) => worker.agentName === args[2]) ?? workerOne);
			if (args[0] === "pane" && args[1] === "close" && args[2] === "pane-two") return commandResult("", 1, "close failed");
			return commandResult("{}");
		},
		validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "parent-session", cwd: fixture.root, resultRoot: join(fixture.root, "referential-cleanup"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths,
		initialState: {
			ownerSessionId: "parent-session", workers,
			pending: { taskId: "task-one", worker: "one", resultPath: "/tmp/result.json", startedAt: 1 },
			unsafeWriter: "worker one may still be writing", unsafeWriterWorker: "one",
		},
		onStateChange: (state) => { persisted = state; },
	});
	const partial = await runtime.cleanupOwned();
	assert.equal(partial.ok, false);
	const parsed = parseDelegateRuntimeState(persisted);
	const restoredState = requireSuccess(parsed);
	assert.deepEqual(restoredState.workers.map((worker) => worker.id), ["two"]);
	assert.equal(restoredState.pending, undefined);
	assert.equal(restoredState.unsafeWriter, undefined);
	assert.equal(restoredState.unsafeWriterWorker, undefined);
	const restored = new DelegateRuntime({
		runHerdr: async (args) => args[0] === "agent" ? identity(workerTwo) : commandResult("{}"),
		validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "parent-session", cwd: fixture.root, resultRoot: join(fixture.root, "restored-cleanup"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths, initialState: restoredState,
	});
	requireSuccess(await restored.cleanupOwned());
	assert.deepEqual(restored.getState().workers, []);
});

test("persisted unsafe-writer state survives runtime reconstruction and prevents Herdr calls", async () => {
	const fixture = await makeFixture();
	const runtime = new DelegateRuntime({
		runHerdr: fixture.processRun, validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace", parentSessionId: "parent-session", cwd: fixture.root,
		resultRoot: join(fixture.root, "restored-results"), reporterPath: "/extension/index.ts",
		rolePaths: fixture.rolePaths,
		initialState: { ownerSessionId: "parent-session", workers: [], unsafeWriter: "writer may still be active" },
	});
	const result = await runtime.delegate({ role: "reviewer", task: "do not start" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "worker_unresolved");
	assert.deepEqual((await fixture.state()).calls, []);
});

test("changed role configuration rejects a builder follow-up before prompt", async () => {
	const fixture = await makeFixture();
	const first = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
	await writeFile(fixture.rolePaths.builder, `---\nname: builder\ndescription: changed\nmodel: test-provider/sol\nthinking: medium\ntools: read, bash, edit, write\n---\n\nChanged instructions.\n`);
	const promptCount = (await fixture.state()).calls.filter((call) => call[0] === "agent" && call[1] === "prompt").length;
	const followup = await fixture.runtime.delegate({ worker: first.worker, task: "fix" });
	assert.equal(followup.ok, false);
	if (!followup.ok) assert.equal(followup.error.code, "role_changed");
	assert.equal((await fixture.state()).calls.filter((call) => call[0] === "agent" && call[1] === "prompt").length, promptCount);
});

test("killed prompt transport remains unresolved even when exit code is zero", async () => {
	const fixture = await makeFixture();
	const run: RunHerdr = async (args, options) => args[0] === "agent" && args[1] === "prompt"
		? { code: 0, stdout: "", stderr: "", killed: true }
		: fixture.processRun(args, options);
	const runtime = new DelegateRuntime({
		runHerdr: run, validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "parent-session", cwd: fixture.root, resultRoot: join(fixture.root, "killed-results"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths,
	});
	const result = await runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "worker_unresolved");
});

test("a forked parent session neither adopts nor cleans copied worker authority", async () => {
	const fixture = await makeFixture();
	const first = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
	const copied = fixture.runtime.getState();
	const callCount = (await fixture.state()).calls.length;
	const fork = new DelegateRuntime({
		runHerdr: fixture.processRun, validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "fork-session", cwd: fixture.root, resultRoot: join(fixture.root, "fork-results"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths, initialState: copied,
	});
	const delegated = await fork.delegate({ worker: first.worker, task: "must not run" });
	assert.equal(delegated.ok, false);
	if (!delegated.ok) assert.equal(delegated.error.code, "foreign_authority");
	const cleaned = await fork.cleanupOwned();
	assert.equal(cleaned.ok, false);
	assert.equal((await fixture.state()).calls.length, callCount);
});

test("concurrent first calls share one runtime queue", async () => {
	const fixture = await makeFixture();
	const [first, second] = await Promise.all([
		fixture.runtime.delegate({ role: "builder", task: "first" }),
		fixture.runtime.delegate({ role: "reviewer", task: "second" }),
	]);
	assert.equal(first.ok, true);
	assert.equal(second.ok, true);
	assert.equal((await fixture.state()).calls.filter((call) => call[0] === "agent" && call[1] === "prompt").length, 2);
});

test("cleanup closes only a worker whose live identity and session still match", async () => {
	const fixture = await makeFixture();
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	requireSuccess(await fixture.runtime.cleanupOwned());
	const calls = (await fixture.state()).calls;
	assert.ok(calls.some((call) => call[0] === "pane" && call[1] === "close"));
	assert.equal(calls.some((call) => call[0] === "tab" && call[1] === "close"), false);
});
