import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { afterEach } from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import {
	DelegateRuntime,
	DelegationError,
	delegateRuntimeStateSchema,
	loadRoleConfig,
	parseDelegateRuntimeState,
	roleFingerprint,
	type DelegateInput,
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
		worker: join(root, "worker.md"),
		scout: join(root, "scout.md"),
		reviewer: join(root, "reviewer.md"),
	};
	for (const role of ["builder", "worker", "scout", "reviewer"] as const) {
		const path = rolePaths[role];
		const writer = role === "builder" || role === "worker";
		const roleModel = writer ? model : "test-provider/astra";
		const thinking = writer ? roleOverrides.thinking ?? "medium" : "xhigh";
		const tools = writer ? roleOverrides.tools ?? "read, bash, edit, write" : "read, bash";
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

const legacyStartupFailure = "agent startup failed after creating pane=old-pane, tab=old-tab, workspace=workspace (timeout); native session identity was not pinned, so inspect and close that pane manually if appropriate";

test("startup acknowledgment preserves the lock on failed publication and permits deliberate retry and reload", async () => {
	const fixture = await makeFixture();
	const initialState = { ownerSessionId: "parent-session", workers: [], unsafeWriter: legacyStartupFailure };
	let failPublication = true;
	let published: DelegateRuntimeState = initialState;
	const runtime = new DelegateRuntime({ ...fixture.options, initialState, onStateChange: (state) => {
		if (failPublication) throw new Error("disk unavailable");
		published = state;
	} });
	const record = requireSuccess(runtime.getStartupRecovery());
	assert.match(record, /Legacy record/);
	assert.equal(runtime.acknowledgeStartupRecovery("different record").ok, false);
	assert.equal(runtime.acknowledgeStartupRecovery(record).ok, false);
	assert.equal(runtime.getState().unsafeWriter, legacyStartupFailure);
	assert.ok(runtime.getState().persistenceError);
	assert.deepEqual(published, initialState);
	assert.equal((await runtime.delegate({ role: "worker", task: "must stay locked" })).ok, false);
	failPublication = false;
	requireSuccess(runtime.acknowledgeStartupRecovery(record));
	assert.deepEqual(published, { ownerSessionId: "parent-session", workers: [] });
	assert.equal(runtime.getStartupRecovery().ok, false);
	assert.equal(runtime.acknowledgeStartupRecovery(record).ok, false);
	assert.deepEqual((await fixture.state()).calls, []);
	const reloaded = new DelegateRuntime({ ...fixture.options, initialState: published });
	requireSuccess(await reloaded.delegate({ role: "scout", task: "new deliberate task" }));
});

test("startup acknowledgment refuses foreign, corrupt, pinned, pending, and unrelated authority", async () => {
	const fixture = await makeFixture();
	const worker = { id: "owned", role: "worker", agentName: "owned-agent", paneId: "owned-pane", session: "/tmp/owned.jsonl", roleFingerprint: "fingerprint", promptPath: "/tmp/prompt.md" } as const;
	const startup = { ownerSessionId: "parent-session", workers: [], unsafeWriter: legacyStartupFailure };
	const states: DelegateRuntimeState[] = [
		{ ...startup, ownerSessionId: "foreign" },
		{ ...startup, unsafeWriter: "unrelated safety failure" },
		{ ...startup, unsafeWriter: "started delegate-worker; unrelated safety failure" },
		{ ...startup, workers: [worker] },
		{ ...startup, workers: [worker], unsafeWriterWorker: worker.id },
		{ ...startup, workers: [worker], pending: { worker: worker.id, taskId: "task", resultPath: "/tmp/result", startedAt: 1 } },
	];
	for (const initialState of states) {
		const runtime = new DelegateRuntime({ ...fixture.options, initialState });
		const before = runtime.getState();
		assert.equal(runtime.getStartupRecovery().ok, false);
		assert.equal(runtime.acknowledgeStartupRecovery(legacyStartupFailure).ok, false);
		assert.deepEqual(runtime.getState(), before);
	}
	const corrupt = new DelegateRuntime({ ...fixture.options, initialState: startup, initialStateError: "corrupt authority" });
	assert.equal(corrupt.getStartupRecovery().ok, false);
	assert.equal(corrupt.acknowledgeStartupRecovery(legacyStartupFailure).ok, false);
	const closed = new DelegateRuntime({ ...fixture.options, initialState: startup });
	const record = requireSuccess(closed.getStartupRecovery());
	await closed.drain();
	assert.equal(closed.acknowledgeStartupRecovery(record).ok, false);
	assert.deepEqual((await fixture.state()).calls, []);
});

test("startup acknowledgment rejects accepted queued delegation even before it reaches the safety lock", async () => {
	const fixture = await makeFixture();
	const runtime = new DelegateRuntime({ ...fixture.options, initialState: { ownerSessionId: "parent-session", workers: [], unsafeWriter: legacyStartupFailure } });
	const record = requireSuccess(runtime.getStartupRecovery());
	const first = runtime.delegate({ role: "worker", task: "blocked" });
	const queued = runtime.delegate({ role: "worker", task: "also blocked" });
	assert.equal(runtime.getStartupRecovery().ok, false);
	assert.equal(runtime.acknowledgeStartupRecovery(record).ok, false);
	await Promise.all([first, queued]);
	requireSuccess(runtime.acknowledgeStartupRecovery(record));
	assert.deepEqual((await fixture.state()).calls, []);
});

for (const emptyField of ["pane", "root-tab", "root-workspace", "tab", "workspace"] as const) {
	test(`empty creation ${emptyField} identity remains a reconstructable malformed-startup lock`, async () => {
		const fixture = await makeFixture();
		const manager = SessionManager.inMemory(fixture.root);
		const calls: string[][] = [];
		const runtime = new DelegateRuntime({ ...fixture.options,
			onStateChange: (state) => { manager.appendCustomEntry("herdr-delegate-state", state); },
			runHerdr: async (args) => {
				calls.push([...args]);
				if (args[0] === "tab" && args[1] === "create") return commandResult(JSON.stringify({ result: {
					root_pane: { pane_id: emptyField === "pane" ? "" : "pane", tab_id: emptyField === "root-tab" ? "" : "tab", workspace_id: emptyField === "root-workspace" ? "" : "workspace" },
					tab: { tab_id: emptyField === "tab" ? "" : "tab", workspace_id: emptyField === "workspace" ? "" : "workspace" },
				} }));
				return commandResult("", 1, "startup failed");
			},
		});
		const result = await runtime.delegate({ role: "worker", task: "must not be delivered" });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, "manual_recovery_required");
		assert.equal(calls.length, 1, "malformed creation identity must be rejected before startup");
		assert.deepEqual(calls[0]?.slice(0, 2), ["tab", "create"]);
		const entry = manager.getBranch().at(-1);
		assert.ok(entry?.type === "custom");
		const representation: unknown = JSON.parse(JSON.stringify(entry.data));
		assert.ok(Value.Check(delegateRuntimeStateSchema, representation));
		const state = requireSuccess(parseDelegateRuntimeState(representation));
		assert.equal(state.startupResource, undefined);
		assert.match(state.unsafeWriter ?? "", /^tab creation succeeded but its root pane identity was malformed;/);
		const restored = new DelegateRuntime({ ...fixture.options, initialState: state });
		assert.equal((await restored.cleanupOwned()).ok, false);
		requireSuccess(restored.acknowledgeStartupRecovery(requireSuccess(restored.getStartupRecovery())));
		assert.deepEqual(restored.getState(), { ownerSessionId: "parent-session", workers: [] });
		assert.deepEqual((await fixture.state()).calls, [], "reconstruction and acknowledgment must not touch resources");
	});
}

