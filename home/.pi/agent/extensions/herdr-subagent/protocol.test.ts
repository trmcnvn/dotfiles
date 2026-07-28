import assert from "node:assert/strict";
import test from "node:test";

import { HerdrProtocol } from "./protocol.ts";

test("parses the pane created by Herdr", () => {
	const parsed = HerdrProtocol.parseSplitPaneId(
		JSON.stringify({ result: { pane: { pane_id: "w3:p2" }, type: "pane_split" } }),
	);

	assert.deepEqual(parsed, { ok: true, value: "w3:p2" });
});

test("parses caller geometry from a multi-pane layout", () => {
	const parsed = HerdrProtocol.parsePaneRect(
		JSON.stringify({
			result: {
				layout: {
					panes: [
						{ pane_id: "w3:p1", rect: { width: 100, height: 40 } },
						{ pane_id: "w3:p2", rect: { width: 39, height: 40 } },
					],
				},
			},
		}),
		"w3:p2",
	);

	assert.deepEqual(parsed, { ok: true, value: { width: 39, height: 40 } });
});

test("parses pane cwd and agent status", () => {
	const pane = HerdrProtocol.parsePaneCwd(
		JSON.stringify({ result: { pane: { cwd: "/fallback", foreground_cwd: "/project" } } }),
	);
	const agent = HerdrProtocol.parseAgentStatus(JSON.stringify({ result: { agent: { agent_status: "blocked" } } }));

	assert.deepEqual(pane, { ok: true, value: "/project" });
	assert.deepEqual(agent, { ok: true, value: "blocked" });
});

test("parses shell ownership from pane process information", () => {
	const parsed = HerdrProtocol.parseProcessInfo(
		JSON.stringify({
			result: {
				process_info: {
					shell_pid: 42,
					foreground_processes: [{ pid: 42, name: "nu" }],
				},
			},
		}),
	);

	assert.deepEqual(parsed, { ok: true, value: { shellPid: 42, foregroundPids: [42] } });
});

test("parses a complete child result without trusting unknown optional fields", () => {
	const parsed = HerdrProtocol.parseChildResult(
		JSON.stringify({
			version: 1,
			status: "completed",
			output: "Done",
			sessionFile: "/tmp/session.jsonl",
			provider: "openai-codex",
			model: "gpt-5.6-sol",
			thinking: "high",
			finishedAt: 123,
		}),
	);

	assert.deepEqual(parsed, {
		ok: true,
		value: {
			version: 1,
			status: "completed",
			output: "Done",
			sessionFile: "/tmp/session.jsonl",
			provider: "openai-codex",
			model: "gpt-5.6-sol",
			thinking: "high",
			finishedAt: 123,
		},
	});
});

test("rejects malformed Herdr and child responses", () => {
	assert.equal(HerdrProtocol.parseAgentStatus("not-json").ok, false);
	assert.equal(
		HerdrProtocol.parseChildResult(JSON.stringify({ version: 1, status: "completed", output: 12, finishedAt: 123 })).ok,
		false,
	);
});
