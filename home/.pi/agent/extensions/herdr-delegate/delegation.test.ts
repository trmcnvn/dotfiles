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
	const options: ConstructorParameters<typeof DelegateRuntime>[0] = {
		runHerdr: processRun,
		validateRole: async () => ({ ok: true, value: undefined }),
		callerWorkspaceId: "workspace",
		parentSessionId: "parent-session",
		cwd: root,
		resultRoot: join(root, "results"),
		reporterPath: "/extension/index.ts",
		rolePaths,
		id: () => `id-${++sequence}`,
	};
	const runtime = new DelegateRuntime(options);
	const state = async () => {
		const value: unknown = JSON.parse(await readFile(statePath, "utf8"));
		assert.ok(Value.Check(fakeStateSchema, value));
		return value;
	};
	return { root, runtime, rolePaths, processRun, state, options };
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
	assert.deepEqual(result.cleanup, { status: "retained", reason: "builder_followups" });
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
	assert.deepEqual(second.cleanup, { status: "retained", reason: "builder_followups" });
	assert.equal((await fixture.state()).calls.filter((call) => call[0] === "tab" && call[1] === "create").length, 1);
});

test("closes a fresh reviewer immediately after preserving its correlated result", async () => {
	const fixture = await makeFixture();
	const result = requireSuccess(await fixture.runtime.delegate({ role: "reviewer", task: "review" }));
	assert.deepEqual(result.cleanup, { status: "closed" });
	assert.match(await readFile(result.resultPath, "utf8"), /"output":"done:review"/);
	assert.deepEqual(fixture.runtime.getState().workers, []);
	const calls = (await fixture.state()).calls;
	assert.ok(calls.some((call) => call[0] === "pane" && call[1] === "close"));
	assert.equal(calls.some((call) => call[0] === "tab" && call[1] === "close"), false);
});

test("returns completed reviewer output when cleanup fails and retains recovery authority", async () => {
	const fixture = await makeFixture("cleanup-fails");
	const result = requireSuccess(await fixture.runtime.delegate({ role: "reviewer", task: "review" }));
	assert.equal(result.output, "done:review");
	assert.equal(result.cleanup.status, "failed");
	assert.equal(fixture.runtime.getState().workers.length, 1);
	assert.equal(fixture.runtime.getState().unsafeWriterWorker, result.worker);
	assert.match(await readFile(result.resultPath, "utf8"), /done:review/);
});

test("a stale task result stops and closes the identity-matching worker without resubmission", async () => {
	const fixture = await makeFixture("stale");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "task_cancelled");
		assert.match(result.error.message, /matching owned pane closed/);
	}
	assert.deepEqual(fixture.runtime.getState().workers, []);
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
	test(`${scenario} stops and closes the identity-matching worker before returning`, async () => {
		const fixture = await makeFixture(scenario);
		const result = await fixture.runtime.delegate({ role: "builder", task: "task", timeoutMs: 5_000 });
		assert.equal(result.ok, false);
		const calls = (await fixture.state()).calls;
		assert.ok(calls.some((call) => call[0] === "agent" && call[1] === "send-keys"));
		assert.ok(calls.some((call) => call[0] === "pane" && call[1] === "close"));
		if (!result.ok) assert.equal(result.error.code, "task_cancelled");
		assert.deepEqual(fixture.runtime.getState().workers, []);
	});
}

test("an ambiguous blocked startup pane remains locked with exact manual recovery", async () => {
	const fixture = await makeFixture("startup-blocked");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "manual_recovery_required");
		assert.match(result.error.message, /pane=worker-pane, tab=worker-tab, workspace=workspace/);
	}
	const cleanup = await fixture.runtime.cleanupOwned();
	assert.equal(cleanup.ok, false);
	if (!cleanup.ok) assert.equal(cleanup.error.code, "manual_recovery_required");
	const calls = (await fixture.state()).calls;
	assert.equal(calls.some((call) => call[0] === "pane" && call[1] === "close"), false);
});

test("malformed successful prompt response closes only the confirmed native worker", async () => {
	const fixture = await makeFixture("malformed");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "task_cancelled");
	assert.deepEqual(fixture.runtime.getState().workers, []);
});

