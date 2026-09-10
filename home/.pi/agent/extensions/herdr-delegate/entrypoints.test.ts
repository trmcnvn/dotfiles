import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const roleSource = (
	role: "builder" | "reviewer",
	model: string,
	thinking: (typeof THINKING_LEVELS)[number],
): string => `---
name: ${role}
description: ${role} fixture
model: ${model}
thinking: ${thinking}
tools: ${role === "builder" ? "read, bash, edit, write" : "read, bash"}
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

test("real Pi entrypoints preserve guards, restoration locks, and thinking classification", async () => {
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
		writeFile(join(root, "agents", "builder.md"), roleSource("builder", modelName, "off")),
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
	await session.bindExtensions({ mode: "print" });
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
		await session.extensionRunner.emit({ type: "agent_end", messages: [] });
		assert.equal(existsSync(sentinel), false);
		await session.extensionRunner.emit({ type: "agent_settled" });
		assert.match(await readFile(sentinel, "utf8"), /^agent get delegate-builder-worker\npane close worker-pane\n$/);
		const latestState = sessionManager.getBranch().at(-1);
		assert.equal(latestState?.type, "custom");
		if (latestState?.type === "custom") assert.deepEqual(latestState.data, { ownerSessionId: sessionManager.getSessionId(), workers: [] });

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
		assert.equal(existsSync(sentinel), false);
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
		await rm(root, { recursive: true, force: true });
	}
});