test("new unpinned startup failures retain diagnostic provenance across parsing and acknowledgment", async () => {
	const fixture = await makeFixture("startup-blocked");
	assert.equal((await fixture.runtime.delegate({ role: "worker", task: "not delivered" })).ok, false);
	const state = fixture.runtime.getState();
	assert.ok(state.startupResource);
	assert.equal(state.startupResource.agentName, "delegate-worker-id1");
	const parsed = requireSuccess(parseDelegateRuntimeState(state));
	assert.deepEqual(parsed.startupResource, state.startupResource);
	const restored = new DelegateRuntime({ ...fixture.options, initialState: parsed });
	const record = requireSuccess(restored.getStartupRecovery());
	assert.match(record, /Startup provenance \(not native ownership\)/);
	assert.equal((await restored.cleanupOwned()).ok, false);
	const callsBefore = (await fixture.state()).calls;
	requireSuccess(restored.acknowledgeStartupRecovery(record));
	assert.deepEqual((await fixture.state()).calls, callsBefore);
	assert.deepEqual(restored.getState(), { ownerSessionId: "parent-session", workers: [] });
	assert.equal(parseDelegateRuntimeState({ ...state, unsafeWriterWorker: "owned" }).ok, false);
	assert.equal(parseDelegateRuntimeState({ ownerSessionId: "parent-session", workers: [], startupResource: state.startupResource }).ok, false);
});

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

