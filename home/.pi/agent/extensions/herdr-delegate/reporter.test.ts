import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createAgentSession,
	DefaultResourceLoader,
	formatSkillsForPrompt,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

const reporterResultSchema = Type.Object({ status: Type.String() });

const usage = {
	input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

test("real Pi input and settled events report only stop as completed", async () => {
	const root = await mkdtemp(join(tmpdir(), "delegate-reporter-"));
	const worker = "reporter-worker";
	process.env.PI_HERDR_DELEGATE_CHILD = "1";
	process.env.PI_HERDR_DELEGATE_RESULT_ROOT = root;
	process.env.PI_HERDR_DELEGATE_WORKER = worker;
	const cwd = process.cwd();
	const settingsManager = SettingsManager.inMemory({ packages: [] });
	const loader = new DefaultResourceLoader({
		cwd, agentDir: root, settingsManager, noExtensions: true,
		additionalExtensionPaths: [join(import.meta.dirname, "index.ts")],
		noThemes: true, noPromptTemplates: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
	const { session } = await createAgentSession({
		cwd, agentDir: root, modelRuntime, resourceLoader: loader, settingsManager,
		sessionManager: SessionManager.inMemory(cwd), tools: ["read"],
	});
	await session.bindExtensions({ mode: "print" });
	try {
		assert.equal(session.extensionRunner.getToolDefinition("delegate"), undefined);
		assert.equal(session.extensionRunner.getToolDefinition("read_agent_activity"), undefined);
		assert.equal((await session.extensionRunner.emitInput("/skill:orchestrate another worker", undefined, "interactive")).action, "handled");
		const skills = ["orchestrate", "coding-standards"].map((name) => ({
			name, description: `${name} fixture`, filePath: join(root, name, "SKILL.md"), baseDir: join(root, name), disableModelInvocation: false,
			sourceInfo: { path: join(root, name, "SKILL.md"), source: "custom", scope: "temporary" as const, origin: "top-level" as const },
		}));
		const prompt = await session.extensionRunner.emitBeforeAgentStart("task", undefined, formatSkillsForPrompt(skills, "read"), { cwd, selectedTools: ["read"], skills });
		assert.ok(prompt?.systemPrompt);
		assert.doesNotMatch(prompt.systemPrompt, /<name>orchestrate<\/name>/);
		assert.match(prompt.systemPrompt, /<name>coding-standards<\/name>/);
		assert.match(prompt.systemPrompt, /Do not delegate, launch other agents/);
		assert.match(prompt.systemPrompt, /never blindly repeat an uncertain task/);
		for (const [stopReason, expected] of [
			["stop", "completed"], ["length", "incomplete"], ["toolUse", "incomplete"],
			["error", "failed"], ["aborted", "failed"],
		] as const) {
			const taskId = `task-${stopReason}`;
			const startedAt = Date.now() - 1;
			const envelope = Buffer.from(JSON.stringify({ version: 1, taskId, worker, startedAt })).toString("base64url");
			const input = await session.extensionRunner.emitInput(`[[herdr-delegate:v1:${envelope}]]\ncheck`, undefined, "interactive");
			assert.equal(input.action, "transform");
			session.sessionManager.appendMessage({
				role: "assistant", content: [{ type: "text", text: `output-${stopReason}` }],
				provider: "test", model: "test", api: "openai-codex-responses", stopReason,
				timestamp: Date.now(), usage,
			});
			await session.extensionRunner.emit({ type: "agent_settled" });
			const result: unknown = JSON.parse(await readFile(join(root, worker, `${taskId}.json`), "utf8"));
			assert.ok(Value.Check(reporterResultSchema, result));
			assert.equal(result.status, expected);
		}
		const unsafeEnvelope = Buffer.from(JSON.stringify({ version: 1, taskId: "../escape", worker, startedAt: Date.now() })).toString("base64url");
		assert.equal((await session.extensionRunner.emitInput(`[[herdr-delegate:v1:${unsafeEnvelope}]]\ncheck`, undefined, "interactive")).action, "handled");
	} finally {
		session.dispose();
		delete process.env.PI_HERDR_DELEGATE_CHILD;
		delete process.env.PI_HERDR_DELEGATE_RESULT_ROOT;
		delete process.env.PI_HERDR_DELEGATE_WORKER;
		await rm(root, { recursive: true, force: true });
	}
});