test("a child-reported failure is returned as a typed task failure after owned-pane cleanup", async () => {
	const fixture = await makeFixture("failed");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "task_failed");
		assert.match(result.error.message, /matching owned pane closed/);
	}
	assert.deepEqual(fixture.runtime.getState().workers, []);
});

test("a failed task keeps its lock and pane when native session ownership changed", async () => {
	const fixture = await makeFixture("failed-replaced-on-cleanup");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "task_failed");
		assert.equal(result.error.worker, "id-1");
		assert.match(result.error.message, /Cleanup failed/);
	}
	const calls = (await fixture.state()).calls;
	assert.equal(calls.some((call) => call[0] === "pane" && call[1] === "close"), false);
	assert.equal(fixture.runtime.getState().unsafeWriterWorker, "id-1");
});

test("empty child error metadata preserves the task-failed status fallback", async () => {
	const fixture = await makeFixture("failed-empty");
	const result = await fixture.runtime.delegate({ role: "builder", task: "task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "task_failed");
		assert.equal(result.error.message, "task_failed: failed. Cleanup: matching owned pane closed.");
	}
});

test("a timed-out worker is closed even when Escape does not make it idle", async () => {
	const fixture = await makeFixture("timeout-stuck");
	const first = await fixture.runtime.delegate({ role: "builder", task: "task", timeoutMs: 5_000 });
	assert.equal(first.ok, false);
	if (!first.ok) assert.equal(first.error.code, "task_cancelled");
	assert.deepEqual(fixture.runtime.getState().workers, []);
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

test("reload reconstruction preserves an explicitly persisted in-flight task lock", async () => {
	const fixture = await makeFixture();
	const built = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	const worker = fixture.runtime.getState().workers[0];
	assert.ok(worker);
	const persisted: DelegateRuntimeState = {
		ownerSessionId: "parent-session",
		workers: [worker],
		pending: { taskId: "interrupted-task", worker: built.worker, resultPath: "/tmp/result.json", startedAt: 1 },
	};
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
		{ ownerSessionId: "parent", workers: [], pending: { taskId: "", worker: "worker", resultPath: "/tmp/result", startedAt: 1 } },
		{ ownerSessionId: "parent", workers: [], pending: { taskId: "task", worker: "", resultPath: "/tmp/result", startedAt: 1 } },
		{ ownerSessionId: "parent", workers: [], pending: { taskId: "task", worker: "worker", resultPath: "", startedAt: 1 } },
		{ ownerSessionId: "parent", workers: [], pending: { taskId: "task", worker: "missing", resultPath: "/tmp/result", startedAt: 1 } },
	]) {
		if (!Value.Check(delegateRuntimeStateSchema, value)) continue;
		const result = parseDelegateRuntimeState(value);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, "state_invalid");
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
	assert.deepEqual(snapshots, [["two"], ["two"]]);
	assert.deepEqual(runtime.getState().workers.map((worker) => worker.id), ["two"]);
	assert.equal(runtime.getState().unsafeWriterWorker, "two");
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
	assert.match(restoredState.unsafeWriter ?? "", /cleanup could not safely close/);
	assert.equal(restoredState.unsafeWriterWorker, "two");
	const restored = new DelegateRuntime({
		runHerdr: async (args) => args[0] === "agent" ? identity(workerTwo) : commandResult("{}"),
		validateRole: async () => ({ ok: true, value: undefined }), callerWorkspaceId: "workspace",
		parentSessionId: "parent-session", cwd: fixture.root, resultRoot: join(fixture.root, "restored-cleanup"),
		reporterPath: "/extension/index.ts", rolePaths: fixture.rolePaths, initialState: restoredState,
	});
	requireSuccess(await restored.cleanupOwned());
	assert.deepEqual(restored.getState().workers, []);
});

test("persisted unpinned unsafe state requires manual recovery and prevents Herdr calls", async () => {
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
	if (!result.ok) assert.equal(result.error.code, "manual_recovery_required");
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

test("killed prompt transport closes the confirmed worker even when exit code is zero", async () => {
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
	if (!result.ok) assert.equal(result.error.code, "task_cancelled");
	assert.deepEqual(runtime.getState().workers, []);
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

for (const failure of ["replaced", "unavailable", "moved"] as const) {
	test(`builder follow-up ${failure} identity retains its handle and blocks later writers`, async () => {
		const fixture = await makeFixture();
		const built = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
		const calls: readonly string[][] = [];
		let lookups = 0;
		const runtime = new DelegateRuntime({
			...fixture.options, initialState: fixture.runtime.getState(),
			runHerdr: async (args) => {
				lookups += 1;
				if (failure === "unavailable") return commandResult("", 1, "timeout");
				if (failure === "replaced") return commandResult(JSON.stringify({ result: { agent: {
					name: built.agentName, pane_id: built.paneId, agent_session: { value: "another-session" },
				} } }));
				if (args[0] === "pane") return commandResult(JSON.stringify({ result: { pane: {
					pane_id: built.paneId, tab_id: "another-tab", workspace_id: "workspace",
				} } }));
				return fixture.processRun(args);
			},
		});
		const result = await runtime.delegate({ worker: built.worker, task: "fix" });
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "worker_unresolved");
			assert.equal(result.error.worker, built.worker);
		}
		assert.equal(runtime.getState().unsafeWriterWorker, built.worker);
		const before = lookups;
		assert.equal((await runtime.delegate({ role: "builder", task: "another writer" })).ok, false);
		assert.equal(lookups, before);
		assert.deepEqual(calls, []);
	});
}

test("cleanup continues after failure and preserves unrelated unpinned startup authority", async () => {
	const fixture = await makeFixture();
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
	const worker = fixture.runtime.getState().workers[0];
	assert.ok(worker);
	const failed = { ...worker, id: "failed", agentName: "failed-worker" };
	const closed: string[] = [];
	const runtime = new DelegateRuntime({
		...fixture.options,
		initialState: { ownerSessionId: "parent-session", workers: [failed, worker], unsafeWriter: "unknown startup pane" },
		runHerdr: async (args) => {
			if (args[2] === failed.agentName) return commandResult("", 1, "timeout");
			if (args[0] === "pane" && args[1] === "close") closed.push(args[2] ?? "");
			return fixture.processRun(args);
		},
	});
	const result = await runtime.cleanupOwned();
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "manual_recovery_required");
		assert.match(result.error.message, /unknown startup pane.*timeout/);
	}
	assert.deepEqual(closed, [worker.paneId]);
	assert.deepEqual(runtime.getState().workers, [failed]);
	assert.equal(runtime.getState().unsafeWriter, "unknown startup pane");
	assert.equal(runtime.getState().unsafeWriterWorker, undefined);
	assert.equal((await runtime.delegate({ role: "builder", task: "must not run" })).ok, false);
});

for (const checkpoint of ["worker", "pending", "terminal", "closure"] as const) {
	test(`publication failure at ${checkpoint} preserves safety and captured results`, async () => {
		const fixture = await makeFixture();
		let publications = 0;
		const failAt = { worker: 1, pending: 2, terminal: 3, closure: 4 }[checkpoint];
		const runtime = new DelegateRuntime({
			...fixture.options,
			onStateChange: () => {
				publications += 1;
				if (publications >= failAt) throw new Error("disk unavailable");
			},
		});
		const result = await runtime.delegate({ role: "reviewer", task: "review" });
		if (checkpoint === "worker" || checkpoint === "pending") {
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, "state_persist_failed");
			assert.equal((await fixture.state()).calls.some((call) => call[1] === "prompt"), false);
			assert.equal(runtime.getState().workers.length, 1);
		} else {
			const captured = requireSuccess(result);
			assert.equal(captured.output, "done:review");
			assert.deepEqual(captured.cleanup, { status: "closed" });
			assert.match(captured.persistenceError ?? "", /state_persist_failed/);
			assert.match(await readFile(captured.resultPath, "utf8"), /done:review/);
			assert.deepEqual(runtime.getState().workers, []);
		}
		assert.match(runtime.getState().unsafeWriter ?? "", /state_persist_failed/);
		assert.equal((await runtime.delegate({ role: "builder", task: "must not run" })).ok, false);
		assert.equal((await runtime.cleanupOwned()).ok, false);
	});
}