for (const role of ["worker", "scout", "reviewer"] as const) {
	test(`${role} stores sessions privately outside normal Pi history`, async () => {
		const fixture = await makeFixture();
		const result = requireSuccess(await fixture.runtime.delegate({ role, task: "transport check" }));
		const start = (await fixture.state()).calls.find((call) => call[0] === "agent" && call[1] === "start");
		assert.ok(start);
		const sessionDir = join(fixture.options.resultRoot, result.worker, "sessions");
		assert.deepEqual(start.slice(start.indexOf("--session-dir"), start.indexOf("--session-dir") + 2), ["--session-dir", sessionDir]);
		assert.equal((await stat(sessionDir)).mode & 0o777, 0o700);
		assert.equal(start.includes("--no-session"), false, "native session identity and activity require persistence");
		const manager = SessionManager.create(fixture.root, sessionDir);
		assert.equal(manager.getSessionDir(), sessionDir);
		assert.notEqual(manager.getSessionDir(), SessionManager.inMemory(fixture.root).getSessionDir());
	});
}

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
		{ ownerSessionId: "parent", workers: [], persistenceError: null },
		{ ownerSessionId: "parent", workers: [], persistenceError: "" },
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
	const acknowledgment = runtime.acknowledgeStartupRecovery(legacyStartupFailure);
	assert.equal(acknowledgment.ok, false);
	if (!acknowledgment.ok) assert.equal(acknowledgment.error.code, "cleanup_busy");
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
		assert.match(runtime.getState().persistenceError ?? "", /state_persist_failed/);
		assert.equal((await runtime.delegate({ role: "builder", task: "must not run" })).ok, false);
		assert.equal((await runtime.cleanupOwned()).ok, false);
	});
}

test("real Pi session append failure retains the pinned worker and prevents prompt delivery", async () => {
	const fixture = await makeFixture();
	const sessionPath = join(fixture.root, "parent.jsonl");
	await writeFile(sessionPath, `${JSON.stringify({ type: "session", version: 3, id: "parent-session", timestamp: new Date().toISOString(), cwd: fixture.root })}\n`);
	const sessionManager = SessionManager.open(sessionPath);
	const runtime = new DelegateRuntime({
		...fixture.options,
		onStateChange: (state) => { sessionManager.appendCustomEntry("herdr-delegate-state", state); },
		runHerdr: async (args) => {
			const result = await fixture.processRun(args);
			if (args[0] === "agent" && args[1] === "start") {
				await rm(sessionPath);
				await mkdir(sessionPath);
			}
			return result;
		},
	});
	const result = await runtime.delegate({ role: "builder", task: "must not deliver" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "state_persist_failed");
		assert.equal(result.error.worker, runtime.getState().workers[0]?.id);
		assert.ok(result.error.cause instanceof Error);
	}
	assert.equal(runtime.getState().workers.length, 1);
	assert.ok(runtime.getState().persistenceError);
	assert.equal((await fixture.state()).calls.some((call) => call[1] === "prompt"), false);
});

test("cleanup aggregates failures and still closes later verified workers", async () => {
	const fixture = await makeFixture();
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "first" }));
	const worker = fixture.runtime.getState().workers[0];
	assert.ok(worker);
	const failures = ["first-missing", "second-missing"].map((id) => ({ ...worker, id, agentName: id }));
	const runtime = new DelegateRuntime({
		...fixture.options,
		initialState: { ownerSessionId: "parent-session", workers: [...failures, worker] },
		runHerdr: async (args) => failures.some((failed) => failed.agentName === args[2])
			? commandResult("", 1, `timeout for ${args[2]}`)
			: fixture.processRun(args),
	});
	const result = await runtime.cleanupOwned();
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.match(result.error.message, /first-missing/);
		assert.match(result.error.message, /second-missing/);
	}
	assert.deepEqual(runtime.getState().workers, failures);
	assert.ok(runtime.getState().unsafeWriter);
	assert.equal((await runtime.delegate({ role: "builder", task: "must not run" })).ok, false);
});

