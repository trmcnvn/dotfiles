import { Buffer } from "node:buffer";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	GitHubMemoryStore,
	type GhCommandOptions,
	type GhCommandResult,
} from "./github-memory-store";
import type { MemoryLocation } from "./memory-location";
import { MemoryStore } from "./memory-store";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
	const directory = await mkdtemp(path.join(tmpdir(), "pi-github-memory-"));
	tempDirs.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function location(cacheDir: string): MemoryLocation {
	return {
		scope: "global",
		repositoryPath: "global.md",
		displayPath: "github:owner/pi-memory/global.md",
		cachePath: path.join(cacheDir, "cache", "global.md"),
		legacyPath: path.join(cacheDir, "MEMORY.md"),
	};
}

function success(stdout: string): GhCommandResult {
	return { stdout, stderr: "", code: 0 };
}

function failure(status: number): GhCommandResult {
	return { stdout: "", stderr: `gh: request failed (HTTP ${status})`, code: 1 };
}

function privateRepository(): GhCommandResult {
	return success(JSON.stringify({ private: true, full_name: "owner/pi-memory" }));
}

function remoteFile(content: string, sha = "blob-1"): GhCommandResult {
	return success(JSON.stringify({
		type: "file",
		encoding: "base64",
		content: Buffer.from(content, "utf8").toString("base64"),
		sha,
	}));
}

let shaCounter = 0;

function randomSha(): string {
	shaCounter += 1;
	return `sha-${shaCounter}`;
}

describe("GitHubMemoryStore", () => {
	test("reads GitHub content and refreshes the private local cache", async () => {
		const cacheDir = await createTempDir();
		const responses = [privateRepository(), remoteFile("# Memory\n\nRemote fact.\n")];
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async () => responses.shift() ?? failure(500),
		});
		const target = location(cacheDir);

		const result = await store.read(target);

		expect(result).toEqual({ content: "# Memory\n\nRemote fact.\n", source: "github" });
		expect(await readFile(target.cachePath, "utf8")).toBe(result.content);
	});

	test("uses cached memory when GitHub is temporarily unavailable", async () => {
		const cacheDir = await createTempDir();
		const target = location(cacheDir);
		await mkdir(path.dirname(target.cachePath), { recursive: true });
		await writeFile(target.cachePath, "Cached fact.\n", "utf8");
		const responses = [privateRepository(), failure(503)];
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async () => responses.shift() ?? failure(500),
		});

		const result = await store.read(target);

		expect(result.content).toBe("Cached fact.\n");
		expect(result.source).toBe("cache");
		expect(result.warning).toContain("GitHub memory is unavailable");
	});

	test("updates with the current blob SHA and sends content through stdin", async () => {
		const cacheDir = await createTempDir();
		const calls: Array<{ args: readonly string[]; options?: GhCommandOptions }> = [];
		const responses = [
			privateRepository(),
			remoteFile("# Memory\n", "current-sha"),
			success(JSON.stringify({ content: { sha: "next-sha" } })),
		];
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async (args, options) => {
				calls.push({ args, options });
				return responses.shift() ?? failure(500);
			},
		});
		const target = location(cacheDir);

		const result = await store.mutate(target, "Update global Pi memory", (existing) =>
			MemoryStore.append(existing, "Remote fact."),
		);

		expect(result.type).toBe("success");
		const write = calls[2];
		expect(write?.args).toContain("PUT");
		expect(write?.args).toContain("-");
		const payload: unknown = JSON.parse(write?.options?.input ?? "null");
		expect(payload).toMatchObject({ sha: "current-sha", message: "Update global Pi memory" });
		if (typeof payload !== "object" || payload === null || !("content" in payload) || typeof payload.content !== "string") {
			throw new Error("Expected encoded content in GitHub write payload");
		}
		expect(Buffer.from(payload.content, "base64").toString("utf8")).toContain("Remote fact.");
	});

	test("serializes repository writes across memory documents", async () => {
		const cacheDir = await createTempDir();
		let activeWrites = 0;
		let maximumActiveWrites = 0;
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async (args) => {
				if (!args.some((argument) => argument.includes("/contents/"))) return privateRepository();
				if (!args.includes("PUT")) return remoteFile("# Memory\n", "current-sha");
				activeWrites += 1;
				maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
				await new Promise((resolve) => setTimeout(resolve, 5));
				activeWrites -= 1;
				return success(JSON.stringify({ content: { sha: randomSha() } }));
			},
		});
		const global = location(cacheDir);
		const project: MemoryLocation = {
			...global,
			scope: "project",
			repositoryPath: "projects/app.md",
			displayPath: "github:owner/pi-memory/projects/app.md",
			cachePath: path.join(cacheDir, "cache", "projects", "app.md"),
		};

		await Promise.all([
			store.mutate(global, "Update global", (existing) => MemoryStore.append(existing, "Global fact.")),
			store.mutate(project, "Update project", (existing) => MemoryStore.append(existing, "Project fact.")),
		]);

		expect(maximumActiveWrites).toBe(1);
	});

	test("rejects a concurrent update instead of losing memory", async () => {
		const cacheDir = await createTempDir();
		const responses = [privateRepository(), remoteFile("# Memory\n", "stale-sha"), failure(409)];
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async () => responses.shift() ?? failure(500),
		});

		await expect(
			store.mutate(location(cacheDir), "Update global Pi memory", (existing) =>
				MemoryStore.append(existing, "New fact."),
			),
		).rejects.toThrow("changed concurrently");
	});

	test("refuses to use a public repository", async () => {
		const cacheDir = await createTempDir();
		const store = GitHubMemoryStore.create({
			repository: "owner/pi-memory",
			run: async () => success(JSON.stringify({ private: false })),
		});

		await expect(store.read(location(cacheDir))).rejects.toThrow("is public");
	});
});