test("persistence failure does not discard output when reviewer closure also fails", async () => {
	const fixture = await makeFixture("cleanup-fails");
	const runtime = new DelegateRuntime({
		...fixture.options,
		onStateChange: (state) => {
			if (state.unsafeWriter) throw new Error("disk unavailable");
		},
	});
	const captured = requireSuccess(await runtime.delegate({ role: "reviewer", task: "review" }));
	assert.equal(captured.output, "done:review");
	assert.equal(captured.cleanup.status, "failed");
	assert.match(captured.persistenceError ?? "", /state_persist_failed/);
	assert.equal(runtime.getState().unsafeWriterWorker, captured.worker);
	assert.equal(runtime.getState().workers.length, 1);
});

test("foreign empty snapshots are inert while inherited locks remain foreign", async () => {
	const fixture = await makeFixture();
	const empty = new DelegateRuntime({
		...fixture.options, initialState: { ownerSessionId: "other-parent", workers: [] },
	});
	requireSuccess(await empty.cleanupOwned());
	assert.equal(empty.getState().ownerSessionId, "parent-session");
	requireSuccess(await empty.delegate({ role: "builder", task: "fresh task" }));
	const locked = new DelegateRuntime({
		...fixture.options, initialState: { ownerSessionId: "other-parent", workers: [], unsafeWriter: "unknown pane" },
	});
	const rejected = await locked.delegate({ role: "builder", task: "must not run" });
	assert.equal(rejected.ok, false);
	if (!rejected.ok) assert.equal(rejected.error.code, "foreign_authority");
	assert.equal((await locked.cleanupOwned()).ok, false);
});