test("a failed closure publication does not stop cleanup of other verified workers", async () => {
	const fixture = await makeFixture();
	const workers = ["one", "two"].map((id) => ({
		id, role: "builder" as const, agentName: `delegate-${id}`, paneId: `pane-${id}`,
		session: `/tmp/${id}.jsonl`, roleFingerprint: "fingerprint", promptPath: `/tmp/${id}.md`,
	}));
	const closed: string[] = [];
	const snapshots: DelegateRuntimeState[] = [];
	const runtime = new DelegateRuntime({
		...fixture.options, initialState: { ownerSessionId: "parent-session", workers },
		runHerdr: async (args) => {
			if (args[0] === "agent") {
				const worker = workers.find((candidate) => candidate.agentName === args[2]);
				assert.ok(worker);
				return commandResult(JSON.stringify({ result: { agent: {
					name: worker.agentName, pane_id: worker.paneId, agent_session: { value: worker.session },
				} } }));
			}
			closed.push(args[2] ?? "");
			return commandResult("{}");
		},
		onStateChange: (state) => {
			snapshots.push(state);
			throw new Error("disk unavailable");
		},
	});
	const result = await runtime.cleanupOwned();
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "state_persist_failed");
	assert.deepEqual(closed, ["pane-one", "pane-two"]);
	assert.deepEqual(snapshots[0]?.workers.map((worker) => worker.id), ["two"]);
	assert.deepEqual(runtime.getState().workers, []);
	assert.ok(runtime.getState().persistenceError);
});

test("drain waits for accepted delegation and leaves its idle builder retained", async () => {
	const fixture = await makeFixture();
	let release = (): void => undefined;
	let started = (): void => undefined;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const entered = new Promise<void>((resolve) => { started = resolve; });
	let snapshot: DelegateRuntimeState | undefined;
	const runtime = new DelegateRuntime({
		...fixture.options,
		validateRole: async () => { started(); await gate; return { ok: true, value: undefined }; },
		onStateChange: (state) => { snapshot = state; },
	});
	const delegated = runtime.delegate({ role: "builder", task: "first" });
	await entered;
	let drained = false;
	const draining = runtime.drain().then((result) => { drained = true; return result; });
	await Promise.resolve();
	assert.equal(drained, false);
	const rejected = await runtime.delegate({ role: "reviewer", task: "must not start" });
	assert.equal(rejected.ok, false);
	if (!rejected.ok) assert.equal(rejected.error.code, "runtime_closed");
	release();
	const built = requireSuccess(await delegated);
	requireSuccess(await draining);
	assert.equal(snapshot?.workers[0]?.id, built.worker);
	assert.equal(snapshot?.pending, undefined);
	assert.equal((await fixture.state()).calls.some((call) => call[1] === "close"), false);
});

test("failed child output and artifact remain available when terminal publication fails", async () => {
	const fixture = await makeFixture("failed");
	let publications = 0;
	const runtime = new DelegateRuntime({
		...fixture.options,
		onStateChange: () => { if (++publications >= 3) throw new Error("disk unavailable"); },
	});
	const result = await runtime.delegate({ role: "builder", task: "failed task" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "task_failed");
		assert.match(result.error.message, /state_persist_failed/);
		assert.match(result.error.message, /Result artifact: .*\.json/);
		assert.match(result.error.message, /done:failed task/);
		assert.match(result.error.message, /matching owned pane closed/);
	}
	assert.deepEqual(runtime.getState().workers, []);
	assert.ok(runtime.getState().persistenceError);
});

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

