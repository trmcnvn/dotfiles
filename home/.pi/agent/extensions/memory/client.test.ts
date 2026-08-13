import { describe, expect, test } from "bun:test";
import { createMemoryClient, MemoryServiceError, type MemoryRecord } from "./client";

const record: MemoryRecord = {
	id: "global//default/preferences/shell",
	key: "preferences/shell",
	scope: "global",
	projectId: null,
	namespace: "default",
	title: "Shell preference",
	content: "Use Nushell examples.",
	tags: ["preference", "shell"],
	status: "active",
	staleAfter: null,
	createdAt: "2026-08-14T00:00:00.000Z",
	updatedAt: "2026-08-14T00:00:00.000Z",
	version: 1,
};

function apiResponse(value: unknown, status = 200): Response {
	return Response.json(value, { status });
}

describe("createMemoryClient", () => {
	test("sends authenticated writes and validates records", async () => {
		let capturedUrl = "";
		let capturedAuth = "";
		let capturedBody: unknown;
		const client = createMemoryClient({
			baseUrl: "https://memory.example/",
			token: "secret-token",
			fetch: async (input, init) => {
				capturedUrl = String(input);
				capturedAuth = new Headers(init?.headers).get("authorization") ?? "";
				capturedBody = JSON.parse(String(init?.body));
				return apiResponse({ ok: true, value: record });
			},
		});

		const result = await client.write({
			scope: "global",
			key: "preferences/shell",
			content: "Use Nushell examples.",
			expectedVersion: 0,
		});

		expect(capturedUrl).toBe("https://memory.example/v1/write");
		expect(capturedAuth).toBe("Bearer secret-token");
		expect(capturedBody).toMatchObject({ scope: "global", key: "preferences/shell", expectedVersion: 0 });
		expect(result).toEqual(record);
	});

	test("parses list, search, and delete results", async () => {
		const { content: _content, ...summary } = record;
		const responses = [
			apiResponse({ ok: true, value: { records: [{ ...summary, excerpt: "Nushell" }], nextCursor: "next" } }),
			apiResponse({ ok: true, value: [{ ...summary, excerpt: "Nushell" }] }),
			apiResponse({ ok: true, value: { deleted: true } }),
		];
		const client = createMemoryClient({
			baseUrl: "https://memory.example",
			token: "token",
			fetch: async () => responses.shift() ?? apiResponse({ ok: false, error: { code: "internal_error", message: "missing fixture" } }, 500),
		});

		expect(await client.list({ scope: "global" })).toMatchObject({ nextCursor: "next", records: [{ key: "preferences/shell" }] });
		expect(await client.search({ scope: "global", query: "nushell" })).toMatchObject([{ excerpt: "Nushell" }]);
		expect(await client.delete({ scope: "global", key: "preferences/shell" })).toEqual({ deleted: true });
	});

	test("preserves structured service errors", async () => {
		const client = createMemoryClient({
			baseUrl: "https://memory.example",
			token: "token",
			fetch: async () => apiResponse({
				ok: false,
				error: { code: "conflict", message: "Memory changed.", field: "expectedVersion" },
			}, 409),
		});

		const error = await client.write({ scope: "global", key: "key", content: "content" }).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(MemoryServiceError);
		expect(error).toMatchObject({ code: "conflict", status: 409, field: "expectedVersion", message: "Memory changed." });
	});

	test("rejects malformed successful responses", async () => {
		const client = createMemoryClient({
			baseUrl: "https://memory.example",
			token: "token",
			fetch: async () => apiResponse({ ok: true, value: { key: "incomplete" } }),
		});

		const error = await client.get({ scope: "global", key: "key" }).catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(MemoryServiceError);
		expect(error).toMatchObject({ code: "protocol" });
	});

	test("requires HTTPS except for local development", () => {
		expect(() => createMemoryClient({ baseUrl: "http://memory.example", token: "token" })).toThrow("must use HTTPS");
		expect(() => createMemoryClient({ baseUrl: "http://localhost:8787", token: "token" })).not.toThrow();
	});
});