for (const evidence of ["absent", "name-absent", "agent-timeout", "agent-not-running", "pane-timeout", "pane-present", "pane-killed", "agent-replaced"] as const) {
	test(`cleanup absence evidence ${evidence} only prunes a specifically missing agent and pane`, async () => {
		const fixture = await makeFixture();
		requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
		const worker = fixture.runtime.getState().workers[0];
		assert.ok(worker);
		const calls: string[][] = [];
		const missing = (code: string) => commandResult("", 1, JSON.stringify({ error: { code, message: "missing" } }));
		const runtime = new DelegateRuntime({
			...fixture.options,
			initialState: {
				...fixture.runtime.getState(),
				pending: { taskId: "old-task", worker: worker.id, resultPath: "/tmp/old-task.json", startedAt: 1 },
				unsafeWriter: "old task unresolved", unsafeWriterWorker: worker.id,
			},
			runHerdr: async (args) => {
				calls.push([...args]);
				if (args[0] === "agent") {
					if (evidence === "agent-timeout") return missing("timeout");
					if (evidence === "agent-not-running") return missing("agent_not_running");
					if (evidence === "agent-replaced") return commandResult(JSON.stringify({ result: { agent: {
						name: worker.agentName, pane_id: worker.paneId, agent_session: { value: "replacement" },
					} } }));
					return missing(evidence === "name-absent" ? "agent_name_not_found" : "agent_not_found");
				}
				if (evidence === "pane-timeout") return missing("timeout");
				if (evidence === "pane-present") return fixture.processRun(args);
				if (evidence === "pane-killed") return { ...missing("pane_not_found"), killed: true };
				return missing("pane_not_found");
			},
		});
		const cleaned = await runtime.cleanupOwned();
		const absent = evidence === "absent" || evidence === "name-absent";
		assert.equal(cleaned.ok, absent);
		assert.equal(runtime.getState().workers.length, absent ? 0 : 1);
		assert.equal(runtime.getState().pending === undefined, absent);
		assert.equal(runtime.getState().unsafeWriter === undefined, absent);
		assert.equal(calls.some((call) => call[1] === "close" || call[1] === "send-keys"), false);
	});
}

test("cleanup closes only a worker whose live identity and session still match", async () => {
	const fixture = await makeFixture();
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	requireSuccess(await fixture.runtime.cleanupOwned());
	const calls = (await fixture.state()).calls;
	assert.ok(calls.some((call) => call[0] === "pane" && call[1] === "close"));
	assert.equal(calls.some((call) => call[0] === "tab" && call[1] === "close"), false);
});