test("reloadable persistence locks recover without becoming unknown startup authority", async () => {
	const fixture = await makeFixture();
	let publications = 0;
	const original = new DelegateRuntime({
		...fixture.options,
		onStateChange: () => { if (++publications >= 3) throw new Error("disk unavailable"); },
	});
	const result = requireSuccess(await original.delegate({ role: "reviewer", task: "review" }));
	assert.equal(result.cleanup.status, "closed");
	const snapshot = requireSuccess(parseDelegateRuntimeState(original.getState()));
	assert.ok(snapshot.persistenceError);
	assert.equal(snapshot.unsafeWriter, undefined);
	const restored = new DelegateRuntime({ ...fixture.options, initialState: snapshot });
	assert.equal((await restored.delegate({ role: "builder", task: "must not run" })).ok, false);
	requireSuccess(await restored.cleanupOwned());
	assert.equal(restored.getState().persistenceError, undefined);
	requireSuccess(await restored.delegate({ role: "builder", task: "fresh task" }));
	const copied = new DelegateRuntime({ ...fixture.options, parentSessionId: "fork", initialState: snapshot });
	const rejected = await copied.cleanupOwned();
	assert.equal(rejected.ok, false);
	if (!rejected.ok) assert.equal(rejected.error.code, "foreign_authority");
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

for (const evidence of ["absent", "name-absent", "agent-timeout", "agent-not-running", "pane-timeout", "pane-present", "pane-killed", "agent-replaced", "agent-moved", "agent-malformed"] as const) {
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
					if (evidence === "agent-malformed") return commandResult("{}");
					if (evidence === "agent-replaced" || evidence === "agent-moved") return commandResult(JSON.stringify({ result: { agent: {
						name: worker.agentName, pane_id: evidence === "agent-moved" ? "moved-pane" : worker.paneId,
						agent_session: { value: evidence === "agent-moved" ? worker.session : "replacement" },
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

test("Worker survives fresh Scout and Reviewer results, then accepts in-task fixes", async () => {
	const fixture = await makeFixture();
	const worker = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "implement" }));
	assert.deepEqual(worker.cleanup, { status: "retained", reason: "worker_followups" });
	for (const role of ["scout", "reviewer"] as const) {
		const result = requireSuccess(await fixture.runtime.delegate({ role, task: "inspect" }));
		assert.equal(result.role, role);
		assert.deepEqual(result.cleanup, { status: "closed" });
		assert.match(await readFile(result.resultPath, "utf8"), /done:inspect/);
		assert.deepEqual(fixture.runtime.getState().workers.map((owned) => owned.id), [worker.worker]);
		assert.equal((await fixture.runtime.delegate({ worker: result.worker, task: "reuse" })).ok, false);
	}
	const fixed = requireSuccess(await fixture.runtime.delegate({ worker: worker.worker, task: "fix" }));
	assert.equal(fixed.session, worker.session);
	assert.equal(fixed.output, "done:fix");
	requireSuccess(await fixture.runtime.cleanupOwned());
	assert.deepEqual(fixture.runtime.getState().workers, []);
});

for (const role of ["worker", "scout", "reviewer", "builder"] as const) {
	test(`${role} persisted identity and fingerprint survive reconstruction unchanged`, async () => {
		const fixture = await makeFixture();
		const built = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "legacy" }));
		const original = fixture.runtime.getState().workers[0];
		assert.ok(original);
		const config = requireSuccess(await loadRoleConfig(fixture.rolePaths[role], role));
		const persisted = { ...original, role, roleFingerprint: roleFingerprint(config) };
		const parsed = requireSuccess(parseDelegateRuntimeState({ ownerSessionId: "parent-session", workers: [persisted] }));
		assert.deepEqual(parsed.workers, [persisted]);
		const restored = new DelegateRuntime({ ...fixture.options, initialState: parsed });
		const result = await restored.delegate({ worker: built.worker, task: "follow-up" });
		if (role === "scout" || role === "reviewer") {
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, `${role}_reuse_forbidden`);
		} else {
			assert.equal(requireSuccess(result).session, built.session);
			assert.deepEqual(restored.getState().workers, [persisted]);
		}
	});
}

for (const role of ["scout", "reviewer"] as const) {
	for (const tools of ["read, write", "read, edit", "read, delegate", "read, read_agent_activity", "read, custom_mutator"]) {
		test(`${role} rejects unsafe tool configuration ${tools}`, async () => {
			const fixture = await makeFixture();
			const source = await readFile(fixture.rolePaths[role], "utf8");
			await writeFile(fixture.rolePaths[role], source.replace("tools: read, bash", `tools: ${tools}`));
			const result = await fixture.runtime.delegate({ role, task: "inspect" });
			assert.equal(result.ok, false);
			if (!result.ok) assert.equal(result.error.code, "role_unsafe");
			assert.deepEqual((await fixture.state()).calls, []);
		});
	}
}

test("Scout captures output even when cleanup fails and blocks subsequent work", async () => {
	const fixture = await makeFixture("cleanup-fails");
	const scout = requireSuccess(await fixture.runtime.delegate({ role: "scout", task: "research only" }));
	assert.equal(scout.output, "done:research only");
	assert.equal(scout.cleanup.status, "failed");
	assert.equal(fixture.runtime.getState().unsafeWriterWorker, scout.worker);
	assert.equal((await fixture.runtime.delegate({ role: "worker", task: "must not start" })).ok, false);
});

test("writer admission excludes both canonical and legacy second writers", async () => {
	const fixture = await makeFixture();
	const retained = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	for (const role of ["worker", "builder"] as const) {
		const result = await fixture.runtime.delegate({ role, task: "another writer" });
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error.code, "writer_exists");
			assert.equal(result.error.worker, retained.worker);
		}
	}
	assert.equal((await fixture.state()).calls.filter((call) => call[1] === "start").length, 1);
});

