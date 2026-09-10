import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach } from "node:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { ACTIVITY_OUTPUT_BYTES, AgentActivityError, readSessionActivity } from "./activity.ts";

 type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
const scanCursorSchema = Type.Object({ scanOffset: Type.Number() }, { additionalProperties: true });
const mutableCursorSchema = Type.Object({
	offset: Type.Number(),
	scanOffset: Type.Number(),
}, { additionalProperties: true });

const roots = new Set<string>();
afterEach(async () => {
	await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
	roots.clear();
});

async function sessionFile(id = "session-one"): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-activity-"));
	roots.add(root);
	const path = join(root, "session.jsonl");
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3, id, cwd: root })}\n`);
	return path;
}

function entry(id: string, message: JsonValue): string {
	return `${JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date().toISOString(), message })}\n`;
}

test("reads assistant text, tool activity, errors, branches, and compaction without thinking", async () => {
	const path = await sessionFile();
	await appendFile(path, [
		entry("assistant-1", { role: "assistant", content: [
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "working" },
			{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "pwd" } },
		], stopReason: "toolUse" }),
		entry("result-1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "failed output" }], isError: true }),
		`${JSON.stringify({ type: "branch_summary", id: "branch-1", summary: "alternate work" })}\n`,
		`${JSON.stringify({ type: "compaction", id: "compact-1", summary: "older work" })}\n`,
	].join(""));
	const result = await readSessionActivity("worker-one", path);
	assert.match(result.activity, /assistant-1 message\/assistant/);
	assert.match(result.activity, /tool call call-1 bash/);
	assert.match(result.activity, /result-1 message\/toolResult.*error/);
	assert.match(result.activity, /branch-1 branch_summary/);
	assert.match(result.activity, /compact-1 compaction/);
	assert.doesNotMatch(result.activity, /private reasoning/);
	assert.equal(result.hasMore, false);
	assert.ok(Buffer.byteLength(result.activity) <= ACTIVITY_OUTPUT_BYTES);
});

test("does not advance over an incomplete UTF-8 trailing record", async () => {
	const path = await sessionFile();
	const complete = entry("assistant-1", { role: "assistant", content: [{ type: "text", text: "café" }] });
	const bytes = Buffer.from(complete, "utf8");
	const split = bytes.indexOf(Buffer.from("é", "utf8")) + 1;
	assert.ok(split > 0);
	await appendFile(path, bytes.subarray(0, split));
	const first = await readSessionActivity("worker-one", path);
	assert.equal(first.incompleteTrailingLine, true);
	assert.doesNotMatch(first.activity, /café/);
	await appendFile(path, bytes.subarray(split));
	const second = await readSessionActivity("worker-one", path, first.cursor);
	assert.match(second.activity, /café/);
	assert.doesNotMatch(second.activity, /�/);
});

test("paginates every short record across event and 64 KB limits", async () => {
	for (const count of [75, 800]) {
		const path = await sessionFile(`session-${count}`);
		await appendFile(path, Array.from({ length: count }, (_, index) => entry(`short-${index}`, { role: "assistant", content: [{ type: "text", text: `event-${index}-${"x".repeat(60)}` }] })).join(""));
		const seen = new Set<string>();
		let cursor: string | undefined;
		for (let page = 0; page < 100; page += 1) {
			const result = await readSessionActivity(`worker-${count}`, path, cursor);
			for (const match of result.activity.matchAll(/\[short-(\d+) /g)) seen.add(match[1] ?? "");
			cursor = result.cursor;
			if (!result.hasMore) break;
		}
		assert.equal(seen.size, count);
	}
});

test("retains a normal record boundary when a record straddles a 64 KB page", async () => {
	const path = await sessionFile();
	const statsHeader = await readFile(path);
	assert.ok(statsHeader.length > 0);
	const target = 65_520;
	const hiddenBase = { type: "message", id: "hidden", parentId: null, message: { role: "user", content: "" } };
	let hidden = `${JSON.stringify(hiddenBase)}\n`;
	const padding = Math.max(0, target - Buffer.byteLength(hidden));
	hidden = `${JSON.stringify({ ...hiddenBase, message: { role: "user", content: "x".repeat(padding) } })}\n`;
	await appendFile(path, hidden + entry("straddled", { role: "assistant", content: [{ type: "text", text: "kept" }] }));
	const first = await readSessionActivity("worker-one", path);
	assert.equal(first.hasMore, true);
	assert.doesNotMatch(first.activity, /straddled/);
	const second = await readSessionActivity("worker-one", path, first.cursor);
	assert.match(second.activity, /straddled/);
});

test("advances across complete oversized records and resumes incomplete oversized records", async () => {
	const path = await sessionFile();
	const oversized = entry("large", { role: "assistant", content: [{ type: "text", text: "🙂".repeat(40_000) }] });
	await appendFile(path, oversized);
	let skipped = await readSessionActivity("worker-one", path);
	assert.match(skipped.activity, /no assistant|oversized/);
	for (let page = 0; page < 5 && !skipped.activity.includes("oversized-record"); page += 1) {
		skipped = await readSessionActivity("worker-one", path, skipped.cursor);
	}
	assert.match(skipped.activity, /oversized-record/);
	assert.equal(skipped.hasMore, false);

	const partialPath = await sessionFile("session-two");
	await appendFile(partialPath, Buffer.from(oversized).subarray(0, 70_000));
	const partialOne = await readSessionActivity("worker-two", partialPath);
	const partialTwo = await readSessionActivity("worker-two", partialPath, partialOne.cursor);
	assert.equal(partialTwo.incompleteTrailingLine, true);
	await appendFile(partialPath, Buffer.from(oversized).subarray(70_000));
	let resumed = await readSessionActivity("worker-two", partialPath, partialTwo.cursor);
	for (let page = 0; page < 5 && !resumed.activity.includes("oversized-record"); page += 1) {
		resumed = await readSessionActivity("worker-two", partialPath, resumed.cursor);
	}
	assert.match(resumed.activity, /oversized-record/);
});

test("caps a rendered below-64 KB multiblock entry at a UTF-8 boundary", async () => {
	const path = await sessionFile();
	const blocks = Array.from({ length: 20 }, (_, index) => ({ type: "text", text: `${index}:${"🙂".repeat(100)}` }));
	const row = entry("many-blocks", { role: "assistant", content: blocks });
	assert.ok(Buffer.byteLength(row) < 64 * 1024);
	await appendFile(path, row);
	const result = await readSessionActivity("worker-one", path);
	assert.match(result.activity, /many-blocks/);
	assert.match(result.activity, /…$/);
	assert.doesNotMatch(result.activity, /�/);
	assert.ok(Buffer.byteLength(result.activity, "utf8") <= ACTIVITY_OUTPUT_BYTES);
});

test("stops at the total output limit and resumes every rendered entry", async () => {
	const path = await sessionFile();
	const count = 20;
	await appendFile(path, Array.from({ length: count }, (_, index) => entry(`total-${index}`, { role: "assistant", content: [{ type: "text", text: `${index}:${"x".repeat(1_500)}` }] })).join(""));
	const seen = new Set<string>();
	let cursor: string | undefined;
	let firstPageCount = 0;
	for (let page = 0; page < 10; page += 1) {
		const result = await readSessionActivity("worker-one", path, cursor);
		const ids = [...result.activity.matchAll(/\[total-(\d+) /g)].map((match) => match[1] ?? "");
		if (page === 0) {
			firstPageCount = ids.length;
			assert.equal(result.hasMore, true);
			assert.ok(Buffer.byteLength(result.activity, "utf8") <= ACTIVITY_OUTPUT_BYTES);
		}
		for (const id of ids) seen.add(id);
		cursor = result.cursor;
		if (!result.hasMore) break;
	}
	assert.ok(firstPageCount < count);
	assert.equal(seen.size, count);
});

test("reports malformed complete records and advances past them", async () => {
	const path = await sessionFile();
	await appendFile(path, "{bad json}\n");
	const first = await readSessionActivity("worker-one", path);
	assert.match(first.activity, /malformed.*invalid JSON/);
	const second = await readSessionActivity("worker-one", path, first.cursor);
	assert.equal(second.activity, "(no assistant/tool activity in this page)");
});

test("rejects same-inode rewrite continuity failures for normal and oversized records", async () => {
	const path = await sessionFile();
	await appendFile(path, entry("assistant-1", { role: "assistant", content: [{ type: "text", text: "hello" }] }));
	const normal = await readSessionActivity("worker-one", path);
	const normalBytes = await readFile(path);
	const hello = normalBytes.indexOf(Buffer.from("hello"));
	assert.ok(hello > 0);
	normalBytes[hello] = "j".charCodeAt(0);
	await writeFile(path, normalBytes);
	await assert.rejects(readSessionActivity("worker-one", path, normal.cursor), (error) => error instanceof AgentActivityError && error.code === "activity_file_changed");

	const oversizedPath = await sessionFile("session-oversized");
	await appendFile(oversizedPath, entry("large", { role: "assistant", content: [{ type: "text", text: "x".repeat(100_000) }] }));
	const scanning = await readSessionActivity("worker-large", oversizedPath);
	const cursor: unknown = JSON.parse(Buffer.from(scanning.cursor, "base64url").toString("utf8"));
	assert.ok(Value.Check(scanCursorSchema, cursor));
	const oversizedBytes = await readFile(oversizedPath);
	oversizedBytes[cursor.scanOffset - 1] = "y".charCodeAt(0);
	await writeFile(oversizedPath, oversizedBytes);
	await assert.rejects(readSessionActivity("worker-large", oversizedPath, scanning.cursor), (error) => error instanceof AgentActivityError && error.code === "activity_file_changed");
});

test("rejects cursor worker mismatch, file replacement, and truncation", async () => {
	const path = await sessionFile();
	await appendFile(path, entry("assistant-1", { role: "assistant", content: [{ type: "text", text: "hello" }] }));
	const first = await readSessionActivity("worker-one", path);
	await assert.rejects(readSessionActivity("worker-two", path, first.cursor), (error) => error instanceof AgentActivityError && error.code === "activity_cursor_mismatch");
	const decoded: unknown = JSON.parse(Buffer.from(first.cursor, "base64url").toString("utf8"));
	assert.ok(Value.Check(mutableCursorSchema, decoded));
	decoded.offset -= 1;
	decoded.scanOffset = decoded.offset;
	const middleCursor = Buffer.from(JSON.stringify(decoded)).toString("base64url");
	await assert.rejects(readSessionActivity("worker-one", path, middleCursor), (error) => error instanceof AgentActivityError && error.code === "activity_cursor_mismatch");

	const old = `${path}.old`;
	await rename(path, old);
	await writeFile(path, `${JSON.stringify({ type: "session", version: 3, id: "session-one", cwd: dirname(path) })}\n`);
	await assert.rejects(readSessionActivity("worker-one", path, first.cursor), (error) => error instanceof AgentActivityError && error.code === "activity_file_replaced");

	await rm(path);
	await rename(old, path);
	const current = await readSessionActivity("worker-one", path);
	await truncate(path, 0);
	await assert.rejects(readSessionActivity("worker-one", path, current.cursor), (error) => error instanceof AgentActivityError && (error.code === "activity_header_invalid" || error.code === "activity_file_truncated"));
});
