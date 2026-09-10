import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

const roleSource = (role: "builder" | "reviewer", model: string): string => `---
name: ${role}
description: ${role} fixture
model: ${model}
thinking: medium
tools: ${role === "builder" ? "read, bash, edit, write" : "read, bash"}
---

Perform the ${role} task without delegation.
`;

test("real Pi entrypoints guard cleanup and classify unavailable role models", async () => {
	const root = await mkdtemp(join(tmpdir(), "delegate-entrypoints-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousChild = process.env.PI_HERDR_DELEGATE_CHILD;
	const previousResultRoot = process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
	const previousWorker = process.env.PI_HERDR_DELEGATE_WORKER;
	const previousHerdr = process.env.HERDR_ENV;
	const previousPane = process.env.HERDR_PANE_ID;
	const previousWorkspace = process.env.HERDR_WORKSPACE_ID;
	process.env.PI_CODING_AGENT_DIR = root;
	delete process.env.PI_HERDR_DELEGATE_CHILD;
	delete process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
	delete process.env.PI_HERDR_DELEGATE_WORKER;
	await mkdir(join(root, "agents"), { recursive: true });
	await Promise.all([
		writeFile(join(root, "agents", "builder.md"), roleSource("builder", "missing/provider")),
		writeFile(join(root, "agents", "reviewer.md"), roleSource("reviewer", "missing/provider")),
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
	const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
	const { session } = await createAgentSession({
		cwd: root,
		agentDir: root,
		modelRuntime,
		resourceLoader: loader,
		settingsManager,
		sessionManager: SessionManager.inMemory(root),
		tools: ["read", "bash", "edit", "write"],
	});
	await session.bindExtensions({ mode: "print" });
	try {
		const cleanup = session.extensionRunner.getRegisteredCommands()
			.find((command) => command.name === "delegate-cleanup");
		assert.ok(cleanup);
		delete process.env.HERDR_ENV;
		delete process.env.HERDR_PANE_ID;
		delete process.env.HERDR_WORKSPACE_ID;
		await cleanup.handler("", session.extensionRunner.createCommandContext());

		process.env.HERDR_ENV = "1";
		process.env.HERDR_PANE_ID = "parent-pane";
		process.env.HERDR_WORKSPACE_ID = "parent-workspace";
		const delegate = session.getToolDefinition("delegate");
		assert.ok(delegate);
		await assert.rejects(
			delegate.execute(
				"call",
				{ role: "reviewer", task: "review" },
				new AbortController().signal,
				undefined,
				session.extensionRunner.createContext(),
			),
			/model_unavailable/,
		);
	} finally {
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
		await rm(root, { recursive: true, force: true });
	}
});