test("explicit replacement saves a handoff before closure and selects current Worker settings", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "old changes" }));
	const before = await readFile(old.resultPath, "utf8");
	const source = await readFile(fixture.rolePaths.worker, "utf8");
	await writeFile(fixture.rolePaths.worker, source.replace("test-provider/sol", "new-provider/selected-model").replace("thinking: medium", "thinking: high"));
	let handoffAtClosure = "";
	const runtime = new DelegateRuntime({
		...fixture.options, initialState: fixture.runtime.getState(),
		runHerdr: async (args) => {
			if (args[0] === "pane" && args[1] === "close") {
				const directory = join(fixture.options.resultRoot, old.worker);
				const handoff = (await readdir(directory)).find((file) => file.startsWith("replacement-"));
				assert.ok(handoff);
				handoffAtClosure = await readFile(join(directory, handoff), "utf8");
			}
			return fixture.processRun(args);
		},
	});
	const next = requireSuccess(await runtime.delegate({ replace: true, worker: old.worker, role: "worker", task: "Inspect existing changes; finish remaining checks within the original scope." }));
	assert.notEqual(next.worker, old.worker);
	assert.equal(next.role, "worker");
	assert.equal(next.model, "new-provider/selected-model");
	assert.equal(next.thinking, "high");
	assert.match(handoffAtClosure, /Inspect existing changes/);
	assert.match(handoffAtClosure, /Model: new-provider\/selected-model/);
	assert.ok(next.replacement);
	assert.equal(next.replacement.worker, old.worker);
	assert.equal(await readFile(next.replacement.handoffPath, "utf8"), handoffAtClosure);
	assert.equal(await readFile(old.resultPath, "utf8"), before);
	const calls = (await fixture.state()).calls;
	const closeIndex = calls.findIndex((call) => call[1] === "close");
	assert.ok(closeIndex < calls.findLastIndex((call) => call[1] === "start"));
	assert.equal((await runtime.delegate({ worker: old.worker, task: "old handle" })).ok, false);
	requireSuccess(await runtime.delegate({ worker: next.worker, task: "follow-up" }));
});

test("replacement argument combinations fail before Herdr mutation", async () => {
	const fixture = await makeFixture();
	const invalid: readonly DelegateInput[] = [
		{ replace: true, task: "handoff" },
		{ replace: true, role: "worker", task: "handoff" },
		{ replace: true, worker: "old", task: "handoff" },
		{ replace: true, worker: "old", role: "reviewer", task: "handoff" },
		{ replace: true, worker: "old", role: "scout", task: "handoff" },
		{ replace: true, worker: "old", role: "builder", task: "handoff" },
		{ replace: false, worker: "old", role: "worker", task: "handoff" },
		{ replace: true, worker: "old", role: "worker", task: "  " },
	];
	for (const input of invalid) {
		const result = await fixture.runtime.delegate(input);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, "request_invalid");
	}
	assert.deepEqual((await fixture.state()).calls, []);
});

test("concurrent replacements cannot launch two writers or redeliver the old task", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	const input = { replace: true, worker: old.worker, role: "worker", task: "Inspect current files and continue from this handoff." } as const;
	const [first, second, third] = await Promise.all([
		fixture.runtime.delegate(input), fixture.runtime.delegate(input), fixture.runtime.delegate({ role: "worker", task: "third writer" }),
	]);
	requireSuccess(first);
	assert.equal(second.ok, false);
	if (!second.ok) assert.equal(second.error.code, "worker_unknown");
	assert.equal(third.ok, false);
	if (!third.ok) assert.equal(third.error.code, "writer_exists");
	assert.equal((await fixture.state()).calls.filter((call) => call[1] === "start").length, 2);
});

