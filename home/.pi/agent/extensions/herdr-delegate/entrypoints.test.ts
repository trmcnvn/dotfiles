import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getSupportedThinkingLevels, validateToolCall } from "@earendil-works/pi-ai";
import type { DelegateInput } from "./delegation.ts";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const roleSource = (
	role: "worker" | "scout" | "reviewer",
	model: string,
	thinking: (typeof THINKING_LEVELS)[number],
): string => `---
name: ${role}
description: ${role} fixture
model: ${model}
thinking: ${thinking}
tools: ${role === "worker" ? "read, bash, edit, write" : "read, bash"}
---

Perform the ${role} task without delegation.
`;

const ownedWorkerState = {
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
};

test("real SDK startup recovery confirms explicitly, deduplicates cleanup, and survives same-session reload", async () => {
	const root = await mkdtemp(join(tmpdir(), "delegate-sdk-recovery-"));
	const environment = new Map(["PI_CODING_AGENT_DIR", "PI_HERDR_DELEGATE_CHILD", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID"].map((key) => [key, process.env[key]]));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		process.env.PI_CODING_AGENT_DIR = root;
		delete process.env.PI_HERDR_DELEGATE_CHILD;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "parent-pane";
		process.env.HERDR_WORKSPACE_ID = "workspace";
		const failure = "agent startup failed after creating pane=missing-pane, tab=missing-tab, workspace=workspace (timeout); native session identity was not pinned";
		const manager = SessionManager.create(root, join(root, "sessions"));
		manager.appendMessage({ role: "assistant", content: [], api: "anthropic-messages", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
		const locked = { ownerSessionId: manager.getSessionId(), workers: [], unsafeWriter: failure };
		manager.appendCustomEntry("herdr-delegate-state", locked);
		const settingsManager = SettingsManager.inMemory({ packages: [] });
		const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager, noExtensions: true, additionalExtensionPaths: [join(import.meta.dirname, "index.ts")], noThemes: true, noPromptTemplates: true, noSkills: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const created = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: await ModelRuntime.create({ allowModelNetwork: false }), resourceLoader: loader, settingsManager, sessionManager: manager });
		session = created.session;
		const notices: string[] = [];
		const confirmations: string[] = [];
		const errors: string[] = [];
		let confirm = false;
		let failNotify = false;
		let beforeConfirm: (() => Promise<void>) | undefined;
		await session.bindExtensions({ mode: "tui", onError: (error) => { errors.push(error.error); }, uiContext: {
			...session.extensionRunner.getUIContext(),
			notify: (message) => { if (failNotify) throw new Error("notification unavailable"); notices.push(message); },
			confirm: async (_title, message) => { confirmations.push(message); await beforeConfirm?.(); return confirm; },
		} });
		const cleanup = async (args = "") => {
			const command = created.session.extensionRunner.getRegisteredCommands().find((candidate) => candidate.name === "delegate-cleanup");
			assert.ok(command);
			await command.handler(args, created.session.extensionRunner.createCommandContext());
		};
		const settled = () => created.session.extensionRunner.emit({ type: "agent_settled" });
		const automaticNotices = () => notices.filter((message) => message.startsWith("Automatic delegation cleanup failed:"));
		const sessionFile = manager.getSessionFile();
		assert.ok(sessionFile);
		const entriesBeforeNotice = manager.getEntries();
		const leafBeforeNotice = manager.getLeafId();
		const diskBeforeNotice = await readFile(sessionFile, "utf8");
		await rename(sessionFile, `${sessionFile}.saved`);
		await mkdir(sessionFile);
		try {
			await settled();
			await settled();
			assert.deepEqual(manager.getEntries(), entriesBeforeNotice, "notification bookkeeping must not append even when disk writes would fail");
			assert.equal(manager.getLeafId(), leafBeforeNotice, "notification must not advance ancestry");
		} finally {
			await rm(sessionFile, { recursive: true });
			await rename(`${sessionFile}.saved`, sessionFile);
		}
		assert.equal(await readFile(sessionFile, "utf8"), diskBeforeNotice);
		manager.appendMessage({ role: "user", content: "message after cleanup notification", timestamp: Date.now() });
		const notificationReopen = SessionManager.open(sessionFile);
		assert.deepEqual(notificationReopen.getBranch(), manager.getBranch(), "message ancestry must survive disk reopen");
		const survivingLock = notificationReopen.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === "herdr-delegate-state");
		assert.ok(survivingLock?.type === "custom");
		assert.deepEqual(survivingLock.data, locked);
		assert.equal(automaticNotices().length, 1);
		await cleanup();
		await cleanup();
		assert.equal(notices.filter((message) => message.startsWith("manual_recovery_required:")).length, 2, "manual reports remain useful");
		await session.reload();
		assert.equal(session.sessionId, manager.getSessionId());
		await settled();
		assert.equal(automaticNotices().length, 2, "reload may remind once in the new instance");
		await cleanup("force");
		assert.equal(confirmations.length, 0);
		const ui = session.extensionRunner.getUIContext();
		session.extensionRunner.setUIContext(undefined, "print");
		await cleanup("acknowledge-startup");
		assert.equal(confirmations.length, 0, "headless recovery must not assume confirmation");
		session.extensionRunner.setUIContext(ui, "tui");
		await session.followUp("queued parent continuation");
		await cleanup("acknowledge-startup");
		assert.equal(confirmations.length, 0, "queued parent activity refuses confirmation");
		session.clearQueue();
		await cleanup("acknowledge-startup");
		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0] ?? "", /missing-pane/);
		assert.match(confirmations[0] ?? "", /personally verified.*moved or renamed/);
		assert.match(notices.at(-1) ?? "", /cancelled; safety lock retained/);
		await cleanup();
		assert.match(notices.at(-1) ?? "", /manual_recovery_required/);
		confirm = true;
		beforeConfirm = () => created.session.followUp("continuation arriving during confirmation");
		await cleanup("acknowledge-startup");
		assert.match(notices.at(-1) ?? "", /Parent activity changed; safety lock retained/);
		beforeConfirm = undefined;
		session.clearQueue();
		await rename(sessionFile, `${sessionFile}.saved`);
		await mkdir(sessionFile);
		try {
			await cleanup("acknowledge-startup");
			assert.match(notices.at(-1) ?? "", /state_persist_failed/);
			await session.reload();
			await cleanup();
			assert.match(notices.at(-1) ?? "", /manual_recovery_required/, "publication failure stays locked through real SDK reload");
		} finally {
			await rm(sessionFile, { recursive: true });
			await rename(`${sessionFile}.saved`, sessionFile);
		}
		await cleanup("acknowledge-startup");
		assert.match(notices.at(-1) ?? "", /cleared by your explicit attestation/);
		await session.reload();
		await cleanup();
		assert.equal(notices.at(-1), "Owned delegation workers cleaned up.");
		assert.equal(confirmations.length, 4);
		const reopened = SessionManager.open(sessionFile);
		const recoveredEntry = reopened.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === "herdr-delegate-state");
		assert.ok(recoveredEntry?.type === "custom");
		assert.deepEqual(recoveredEntry.data, { ownerSessionId: manager.getSessionId(), workers: [] });

		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		manager.appendCustomEntry("herdr-delegate-state", locked);
		await session.reload();
		failNotify = true;
		await settled();
		assert.ok(errors.some((error) => error.includes("notification unavailable")));
		failNotify = false;
		await rename(sessionFile, `${sessionFile}.saved`);
		await mkdir(sessionFile);
		try {
			await settled();
			await settled();
			assert.equal(automaticNotices().length, 3, "notification deduplication does not require writable session storage");
		} finally {
			await rm(sessionFile, { recursive: true });
			await rename(`${sessionFile}.saved`, sessionFile);
		}
		await settled();
		assert.equal(automaticNotices().length, 3, "a later recurrence is visible, and failed notification is retried");
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		manager.appendCustomEntry("herdr-delegate-state", { ...locked, unsafeWriter: `${failure}; changed failure` });
		await session.reload();
		await settled();
		assert.equal(automaticNotices().length, 4, "changed failure is reported");

		beforeConfirm = () => created.session.reload();
		await cleanup("acknowledge-startup");
		beforeConfirm = undefined;
		await cleanup();
		assert.match(notices.at(-1) ?? "", /manual_recovery_required/, "confirmation from an invalidated instance cannot clear the new runtime");
		const beforeRefusals = confirmations.length;
		for (const authority of [
			{ ...locked, ownerSessionId: "foreign-parent" },
			{ ...locked, pending: null },
			{ ...locked, startupResource: null },
			{ ...locked, startupResource: { worker: "", agentName: "agent", paneId: "pane", tabId: "tab", workspaceId: "workspace" } },
			{ ...ownedWorkerState, ownerSessionId: manager.getSessionId(), unsafeWriter: failure, unsafeWriterWorker: "worker" },
			{ ...ownedWorkerState, ownerSessionId: manager.getSessionId(), pending: { taskId: "delivered", worker: "worker", resultPath: "/tmp/result", startedAt: 1 } },
		]) {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
			manager.appendCustomEntry("herdr-delegate-state", authority);
			await session.reload();
			await cleanup("acknowledge-startup");
			assert.equal(confirmations.length, beforeRefusals);
			assert.match(notices.at(-1) ?? "", /foreign_authority|state_corrupt|startup_recovery_unavailable/);
		}
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		manager.appendCustomEntry("herdr-delegate-state", { ...locked, ownerSessionId: "foreign-parent" });
		await session.reload();
		await settled();
		await settled();
		assert.match(automaticNotices().at(-1) ?? "", /foreign_authority/);
		const foreignCount = automaticNotices().length;
		await session.reload();
		await settled();
		assert.equal(automaticNotices().length, foreignCount + 1, "foreign authority may remind once after reload");
	} finally {
		session?.dispose();
		for (const [key, value] of environment) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("real SDK tool validation admits only current roles and rejects Builder without mutation", async () => {
	const root = await mkdtemp(join(tmpdir(), "delegate-sdk-roles-"));
	const environment = new Map(["PI_CODING_AGENT_DIR", "PI_HERDR_DELEGATE_CHILD", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "PATH"].map((key) => [key, process.env[key]]));
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		process.env.PI_CODING_AGENT_DIR = root;
		delete process.env.PI_HERDR_DELEGATE_CHILD;
		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "parent-pane";
		process.env.HERDR_WORKSPACE_ID = "workspace";
		const bin = join(root, "bin");
		await mkdir(bin);
		await mkdir(join(root, "agents"));
		const statePath = join(root, "fake-state.json");
		await writeFile(statePath, JSON.stringify({ calls: [], scenario: "success" }));
		await writeFile(join(bin, "herdr"), `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dirname, "fake-herdr.mjs")}" "${statePath}" "$@"\n`, { mode: 0o755 });
		process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;
		const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
		const model = modelRuntime.getModels().find((candidate) => candidate.provider === "anthropic" && getSupportedThinkingLevels(candidate).includes("off"));
		assert.ok(model);
		await modelRuntime.setRuntimeApiKey(model.provider, "fixture-not-a-real-key");
		for (const role of ["worker", "scout", "reviewer"] as const) {
			await writeFile(join(root, "agents", `${role}.md`), roleSource(role, `${model.provider}/${model.id}`, "off"));
		}
		const settingsManager = SettingsManager.inMemory({ packages: [] });
		const loader = new DefaultResourceLoader({
			cwd: root, agentDir: root, settingsManager, noExtensions: true,
			additionalExtensionPaths: [join(import.meta.dirname, "index.ts")], noThemes: true, noPromptTemplates: true, noSkills: true,
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const created = await createAgentSession({
			cwd: root, agentDir: root, modelRuntime, model, resourceLoader: loader, settingsManager,
			sessionManager: SessionManager.inMemory(root), tools: ["read", "bash", "edit", "write", "delegate"],
		});
		session = created.session;
		await session.bindExtensions({ mode: "print" });
		const tool = session.agent.state.tools.find((candidate) => candidate.name === "delegate");
		assert.ok(tool);
		assert.match(tool.description, /worker — worker fixture.*scout — scout fixture.*reviewer — reviewer fixture/);
		assert.doesNotMatch(tool.description, /builder/i);
		const beforeRejected = await readFile(statePath, "utf8");
		for (const arguments_ of [{ role: "builder", task: "retired" }, { replace: true, role: "builder", worker: "old", task: "retired" }]) {
			assert.throws(() => validateToolCall([tool], { type: "toolCall", id: "retired", name: "delegate", arguments: arguments_ }));
		}
		assert.equal(await readFile(statePath, "utf8"), beforeRejected);
		const invoke = async (input: DelegateInput) => {
			validateToolCall([tool], { type: "toolCall", id: "call", name: "delegate", arguments: { ...input } });
			return tool.execute("call", input, new AbortController().signal);
		};
		for (const role of ["scout", "reviewer"] as const) {
			const result = await invoke({ role, task: "Inspect only." });
			assert.match(JSON.stringify(result.content), new RegExp(`Worker finished \\(${role}\\)`));
			assert.match(JSON.stringify(result.content), /matching owned pane closed/);
		}
		const first = await invoke({ role: "worker", task: "Use current Worker configuration." });
		const text = first.content.find((part) => part.type === "text");
		assert.ok(text && text.type === "text");
		assert.match(text.text, /Worker finished \(worker\)/);
		const handle = /Worker: ([^\n]+)/.exec(text.text)?.[1];
		assert.ok(handle);
		await invoke({ worker: handle, task: "Inspect existing changes and fix only the identified issue." });
		const replacement = await invoke({ replace: true, worker: handle, role: "worker", task: "Parent handoff: inspect existing changes; preserve scope; finish checks." });
		assert.match(JSON.stringify(replacement.content), /Replaced worker:/);
		await assert.rejects(invoke({ role: "worker", task: "second writer" }), /writer_exists/);
		await assert.rejects(invoke({ replace: true, role: "scout", task: "invalid" }), /request_invalid/);
		for (const arguments_ of [{ role: "unknown", task: "bad" }, { role: "scout", task: "bad", replace: "yes" }, { role: "worker", task: "bad", timeoutMs: 1 }]) {
			assert.throws(() => validateToolCall([tool], { type: "toolCall", id: "bad", name: "delegate", arguments: arguments_ }));
		}
		await session.extensionRunner.emit({ type: "agent_settled" });
	} finally {
		session?.dispose();
		for (const [key, value] of environment) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("real Pi entrypoints preserve legacy Builder authority, refuse follow-ups, and clean safely", async () => {
	const root = await mkdtemp(join(tmpdir(), "delegate-entrypoints-"));
	const bin = join(root, "bin");
	const sentinel = join(root, "herdr-called");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousChild = process.env.PI_HERDR_DELEGATE_CHILD;
	const previousResultRoot = process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
	const previousWorker = process.env.PI_HERDR_DELEGATE_WORKER;
	const previousHerdr = process.env.HERDR_ENV;
	const previousPane = process.env.HERDR_PANE_ID;
	const previousWorkspace = process.env.HERDR_WORKSPACE_ID;
	const previousPath = process.env.PATH;
	process.env.PI_CODING_AGENT_DIR = root;
	delete process.env.PI_HERDR_DELEGATE_CHILD;
	delete process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
	delete process.env.PI_HERDR_DELEGATE_WORKER;
	await mkdir(join(root, "agents"), { recursive: true });
	await mkdir(bin);
	await writeFile(join(bin, "herdr"), `#!/bin/sh
printf '%s %s %s\\n' "$1" "$2" "$3" >> "$HERDR_TEST_SENTINEL"
if [ "$1 $2" = "agent get" ]; then
  printf '%s\\n' '{"result":{"agent":{"name":"delegate-builder-worker","pane_id":"worker-pane","agent_status":"idle","agent_session":{"value":"/tmp/worker.jsonl"}}}}'
  exit 0
fi
if [ "$1 $2" = "pane close" ]; then
  if [ -n "$HERDR_TEST_CLOSE_GATE" ]; then
    while [ ! -f "$HERDR_TEST_CLOSE_GATE" ]; do sleep 0.01; done
  fi
  if [ -n "$HERDR_TEST_CLOSE_FAILURE" ]; then
    printf '%s\\n' '{"error":{"code":"close_failed","message":"fixture closure failure"}}' >&2
    exit 1
  fi
  printf '%s\\n' '{"result":{}}'
  exit 0
fi
exit 99
`, { mode: 0o755 });
	process.env.PATH = `${bin}:${previousPath ?? ""}`;
	process.env.HERDR_TEST_SENTINEL = sentinel;

	const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
	const model = modelRuntime.getModels().find((candidate) =>
		getSupportedThinkingLevels(candidate).length < THINKING_LEVELS.length,
	);
	assert.ok(model);
	const unsupportedThinking = THINKING_LEVELS.find((level) => !getSupportedThinkingLevels(model).includes(level));
	assert.ok(unsupportedThinking);
	const modelName = `${model.provider}/${model.id}`;
	await Promise.all([
		writeFile(join(root, "agents", "worker.md"), roleSource("worker", modelName, "off")),
		writeFile(join(root, "agents", "reviewer.md"), roleSource("reviewer", modelName, unsupportedThinking)),
	]);
	const settingsManager = SettingsManager.inMemory({ packages: [] });
	const loader = new DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager,
		noExtensions: true,
		additionalExtensionPaths: [join(import.meta.dirname, "index.ts")],
		noThemes: true,
		noPromptTemplates: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);

	const sessionManager = SessionManager.inMemory(root);
	sessionManager.appendCustomEntry("herdr-delegate-state", {
		...ownedWorkerState,
		ownerSessionId: sessionManager.getSessionId(),
	});
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		modelRuntime,
		resourceLoader: loader,
		settingsManager,
		sessionManager,
		tools: ["read", "bash", "edit", "write"],
	});
	const extensionErrors: string[] = [];
	await session.bindExtensions({ mode: "print", onError: (error) => { extensionErrors.push(error.error); } });
	let corruptSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	try {
		const notifications: string[] = [];
		const cleanup = session.extensionRunner.getRegisteredCommands()
			.find((command) => command.name === "delegate-cleanup");
		assert.ok(cleanup);
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_PANE_ID;
		delete process.env.HERDR_WORKSPACE_ID;
		const cleanupContext = session.extensionRunner.createCommandContext();
		cleanupContext.ui.notify = (message) => { notifications.push(message); };
		await cleanup.handler("", cleanupContext);
		assert.deepEqual(notifications, ["Delegation cleanup requires HERDR_ENV=1; no panes were touched."]);
		assert.equal(existsSync(sentinel), false);
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		assert.equal(existsSync(sentinel), false);

		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "parent-pane";
		process.env.HERDR_WORKSPACE_ID = "parent-workspace";
		assert.equal(existsSync(sentinel), false);
		await session.reload();
		assert.equal(existsSync(sentinel), false, "reload alone must retain legacy Builder ownership");
		const legacyTool = session.extensionRunner.getToolDefinition("delegate");
		assert.ok(legacyTool);
		const beforeFollowup = sessionManager.getBranch();
		await assert.rejects(legacyTool.execute("legacy", { worker: "worker", task: "must not deliver" }, new AbortController().signal, undefined, session.extensionRunner.createContext()), /role_retired/);
		assert.deepEqual(sessionManager.getBranch(), beforeFollowup);
		assert.equal(existsSync(sentinel), false, "retired follow-up must not call Herdr");
		await session.extensionRunner.emit({ type: "agent_end", messages: [] });
		assert.equal(existsSync(sentinel), false);
		const gate = join(root, "allow-close");
		process.env.HERDR_TEST_CLOSE_GATE = gate;
		const settled = session.extensionRunner.emit({ type: "agent_settled" });
		const deadline = Date.now() + 3_000;
		while (!existsSync(sentinel) || !(await readFile(sentinel, "utf8")).includes("pane close")) {
			assert.ok(Date.now() < deadline, "settled cleanup should reach the close gate");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(session.isIdle, true, "Pi exposes idle during awaited settled cleanup");
		let reloaded = false;
		const reload = session.reload().then(() => { reloaded = true; });
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(reloaded, false, "reload must drain the old cleanup before invalidation");
		await writeFile(gate, "close");
		await Promise.all([settled, reload]);
		assert.deepEqual(extensionErrors, []);
		delete process.env.HERDR_TEST_CLOSE_GATE;
		assert.match(await readFile(sentinel, "utf8"), /^agent get delegate-builder-worker\npane close worker-pane\n$/);
		const latestState = sessionManager.getBranch().at(-1);
		assert.equal(latestState?.type, "custom");
		if (latestState?.type === "custom") assert.deepEqual(latestState.data, { ownerSessionId: sessionManager.getSessionId(), workers: [] });
		await session.extensionRunner.emit({ type: "agent_settled" });
		assert.equal((await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length, 2, "reloaded runtime must not retain stale closed authority");

		const delegate = session.extensionRunner.getToolDefinition("delegate");
		assert.ok(delegate);
		await assert.rejects(
			delegate.execute(
				"call",
				{ role: "reviewer", task: "review" },
				new AbortController().signal,
				undefined,
				session.extensionRunner.createContext(),
			),
			/thinking_unsupported/,
		);
		assert.equal((await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length, 2);

		// A delayed failed cleanup may finish after shutdown starts; only the new runtime should notify.
		await session.extensionRunner.emit({ type: "session_shutdown", reason: "reload" });
		sessionManager.appendCustomEntry("herdr-delegate-state", { ...ownedWorkerState, ownerSessionId: sessionManager.getSessionId() });
		await session.reload();
		await session.bindExtensions({ mode: "tui", uiContext: { ...session.extensionRunner.getUIContext(), notify: (message) => { notifications.push(message); } } });
		const failureGate = join(root, "allow-failed-close");
		process.env.HERDR_TEST_CLOSE_GATE = failureGate;
		process.env.HERDR_TEST_CLOSE_FAILURE = "1";
		const failedSettled = session.extensionRunner.emit({ type: "agent_settled" });
		const failureDeadline = Date.now() + 3_000;
		while ((await readFile(sentinel, "utf8")).split("pane close").length < 3) {
			assert.ok(Date.now() < failureDeadline);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const failureReload = session.reload();
		await writeFile(failureGate, "release");
		await Promise.all([failedSettled, failureReload]);
		assert.equal(notifications.filter((message) => message.startsWith("Automatic delegation cleanup failed:")).length, 0);
		delete process.env.HERDR_TEST_CLOSE_GATE;
		const callsBeforeRetry = (await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length;
		await session.extensionRunner.emit({ type: "agent_settled" });
		await session.extensionRunner.emit({ type: "agent_settled" });
		assert.equal((await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length, callsBeforeRetry + 4, "deduplication must not suppress cleanup attempts");
		assert.equal(notifications.filter((message) => message.startsWith("Automatic delegation cleanup failed:")).length, 1);
		await session.reload();
		await session.extensionRunner.emit({ type: "agent_settled" });
		assert.equal(notifications.filter((message) => message.startsWith("Automatic delegation cleanup failed:")).length, 2);
		delete process.env.HERDR_TEST_CLOSE_FAILURE;
		await session.extensionRunner.emit({ type: "agent_settled" });
		const callsAfterRecovery = (await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length;

		const corruptManager = SessionManager.inMemory(root);
		corruptManager.appendCustomEntry("herdr-delegate-state", {
			...ownedWorkerState,
			ownerSessionId: corruptManager.getSessionId(),
			pending: { taskId: "", worker: "worker", resultPath: "/tmp/result.json", startedAt: 1 },
		});
		const created = await createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			resourceLoader: loader,
			settingsManager,
			sessionManager: corruptManager,
			tools: ["read", "bash", "edit", "write"],
		});
		corruptSession = created.session;
		await corruptSession.bindExtensions({ mode: "print" });
		const corruptCleanup = corruptSession.extensionRunner.getRegisteredCommands()
			.find((command) => command.name === "delegate-cleanup");
		assert.ok(corruptCleanup);
		const entriesBefore = corruptManager.getBranch().length;
		const corruptNotifications: string[] = [];
		const corruptContext = corruptSession.extensionRunner.createCommandContext();
		corruptContext.ui.notify = (message) => { corruptNotifications.push(message); };
		await corruptCleanup.handler("", corruptContext);
		assert.match(corruptNotifications[0] ?? "", /state_corrupt/);
		assert.equal((await readFile(sentinel, "utf8")).split("\n").filter(Boolean).length, callsAfterRecovery);
		assert.equal(corruptManager.getBranch().length, entriesBefore);
	} finally {
		corruptSession?.dispose();
		session.dispose();
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousChild === undefined) delete process.env.PI_HERDR_DELEGATE_CHILD;
		else process.env.PI_HERDR_DELEGATE_CHILD = previousChild;
		if (previousResultRoot === undefined) delete process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
		else process.env.PI_HERDR_DELEGATE_RESULT_ROOT = previousResultRoot;
		if (previousWorker === undefined) delete process.env.PI_HERDR_DELEGATE_WORKER;
		else process.env.PI_HERDR_DELEGATE_WORKER = previousWorker;
		if (previousHerdr === undefined) delete process.env.HERDR_ENV;
		else process.env.HERDR_ENV = previousHerdr;
		if (previousPane === undefined) delete process.env.HERDR_PANE_ID;
		else process.env.HERDR_PANE_ID = previousPane;
		if (previousWorkspace === undefined) delete process.env.HERDR_WORKSPACE_ID;
		else process.env.HERDR_WORKSPACE_ID = previousWorkspace;
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
		delete process.env.HERDR_TEST_SENTINEL;
		delete process.env.HERDR_TEST_CLOSE_GATE;
		delete process.env.HERDR_TEST_CLOSE_FAILURE;
		await rm(root, { recursive: true, force: true });
	}
});
