import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import herdrDelegateExtension from "./index.ts";

test("entrypoint guards prevent out-of-Herdr cleanup and reject unsupported xhigh", async () => {
	const handlers = new Map<string, (...args: readonly unknown[]) => unknown>();
	let cleanupCommand: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
	let executeDelegate: ((
		id: string,
		params: { task: string; role: "reviewer" },
		signal: AbortSignal,
	) => Promise<unknown>) | undefined;
	let execCalls = 0;
	const notifications: string[] = [];
	const toolNames: string[] = [];

	const pi = {
		on(name: string, handler: (...args: readonly unknown[]) => unknown) {
			handlers.set(name, handler);
		},
		registerCommand(name: string, command: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) {
			if (name === "delegate-cleanup") cleanupCommand = command.handler;
		},
		registerTool(tool: {
			name: string;
			execute: (id: string, params: { task: string; role: "reviewer" }, signal: AbortSignal) => Promise<unknown>;
		}) {
			toolNames.push(tool.name);
			if (tool.name === "delegate") executeDelegate = tool.execute;
		},
		exec: async () => {
			execCalls += 1;
			return { code: 0, stdout: "", stderr: "", killed: false };
		},
		appendEntry() {},
		getAllTools: () => [{ name: "read" }, { name: "bash" }],
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;

	await herdrDelegateExtension(pi);
	assert.deepEqual(toolNames, ["delegate", "read_agent_activity"]);
	const sessionContext = {
		cwd: process.cwd(),
		sessionManager: {
			getBranch: () => [{
				type: "custom",
				customType: "herdr-delegate-state",
				data: {
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
			}],
			getSessionId: () => "parent-session",
		},
		modelRegistry: {
			find: () => ({
				id: "gpt-6-astra",
				provider: "openai-codex",
				api: "openai-codex-responses",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1,
				maxTokens: 1,
			}),
			getProviderAuth: async () => "token",
		},
		ui: { notify: (message: string) => { notifications.push(message); } },
	} as unknown as ExtensionContext;

	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	delete process.env.HERDR_WORKSPACE_ID;
	await handlers.get("session_start")?.({}, sessionContext);
	assert.ok(cleanupCommand);
	await cleanupCommand("", sessionContext);
	await handlers.get("session_shutdown")?.({ reason: "quit" }, sessionContext);

	assert.equal(execCalls, 0);
	assert.match(notifications[0] ?? "", /requires HERDR_ENV=1/);

	process.env.HERDR_ENV = "1";
	process.env.HERDR_PANE_ID = "parent-pane";
	process.env.HERDR_WORKSPACE_ID = "parent-workspace";
	assert.ok(executeDelegate);
	await assert.rejects(
		executeDelegate("call", { role: "reviewer", task: "review" }, new AbortController().signal),
		/thinking_unsupported/,
	);
	delete process.env.HERDR_ENV;
	delete process.env.HERDR_PANE_ID;
	delete process.env.HERDR_WORKSPACE_ID;
	assert.equal(execCalls, 0);
});