for (const failure of ["close", "killed-close", "identity", "lookup", "publication", "handoff"] as const) {
	test(`replacement ${failure} failure preserves evidence and prevents a new writer`, async () => {
		const fixture = await makeFixture();
		const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
		const root = failure === "handoff" ? join(fixture.root, "not-a-directory") : fixture.options.resultRoot;
		if (failure === "handoff") await writeFile(root, "file");
		const runtime = new DelegateRuntime({
			...fixture.options, resultRoot: root, initialState: fixture.runtime.getState(),
			onStateChange: () => { if (failure === "publication") throw new Error("disk unavailable"); },
			runHerdr: async (args) => {
				if (args[1] === "close" && failure === "close") return commandResult("", 1, "close failed");
				if (args[1] === "close" && failure === "killed-close") return { ...commandResult(), killed: true };
				if (args[0] === "agent" && args[1] === "get" && failure === "lookup") return commandResult("", 1, "lookup timed out");
				if (args[0] === "agent" && args[1] === "get" && failure === "identity") return commandResult(JSON.stringify({ result: { agent: {
					name: old.agentName, pane_id: old.paneId, agent_session: { value: "replacement-session" },
				} } }));
				return fixture.processRun(args);
			},
		});
		const result = await runtime.delegate({ replace: true, role: "worker", worker: old.worker, task: "Parent handoff preserving current changes and checks." });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.error.code, failure === "handoff" ? "handoff_write_failed" : failure === "publication" ? "state_persist_failed" : "worker_unresolved");
		assert.match(await readFile(old.resultPath, "utf8"), /done:first/);
		assert.equal((await fixture.state()).calls.filter((call) => call[1] === "start").length, 1);
		if (failure !== "handoff") {
			assert.ok((await readdir(join(fixture.options.resultRoot, old.worker))).some((file) => file.startsWith("replacement-")));
			assert.equal((await runtime.delegate({ role: "worker", task: "must not launch" })).ok, false);
		}
		assert.equal(runtime.getState().workers.length, failure === "publication" ? 0 : 1);
	});
}

test("aborting replacement after confirmed closure never launches the next writer", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	const controller = new AbortController();
	const runtime = new DelegateRuntime({
		...fixture.options, initialState: fixture.runtime.getState(),
		runHerdr: async (args) => {
			const result = await fixture.processRun(args);
			if (args[1] === "close") controller.abort();
			return result;
		},
	});
	const result = await runtime.delegate({ replace: true, role: "worker", worker: old.worker, task: "Parent handoff" }, controller.signal);
	assert.equal(result.ok, false);
	if (!result.ok) assert.match(result.error.message, /old writer closed.*handoff:/);
	assert.deepEqual(runtime.getState().workers, []);
	assert.equal((await fixture.state()).calls.filter((call) => call[1] === "start").length, 1);
});

test("Worker drift is explicit while legacy builders retain their original configuration", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "legacy" }));
	const original = fixture.runtime.getState().workers[0];
	const source = await readFile(fixture.rolePaths.worker, "utf8");
	await writeFile(fixture.rolePaths.worker, source.replace("thinking: medium", "thinking: high"));
	requireSuccess(await fixture.runtime.delegate({ worker: old.worker, task: "legacy fix" }));
	assert.deepEqual(fixture.runtime.getState().workers[0], original);
	const next = requireSuccess(await fixture.runtime.delegate({ replace: true, worker: old.worker, role: "worker", task: "Inspect legacy changes before continuing." }));
	await writeFile(fixture.rolePaths.worker, source);
	const drift = await fixture.runtime.delegate({ worker: next.worker, task: "fix" });
	assert.equal(drift.ok, false);
	if (!drift.ok) assert.equal(drift.error.code, "role_changed");
	assert.equal(fixture.runtime.getState().workers[0]?.id, next.worker);
});

test("replacement validation failure leaves the old writer and captured result untouched", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	const count = (await fixture.state()).calls.length;
	const runtime = new DelegateRuntime({
		...fixture.options, initialState: fixture.runtime.getState(),
		validateRole: async () => ({ ok: false, error: new DelegationError("model_unavailable", "selected model unavailable") }),
	});
	const result = await runtime.delegate({ replace: true, worker: old.worker, role: "worker", task: "Parent handoff" });
	assert.equal(result.ok, false);
	if (!result.ok) assert.equal(result.error.code, "model_unavailable");
	assert.equal((await fixture.state()).calls.length, count);
	assert.deepEqual(runtime.getState(), fixture.runtime.getState());
	assert.equal((await readdir(join(fixture.options.resultRoot, old.worker))).some((file) => file.startsWith("replacement-")), false);
});

test("replacement can retire specifically absent old agent and pane without closing peers", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	await fixture.processRun(["pane", "close", old.paneId]);
	const next = requireSuccess(await fixture.runtime.delegate({ replace: true, worker: old.worker, role: "worker", task: "Parent inspected prior changes; continue from this handoff." }));
	assert.notEqual(next.worker, old.worker);
	assert.equal((await fixture.state()).calls.filter((call) => call[1] === "close").length, 1);
});

test("replacement startup failure keeps the durable handoff and conservative new startup lock", async () => {
	const fixture = await makeFixture();
	const old = requireSuccess(await fixture.runtime.delegate({ role: "worker", task: "first" }));
	let attempts = 0;
	const runtime = new DelegateRuntime({
		...fixture.options, initialState: fixture.runtime.getState(),
		runHerdr: async (args) => {
			if (args[0] === "agent" && args[1] === "start") {
				attempts += 1;
				return commandResult("", 1, "mise shim failed");
			}
			return fixture.processRun(args);
		},
	});
	const result = await runtime.delegate({ replace: true, worker: old.worker, role: "worker", task: "Parent handoff" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "manual_recovery_required");
		assert.match(result.error.message, /Preserved handoff: .*replacement-.*\.md/);
	}
	assert.equal(attempts, 1);
	assert.deepEqual(runtime.getState().workers, []);
	assert.match(runtime.getState().unsafeWriter ?? "", /mise shim failed/);
	assert.match(await readFile(old.resultPath, "utf8"), /done:first/);
	assert.equal((await runtime.cleanupOwned()).ok, false);
});

test("failed auto-closed Worker requires a fresh parent handoff rather than old-handle reuse", async () => {
	const fixture = await makeFixture("failed");
	const failed = await fixture.runtime.delegate({ role: "worker", task: "first" });
	assert.equal(failed.ok, false);
	assert.deepEqual(fixture.runtime.getState().workers, []);
	const stale = await fixture.runtime.delegate({ worker: "id-1", task: "retry" });
	assert.equal(stale.ok, false);
	if (!stale.ok) assert.equal(stale.error.code, "worker_unknown");
	const next = await fixture.runtime.delegate({ role: "worker", task: "Parent handoff: inspect existing changes and checks before continuing." });
	assert.equal(next.ok, false);
	if (!next.ok) assert.equal(next.error.code, "task_failed");
	assert.equal((await fixture.state()).calls.filter((call) => call[1] === "start").length, 2);
});

test("a deferred target-shell shim failure keeps conservative unpinned startup authority", async () => {
	const fixture = await makeFixture("startup-shim-error");
	const result = await fixture.runtime.delegate({ role: "worker", task: "must not deliver" });
	assert.equal(result.ok, false);
	if (!result.ok) {
		assert.equal(result.error.code, "manual_recovery_required");
		assert.match(result.error.message, /mise ERROR pi is not installed for node 26.8.2/);
	}
	assert.equal((await fixture.runtime.cleanupOwned()).ok, false);
	const restored = new DelegateRuntime({ ...fixture.options, initialState: fixture.runtime.getState() });
	assert.equal((await restored.delegate({ role: "scout", task: "must not bypass lock" })).ok, false);
	const calls = (await fixture.state()).calls;
	assert.equal(calls.filter((call) => call[1] === "start").length, 1);
	assert.equal(calls.some((call) => ["close", "prompt", "run", "send-text", "process-info"].includes(call[1] ?? "")), false);
});

test("cleanup closes only a worker whose live identity and session still match", async () => {
	const fixture = await makeFixture();
	requireSuccess(await fixture.runtime.delegate({ role: "builder", task: "task" }));
	requireSuccess(await fixture.runtime.cleanupOwned());
	const calls = (await fixture.state()).calls;
	assert.ok(calls.some((call) => call[0] === "pane" && call[1] === "close"));
	assert.equal(calls.some((call) => call[0] === "tab" && call[1] === "close"), false);
});
